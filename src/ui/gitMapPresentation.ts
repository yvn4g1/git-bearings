import type { RepositoryState } from "../domain/repositoryState";
import type { DetailMode, SelectionState } from "../domain/appViewState";
import { createCommitGraphPresentation, type CommitGraphPresentation } from "./commitGraphPresentation";
import type { RepositoryStateSnapshot } from "./repositoryStateSnapshot";
import { createExplanationPresentation, type ExplanationPresentation } from "./explanationPresentation";
import type { CommitDetailState } from "../domain/commitDetail";
import type { CommandPreviewPresentation } from "./commandPreview";

export interface GitMapItem { readonly label: string; readonly value: string; }
export interface WorkingTreePresentation { readonly kind: "clean" | "changes"; readonly unstagedCount: number; readonly modifiedCount: number; readonly untrackedCount: number; readonly conflictsCount: number; readonly visualState?: "selected" | "related"; }
export interface StagingPresentation { readonly stagedCount: number; readonly visualState?: "selected" | "related"; }
export type StashPresentation = { readonly kind: "none" } | { readonly kind: "shelf"; readonly count: number; readonly visualState?: "selected" | "related" } | { readonly kind: "unavailable"; readonly reason: string; };
export interface GitMapUnknown { readonly label: string; readonly message: string; }
export interface GitMapRemote { readonly name: string; readonly facts: readonly GitMapItem[]; readonly liveRemote: GitMapUnknown; readonly visualState?: "selected" | "related"; }
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
  readonly upstreamSelection?: { readonly remoteName: string; readonly branchName: string; };
  readonly detailSnapshot: RepositoryStateSnapshot;
  readonly selection?: SelectionState;
  readonly detailIdentity?: string;
  readonly explanation?: ExplanationPresentation;
  readonly commitDetail?: CommitDetailState;
  readonly upstreamVisualState?: "selected" | "related";
  readonly commandPreview?: CommandPreviewPresentation;
  readonly detailMode?: DetailMode;
}

export function createGitMapPresentation(snapshot: RepositoryStateSnapshot, selection: SelectionState = { kind: "overview" }, commitDetail: CommitDetailState = { kind: "idle" }, commandPreview?: CommandPreviewPresentation, detailMode: DetailMode = "inspect"): GitMapPresentation {
  if (snapshot.kind === "empty") return unavailable(snapshot, snapshot.reason === "noRepository" ? "このworkspaceではGit Repositoryが見つかっていません。Git Bearingsは既存Repositoryの状態を読み取るツールです。" : "Git状態をまだ読み取っていません");
  if (snapshot.kind === "loading") return unavailable(snapshot, "Git状態を読み取り中…");
  if (snapshot.kind === "unavailable") return unavailable(snapshot, "Git状態を安全に取得できません", snapshot.reason);
  const state = snapshot.state;
  const workingTree = state.workingTree;
  return {
    status: "available", repository: state.repository.rootPath, operationBanner: operationBanner(state),
    workingTree: { kind: workingTree.unstaged.length || workingTree.untracked.length || workingTree.conflicts.length ? "changes" : "clean", unstagedCount: workingTree.unstaged.length, modifiedCount: workingTree.unstaged.filter((change) => change.kind === "modified").length, untrackedCount: workingTree.untracked.length, conflictsCount: workingTree.conflicts.length, ...(selection.kind === "workingTree" ? { visualState: "selected" as const } : {}) },
    staging: { stagedCount: workingTree.staged.length, ...(selection.kind === "staging" ? { visualState: "selected" as const } : {}) }, stash: selectedStash(stashPresentation(state), selection), graph: previewGraph(selectedGraph(createCommitGraphPresentation(state), state, selection), commandPreview), ...remoteFacts(state, selection), detailSnapshot: snapshot, selection, detailIdentity: selectionIdentity(selection), explanation: createExplanationPresentation(state, selection), ...(selection.kind === "commit" ? { commitDetail } : {}), ...(selection.kind === "upstream" ? { upstreamVisualState: "selected" as const } : {}), ...(commandPreview ? { commandPreview } : {}), detailMode,
  };
}

