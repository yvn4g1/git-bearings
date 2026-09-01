import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { createExplanationPresentation } from "./explanationPresentation";

const oid = "a".repeat(40);
const commit = { id: oid, shortId: "aaaaaaa", subject: "subject <safe>" };

test("HEAD and branch explanations preserve ref relationships", () => {
  assert.match(explain({ kind: "head" }).level1, /feature/);
  assert.match(explain({ kind: "head" }).level2, /HEAD → branch → commit/);
  assert.match(explain({ kind: "head" }, { currentLocation: { kind: "detached", branchName: null, head: commit, detached: true } }).level1, /branchを経由せず/);
  assert.match(explain({ kind: "head" }, { currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false } }).level1, /まだ最初のcommitがありません/);
  const current = explain({ kind: "branch", branchName: "feature" });
  const other = explain({ kind: "branch", branchName: "main" });
  assert.match(current.level1, /現在のbranch/); assert.doesNotMatch(other.level1, /現在のbranch/);
  assert.match(current.level2, /履歴線そのものではなく/);
  const unborn = { currentLocation: { kind: "unborn" as const, branchName: "main", head: null, detached: false as const }, localBranches: [] };
  const unbornBranch = explain({ kind: "branch", branchName: "main" }, unborn);
  assert.match(unbornBranch.level1, /まだ最初のcommitがありません/); assert.doesNotMatch(unbornBranch.level1, /確認できません/);
  assert.match(explain({ kind: "branch", branchName: "feature" }, unborn).level1, /確認できません/);
  const outsideHistory = "b".repeat(40);
  const bounded = explain({ kind: "branch", branchName: "feature" }, { localBranches: [{ name: "feature", tipCommitId: outsideHistory }], history: [] });
  assert.match(bounded.level1, /bbbbbbb/); assert.match(bounded.level1, /履歴範囲では表示できません/); assert.doesNotMatch(bounded.level1, /subject/);
});

test("commit, working tree, and staging use only current bounded facts", () => {
  assert.match(explain({ kind: "commit", commitId: oid }, { history: [{ commit, parentIds: [] }] }).level1, /subject <safe>/);
  assert.match(explain({ kind: "workingTree", section: "overview" }).level1, /commitしていない変更はありません/);
  const stagedOnly = { workingTree: { staged: [{ path: "a", kind: "modified" as const }], unstaged: [], untracked: [], conflicts: [] } };
  const stagedWorkingTree = explain({ kind: "workingTree", section: "overview" }, stagedOnly);
  assert.match(stagedWorkingTree.level1, /Stagingへ未反映の変更はありません/); assert.doesNotMatch(stagedWorkingTree.level1, /commitしていない変更はありません/);
  assert.match(explain({ kind: "staging" }, stagedOnly).level1, /1 件/);
  const changed = { workingTree: { staged: [{ path: "a", kind: "modified" as const }], unstaged: [{ path: "b", kind: "modified" as const }], untracked: ["c"], conflicts: [{ path: "d", kind: "bothModified" as const }] } };
  assert.match(explain({ kind: "workingTree", section: "unstaged" }, changed).level1, /1 件/);
  assert.match(explain({ kind: "workingTree", section: "untracked" }, changed).level1, /追跡していない/);
  assert.match(explain({ kind: "workingTree", section: "conflicts" }, changed).level1, /競合/);
  const staging = explain({ kind: "staging" }, changed);
  assert.match(staging.level1, /1 件/); assert.match(staging.level2, /物理的に移動するものではありません/);
  assert.match(explain({ kind: "staging" }).level1, /記録されていません/);
});

