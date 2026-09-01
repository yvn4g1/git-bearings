import { strict as assert } from "node:assert";
import test from "node:test";
import { reconcileSelection } from "./selectionReconciliation";
import type { RepositoryState } from "./repositoryState";

test("refresh falls back when selected facts disappear", () => {
  const state: RepositoryState = { repository: { rootPath: "/work" }, currentLocation: { kind: "branch", branchName: "main", detached: false, head: { id: "a", shortId: "a", subject: "a" } }, localBranches: [{ name: "main", tipCommitId: "a" }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [{ commit: { id: "a", shortId: "a", subject: "a" }, parentIds: [] }], operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date() };
  const snapshot = { kind: "available" as const, repositoryId: "repo", state };
  assert.deepEqual(reconcileSelection({ kind: "commit", commitId: "missing" }, snapshot), { kind: "overview" });
  assert.deepEqual(reconcileSelection({ kind: "branch", branchName: "main" }, snapshot), { kind: "branch", branchName: "main" });
  const tracked = { ...state, remotes: { kind: "available" as const, value: [{ name: "origin", trackingRefs: [], locallyKnownDefaultBranch: null }] }, upstream: { kind: "available" as const, value: { remoteName: "origin", branchName: "main", trackingRef: "refs/remotes/origin/main", relation: { kind: "available" as const, value: { ahead: 1, behind: 0 } } } } };
  assert.deepEqual(reconcileSelection({ kind: "unpushedCommits", upstreamRef: "refs/remotes/origin/main" }, { ...snapshot, state: tracked }), { kind: "unpushedCommits", upstreamRef: "refs/remotes/origin/main" });
  for (const relation of [{ kind: "available" as const, value: { ahead: 0, behind: 0 } }, { kind: "unavailable" as const, reason: "failed" }]) assert.deepEqual(reconcileSelection({ kind: "unpushedCommits", upstreamRef: "refs/remotes/origin/main" }, { ...snapshot, state: { ...tracked, upstream: { kind: "available", value: { ...tracked.upstream.value, relation } } } }), { kind: "overview" });
});

test("unborn current branch remains selectable without a local ref", () => {
  const state: RepositoryState = { repository: { rootPath: "/work" }, currentLocation: { kind: "unborn", branchName: "main", detached: false, head: null }, localBranches: [], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [], operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date() };
  const snapshot = { kind: "available" as const, repositoryId: "repo", state };
  assert.deepEqual(reconcileSelection({ kind: "branch", branchName: "main" }, snapshot), { kind: "branch", branchName: "main" });
  assert.deepEqual(reconcileSelection({ kind: "branch", branchName: "feature" }, snapshot), { kind: "overview" });
  assert.deepEqual(reconcileSelection({ kind: "head" }, snapshot), { kind: "head" });
});
