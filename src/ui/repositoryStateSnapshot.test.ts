import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { matchesSnapshotTarget, RepositoryStateSnapshotStore } from "./repositoryStateSnapshot";

test("snapshot store exposes empty, loading, available, unavailable, and notifications", () => {
  const store = new RepositoryStateSnapshotStore();
  const changes: string[] = [];
  const subscription = store.onDidChange((snapshot) => changes.push(snapshot.kind));
  assert.deepEqual(store.current, { kind: "empty" });
  store.set({ kind: "loading", repositoryId: "a", rootPath: "/a" });
  store.set({ kind: "available", repositoryId: "a", state: state("/a") });
  store.set({ kind: "unavailable", repositoryId: "b", rootPath: "/b", reason: "core failed" });
  store.clear();
  subscription.dispose();
  assert.deepEqual(changes, ["loading", "available", "unavailable", "empty"]);
  assert.deepEqual(store.current, { kind: "empty" });
});

test("a completed read only applies to the still-selected repository target", () => {
  const repositoryA = { id: "a", rootPath: "/a" };
  const repositoryB = { id: "b", rootPath: "/b" };
  assert.equal(matchesSnapshotTarget(repositoryA, "a", "/a"), true);
  assert.equal(matchesSnapshotTarget(repositoryB, "a", "/a"), false);
  assert.equal(matchesSnapshotTarget(undefined, "a", "/a"), false);
});

function state(rootPath: string): RepositoryState {
  const id = "a".repeat(40);
  return {
    repository: { rootPath }, currentLocation: { kind: "branch", branchName: "main", head: { id, shortId: "aaaaaaa", subject: "initial" }, detached: false },
    localBranches: [{ name: "main", tipCommitId: id }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [], operation: { kind: "normal" },
    remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date(0),
  };
}