test("Remote and upstream distinguish local tracking information and local upstream", () => {
  const remote = { name: "origin<unsafe>", trackingRefs: [{ branchName: "main", trackingRef: "refs/remotes/origin/main", commitId: oid }], locallyKnownDefaultBranch: null };
  const configured = { remotes: { kind: "available" as const, value: [remote] }, upstream: { kind: "available" as const, value: { remoteName: remote.name, branchName: "main", trackingRef: "refs/remotes/origin/main", relation: { kind: "available" as const, value: { ahead: 2, behind: 1 } } } } };
  const remoteExplanation = explain({ kind: "remote", remoteName: remote.name }, configured);
  assert.match(remoteExplanation.level1, /最後に取得した情報/); assert.match(remoteExplanation.level2, /live Remote branchそのものではありません/);
  const upstream = explain({ kind: "upstream", remoteName: remote.name, branchName: "main" }, configured);
  assert.match(upstream.level1, /追跡情報/); assert.match(upstream.level2, /base branchとは別/);
  const local = explain({ kind: "upstream", remoteName: ".", branchName: "main" }, { upstream: { kind: "available", value: { ...configured.upstream.value, remoteName: ".", relation: { kind: "unavailable", reason: "no relation" } } } });
  assert.match(local.level1, /Remoteではないローカルupstream/); assert.doesNotMatch(local.level1, /actual Remote/);
  assert.match(explain({ kind: "upstream", remoteName: "origin", branchName: "main" }).level1, /設定されていません/);
  assert.match(explain({ kind: "upstream", remoteName: "origin", branchName: "main" }, { upstream: { kind: "unavailable", reason: "failed" } }).level1, /取得できません/);
  assert.match(explain({ kind: "remote", remoteName: "origin" }, { remotes: { kind: "notConfigured" } }).level1, /設定されていません/);
  assert.match(explain({ kind: "remote", remoteName: "origin" }, { remotes: { kind: "unavailable", reason: "failed" } }).level1, /取得できません/);
});

test("comparison and stash avoid false historical and structural claims", () => {
  const comparison = explain({ kind: "branchComparison", baseRef: "refs/heads/main" }, { comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: commit, ahead: 2, behind: 3 } } });
  assert.match(comparison.level1, /あなた側のみ2commit/); assert.match(comparison.level2, /branch作成地点とは限りません/);
  assert.match(explain({ kind: "branchComparison", baseRef: "refs/heads/main" }, { comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: null, ahead: 0, behind: 0 } } }).level1, /共通祖先は現在確認できません/);
  assert.match(explain({ kind: "branchComparison", baseRef: "refs/heads/main" }, { comparison: { kind: "notConfigured" } }).level1, /設定されていません/);
  assert.match(explain({ kind: "branchComparison", baseRef: "refs/heads/main" }, { comparison: { kind: "unavailable", reason: "failed" } }).level1, /取得できません/);
  assert.match(explain({ kind: "stashShelf" }).level1, /0 件/);
  assert.match(explain({ kind: "stashShelf" }, { stash: { kind: "available", value: [{ index: 0, commitId: oid, message: "one" }, { index: 1, commitId: "b".repeat(40), message: "two" }] } }).level1, /2 件/);
  const stash = explain({ kind: "stash", stashCommitId: oid }, { stash: { kind: "available", value: [{ index: 1, commitId: oid, message: "WIP <unsafe>" }] } });
  assert.match(stash.level1, /WIP <unsafe>/); assert.match(stash.level2, /Git内部にShelfという領域があるわけではありません/);
  assert.match(explain({ kind: "stashShelf" }, { stash: { kind: "unavailable", reason: "failed" } }).level1, /取得できません/);
});

function explain(selection: Parameters<typeof createExplanationPresentation>[1], overrides: Partial<RepositoryState> = {}) {
  const result = createExplanationPresentation({ ...baseState(), ...overrides }, selection);
  assert.ok(result); return result;
}

function baseState(): RepositoryState {
  return { repository: { rootPath: "/work/repository" }, currentLocation: { kind: "branch", branchName: "feature", head: commit, detached: false }, localBranches: [{ name: "feature", tipCommitId: oid }, { name: "main", tipCommitId: oid }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [], operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date(0) };
}
