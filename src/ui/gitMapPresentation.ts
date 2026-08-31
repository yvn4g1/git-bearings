import type { RepositoryState } from "../domain/repositoryState";
import { createCommitGraphPresentation, type CommitGraphPresentation } from "./commitGraphPresentation";
import type { RepositoryStateSnapshot } from "./repositoryStateSnapshot";

export interface GitMapItem { readonly label: string; readonly value: string; }
export interface WorkingTreePresentation { readonly kind: "clean" | "changes"; readonly unstagedCount: number; readonly modifiedCount: number; readonly untrackedCount: number; readonly conflictsCount: number; }
export interface StagingPresentation { readonly stagedCount: number; }
export type StashPresentation = { readonly kind: "none" } | { readonly kind: "shelf"; readonly count: number } | { readonly kind: "unavailable"; readonly reason: string; };
export interface GitMapUnknown { readonly label: string; readonly message: string; }
export interface GitMapRemote { readonly name: string; readonly facts: readonly GitMapItem[]; readonly liveRemote: GitMapUnknown; }
export interface GitMapPresentation {
  readonly status: "empty" | "loading" | "unavailable" | "available";
  readonly repository?: string;
  readonly message?: string;
  readonly unavailableReason?: string;
  readonly operationBanner?: string;
  readonly workingTree: WorkingTreePresentation;
  readonly staging: StagingPresentation;
  readonly stash: StashPresentation;
  readonly graph: CommitGraphPresentation;
  readonly remotes: readonly GitMapRemote[];
  readonly remoteMessage?: string;
  readonly remoteUnavailableReason?: string;
  readonly upstream: readonly GitMapItem[];
  readonly upstreamUnavailableReason?: string;
  readonly detailSnapshot: RepositoryStateSnapshot;
}

export function createGitMapPresentation(snapshot: RepositoryStateSnapshot): GitMapPresentation {
  if (snapshot.kind === "empty") return unavailable(snapshot, "Git状態をまだ読み取っていません");
  if (snapshot.kind === "loading") return unavailable(snapshot, "Git状態を読み取り中…");
  if (snapshot.kind === "unavailable") return unavailable(snapshot, "Git状態を安全に取得できません", snapshot.reason);
  const state = snapshot.state;
  const workingTree = state.workingTree;
  return {
    status: "available", repository: state.repository.rootPath, operationBanner: operationBanner(state),
    workingTree: { kind: workingTree.staged.length || workingTree.unstaged.length || workingTree.untracked.length || workingTree.conflicts.length ? "changes" : "clean", unstagedCount: workingTree.unstaged.length, modifiedCount: workingTree.unstaged.filter((change) => change.kind === "modified").length, untrackedCount: workingTree.untracked.length, conflictsCount: workingTree.conflicts.length },
    staging: { stagedCount: workingTree.staged.length }, stash: stashPresentation(state), graph: createCommitGraphPresentation(state), ...remoteFacts(state), detailSnapshot: snapshot,
  };
}

function unavailable(snapshot: Exclude<RepositoryStateSnapshot, { kind: "available" }>, message: string, reason?: string): GitMapPresentation {
  return { status: snapshot.kind, repository: snapshot.kind === "empty" ? undefined : snapshot.rootPath, message, unavailableReason: reason, workingTree: { kind: "clean", unstagedCount: 0, modifiedCount: 0, untrackedCount: 0, conflictsCount: 0 }, staging: { stagedCount: 0 }, stash: { kind: "none" }, graph: { kind: "empty", nodes: [], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], predictionCommits: [], width: 0, height: 0 }, remotes: [], upstream: [], detailSnapshot: snapshot };
}

function stashPresentation(state: RepositoryState): StashPresentation {
  if (state.stash.kind === "unavailable") return { kind: "unavailable", reason: state.stash.reason };
  return state.stash.value.length ? { kind: "shelf", count: state.stash.value.length } : { kind: "none" };
}

function remoteFacts(state: RepositoryState): Pick<GitMapPresentation, "remotes" | "remoteMessage" | "remoteUnavailableReason" | "upstream" | "upstreamUnavailableReason"> {
  const upstream = upstreamFacts(state);
  if (state.remotes.kind === "unavailable") return { remotes: [], remoteMessage: "Remote情報を取得できません", remoteUnavailableReason: state.remotes.reason, ...upstream };
  if (state.remotes.kind === "notConfigured" || state.remotes.value.length === 0) return { remotes: [], remoteMessage: "Remote は設定されていません", ...upstream };
  const origin = state.remotes.value.find((remote) => remote.name === "origin");
  return origin ? { remotes: [{ name: origin.name, facts: [{ label: "ローカルにある追跡ref", value: String(origin.trackingRefs.length) }, ...(origin.locallyKnownDefaultBranch ? [{ label: "ローカルで分かるdefault", value: `${origin.name}/${origin.locallyKnownDefaultBranch.branchName}` }] : [])], liveRemote: { label: "live Remote", message: "未確認（自動fetchしません）" } }], ...upstream } : { remotes: [], remoteMessage: "origin は設定されていません", ...upstream };
}

function upstreamFacts(state: RepositoryState): Pick<GitMapPresentation, "upstream" | "upstreamUnavailableReason"> {
  if (state.upstream.kind === "notConfigured") return { upstream: [{ label: "upstream", value: "設定されていません" }] };
  if (state.upstream.kind === "unavailable") return { upstream: [{ label: "upstream", value: "情報を取得できません" }], upstreamUnavailableReason: state.upstream.reason };
  const value = state.upstream.value;
  const target = value.remoteName === "." ? `ローカルupstream: ${value.branchName}` : `upstream: ${value.remoteName}/${value.branchName}`;
  if (value.relation.kind === "unavailable") return { upstream: [{ label: "追跡", value: target }, { label: "差分", value: "取得できません" }], upstreamUnavailableReason: value.relation.reason };
  const relation = value.relation.value;
  return { upstream: [{ label: "追跡", value: target }, { label: "あなた側のみ", value: String(relation.ahead) }, { label: "upstream側のみ", value: String(relation.behind) }] };
}

function operationBanner(state: RepositoryState): string | undefined {
  if (state.operation.kind === "merge") return "merge処理中";
  if (state.operation.kind === "rebase") return "rebase処理中";
  if (state.operation.kind === "unsupported") return `${state.operation.operationName}: Git処理の途中です`;
  return undefined;
}
