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
  const result = graph([a, b, c], { currentLocation: { kind: "branch", branchName: "feature", head: c.commit, detached: false }, localBranches: [{ name: "base", tipCommitId: b.commit.id }], comparison: { kind: "available", value: { baseRef: "refs/heads/base", mergeBase: a.commit, ahead: 1, behind: 1 } } });
  assert.ok(node(result, "c").roles.includes("current"));
  assert.ok(node(result, "b").roles.includes("base"));
  assert.ok(node(result, "a").roles.includes("mergeBase"));
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

function graph(history: readonly HistoryCommit[], overrides: Partial<RepositoryState> = {}) {
  return createCommitGraphPresentation({ ...state(history), ...overrides });
}

function node(result: ReturnType<typeof graph>, value: string) {
  const found = result.nodes.find((item) => item.commitId === id(value));
  assert.ok(found);
  return found;
}

function state(history: readonly HistoryCommit[]): RepositoryState {
  const head = history[0]?.commit ?? { id: id("x"), shortId: "xxxxxxx", subject: "x" };
  return { repository: { rootPath: "/repo" }, currentLocation: { kind: "branch", branchName: "feature", head, detached: false }, localBranches: [{ name: "feature", tipCommitId: head.id }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history, operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date(0) };
}
