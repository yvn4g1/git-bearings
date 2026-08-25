import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { createSidebarPresentation, type SidebarNode } from "./sidebarPresentation";

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
