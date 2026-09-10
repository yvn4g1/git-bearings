import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { createSidebarPresentation, type SidebarNode, WORKING_TREE_PATH_LIMIT } from "./sidebarPresentation";

const oid = "a".repeat(40);
const otherOid = "b".repeat(40);

test("snapshot presentation does not retain static fixture or unavailable facts", () => {
  assert.deepEqual(labels(createSidebarPresentation({ kind: "empty" })), ["Git状態をまだ読み取っていません"]);
  assert.deepEqual(labels(createSidebarPresentation({ kind: "loading", repositoryId: "a", rootPath: "/work/a" })), ["a", "Git状態を読み取り中…"]);
  const unavailable = createSidebarPresentation({ kind: "unavailable", repositoryId: "a", rootPath: "/work/a", reason: "core failed" });
  assert.deepEqual(labels(unavailable), ["a", "Git状態を安全に取得できません"]);
  assert.equal(unavailable[1].tooltip, "core failed");
});

test("current locations and comparison semantics are displayed without guessing", () => {
  const branch = presentation({ comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: commit(), ahead: 3, behind: 1 } } });
  assert.ok(labels(branch).includes("feature"));
  assert.ok(labels(branch).includes("mainとの関係"));
  assert.ok(labels(branch).includes("あなた側のみ 3 commits"));
  assert.ok(labels(branch).includes("main側のみ 1 commits"));

  const detached = presentation({ currentLocation: { kind: "detached", branchName: null, head: commit() , detached: true } });
  assert.ok(labels(detached).includes("detached HEAD"));
  assert.ok(!labels(detached).includes("feature"));

  const unborn = presentation({ currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false }, comparison: { kind: "notConfigured" } });
  assert.ok(labels(unborn).includes("まだcommitがありません"));
  assert.ok(labels(unborn).includes("基準branchがまだ設定されていません"));

  const exact = presentation({ comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: commit(), ahead: 0, behind: 0 } } });
  assert.ok(labels(exact).includes("現在、基準branch上です"));
  const sameTipDifferentRef = presentation({ comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: commit(), ahead: 0, behind: 0 } } });
  assert.ok(!labels(sameTipDifferentRef).includes("現在、基準branch上です"));
  assert.ok(labels(sameTipDifferentRef).includes("main側のみ 0 commits"));
  const unavailable = presentation({ comparison: { kind: "unavailable", reason: "comparison failed" } });
  assert.ok(labels(unavailable).includes("基準branchとの関係を取得できません"));
  const unknownBase = presentation({ comparison: { kind: "available", value: { baseRef: "refs/custom/unknown", mergeBase: commit(), ahead: 0, behind: 0 } } });
  assert.ok(labels(unknownBase).includes("refs/custom/unknownとの関係"));
});

test("working tree groups retain staged, unstaged, conflicts, renames, and copies", () => {
  const result = presentation({ workingTree: {
    staged: [{ path: "same.ts", kind: "modified" }, { path: "renamed.ts", originalPath: "old.ts", kind: "renamed" }, { path: "copied.ts", originalPath: "source.ts", kind: "copied" }],
    unstaged: [{ path: "same.ts", kind: "modified" }], untracked: ["new.ts"], conflicts: [{ path: "conflict.ts", kind: "bothModified" }],
  } });
  const all = labels(result);
  for (const expected of ["次のcommitに入る変更", "まだaddしていない変更", "未追跡", "競合", "old.ts → renamed.ts", "source.ts → copied.ts"]) assert.ok(all.includes(expected));
  assert.equal(all.filter((label) => label === "same.ts").length, 2);
  assert.ok(presentation({ workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] } }).some((node) => node.label === "作業中" && node.description === "変更なし"));
});

test("sidebar retains hostile repository strings as node data", () => {
  const path = `<img src=x onerror="alert(1)">.txt`;
  const branchName = `feature-<script>&`;
  const stashMessage = `stash <script>credential=secret</script>`;
  const nodes = presentation({
    currentLocation: { kind: "branch", branchName, head: commit(), detached: false },
    workingTree: { staged: [{ path, kind: "modified" }], unstaged: [], untracked: [], conflicts: [] },
    stash: { kind: "available", value: [{ index: 0, commitId: oid, message: stashMessage }] },
  });
  assert.ok(labels(nodes).includes(path));
  assert.ok(labels(nodes).includes(branchName));
  assert.equal(nodes.find((node) => node.id === "stash")?.children?.[0].description, stashMessage);
});

