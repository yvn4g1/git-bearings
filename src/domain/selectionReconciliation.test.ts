import { strict as assert } from "node:assert";
import test from "node:test";
import { reconcileSelection } from "./selectionReconciliation";
import type { RepositoryState } from "./repositoryState";

test("refresh falls back when selected facts disappear", () => {
  const state: RepositoryState = { repository: { rootPath: "/work" }, currentLocation: { kind: "branch", branchName: "main", detached: false, head: { id: "a", shortId: "a", subject: "a" } }, localBranches: [{ name: "main", tipCommitId: "a" }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [{ commit: { id: "a", shortId: "a", subject: "a" }, parentIds: [] }], operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date() };
  const snapshot = { kind: "available" as const, repositoryId: "repo", state };
  assert.deepEqual(reconcileSelection({ kind: "commit", commitId: "missing" }, snapshot), { kind: "overview" });
  assert.deepEqual(reconcileSelection({ kind: "branch", branchName: "main" }, snapshot), { kind: "branch", branchName: "main" });
});
