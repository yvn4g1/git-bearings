import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { createOverviewPresentation } from "./overviewPresentation";

const oid = "a".repeat(40);
const commit = () => ({ id: oid, shortId: "aaaaaaa", subject: "subject" });

test("snapshot states are represented without retaining old facts", () => {
  assert.equal(createOverviewPresentation({ kind: "empty" }).message, "Git状態をまだ読み取っていません");
  assert.equal(createOverviewPresentation({ kind: "loading", repositoryId: "a", rootPath: "/work/a" }).message, "Git状態を読み取り中…");
  const unavailable = createOverviewPresentation({ kind: "unavailable", repositoryId: "a", rootPath: "/work/a", reason: "core failed" });
  assert.equal(unavailable.message, "Git状態を安全に取得できません");
  assert.equal(unavailable.unavailableReason, "core failed");
});

test("current locations, comparison semantics, and operation banner stay factual", () => {
  const branch = available();
  assert.equal(section(branch, "current").meaning, "現在は feature branch上にいます。");
  assert.equal(section(branch, "comparison").meaning, "あなたの現在地だけが基準branchより先に進んでいます。");
  assert.equal(available({ currentLocation: { kind: "detached", branchName: null, head: commit(), detached: true } }).sections[0].meaning, "branchではなく、このcommitを直接見ています。");
  assert.equal(available({ currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false } }).sections[0].facts[1].value, "まだcommitがありません");
  assert.equal(section(available({ comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: commit(), ahead: 0, behind: 2 } } }), "comparison").meaning, "基準branch側に、あなたの現在地にはないcommitがあります。");
  assert.equal(section(available({ comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: commit(), ahead: 2, behind: 3 } } }), "comparison").meaning, "あなたの現在地と基準branchが、それぞれ別方向に進んでいます。");
  assert.equal(section(available({ comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: commit(), ahead: 0, behind: 0 } } }), "comparison").meaning, "現在、基準branch上です。");
  assert.equal(section(available({ comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: commit(), ahead: 0, behind: 0 } } }), "comparison").meaning, "現在は基準branchと同じcommitを指しています。");
  assert.match(section(available({ comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: null, ahead: 1, behind: 0 } } }), "comparison").meaning ?? "", /共通祖先/);
  assert.equal(section(available({ comparison: { kind: "notConfigured" } }), "comparison").facts[0].value, "基準branchがまだ設定されていません");
  assert.equal(section(available({ comparison: { kind: "unavailable", reason: "failed" } }), "comparison").unavailableReason, "failed");
  assert.equal(available({ operation: { kind: "merge" } }).operationBanner, "merge処理中");
  assert.equal(available({ operation: { kind: "rebase" } }).operationBanner, "rebase処理中");
  assert.equal(available({ operation: { kind: "unsupported", operationName: "cherry-pick" } }).operationBanner, "cherry-pick: Git処理の途中です");
  assert.equal(available({ operation: { kind: "normal" } }).operationBanner, undefined);
});

test("working tree meanings cover clean, mixed, and conflicts", () => {
  assert.equal(section(available(), "working").meaning, "commitしていない変更はありません。");
  assert.equal(section(available({ workingTree: tree(1, 0, 0, 0) }), "working").meaning, "次のcommitに入る変更があります。");
  assert.equal(section(available({ workingTree: tree(0, 1, 0, 0) }), "working").meaning, "まだaddしていない変更があります。");
  assert.equal(section(available({ workingTree: tree(0, 0, 1, 0) }), "working").meaning, "未追跡fileがあります。");
  assert.equal(section(available({ workingTree: tree(1, 1, 0, 0) }), "working").meaning, "commit対象と、まだaddしていない変更の両方があります。");
  assert.equal(section(available({ workingTree: tree(1, 0, 1, 0) }), "working").meaning, "commit対象と、まだaddしていない変更の両方があります。");
  assert.equal(section(available({ workingTree: tree(1, 1, 1, 1) }), "working").meaning, "競合が残っています。");
});