test("working tree limits displayed paths across buckets without changing fact counts", () => {
  const files = (prefix: string) => Array.from({ length: 400 }, (_, index) => `${prefix}-${index}.txt`);
  const nodes = presentation({ workingTree: {
    staged: files("staged").map((path) => ({ path, kind: "modified" as const })),
    unstaged: files("unstaged").map((path) => ({ path, kind: "modified" as const })),
    untracked: files("untracked"),
    conflicts: files("conflict").map((path) => ({ path, kind: "bothModified" as const })),
  } });
  const working = nodes.find((node) => node.id === "working")!;
  const groups = working.children!.filter((node) => node.children !== undefined);
  const displayedPaths = groups.flatMap((group) => group.children!).filter((node) => !node.id.endsWith(":omitted"));

  assert.equal(displayedPaths.length, WORKING_TREE_PATH_LIMIT);
  assert.deepEqual(groups.map((group) => group.description), ["Staged · 400件", "Unstaged · 400件", "Untracked · 400件", "Conflicts · 400件"]);
  assert.equal(groups[0].children?.at(-1)?.label, "staged-399.txt");
  assert.equal(groups[1].children?.at(-1)?.label, "unstaged-399.txt");
  assert.deepEqual(groups[2].children?.map((node) => node.label), ["untracked-0.txt", "untracked-1.txt", "untracked-2.txt", "untracked-3.txt", "untracked-4.txt", "untracked-5.txt", "untracked-6.txt", "untracked-7.txt", "untracked-8.txt", "untracked-9.txt", "untracked-10.txt", "untracked-11.txt", "untracked-12.txt", "untracked-13.txt", "untracked-14.txt", "untracked-15.txt", "untracked-16.txt", "untracked-17.txt", "untracked-18.txt", "untracked-19.txt", "untracked-20.txt", "untracked-21.txt", "untracked-22.txt", "untracked-23.txt", "untracked-24.txt", "untracked-25.txt", "untracked-26.txt", "untracked-27.txt", "untracked-28.txt", "untracked-29.txt", "untracked-30.txt", "untracked-31.txt", "untracked-32.txt", "untracked-33.txt", "untracked-34.txt", "untracked-35.txt", "untracked-36.txt", "untracked-37.txt", "untracked-38.txt", "untracked-39.txt", "untracked-40.txt", "untracked-41.txt", "untracked-42.txt", "untracked-43.txt", "untracked-44.txt", "untracked-45.txt", "untracked-46.txt", "untracked-47.txt", "untracked-48.txt", "untracked-49.txt", "untracked-50.txt", "untracked-51.txt", "untracked-52.txt", "untracked-53.txt", "untracked-54.txt", "untracked-55.txt", "untracked-56.txt", "untracked-57.txt", "untracked-58.txt", "untracked-59.txt", "untracked-60.txt", "untracked-61.txt", "untracked-62.txt", "untracked-63.txt", "untracked-64.txt", "untracked-65.txt", "untracked-66.txt", "untracked-67.txt", "untracked-68.txt", "untracked-69.txt", "untracked-70.txt", "untracked-71.txt", "untracked-72.txt", "untracked-73.txt", "untracked-74.txt", "untracked-75.txt", "untracked-76.txt", "untracked-77.txt", "untracked-78.txt", "untracked-79.txt", "untracked-80.txt", "untracked-81.txt", "untracked-82.txt", "untracked-83.txt", "untracked-84.txt", "untracked-85.txt", "untracked-86.txt", "untracked-87.txt", "untracked-88.txt", "untracked-89.txt", "untracked-90.txt", "untracked-91.txt", "untracked-92.txt", "untracked-93.txt", "untracked-94.txt", "untracked-95.txt", "untracked-96.txt", "untracked-97.txt", "untracked-98.txt", "untracked-99.txt", "untracked-100.txt", "untracked-101.txt", "untracked-102.txt", "untracked-103.txt", "untracked-104.txt", "untracked-105.txt", "untracked-106.txt", "untracked-107.txt", "untracked-108.txt", "untracked-109.txt", "untracked-110.txt", "untracked-111.txt", "untracked-112.txt", "untracked-113.txt", "untracked-114.txt", "untracked-115.txt", "untracked-116.txt", "untracked-117.txt", "untracked-118.txt", "untracked-119.txt", "untracked-120.txt", "untracked-121.txt", "untracked-122.txt", "untracked-123.txt", "untracked-124.txt", "untracked-125.txt", "untracked-126.txt", "untracked-127.txt", "untracked-128.txt", "untracked-129.txt", "untracked-130.txt", "untracked-131.txt", "untracked-132.txt", "untracked-133.txt", "untracked-134.txt", "untracked-135.txt", "untracked-136.txt", "untracked-137.txt", "untracked-138.txt", "untracked-139.txt", "untracked-140.txt", "untracked-141.txt", "untracked-142.txt", "untracked-143.txt", "untracked-144.txt", "untracked-145.txt", "untracked-146.txt", "untracked-147.txt", "untracked-148.txt", "untracked-149.txt", "untracked-150.txt", "untracked-151.txt", "untracked-152.txt", "untracked-153.txt", "untracked-154.txt", "untracked-155.txt", "untracked-156.txt", "untracked-157.txt", "untracked-158.txt", "untracked-159.txt", "untracked-160.txt", "untracked-161.txt", "untracked-162.txt", "untracked-163.txt", "untracked-164.txt", "untracked-165.txt", "untracked-166.txt", "untracked-167.txt", "untracked-168.txt", "untracked-169.txt", "untracked-170.txt", "untracked-171.txt", "untracked-172.txt", "untracked-173.txt", "untracked-174.txt", "untracked-175.txt", "untracked-176.txt", "untracked-177.txt", "untracked-178.txt", "untracked-179.txt", "untracked-180.txt", "untracked-181.txt", "untracked-182.txt", "untracked-183.txt", "untracked-184.txt", "untracked-185.txt", "untracked-186.txt", "untracked-187.txt", "untracked-188.txt", "untracked-189.txt", "untracked-190.txt", "untracked-191.txt", "untracked-192.txt", "untracked-193.txt", "untracked-194.txt", "untracked-195.txt", "untracked-196.txt", "untracked-197.txt", "untracked-198.txt", "untracked-199.txt", "残り 200 件は省略"]);
  assert.deepEqual(groups[3].children?.map((node) => node.label), ["残り 400 件は省略"]);
});

