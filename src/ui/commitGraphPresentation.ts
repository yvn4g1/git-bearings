import type { RepositoryState } from "../domain/repositoryState";

export type CommitGraphRole = "current" | "base" | "mergeBase";

export interface CommitGraphNode {
  readonly commitId: string;
  readonly shortId: string;
  readonly subject: string;
  readonly x: number;
  readonly y: number;
  readonly roles: readonly CommitGraphRole[];
  readonly visualState?: "selected" | "related";
}
export interface PredictionCommit { readonly id: string; readonly label: "Prediction"; readonly description: string; readonly x: number; readonly y: number; readonly visualState?: "selected" | "related"; }
export interface PredictionEdge { readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number; }
export interface PredictionPointer { readonly kind: "branch" | "head"; readonly label: string; readonly x: number; readonly y: number; readonly toX: number; readonly toY: number; }

export interface CommitGraphEdge {
  readonly parentCommitId: string;
  readonly childCommitId: string;
  readonly parentX: number;
  readonly parentY: number;
  readonly childX: number;
  readonly childY: number;
}

export interface CommitGraphOmission {
  readonly childCommitId: string;
  readonly x: number;
  readonly y: number;
}

export interface CommitGraphPresentation {
  readonly kind: "graph" | "empty" | "unavailable" | "unborn";
  readonly nodes: readonly CommitGraphNode[];
  readonly edges: readonly CommitGraphEdge[];
  readonly omissions: readonly CommitGraphOmission[];
  readonly width: number;
  readonly height: number;
  readonly message?: string;
  readonly unbornBranch?: string;
  readonly unbornHeadVisualState?: "selected" | "related";
  readonly unbornBranchVisualState?: "selected" | "related";
  readonly localBranches: readonly GraphRef[];
  readonly remoteTrackingRefs: readonly GraphRef[];
  readonly head?: GraphHead;
  readonly predictionCommits?: readonly PredictionCommit[];
  readonly predictionEdges?: readonly PredictionEdge[];
  readonly predictionPointers?: readonly PredictionPointer[];
}
export interface GraphRefBounds { readonly left: number; readonly top: number; readonly width: number; readonly height: number; }
export interface GraphRefConnector { readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number; }
export interface GraphRef { readonly kind: "local" | "remoteTracking"; readonly label: string; readonly targetCommitId: string; readonly x: number; readonly y: number; readonly targetY: number; readonly current: boolean; readonly bounds: GraphRefBounds; readonly connector: GraphRefConnector; readonly visualState?: "selected" | "related"; readonly revealed?: boolean; readonly remoteName?: string; readonly branchName?: string; readonly trackingRef?: string; }
export interface GraphHead { readonly targetKind: "branch" | "commit"; readonly targetCommitId: string; readonly x: number; readonly y: number; readonly targetY: number; readonly visualState?: "selected" | "related"; }

const X_STEP = 130;
const Y_STEP = 72;
const PADDING_X = 28;
const PADDING_Y = 32;
const GRAPH_SUBJECT_MAX_UNITS = 15;
const LOCAL_REF_MIN_WIDTH = 96;
const LOCAL_REF_MAX_WIDTH = 220;
const LOCAL_REF_CHAR_WIDTH = 7;
const LOCAL_REF_PADDING = 20;
const REF_HEIGHT = 20;
const REF_Y = 48;
const REF_FAN_STEP = 112;
const REF_GAP = 12;

