import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { createBaseSelectionCandidates } from "./baseSelection";

const id = "a".repeat(40);

test("base selection distinguishes local and P09 remote-tracking candidates", () => {
  const candidates = createBaseSelectionCandidates(state({ kind: "available", value: [{
    name: "origin",
    trackingRefs: [{ branchName: "main", trackingRef: "refs/custom/origin/main", commitId: id }],
    locallyKnownDefaultBranch: null,
  }] }));
  assert.deepEqual(candidates.map((candidate) => candidate.label), [
    "ローカル branch: feature",
    "取得済み Remote: origin/main",
  ]);
  assert.deepEqual(candidates[1].savedBase, {
    kind: "remoteTracking", remoteName: "origin", branchName: "main", trackingRef: "refs/custom/origin/main",
  });
});

test("remote failure still exposes local base candidates", () => {
  const candidates = createBaseSelectionCandidates(state({ kind: "unavailable", reason: "failed" }));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].savedBase.kind, "local");
});

function state(remotes: RepositoryState["remotes"]): RepositoryState {
  const refreshedAt = new Date(0);
  return {
    repository: { rootPath: "/repository" },
    currentLocation: { kind: "branch", branchName: "feature", head: { id, shortId: "aaaaaaa", subject: "head" }, detached: false },
    localBranches: [{ name: "feature", tipCommitId: id }],
    workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    history: [], operation: { kind: "normal" }, remotes,
    upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] },
    comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt,
  };
}
