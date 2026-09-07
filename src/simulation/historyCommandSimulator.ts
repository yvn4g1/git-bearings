import type { GitCommand } from "../domain/gitCommand";
import type { HistoryCommit, RepositoryState } from "../domain/repositoryState";
import type { PredictedCommit, SimulationEvent, SimulationNote, SimulationResult } from "../domain/simulation";

type Base = Omit<SimulationResult, "kind" | "reason">;
type KnownTarget = { readonly kind: "localBranch" | "remoteTracking"; readonly operand: string; readonly canonicalRef: string; readonly tipCommitId: string };
type Relation = "same" | "currentContainsTarget" | "currentAncestorOfTarget" | "diverged" | "unknown";

export function simulateHistoryCommand(state: RepositoryState, command: GitCommand): SimulationResult {
  const base: Base = { repository: state.repository, basedOnStateVersion: state.stateVersion, command, events: [], warnings: [], assumptions: [], unknowns: [], risk: "normal" };
  if (state.operation.kind !== "normal") return { ...base, kind: "unsupported", reason: "operationNotNormal" };
  if (state.workingTree.conflicts.length) return { ...base, kind: "blocked", reason: "conflictsPresent" };
  switch (command.kind) {
    case "merge": return merge(state, command, base);
    case "rebase": return rebase(state, command, base);
    case "pull": return pull(state, command, base);
    default: return { ...base, kind: "unsupported", reason: "commandNotImplemented" };
  }
}

function merge(state: RepositoryState, command: Extract<GitCommand, { kind: "merge" }>, base: Base): SimulationResult {
  const target = resolveTarget(state, command.branch);
  if (!target) return unknownTarget(base, command.branch);
  if (state.currentLocation.kind === "unborn") return pointerMove(state, base, target.tipCommitId);
  const relation = relationFor(state, target);
  if (relation === "same" || relation === "currentContainsTarget") return { ...base, kind: "supported", events: [{ kind: "noOp" }] };
  if (relation === "currentAncestorOfTarget") return withDirtyMergeWarning(state, pointerMove(state, base, target.tipCommitId));
  if (relation === "unknown") return withDirtyMergeWarning(state, { ...base, kind: "supported", unknowns: [{ code: "historyRelationUnknown" }] });
  const commit: PredictedCommit = { kind: "newMergeCommit", parentCommitIds: [state.currentLocation.head.id, target.tipCommitId] };
  const events: SimulationEvent[] = [{ kind: "commitCreated", commit }, ...moveToPredicted(state, commit), { kind: "derivedRelationInvalidated", relation: "comparison" }, { kind: "derivedRelationInvalidated", relation: "upstream" }];
  const result: SimulationResult = { ...base, kind: "supported", events, warnings: [{ code: "mergeMayConflict" }], unknowns: [{ code: "futureWorkingTreeAndIndexUnknown" }], risk: "caution" };
  return withDirtyMergeWarning(state, result);
}

function rebase(state: RepositoryState, command: Extract<GitCommand, { kind: "rebase" }>, base: Base): SimulationResult {
  if (state.currentLocation.kind === "unborn") return { ...base, kind: "blocked", reason: "unbornHead" };
  const target = resolveTarget(state, command.upstream);
  if (!target) return unknownTarget(base, command.upstream);
  const relation = relationFor(state, target);
  if (relation === "same" || relation === "currentContainsTarget") return withDirtyRebaseWarning(state, { ...base, kind: "supported", events: [{ kind: "noOp" }] });
  if (relation === "currentAncestorOfTarget") return withDirtyRebaseWarning(state, pointerMove(state, base, target.tipCommitId));
  const replay = replayRange(state, target);
  if (replay.kind === "unsupported") return { ...base, kind: "unsupported", reason: "mergeCommitRebaseNotModeled" };
  if (replay.kind === "unknown") return withDirtyRebaseWarning(state, { ...base, kind: "supported", risk: "caution", unknowns: [{ code: "rebaseReplayRangeUnknown" }] });
  const replacements: PredictedCommit[] = [];
  let basedOn: Extract<PredictedCommit, { kind: "rewrittenCommit" }>["basedOn"] = { kind: "existingCommit", id: target.tipCommitId };
  for (const originalCommitId of replay.commitIds) {
    const replacement: PredictedCommit = { kind: "rewrittenCommit", originalCommitId, basedOn };
    replacements.push(replacement);
    basedOn = { kind: "previousRewrittenCommit", originalCommitId };
  }
  const last = replacements[replacements.length - 1];
  const events: SimulationEvent[] = replacements.map((commit) => ({ kind: "commitCreated", commit }));
  events.push(...moveToPredicted(state, last), { kind: "derivedRelationInvalidated", relation: "comparison" }, { kind: "derivedRelationInvalidated", relation: "upstream" });
  const result: SimulationResult = { ...base, kind: "supported", events, warnings: [{ code: "rebaseMayConflict" }], unknowns: [{ code: "futureWorkingTreeAndIndexUnknown" }], risk: "caution" };
  return withDirtyRebaseWarning(state, result);
}

