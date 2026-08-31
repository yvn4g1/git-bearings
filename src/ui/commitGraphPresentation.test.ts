import { strict as assert } from "node:assert";
import test from "node:test";
import type { HistoryCommit, RepositoryState } from "../domain/repositoryState";
import { createCommitGraphPresentation } from "./commitGraphPresentation";

const id = (value: string) => value.repeat(40).slice(0, 40);
const commit = (value: string, parents: readonly string[] = [], subject = value): HistoryCommit => ({ commit: { id: id(value), shortId: value.repeat(7).slice(0, 7), subject }, parentIds: parents.map(id) });

test("empty and linear histories are represented from parent facts", () => {
  assert.equal(graph([]).kind, "empty");
  const result = graph([commit("a"), commit("b", ["a"]), commit("c", ["b"])]);
  assert.equal(result.nodes.length, 3);
  assert.equal(result.edges.length, 2);
  assert.ok(result.edges.every((edge) => edge.parentX < edge.childX));
  assert.deepEqual(result.nodes.map((node) => node.commitId), [id("a"), id("b"), id("c")]);
});

test("branches and all merge parents receive distinct factual edges", () => {
  const result = graph([commit("m", ["c", "d"]), commit("d", ["b"]), commit("c", ["b"]), commit("b", ["a"]), commit("a")]);
  assert.equal(result.nodes.length, 5);
  assert.deepEqual(result.edges.filter((edge) => edge.childCommitId === id("m")).map((edge) => edge.parentCommitId).sort(), [id("c"), id("d")].sort());
  assert.notEqual(node(result, "c").y, node(result, "d").y);
});

test("three-parent commits retain every visible parent relation", () => {
  const result = graph([commit("z", ["c", "d", "e"]), commit("e", ["a"]), commit("d", ["a"]), commit("c", ["a"]), commit("a")]);
  assert.equal(result.edges.filter((edge) => edge.childCommitId === id("z")).length, 3);
});

test("missing parents become omission markers while roots do not", () => {
  const result = graph([commit("b", ["a"]), commit("root")]);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 0);
  assert.deepEqual(result.omissions.map((item) => item.childCommitId), [id("b")]);
});

test("current, base, and merge-base are resolved by facts rather than array position", () => {
  const a = commit("a"); const b = commit("b", ["a"]); const c = commit("c", ["a"]);
  const result = graph([a, b, c], { currentLocation: { kind: "branch", branchName: "feature", head: c.commit, detached: false }, localBranches: [{ name: "feature", tipCommitId: c.commit.id }, { name: "base", tipCommitId: b.commit.id }], comparison: { kind: "available", value: { baseRef: "refs/heads/base", mergeBase: a.commit, ahead: 1, behind: 1 } } });
  assert.ok(node(result, "c").roles.includes("current"));
  assert.ok(node(result, "b").roles.includes("base"));
  assert.ok(node(result, "a").roles.includes("mergeBase"));
  assert.equal(result.head?.targetKind, "branch");
  assert.equal(result.head?.targetCommitId, c.commit.id);
  assert.equal(result.localBranches.find((branch) => branch.current)?.targetCommitId, c.commit.id);
});

test("detached HEAD has no branch label and unborn history creates no commit", () => {
  const only = commit("a");
  const detached = graph([only], { currentLocation: { kind: "detached", branchName: null, head: only.commit, detached: true }, localBranches: [] });
  assert.equal(detached.head?.targetKind, "commit");
  assert.equal(detached.localBranches.length, 0);
  assert.equal(graph([], { currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false } }).nodes.length, 0);
});

