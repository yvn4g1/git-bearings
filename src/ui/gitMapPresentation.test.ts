import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { createGitMapPresentation } from "./gitMapPresentation";

const oid = "a".repeat(40);
const commit = { id: oid, shortId: "aaaaaaa", subject: "subject" };

test("empty, loading, and unavailable snapshots are safe", () => {
  assert.equal(createGitMapPresentation({ kind: "empty" }).message, "Git状態をまだ読み取っていません");
  assert.equal(createGitMapPresentation({ kind: "loading", repositoryId: "repo", rootPath: "/work/repo" }).message, "Git状態を読み取り中…");
  assert.equal(createGitMapPresentation({ kind: "unavailable", repositoryId: "repo", rootPath: "/work/repo", reason: "core failed" }).unavailableReason, "core failed");
});

test("working tree buckets retain their factual counts", () => {
  const map = presentation({ workingTree: {
    staged: [{ path: "same.ts", kind: "modified" }],
    unstaged: [{ path: "same.ts", kind: "modified" }, { path: "old.ts", kind: "deleted" }, { path: "new-name.ts", originalPath: "old-name.ts", kind: "renamed" }],
    untracked: ["new.ts"], conflicts: [{ path: "conflict.ts", kind: "bothModified" }],
  } });
  assert.deepEqual(map.workingTree, [{ label: "Modified", value: "1" }, { label: "Unstaged", value: "3" }, { label: "Untracked", value: "1" }, { label: "Conflicts", value: "1" }]);
  assert.deepEqual(map.staging, { label: "Staged", value: "1" });
  assert.equal(map.workingTree.some((item) => item.label.includes("files")), false);
});

test("local repository graph uses actual current state and creates no unborn commit", () => {
  const unborn = presentation({ currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false }, history: [] });
  assert.equal(unborn.graph.kind, "unborn");
  assert.equal(unborn.graph.nodes.some((node) => node.shortId === "aaaaaaa"), false);
  assert.equal(presentation({ history: [{ commit, parentIds: [] }] }).graph.nodes[0].subject, "subject");
});

test("remote absence, cached refs, and supplemental failure remain distinct", () => {
  assert.equal(presentation({ remotes: { kind: "available", value: [] } }).remoteMessage, "Remote は設定されていません");
  const remote = presentation({ remotes: { kind: "available", value: [{ name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/remotes/origin/main", commitId: oid }], locallyKnownDefaultBranch: { branchName: "main", trackingRef: "refs/remotes/origin/main" } }] } });
  assert.deepEqual(remote.remotes[0].facts, [{ label: "ローカルにある追跡ref", value: "1" }, { label: "ローカルで分かるdefault", value: "origin/main" }]);
  const unavailable = presentation({ remotes: { kind: "unavailable", reason: "remote failed" }, comparison: { kind: "unavailable", reason: "comparison failed" }, upstream: { kind: "unavailable", reason: "upstream failed" } });
  assert.equal(unavailable.remoteMessage, "Remote情報を取得できません");
  assert.equal(unavailable.remoteUnavailableReason, "remote failed");
  assert.equal(unavailable.graph.kind, "empty");
});

test("only origin is a normal Remote representative", () => {
  const fork = { name: "fork", trackingRefs: [], locallyKnownDefaultBranch: null };
  const origin = { name: "origin", trackingRefs: [], locallyKnownDefaultBranch: null };
  const withoutOrigin = presentation({ remotes: { kind: "available", value: [fork] } });
  assert.equal(withoutOrigin.remotes.length, 0); assert.equal(withoutOrigin.remoteMessage, "origin は設定されていません");
  const withOrigin = presentation({ remotes: { kind: "available", value: [fork, origin] } });
  assert.deepEqual(withOrigin.remotes.map((remote) => remote.name), ["origin"]);
});

test("upstream relation is sourced from RepositoryState", () => {
  const map = presentation({ upstream: { kind: "available", value: { remoteName: "origin", branchName: "feature", trackingRef: "refs/remotes/origin/feature", relation: { kind: "available", value: { ahead: 2, behind: 1 } } } } });
  assert.deepEqual(map.upstream, [{ label: "追跡", value: "upstream: origin/feature" }, { label: "あなた側のみ", value: "2" }, { label: "upstream側のみ", value: "1" }]);
});

test("base configuration is left to the detail layer without guessing", () => {
  const map = presentation({ comparison: { kind: "notConfigured" } });
  assert.equal(map.detailSnapshot.kind, "available");
  assert.equal((map.detailSnapshot as { state: RepositoryState }).state.comparison.kind, "notConfigured");
});

function presentation(overrides: Partial<RepositoryState> = {}) {
  return createGitMapPresentation({ kind: "available", repositoryId: "repo", state: { ...baseState(), ...overrides } });
}

function baseState(): RepositoryState {
  return { repository: { rootPath: "/work/repository" }, currentLocation: { kind: "branch", branchName: "feature", head: commit, detached: false }, localBranches: [{ name: "feature", tipCommitId: oid }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [], operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date(0) };
}