function previewGraph(graph: CommitGraphPresentation, preview: CommandPreviewPresentation | undefined): CommitGraphPresentation {
  if (!preview?.map || graph.kind !== "graph") return graph;
  const facts = new Map(graph.nodes.map((node) => [node.commitId, node]));
  const predictions = new Map<string, { readonly x: number; readonly y: number }>();
  const factRight = Math.max(0, ...graph.nodes.map((node) => node.x));
  const predictionStep = 130;
  const predictionTextRightPadding = 148;
  let nextX = factRight + 118;
  const predictionCommits = preview.map.predictions.map((item, index) => {
    const parents = item.parentCommitIds.map((id) => facts.get(id)).filter((item): item is NonNullable<typeof item> => item !== undefined);
    const basedOn = item.basedOn ? (item.basedOn.kind === "existing" ? facts.get(item.basedOn.id) : predictions.get(item.basedOn.id)) : undefined;
    const anchor = parents[0] ?? basedOn;
    const rewrittenOriginal = item.rewrittenFromCommitId ? facts.get(item.rewrittenFromCommitId) : undefined;
    const rewritten = rewrittenOriginal !== undefined && basedOn !== undefined;
    const point = rewritten
      ? { x: basedOn.x + predictionStep, y: basedOn.y }
      : { x: Math.max(anchor ? anchor.x + predictionStep : nextX, nextX), y: anchor ? anchor.y + (item.basedOn ? 34 : 0) : 48 + index * 34 };
    nextX = Math.max(nextX, point.x + predictionStep);
    predictions.set(item.id, point);
    return { id: item.id, label: "Prediction" as const, description: rewrittenOriginal?.subject ?? item.description, ...point };
  });
  const predictionEdges = preview.map.predictions.flatMap((item) => {
    const target = predictions.get(item.id)!;
    const existing = item.parentCommitIds.map((id) => facts.get(id)).filter((item): item is NonNullable<typeof item> => item !== undefined).map((from) => ({ fromX: from.x, fromY: from.y, toX: target.x, toY: target.y }));
    const basedOn = item.basedOn ? (item.basedOn.kind === "existing" ? facts.get(item.basedOn.id) : predictions.get(item.basedOn.id)) : undefined;
    return [...existing, ...(basedOn ? [{ fromX: basedOn.x, fromY: basedOn.y, toX: target.x, toY: target.y }] : [])];
  });
  const rewriteEdges = preview.map.predictions.flatMap((item) => {
    if (!item.rewrittenFromCommitId) return [];
    const from = facts.get(item.rewrittenFromCommitId);
    const target = predictions.get(item.id);
    return from && target ? [{ fromX: from.x, fromY: from.y, toX: target.x, toY: target.y }] : [];
  });
  const rewrittenOriginalCommitIds = preview.map.predictions.flatMap((item) => item.rewrittenFromCommitId ? [item.rewrittenFromCommitId] : []);
  const predictionPointers = preview.map.pointers.flatMap((pointer, index) => { const target = pointer.target.kind === "existing" ? facts.get(pointer.target.id) : predictions.get(pointer.target.id); if (!target) return []; const factualRefRight = pointer.kind === "branch" && pointer.target.kind === "existing" ? Math.max(target.x, ...graph.localBranches.filter((ref) => ref.targetCommitId === pointer.target.id).map((ref) => ref.bounds.left + ref.bounds.width + 52)) : target.x; return [{ label: pointer.label, x: factualRefRight, y: target.y - (pointer.kind === "branch" ? 48 : 78) - index * 18, toX: target.x, toY: target.y - 9, kind: pointer.kind }]; });
  const predictionTextRight = Math.max(0, ...predictionCommits.map((node) => node.x + predictionTextRightPadding));
  return { ...graph, predictionCommits, predictionEdges, rewriteEdges, rewrittenOriginalCommitIds, predictionPointers, width: Math.max(graph.width, nextX + 28, predictionTextRight, ...predictionPointers.map((pointer) => pointer.x + 52)) };
}