test("unborn and out-of-snapshot refs have no fake commit target", () => {
  const unborn = graph([], { currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false } });
  assert.equal(unborn.kind, "unborn"); assert.equal(unborn.unbornBranch, "main"); assert.equal(unborn.nodes.length, 0); assert.equal(unborn.localBranches.length, 0);
  const visible = commit("a"); const hidden = id("h");
  const result = graph([visible], { localBranches: [{ name: "visible", tipCommitId: visible.commit.id }, { name: "hidden", tipCommitId: hidden }], remotes: { kind: "available", value: [{ name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/cache/custom", commitId: visible.commit.id }, { branchName: "hidden", trackingRef: "refs/cache/hidden", commitId: hidden }], locallyKnownDefaultBranch: null }] } });
  assert.deepEqual(result.localBranches.map((ref) => ref.label), ["visible"]); assert.deepEqual(result.remoteTrackingRefs.map((ref) => ref.label), ["origin/main"]); assert.equal(result.nodes.some((node) => node.commitId === hidden), false);
});

test("ref overlays use current branch coordinates and avoid local/remote collisions", () => {
  const only = commit("a");
  const result = graph([only], { currentLocation: { kind: "branch", branchName: "zzz-current", head: only.commit, detached: false }, localBranches: [{ name: "aaa", tipCommitId: only.commit.id }, { name: "zzz-current", tipCommitId: only.commit.id }], remotes: { kind: "available", value: [{ name: "fork", trackingRefs: [{ branchName: "main", trackingRef: "refs/cache/fork", commitId: only.commit.id }], locallyKnownDefaultBranch: null }, { name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/cache/origin", commitId: only.commit.id }], locallyKnownDefaultBranch: null }] } });
  const current = result.localBranches.find((branch) => branch.current)!;
  assert.equal(result.head?.x, current.x); assert.equal(result.head?.targetY, current.y - 12);
  assert.equal(new Set(result.localBranches.map((branch) => branch.y)).size, 2);
  assert.equal(new Set(result.remoteTrackingRefs.map((ref) => ref.y)).size, 2);
  assert.ok(result.remoteTrackingRefs.every((ref) => !result.localBranches.some((branch) => branch.y === ref.y)));
  assert.deepEqual(result.remoteTrackingRefs.map((ref) => ref.label), ["fork/main", "origin/main"]);
});

test("same current and base commit carries both roles; unavailable comparison keeps graph", () => {
  const only = commit("a");
  const same = graph([only], { localBranches: [{ name: "feature", tipCommitId: only.commit.id }], comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: only.commit, ahead: 0, behind: 0 } } });
  assert.deepEqual(node(same, "a").roles, ["current", "base", "mergeBase"]);
  assert.equal(graph([only], { comparison: { kind: "unavailable", reason: "no base" } }).kind, "graph");
});

test("remote base resolution and unrelated histories never invent a common edge", () => {
  const a = commit("a"); const b = commit("b");
  const result = graph([a, b], {
    currentLocation: { kind: "branch", branchName: "feature", head: a.commit, detached: false },
    remotes: { kind: "available", value: [{ name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/remotes/origin/main", commitId: b.commit.id }], locallyKnownDefaultBranch: null }] },
    comparison: { kind: "available", value: { baseRef: "refs/remotes/origin/main", mergeBase: null, ahead: 1, behind: 1 } },
  });
  assert.ok(node(result, "b").roles.includes("base"));
  assert.equal(result.edges.length, 0);
  assert.equal(result.nodes.some((item) => item.roles.includes("mergeBase")), false);
});

test("bounded history is rendered as supplied without inventing or trimming commits", () => {
  const externalParentId = "f".repeat(40);
  const bounded = Array.from({ length: 51 }, (_, index): HistoryCommit => {
    const commitId = index.toString(16).padStart(40, "0");
    const parentId = index === 0 ? externalParentId : (index - 1).toString(16).padStart(40, "0");
    return { commit: { id: commitId, shortId: commitId.slice(0, 7), subject: `commit ${index}` }, parentIds: [parentId] };
  });
  const root: HistoryCommit = { commit: { id: "e".repeat(40), shortId: "eeeeeee", subject: "root" }, parentIds: [] };
  const current = bounded[50].commit;
  const base = bounded[40].commit;
  const mergeBase = bounded[20].commit;
  const result = graph([...bounded, root], {
    currentLocation: { kind: "branch", branchName: "feature", head: current, detached: false },
    localBranches: [{ name: "feature", tipCommitId: current.id }, { name: "base", tipCommitId: base.id }],
    comparison: { kind: "available", value: { baseRef: "refs/heads/base", mergeBase, ahead: 10, behind: 0 } },
  });
  assert.equal(result.nodes.length, 52);
  assert.deepEqual(new Set(result.nodes.map((node) => node.commitId)), new Set([...bounded, root].map((entry) => entry.commit.id)));
  assert.equal(result.nodes.some((node) => node.commitId === externalParentId), false);
  assert.deepEqual(result.omissions.map((item) => item.childCommitId), [bounded[0].commit.id]);
  assert.equal(result.omissions.some((item) => item.childCommitId === root.commit.id), false);
  assert.ok(nodeById(result, current.id).roles.includes("current"));
  assert.ok(nodeById(result, base.id).roles.includes("base"));
  assert.ok(nodeById(result, mergeBase.id).roles.includes("mergeBase"));
});

function graph(history: readonly HistoryCommit[], overrides: Partial<RepositoryState> = {}) {
  return createCommitGraphPresentation({ ...state(history), ...overrides });
}

function node(result: ReturnType<typeof graph>, value: string) {
  const found = result.nodes.find((item) => item.commitId === id(value));
  assert.ok(found);
  return found;
}

function nodeById(result: ReturnType<typeof graph>, commitId: string) {
  const found = result.nodes.find((item) => item.commitId === commitId);
  assert.ok(found);
  return found;
}

function state(history: readonly HistoryCommit[]): RepositoryState {
  const head = history[0]?.commit ?? { id: id("x"), shortId: "xxxxxxx", subject: "x" };
  return { repository: { rootPath: "/repo" }, currentLocation: { kind: "branch", branchName: "feature", head, detached: false }, localBranches: [{ name: "feature", tipCommitId: head.id }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history, operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date(0) };
}