export function createCommitGraphPresentation(state: RepositoryState): CommitGraphPresentation {
  if (state.history.length === 0) {
    return state.currentLocation.kind === "unborn" ? unborn(state.currentLocation.branchName) : empty("表示できる履歴がありません");
  }

  const entries = new Map<string, { readonly index: number; readonly parentIds: readonly string[]; readonly shortId: string; readonly subject: string }>();
  for (const [index, entry] of state.history.entries()) {
    if (entries.has(entry.commit.id)) return unavailable();
    entries.set(entry.commit.id, { index, parentIds: entry.parentIds, shortId: entry.commit.shortId, subject: entry.commit.subject });
  }

  try {
    const ranks = ranksFor(entries);
    const ordered = [...entries.keys()].sort((left, right) => compareEntries(entries, ranks, left, right));
    const lanes = lanesFor(entries, ranks, ordered);
    const currentId = state.currentLocation.kind === "unborn" ? undefined : state.currentLocation.head.id;
    const baseId = resolveBaseTip(state);
    const mergeBaseId = state.comparison.kind === "available" ? state.comparison.value.mergeBase?.id : undefined;
    const nodes = ordered.map((commitId) => {
      const entry = entries.get(commitId)!;
      const roles: CommitGraphRole[] = [];
      if (commitId === currentId) roles.push("current");
      if (commitId === baseId) roles.push("base");
      if (commitId === mergeBaseId) roles.push("mergeBase");
      return { commitId, shortId: entry.shortId, subject: compactGraphSubject(entry.subject), x: PADDING_X + ranks.get(commitId)! * X_STEP, y: PADDING_Y + lanes.get(commitId)! * Y_STEP + 72, roles };
    });
    const nodeById = new Map(nodes.map((node) => [node.commitId, node]));
    const edges: CommitGraphEdge[] = [];
    const omissions: CommitGraphOmission[] = [];
    for (const node of nodes) {
      const entry = entries.get(node.commitId)!;
      const visibleParents = entry.parentIds.filter((parentId) => nodeById.has(parentId));
      for (const parentId of visibleParents) {
        const parent = nodeById.get(parentId)!;
        edges.push({ parentCommitId: parentId, childCommitId: node.commitId, parentX: parent.x, parentY: parent.y, childX: node.x, childY: node.y });
      }
      if (entry.parentIds.some((parentId) => !nodeById.has(parentId))) {
        omissions.push({ childCommitId: node.commitId, x: Math.max(12, node.x - 48), y: node.y });
      }
    }
    const maxRank = Math.max(...ranks.values());
    const maxLane = Math.max(...lanes.values());
    const grouped = new Map<string, typeof state.localBranches>(); for (const branch of state.localBranches.filter((branch) => nodeById.has(branch.tipCommitId))) grouped.set(branch.tipCommitId, [...(grouped.get(branch.tipCommitId) ?? []), branch]);
    const localBranches = [...grouped.entries()].flatMap(([targetCommitId, branches]) => {
      const target = nodeById.get(targetCommitId)!;
      const isCurrent = (branch: typeof branches[number]) => state.currentLocation.kind === "branch" && branch.name === state.currentLocation.branchName;
      const orderedBranches = [...branches].sort((left, right) => Number(isCurrent(right)) - Number(isCurrent(left)) || left.name.localeCompare(right.name));
      let previousRight = Number.NEGATIVE_INFINITY;
      return orderedBranches.map((branch, index) => {
        const current = isCurrent(branch);
        const width = localRefWidth(branch.name);
        const preferredX = target.x + index * REF_FAN_STEP;
        const x = index === 0 ? target.x : Math.max(preferredX, previousRight + REF_GAP + width / 2);
        const ref = localRef(branch.name, targetCommitId, x, current ? REF_Y : target.y + 38, target.x, target.y, current, width);
        previousRight = ref.bounds.left + ref.bounds.width;
        return ref;
      });
    });
    const trackingFacts = state.remotes.kind !== "available" ? [] : state.remotes.value.flatMap((remote) => remote.trackingRefs.map((ref) => ({ remoteName: remote.name, branchName: ref.branchName, trackingRef: ref.trackingRef, commitId: ref.commitId }))).filter((ref) => nodeById.has(ref.commitId));
    const trackingGroups = new Map<string, typeof trackingFacts>(); for (const ref of trackingFacts) trackingGroups.set(ref.commitId, [...(trackingGroups.get(ref.commitId) ?? []), ref]);
    const remoteTrackingRefs = [...trackingGroups.entries()].flatMap(([targetCommitId, refs]) => [...refs].sort((a, b) => a.remoteName.localeCompare(b.remoteName) || a.branchName.localeCompare(b.branchName)).map((ref, index) => { const target = nodeById.get(targetCommitId)!; return { ...graphRef("remoteTracking", `${ref.remoteName}/${ref.branchName}`, targetCommitId, target.x, target.y + 30 + index * 22, target.x, target.y, false, 104), ...ref }; }));
    const currentBranch = localBranches.find((branch) => branch.current);
    const head = state.currentLocation.kind === "branch" && currentBranch ? { targetKind: "branch" as const, targetCommitId: state.currentLocation.head.id, x: currentBranch.x, y: 18, targetY: currentBranch.y - 12 } : state.currentLocation.kind === "detached" && nodeById.has(state.currentLocation.head.id) ? { targetKind: "commit" as const, targetCommitId: state.currentLocation.head.id, x: nodeById.get(state.currentLocation.head.id)!.x, y: 30, targetY: nodeById.get(state.currentLocation.head.id)!.y - 8 } : undefined;
    const refRight = Math.max(0, ...localBranches.map((branch) => branch.bounds.left + branch.bounds.width));
    return { kind: "graph", nodes, edges, omissions, localBranches, remoteTrackingRefs, head, predictionCommits: [], width: Math.max(PADDING_X * 2 + (maxRank + 1) * X_STEP + 56, refRight + PADDING_X), height: PADDING_Y * 2 + maxLane * Y_STEP + 104 };
  } catch {
    return unavailable();
  }
}