function unavailable(snapshot: Exclude<RepositoryStateSnapshot, { kind: "available" }>, message: string, reason?: string): GitMapPresentation {
  return { status: snapshot.kind, repository: snapshot.kind === "empty" ? undefined : snapshot.rootPath, message, unavailableReason: reason, workingTree: { kind: "clean", unstagedCount: 0, modifiedCount: 0, untrackedCount: 0, conflictsCount: 0 }, staging: { stagedCount: 0 }, stash: { kind: "none" }, graph: { kind: "empty", nodes: [], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], predictionCommits: [], width: 0, height: 0 }, remotes: [], upstream: [], detailSnapshot: snapshot, selection: { kind: "overview" }, detailIdentity: "Overview" };
}

function selectedGraph(graph: CommitGraphPresentation, state: RepositoryState, selection: SelectionState): CommitGraphPresentation {
  const primaryCommit = selection.kind === "commit" ? selection.commitId : undefined;
  const branch = selection.kind === "branch" ? state.localBranches.find((item) => item.name === selection.branchName) : undefined;
  const headId = state.currentLocation.kind === "unborn" ? undefined : state.currentLocation.head.id;
  const headSelected = selection.kind === "head";
  const revealTracking = selection.kind === "upstream" && selection.remoteName !== "." && state.upstream.kind === "available" && state.upstream.value.remoteName === selection.remoteName && state.upstream.value.branchName === selection.branchName;
  return { ...graph,
    ...(graph.kind === "unborn" ? { unbornHeadVisualState: selection.kind === "head" ? "selected" as const : selection.kind === "branch" && selection.branchName === graph.unbornBranch ? "related" as const : undefined, unbornBranchVisualState: selection.kind === "branch" && selection.branchName === graph.unbornBranch ? "selected" as const : selection.kind === "head" ? "related" as const : undefined } : {}),
    nodes: graph.nodes.map((node) => ({ ...node, visualState: node.commitId === primaryCommit ? "selected" : node.commitId === branch?.tipCommitId || (headSelected && node.commitId === headId) ? "related" : undefined })),
    localBranches: graph.localBranches.map((ref) => ({ ...ref, visualState: selection.kind === "branch" && ref.label === selection.branchName ? "selected" : ref.targetCommitId === primaryCommit || (headSelected && ref.current) ? "related" : undefined })),
    remoteTrackingRefs: graph.remoteTrackingRefs.map((ref) => ({ ...ref, revealed: revealTracking && ref.remoteName === selection.remoteName && ref.branchName === selection.branchName && ref.trackingRef === state.upstream.value.trackingRef, visualState: revealTracking && ref.remoteName === selection.remoteName && ref.branchName === selection.branchName && ref.trackingRef === state.upstream.value.trackingRef ? "related" : undefined })),
    head: graph.head ? { ...graph.head, visualState: headSelected ? "selected" : selection.kind === "branch" && state.currentLocation.kind === "branch" && selection.branchName === state.currentLocation.branchName ? "related" : primaryCommit === headId ? "related" : undefined } : undefined,
  };
}

function selectedStash(stash: StashPresentation, selection: SelectionState): StashPresentation { return stash.kind === "shelf" && (selection.kind === "stashShelf" || selection.kind === "stash") ? { ...stash, visualState: selection.kind === "stashShelf" ? "selected" : "related" } : stash; }

function selectionIdentity(selection: SelectionState): string {
  switch (selection.kind) { case "branch": return `branch ${selection.branchName}`; case "commit": return `commit ${selection.commitId.slice(0, 7)}`; case "workingTree": return selection.section === "overview" ? "Working Tree" : `Working Tree / ${selection.section}`; case "upstream": return `upstream ${selection.remoteName}/${selection.branchName}`; case "remote": return `Remote ${selection.remoteName}`; case "stash": return `stash ${selection.stashCommitId.slice(0, 7)}`; case "branchComparison": return `comparison ${selection.baseRef}`; case "unpushedCommits": return "local-only commits"; case "stashShelf": return "Stash Shelf"; case "head": return "HEAD"; case "staging": return "Staging"; case "overview": return "Overview"; }
}