test("staged only shows only the staged group", () => {
  const all = labels(presentation({ workingTree: {
    staged: [{ path: "staged.ts", kind: "modified" }], unstaged: [], untracked: [], conflicts: [],
  } }));
  assert.ok(all.includes("次のcommitに入る変更"));
  assert.ok(!all.includes("まだaddしていない変更"));
  assert.ok(!all.includes("未追跡"));
  assert.ok(!all.includes("競合"));
});

test("unstaged only shows only the unstaged group", () => {
  const all = labels(presentation({ workingTree: {
    staged: [], unstaged: [{ path: "unstaged.ts", kind: "modified" }], untracked: [], conflicts: [],
  } }));
  assert.ok(all.includes("まだaddしていない変更"));
  assert.ok(!all.includes("次のcommitに入る変更"));
  assert.ok(!all.includes("未追跡"));
  assert.ok(!all.includes("競合"));
});

test("untracked only shows only the untracked group", () => {
  const all = labels(presentation({ workingTree: {
    staged: [], unstaged: [], untracked: ["untracked.ts"], conflicts: [],
  } }));
  assert.ok(all.includes("未追跡"));
  assert.ok(!all.includes("次のcommitに入る変更"));
  assert.ok(!all.includes("まだaddしていない変更"));
  assert.ok(!all.includes("競合"));
});

test("conflict only shows a separate conflict group", () => {
  const all = labels(presentation({ workingTree: {
    staged: [], unstaged: [], untracked: [], conflicts: [{ path: "conflict.ts", kind: "bothModified" }],
  } }));
  assert.ok(all.includes("競合"));
  assert.ok(!all.includes("まだaddしていない変更"));
  assert.ok(!all.includes("次のcommitに入る変更"));
  assert.ok(!all.includes("未追跡"));
});