function compactGraphSubject(subject: string): string {
  let units = 0;
  let visible = "";
  const limitBeforeEllipsis = GRAPH_SUBJECT_MAX_UNITS - 1;
  for (const char of Array.from(subject)) {
    const charUnits = /[\u0000-\u00ff]/.test(char) ? 1 : 2;
    if (units + charUnits > limitBeforeEllipsis) return `${visible}…`;
    visible += char;
    units += charUnits;
  }
  return subject;
}

function localRef(label: string, targetCommitId: string, x: number, y: number, targetX: number, targetY: number, current: boolean, width: number): GraphRef {
  const ref = graphRef("local", label, targetCommitId, x, y, targetX, targetY, current, width);
  if (y <= targetY) return ref;
  return { ...ref, connector: { fromX: x, fromY: y - REF_HEIGHT / 2, toX: targetX, toY: targetY + 8 } };
}

function localRefWidth(label: string): number {
  const estimatedTextWidth = Array.from(label).length * LOCAL_REF_CHAR_WIDTH + LOCAL_REF_PADDING;
  return Math.min(LOCAL_REF_MAX_WIDTH, Math.max(LOCAL_REF_MIN_WIDTH, estimatedTextWidth));
}

function graphRef(kind: GraphRef["kind"], label: string, targetCommitId: string, x: number, y: number, targetX: number, targetY: number, current: boolean, width: number): GraphRef {
  return { kind, label, targetCommitId, x, y, targetY, current, bounds: { left: x - width / 2, top: y - REF_HEIGHT / 2, width, height: REF_HEIGHT }, connector: { fromX: x, fromY: y + REF_HEIGHT / 2, toX: targetX, toY: targetY - 8 } };
}

function ranksFor(entries: ReadonlyMap<string, { readonly parentIds: readonly string[] }>): ReadonlyMap<string, number> {
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  const rankFor = (commitId: string): number => {
    const known = ranks.get(commitId);
    if (known !== undefined) return known;
    if (visiting.has(commitId)) throw new Error("History contains a cycle.");
    visiting.add(commitId);
    const parents = entries.get(commitId)!.parentIds.filter((parentId) => entries.has(parentId));
    const rank = parents.length === 0 ? 0 : Math.max(...parents.map(rankFor)) + 1;
    visiting.delete(commitId);
    ranks.set(commitId, rank);
    return rank;
  };
  for (const id of entries.keys()) rankFor(id);
  return ranks;
}

function compareEntries(entries: ReadonlyMap<string, { readonly index: number }>, ranks: ReadonlyMap<string, number>, left: string, right: string): number {
  return ranks.get(left)! - ranks.get(right)! || entries.get(left)!.index - entries.get(right)!.index || left.localeCompare(right);
}

function lanesFor(entries: ReadonlyMap<string, { readonly parentIds: readonly string[] }>, ranks: ReadonlyMap<string, number>, ordered: readonly string[]): ReadonlyMap<string, number> {
  const lanes = new Map<string, number>();
  for (const id of ordered) {
    const parentLanes = entries.get(id)!.parentIds.map((parentId) => lanes.get(parentId)).filter((lane): lane is number => lane !== undefined).sort((a, b) => a - b);
    const usedAtRank = new Set(ordered.filter((other) => ranks.get(other) === ranks.get(id) && lanes.has(other)).map((other) => lanes.get(other)!));
    let lane = parentLanes.find((candidate) => !usedAtRank.has(candidate)) ?? 0;
    while (usedAtRank.has(lane)) lane += 1;
    lanes.set(id, lane);
  }
  return lanes;
}

function resolveBaseTip(state: RepositoryState): string | undefined {
  if (state.comparison.kind !== "available") return undefined;
  const baseRef = state.comparison.value.baseRef;
  const local = state.localBranches.filter((branch) => baseRef === `refs/heads/${branch.name}`).map((branch) => branch.tipCommitId);
  const remote = state.remotes.kind === "available"
    ? state.remotes.value.flatMap((item) => item.trackingRefs.filter((ref) => ref.trackingRef === baseRef).map((ref) => ref.commitId))
    : [];
  const ids = [...new Set([...local, ...remote])];
  return ids.length === 1 ? ids[0] : undefined;
}

function empty(message: string): CommitGraphPresentation { return { kind: "empty", nodes: [], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], predictionCommits: [], width: 0, height: 0, message }; }
function unborn(branchName: string): CommitGraphPresentation { return { kind: "unborn", nodes: [], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], predictionCommits: [], width: 0, height: 0, message: "まだ commit がありません", unbornBranch: branchName }; }
function unavailable(): CommitGraphPresentation { return { kind: "unavailable", nodes: [], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], predictionCommits: [], width: 0, height: 0, message: "履歴の関係を安全に表示できません" }; }