function stashPresentation(state: RepositoryState): StashPresentation {
  if (state.stash.kind === "unavailable") return { kind: "unavailable", reason: state.stash.reason };
  return state.stash.value.length ? { kind: "shelf", count: state.stash.value.length } : { kind: "none" };
}

function remoteFacts(state: RepositoryState, selection: SelectionState): Pick<GitMapPresentation, "remotes" | "remoteMessage" | "remoteUnavailableReason" | "upstream" | "upstreamUnavailableReason" | "upstreamSelection"> {
  const upstream = upstreamFacts(state);
  if (state.remotes.kind === "unavailable") return { remotes: [], remoteMessage: "Remote情報を取得できません", remoteUnavailableReason: state.remotes.reason, ...upstream };
  if (state.remotes.kind === "notConfigured" || state.remotes.value.length === 0) return { remotes: [], remoteMessage: "Remote は設定されていません", ...upstream };
  const origin = state.remotes.value.find((remote) => remote.name === "origin");
  return origin ? { remotes: [{ name: origin.name, facts: origin.locallyKnownDefaultBranch ? [{ label: "最後に把握している既定branch", value: `${origin.name}/${origin.locallyKnownDefaultBranch.branchName}` }] : [], liveRemote: { label: "現在のRemote", message: "未確認（自動fetchしません）" }, ...(selection.kind === "remote" && selection.remoteName === origin.name ? { visualState: "selected" as const } : {}) }], ...upstream } : { remotes: [], remoteMessage: "origin は設定されていません", ...upstream };
}

function upstreamFacts(state: RepositoryState): Pick<GitMapPresentation, "upstream" | "upstreamUnavailableReason" | "upstreamSelection"> {
  if (state.upstream.kind === "notConfigured") return { upstream: [{ label: "追跡先", value: "設定されていません" }] };
  if (state.upstream.kind === "unavailable") return { upstream: [{ label: "追跡先", value: "情報を取得できません" }], upstreamUnavailableReason: state.upstream.reason };
  const value = state.upstream.value;
  const target = value.remoteName === "." ? `ローカルbranch ${value.branchName}` : `${value.remoteName}/${value.branchName}`;
  if (value.relation.kind === "unavailable") return { upstream: [{ label: "追跡先", value: target }, { label: "差分", value: "取得できません" }], upstreamUnavailableReason: value.relation.reason, upstreamSelection: { remoteName: value.remoteName, branchName: value.branchName } };
  const relation = value.relation.value;
  const current = state.currentLocation.kind === "branch" ? state.currentLocation.branchName : "現在地";
  const summary = relation.ahead === 0 && relation.behind === 0
    ? `${current} と ${target} は同じ地点です`
    : relation.ahead > 0 && relation.behind === 0
      ? `${current} は ${target} より ${relation.ahead} commit先です`
      : relation.ahead === 0 && relation.behind > 0
        ? `${current} は ${target} より ${relation.behind} commit後ろです`
        : `${current} と ${target} は分岐しています（あなた側 +${relation.ahead} / 追跡先側 +${relation.behind}）`;
  return { upstream: [{ label: "追跡先", value: target }, { label: "差分", value: summary }], upstreamSelection: { remoteName: value.remoteName, branchName: value.branchName } };
}

function operationBanner(state: RepositoryState): string | undefined {
  const conflicts = state.workingTree.conflicts.length ? `・未解決conflict ${state.workingTree.conflicts.length}件` : "";
  if (state.operation.kind === "merge") return `merge処理中${conflicts}`;
  if (state.operation.kind === "rebase") return `rebase処理中${conflicts}`;
  if (state.operation.kind === "unsupported") return `${state.operation.operationName}: Git処理の途中です`;
  return undefined;
}