test("tracking keeps remote, local, unavailable, and partial states distinct", () => {
  assert.equal(section(available(), "upstream").meaning, "Remote追跡設定がない状態です。");
  assert.equal(section(available({ upstream: { kind: "unavailable", reason: "failed" } }), "upstream").unavailableReason, "failed");
  const remote = { kind: "available" as const, value: { remoteName: "origin", branchName: "main", trackingRef: "refs/remotes/origin/main", relation: { kind: "available" as const, value: { ahead: 1, behind: 0 } } } };
  assert.match(section(available({ upstream: remote }), "upstream").meaning ?? "", /最後に取得したRemote情報/);
  const equal = { ...remote, value: { ...remote.value, relation: { kind: "available" as const, value: { ahead: 0, behind: 0 } } } };
  assert.equal(section(available({ upstream: equal }), "upstream").meaning, "最後に取得したRemote情報との差分はありません。");
  const behind = { ...remote, value: { ...remote.value, relation: { kind: "available" as const, value: { ahead: 0, behind: 2 } } } };
  assert.match(section(available({ upstream: behind }), "upstream").meaning ?? "", /最後に取得したRemote情報/);
  const remoteUnavailable = { ...remote, value: { ...remote.value, relation: { kind: "unavailable" as const, reason: "no remote tip" } } };
  const unavailableRemoteSection = section(available({ upstream: remoteUnavailable }), "upstream");
  assert.equal(unavailableRemoteSection.facts[0].value, "upstream: origin/main");
  assert.equal(unavailableRemoteSection.meaning, "最後に取得したRemote情報との差分を取得できません。");
  assert.equal(unavailableRemoteSection.unavailableReason, "no remote tip");
  assert.doesNotMatch(unavailableRemoteSection.meaning ?? "", /ローカルupstream/);
  const local = { kind: "available" as const, value: { ...remote.value, remoteName: ".", relation: { kind: "unavailable" as const, reason: "no tip" } } };
  const unavailableLocalSection = section(available({ upstream: local }), "upstream");
  assert.equal(unavailableLocalSection.facts[0].value, "ローカルupstream: main");
  assert.equal(unavailableLocalSection.meaning, "ローカルupstreamとの差分を取得できません。");
  assert.equal(unavailableLocalSection.unavailableReason, "no tip");
  assert.doesNotMatch(unavailableLocalSection.meaning ?? "", /最後に取得したRemote情報/);
  const partial = available({ comparison: { kind: "unavailable", reason: "comparison" }, upstream: { kind: "unavailable", reason: "upstream" } });
  assert.equal(section(partial, "current").facts[0].value, "feature");
  assert.equal(section(partial, "working").facts[0].value, "0");
});

function available(overrides: Partial<RepositoryState> = {}) { return createOverviewPresentation({ kind: "available", repositoryId: "repo", state: { ...baseState(), ...overrides } }); }
function section(presentation: ReturnType<typeof available>, id: string) { const result = presentation.sections.find((candidate) => candidate.id === id); assert.ok(result); return result; }
function tree(staged: number, unstaged: number, untracked: number, conflicts: number) { return { staged: Array.from({ length: staged }, () => ({ path: "staged", kind: "modified" as const })), unstaged: Array.from({ length: unstaged }, () => ({ path: "unstaged", kind: "modified" as const })), untracked: Array.from({ length: untracked }, () => "untracked"), conflicts: Array.from({ length: conflicts }, () => ({ path: "conflict", kind: "bothModified" as const })) }; }
function baseState(): RepositoryState { return { repository: { rootPath: "/work/repository" }, currentLocation: { kind: "branch", branchName: "feature", head: commit(), detached: false }, localBranches: [{ name: "feature", tipCommitId: oid }, { name: "main", tipCommitId: oid }], workingTree: tree(0, 0, 0, 0), history: [], operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: commit(), ahead: 1, behind: 0 } }, stateVersion: 1, refreshedAt: new Date(0) }; }