function pull(state: RepositoryState, command: Extract<GitCommand, { kind: "pull" }>, base: Base): SimulationResult {
  const target = command.target.kind === "default" ? "default" as const : { remote: command.target.remote, branch: command.target.branch };
  return { ...base, kind: "supported", events: [{ kind: "pullFetchRequested", target }, { kind: "pullIntegrationPlanned", method: command.rebase ? "rebase" : "unknown" }, { kind: "derivedRelationInvalidated", relation: "comparison" }, { kind: "derivedRelationInvalidated", relation: "upstream" }], warnings: [{ code: "pullMayConflict" }], unknowns: [{ code: "fetchedTipUnknown" }, ...(command.target.kind === "default" ? [{ code: "defaultTargetUnknown", operation: "pull" } as const] : []), ...(command.rebase ? [] : [{ code: "pullIntegrationMethodUnknown" } as const]), { code: "pullIntegrationOutcomeUnknown" }], risk: "caution" };
}

function resolveTarget(state: RepositoryState, operand: string): KnownTarget | undefined {
  const local = state.localBranches.find((branch) => branch.name === operand);
  if (local) return { kind: "localBranch", operand, canonicalRef: `refs/heads/${local.name}`, tipCommitId: local.tipCommitId };
  if (state.remotes.kind !== "available") return undefined;
  for (const remote of state.remotes.value) for (const tracking of remote.trackingRefs) {
    const shorthand = `${remote.name}/${tracking.branchName}`;
    if (operand === tracking.trackingRef || (operand === shorthand && tracking.trackingRef === `refs/remotes/${remote.name}/${tracking.branchName}`)) return { kind: "remoteTracking", operand, canonicalRef: tracking.trackingRef, tipCommitId: tracking.commitId };
  }
  return undefined;
}

function relationFor(state: RepositoryState, target: KnownTarget): Relation {
  if (state.currentLocation.kind === "unborn") return "unknown";
  const currentId = state.currentLocation.head.id;
  if (currentId === target.tipCommitId) return "same";
  const counts = comparisonCounts(state, target);
  if (counts) return counts.ahead === 0 && counts.behind === 0 ? "same" : counts.ahead > 0 && counts.behind === 0 ? "currentContainsTarget" : counts.ahead === 0 && counts.behind > 0 ? "currentAncestorOfTarget" : counts.ahead > 0 && counts.behind > 0 ? "diverged" : "unknown";
  if (hasPath(state.history, target.tipCommitId, currentId)) return "currentAncestorOfTarget";
  if (hasPath(state.history, currentId, target.tipCommitId)) return "currentContainsTarget";
  return "unknown";
}

function comparisonCounts(state: RepositoryState, target: KnownTarget): { readonly ahead: number; readonly behind: number } | undefined {
  if (state.comparison.kind === "available" && state.comparison.value.baseRef === target.canonicalRef) return state.comparison.value;
  if (state.currentLocation.kind === "branch" && state.upstream.kind === "available" && state.upstream.value.trackingRef === target.canonicalRef && state.upstream.value.relation.kind === "available") return state.upstream.value.relation.value;
  return undefined;
}