test("base ref, upstream, stash, and partial unavailable facts stay distinct", () => {
  const remoteBase = presentation({
    remotes: { kind: "available", value: [{ name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/remotes/origin/main", commitId: otherOid }], locallyKnownDefaultBranch: null }] },
    comparison: { kind: "available", value: { baseRef: "refs/remotes/origin/main", mergeBase: commit(), ahead: 0, behind: 2 } },
    upstream: { kind: "available", value: { remoteName: "origin", branchName: "feature", trackingRef: "refs/remotes/origin/feature", relation: { kind: "available", value: { ahead: 1, behind: 0 } } } },
    stash: { kind: "available", value: [{ index: 0, commitId: oid, message: "WIP" }, { index: 1, commitId: otherOid, message: "second" }] },
  });
  const all = labels(remoteBase);
  assert.ok(all.includes("origin/mainとの関係"));
  assert.ok(all.includes("upstream: origin/feature"));
  assert.ok(all.includes("stash@{0}"));
  assert.ok(!labels(presentation({ stash: { kind: "available", value: [] } })).includes("Stash"));
  assert.ok(labels(presentation({ stash: { kind: "unavailable", reason: "stash failed" } })).includes("Stash情報を取得できません"));
  const localUpstream = presentation({ upstream: { kind: "available", value: { remoteName: ".", branchName: "main", trackingRef: "refs/heads/main", relation: { kind: "unavailable", reason: "no tip" } } } });
  assert.ok(labels(localUpstream).includes("ローカルupstream: main"));
  assert.ok(labels(localUpstream).includes("差分を取得できません"));
  const partial = presentation({ comparison: { kind: "unavailable", reason: "failed" } });
  assert.ok(labels(partial).includes("feature"));
  assert.ok(labels(partial).includes("upstreamは設定されていません"));
});

test("upstream unavailable is distinct from not configured", () => {
  const all = labels(presentation({ upstream: { kind: "unavailable", reason: "upstream read failed" } }));
  assert.ok(all.includes("upstream情報を取得できません"));
  assert.ok(!all.includes("upstreamは設定されていません"));
});

test("remote upstream relation unavailable retains the remote target and last-fetched context", () => {
  const nodes = presentation({ upstream: { kind: "available", value: {
    remoteName: "origin", branchName: "main", trackingRef: "refs/remotes/origin/main",
    relation: { kind: "unavailable", reason: "tracking ref is unavailable" },
  } } });
  const all = labels(nodes);
  assert.ok(all.includes("upstream: origin/main"));
  assert.ok(all.includes("差分を取得できません"));
  assert.ok(!all.includes("ローカルupstream: main"));
  assert.equal(nodes.find((node) => node.id === "upstream")?.children?.[0].description, "最後に取得したRemote情報");
  assert.equal(nodes.find((node) => node.id === "upstream")?.children?.[0].tooltip, "これはlive Remote状態ではなく、ローカルGitが最後に取得したRemote情報です。");
});

test("origin selection is available independently of upstream configuration", () => {
  const origin = { name: "origin", trackingRefs: [], locallyKnownDefaultBranch: null };
  for (const upstream of [{ kind: "notConfigured" as const }, { kind: "unavailable" as const, reason: "failed" }, { kind: "available" as const, value: { remoteName: ".", branchName: "main", trackingRef: "refs/heads/main", relation: { kind: "available" as const, value: { ahead: 0, behind: 0 } } } }]) {
    const node = presentation({ remotes: { kind: "available", value: [origin] }, upstream }).find((item) => item.id === "upstream");
    assert.deepEqual(node?.children?.find((item) => item.id === "remote:origin")?.selection, { kind: "remote", remoteName: "origin" });
  }
  assert.equal(presentation({ remotes: { kind: "available", value: [] } }).find((item) => item.id === "upstream")?.children?.some((item) => item.id === "remote:origin"), false);
});

test("multiple supplemental unavailable sections preserve core presentation", () => {
  const all = labels(presentation({
    comparison: { kind: "unavailable", reason: "comparison failed" },
    upstream: { kind: "unavailable", reason: "upstream failed" },
    stash: { kind: "unavailable", reason: "stash failed" },
  }));
  assert.ok(all.includes("基準branchとの関係を取得できません"));
  assert.ok(all.includes("upstream情報を取得できません"));
  assert.ok(all.includes("Stash情報を取得できません"));
  assert.ok(all.includes("あなたは今ここ"));
  assert.ok(all.includes("feature"));
  assert.ok(all.includes("作業中"));
  assert.ok(all.includes("変更なし"));
});

function presentation(overrides: Partial<RepositoryState> = {}): readonly SidebarNode[] {
  return createSidebarPresentation({ kind: "available", repositoryId: "repo", state: { ...baseState(), ...overrides } });
}

function baseState(): RepositoryState {
  return {
    repository: { rootPath: "/work/repository" }, currentLocation: { kind: "branch", branchName: "feature", head: commit(), detached: false },
    localBranches: [{ name: "feature", tipCommitId: oid }, { name: "main", tipCommitId: otherOid }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [], operation: { kind: "normal" },
    remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: commit(), ahead: 3, behind: 1 } }, stateVersion: 1, refreshedAt: new Date(0),
  };
}

function commit() { return { id: oid, shortId: "aaaaaaa", subject: "subject" }; }
function labels(nodes: readonly SidebarNode[]): string[] { return nodes.flatMap((node) => [node.label, ...labels(node.children ?? [])]); }
