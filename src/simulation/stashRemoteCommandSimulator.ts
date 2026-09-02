import type { GitCommand } from "../domain/gitCommand";
import type { RepositoryState } from "../domain/repositoryState";
import type { SimulationEvent, SimulationNote, SimulationResult } from "../domain/simulation";

type Base = Omit<SimulationResult, "kind" | "reason">;
export function simulateStashRemoteCommand(state: RepositoryState, command: GitCommand): SimulationResult {
  const base = { repository: state.repository, basedOnStateVersion: state.stateVersion, command, events: [] as readonly SimulationEvent[], warnings: [] as readonly SimulationNote[], assumptions: [] as readonly SimulationNote[], unknowns: [] as readonly SimulationNote[], risk: "normal" as const };
  switch (command.kind) {
    case "stashPush": return stashPush(state, command, base);
    case "stashList": return { ...base, kind: "supported", events: [{ kind: "noOp" }] };
    case "stashApply": return stashApplyPop(state, command, base, false);
    case "stashPop": return stashApplyPop(state, command, base, true);
    case "fetch": return fetch(state, command, base);
    case "push": return push(state, command, base);
    default: return { ...base, kind: "unsupported", reason: "commandNotImplemented" };
  }
}
function stashPush(state: RepositoryState, command: Extract<GitCommand, { kind: "stashPush" }>, base: Base): SimulationResult {
  if (state.operation.kind !== "normal") return { ...base, kind: "unsupported", reason: "operationNotNormal" };
  if (state.currentLocation.kind === "unborn") return { ...base, kind: "blocked", reason: "unbornHead" };
  if (state.workingTree.conflicts.length) return { ...base, kind: "blocked", reason: "stashCannotRunWithConflicts" };
  const tracked = state.workingTree.staged.length + state.workingTree.unstaged.length > 0;
  const untracked = command.includeUntracked && state.workingTree.untracked.length > 0;
  if (!tracked && !untracked) return { ...base, kind: "supported", events: [{ kind: "noOp" }] };
  return { ...base, kind: "supported", events: [{ kind: "stashCreated", ...(command.message === undefined ? {} : { message: command.message }) }, ...(tracked ? [{ kind: "trackedChangesStashed" } as const] : []), ...(untracked ? [{ kind: "untrackedChangesStashed" } as const] : [])] };
}
function stashApplyPop(state: RepositoryState, command: Extract<GitCommand, { kind: "stashApply" | "stashPop" }>, base: Base, pop: boolean): SimulationResult {
  if (state.operation.kind !== "normal") return { ...base, kind: "unsupported", reason: "operationNotNormal" };
  if (state.workingTree.conflicts.length) return { ...base, kind: "blocked", reason: "stashCannotRunWithConflicts" };
  const index = command.stashIndex ?? 0;
  if (state.stash.kind === "available" && !state.stash.value.some((entry) => entry.index === index)) return { ...base, kind: "blocked", reason: "stashEntryMissing" };
  const unknowns: SimulationNote[] = [{ code: "futureWorkingTreeAndIndexUnknown" }, { code: "stashApplyDoesNotGuaranteeStagedness" }];
  if (state.stash.kind === "unavailable") unknowns.push({ code: "stashTargetUnknown" });
  const events: SimulationEvent[] = state.stash.kind === "unavailable" ? [] : [{ kind: "stashChangesApplied", ...(command.stashIndex === undefined ? {} : { stashIndex: index }) }];
  if (pop && events.length) events.push({ kind: "stashEntryRemovedAfterSuccessfulApply", ...(command.stashIndex === undefined ? {} : { stashIndex: index }) });
  return { ...base, kind: "supported", events, risk: "caution", warnings: [{ code: "stashApplyMayConflict" }], unknowns };
}
function fetch(state: RepositoryState, command: Extract<GitCommand, { kind: "fetch" }>, base: Base): SimulationResult {
  const target = command.remote === undefined ? "default" as const : { remote: command.remote, configuration: state.remotes.kind === "unavailable" ? "unknown" as const : state.remotes.kind === "available" && state.remotes.value.some((remote) => remote.name === command.remote) ? "confirmed" as const : "notFound" as const };
  return { ...base, kind: "supported", events: [{ kind: "fetchRequested", target }, { kind: "remoteTrackingMayRefresh" }, { kind: "derivedRelationInvalidated", relation: "upstream" }, { kind: "derivedRelationInvalidated", relation: "comparison" }], risk: "caution", unknowns: [{ code: "futureTrackingRelationUnknown" }, ...(command.remote === undefined ? [{ code: "defaultTargetUnknown", operation: "fetch" } as const] : [])] };
}
function push(state: RepositoryState, command: Extract<GitCommand, { kind: "push" }>, base: Base): SimulationResult {
  const warnings: SimulationNote[] = [{ code: "liveRemoteStateUnknown" }, { code: "pushMayBeRejected" }];
  const unknowns: SimulationNote[] = [{ code: "futureTrackingRelationUnknown" }];
  if (state.workingTree.staged.length || state.workingTree.unstaged.length || state.workingTree.untracked.length) warnings.push({ code: "uncommittedChangesNotPushed" });
  if (command.target.kind === "default") {
    unknowns.push({ code: "defaultTargetUnknown", operation: "push" });
    return { ...base, kind: "supported", events: [{ kind: "pushRequested", target: "default" }, { kind: "derivedRelationInvalidated", relation: "upstream" }, { kind: "derivedRelationInvalidated", relation: "comparison" }], risk: "caution", warnings, unknowns };
  }
  const targetSpec = command.target;
  const localBranch = state.localBranches.find((branch) => branch.name === targetSpec.branch);
  const target = { remote: targetSpec.remote, branch: targetSpec.branch, ...(localBranch ? { localTipCommitId: localBranch.tipCommitId } : {}) };
  if (!localBranch) unknowns.push({ code: "pushSourceUnknown", branchName: targetSpec.branch });
  const events: SimulationEvent[] = [{ kind: "pushRequested", target }, { kind: "derivedRelationInvalidated", relation: "upstream" }, { kind: "derivedRelationInvalidated", relation: "comparison" }];
  if (command.setUpstream && localBranch && state.remotes.kind === "available" && state.remotes.value.some((remote) => remote.name === targetSpec.remote)) events.push({ kind: "branchUpstreamConfigured", branchName: targetSpec.branch, remoteName: targetSpec.remote, remoteBranchName: targetSpec.branch });
  else if (command.setUpstream) unknowns.push({ code: "upstreamConfigurationUnknown", remoteName: targetSpec.remote, branchName: targetSpec.branch });
  return { ...base, kind: "supported", events, risk: "caution", warnings, unknowns };
}