function hasPath(history: readonly HistoryCommit[], fromId: string, toId: string): boolean {
  const commits = new Map(history.map((entry) => [entry.commit.id, entry])); const pending = [fromId]; const seen = new Set<string>();
  while (pending.length) { const id = pending.pop()!; if (id === toId) return true; if (seen.has(id)) continue; seen.add(id); const entry = commits.get(id); if (entry) pending.push(...entry.parentIds); }
  return false;
}

function replayRange(state: RepositoryState, target: KnownTarget): { readonly kind: "ready"; readonly commitIds: readonly string[] } | { readonly kind: "unknown" } | { readonly kind: "unsupported" } {
  if (state.comparison.kind !== "available" || state.comparison.value.baseRef !== target.canonicalRef || state.comparison.value.mergeBase === null || state.comparison.value.ahead <= 0 || state.comparison.value.behind <= 0) return { kind: "unknown" };
  const commits = new Map(state.history.map((entry) => [entry.commit.id, entry])); const currentId = state.currentLocation.kind === "unborn" ? undefined : state.currentLocation.head.id; const baseId = state.comparison.value.mergeBase.id;
  const newestFirst: string[] = []; let id = currentId;
  while (id && id !== baseId) { const entry = commits.get(id); if (!entry) return { kind: "unknown" }; if (entry.parentIds.length > 1) return { kind: "unsupported" }; if (entry.parentIds.length !== 1) return { kind: "unknown" }; newestFirst.push(id); id = entry.parentIds[0]; }
  if (id !== baseId || newestFirst.length !== state.comparison.value.ahead) return { kind: "unknown" };
  return { kind: "ready", commitIds: newestFirst.reverse() };
}

function pointerMove(state: RepositoryState, base: Base, targetId: string): SimulationResult {
  const events: SimulationEvent[] = state.currentLocation.kind === "detached" ? [{ kind: "headDetachedMoved", target: { kind: "existingCommit", id: targetId } }] : [{ kind: "branchPointerMoved", branchName: state.currentLocation.branchName, target: { kind: "existingCommit", id: targetId } }, { kind: "headBranchRelationRetained", branchName: state.currentLocation.branchName }];
  return { ...base, kind: "supported", events: [...events, { kind: "derivedRelationInvalidated", relation: "comparison" }, { kind: "derivedRelationInvalidated", relation: "upstream" }] };
}
function moveToPredicted(state: RepositoryState, target: PredictedCommit): SimulationEvent[] { return state.currentLocation.kind === "detached" ? [{ kind: "headDetachedMoved", target }] : [{ kind: "branchPointerMoved", branchName: state.currentLocation.branchName, target }, { kind: "headBranchRelationRetained", branchName: state.currentLocation.branchName }]; }
function unknownTarget(base: Base, operand: string): SimulationResult { return { ...base, kind: "supported", unknowns: [{ code: "targetResolutionUnknown", operand }] }; }
function dirty(state: RepositoryState): boolean { return state.workingTree.staged.length + state.workingTree.unstaged.length + state.workingTree.untracked.length > 0; }
function withDirtyMergeWarning(state: RepositoryState, result: SimulationResult): SimulationResult { return dirty(state) && result.kind === "supported" && !result.events.some((event) => event.kind === "noOp") ? { ...result, risk: "caution", warnings: appendNote(result.warnings, { code: "dirtyMergeMayFail" }), unknowns: appendNote(result.unknowns, { code: "futureWorkingTreeAndIndexUnknown" }) } : result; }
function withDirtyRebaseWarning(state: RepositoryState, result: SimulationResult): SimulationResult {
  if (!dirty(state) || result.kind !== "supported") return result;
  const noOp = result.events.some((event) => event.kind === "noOp");
  return { ...result, risk: "caution", warnings: appendNote(result.warnings, { code: "dirtyRebaseMayBeRejected" }), unknowns: noOp ? result.unknowns : appendNote(result.unknowns, { code: "futureWorkingTreeAndIndexUnknown" }) };
}
function appendNote(notes: readonly SimulationNote[], note: SimulationNote): readonly SimulationNote[] { return notes.some((item) => item.code === note.code) ? notes : [...notes, note]; }
