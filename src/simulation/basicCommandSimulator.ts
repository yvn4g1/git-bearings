import type { GitCommand } from "../domain/gitCommand";
import type { FileChange, RepositoryState } from "../domain/repositoryState";
import type { SimulationEvent, SimulationNote, SimulationResult } from "../domain/simulation";

export function simulateBasicGitCommand(state: RepositoryState, command: GitCommand): SimulationResult {
  const base = { repository: state.repository, basedOnStateVersion: state.stateVersion, command, events: [] as readonly SimulationEvent[], warnings: [] as readonly SimulationNote[], assumptions: [] as readonly SimulationNote[], unknowns: [] as readonly SimulationNote[], risk: "normal" as const };
  if (state.operation.kind !== "normal") return { ...base, kind: "unsupported", reason: "operationNotNormal" };
  switch (command.kind) {
    case "add": return add(state, command, base);
    case "unstage": return unstage(state, command, base);
    case "commit": return commit(state, command, base);
    case "switch": return command.create ? switchCreate(state, command, base) : switchExisting(state, command, base);
    default: return { ...base, kind: "unsupported", reason: "commandNotImplemented" };
  }
}

type Base = Omit<SimulationResult, "kind" | "reason">;
function add(state: RepositoryState, command: Extract<GitCommand, { kind: "add" }>, base: Base): SimulationResult {
  const paths = command.target.kind === "repositoryRoot" ? [...state.workingTree.unstaged.map((item) => item.path), ...state.workingTree.untracked] : command.target.paths;
  const stagedPaths = new Set(state.workingTree.staged.map((item) => item.path));
  const events: SimulationEvent[] = []; const unknowns: SimulationNote[] = [];
  for (const path of paths) {
    if (hasConflict(state, path)) { unknowns.push({ code: "conflictResolutionNotModeled", path }); continue; }
    if (state.workingTree.unstaged.some((item) => item.path === path)) events.push(stagedPaths.has(path) ? { kind: "stagingUpdated", path } : { kind: "stagingReflected", path, source: "unstaged" });
    else if (state.workingTree.untracked.includes(path)) events.push(stagedPaths.has(path) ? { kind: "stagingUpdated", path } : { kind: "stagingReflected", path, source: "untracked" });
    else if (stagedPaths.has(path)) continue;
    else if (command.target.kind === "paths") unknowns.push({ code: "unknownPathScope", path });
  }
  if (command.target.kind === "repositoryRoot") {
    for (const conflict of state.workingTree.conflicts) unknowns.push({ code: "conflictResolutionNotModeled", path: conflict.path });
  }
  return { ...base, kind: "supported", events: eventsOrNoOp(events, unknowns), unknowns };
}
function unstage(state: RepositoryState, command: Extract<GitCommand, { kind: "unstage" }>, base: Base): SimulationResult {
  if (state.currentLocation.kind === "unborn") return { ...base, kind: "blocked", reason: "unbornHead" };
  const events: SimulationEvent[] = []; const unknowns: SimulationNote[] = [];
  if (command.paths.length === 1 && command.paths[0] === ".") return { ...base, kind: "supported", events: state.workingTree.staged.length ? state.workingTree.staged.map((item) => ({ kind: "stagingRemoved" as const, path: item.path, workingTreeRetained: true })) : [{ kind: "noOp" }], unknowns };
  for (const path of command.paths) {
    if (state.workingTree.staged.some((item) => item.path === path)) events.push({ kind: "stagingRemoved", path, workingTreeRetained: true });
    else if (command.syntax === "resetHead" || knownTracked(state, path)) events.push({ kind: "noOp" });
    else unknowns.push({ code: "unknownPathScope", path });
  }
  return { ...base, kind: "supported", events: eventsOrNoOp(events, unknowns), unknowns };
}
function commit(state: RepositoryState, command: Extract<GitCommand, { kind: "commit" }>, base: Base): SimulationResult {
  if (!state.workingTree.staged.length) return { ...base, kind: "blocked", reason: "nothingStaged" };
  if (state.workingTree.conflicts.length) return { ...base, kind: "blocked", reason: "conflictsPresent" };
  if (command.message === "") return { ...base, kind: "blocked", reason: "emptyCommitMessage" };
  const parents = state.currentLocation.kind === "unborn" ? [] : [state.currentLocation.head.id];
  const created: SimulationEvent = { kind: "commitCreated", commit: { kind: "newCommit", parentCommitIds: parents } };
  const next: SimulationEvent = state.currentLocation.kind === "detached"
    ? { kind: "headDetachedMoved", target: { kind: "newCommit", parentCommitIds: parents } }
    : state.currentLocation.kind === "unborn"
      ? { kind: "branchPointerMoved", branchName: state.currentLocation.branchName, target: { kind: "newCommit", parentCommitIds: parents } }
      : { kind: "branchPointerMoved", branchName: state.currentLocation.branchName, target: { kind: "newCommit", parentCommitIds: parents } };
  const relation: SimulationEvent[] = state.currentLocation.kind === "detached" ? [] : [{ kind: "headBranchRelationRetained", branchName: state.currentLocation.branchName }];
  return { ...base, kind: "supported", events: [created, next, ...relation, { kind: "stagedChangesCleared" }, { kind: "derivedRelationInvalidated", relation: "comparison" }, { kind: "derivedRelationInvalidated", relation: "upstream" }], assumptions: command.message === undefined ? [{ code: "interactiveCommitMessageRequired" }] : [], unknowns: [{ code: "futureTrackingRelationUnknown" }] };
}
function switchExisting(state: RepositoryState, command: Extract<GitCommand, { kind: "switch" }>, base: Base): SimulationResult {
  const target = state.localBranches.find((branch) => branch.name === command.branchName);
  if (!target) return { ...base, kind: "unsupported", reason: "implicitRemoteGuessNotModeled", unknowns: [{ code: "implicitRemoteGuessNotModeled", branchName: command.branchName }] };
  if (state.workingTree.conflicts.length) return { ...base, kind: "blocked", reason: "switchHasConflicts" };
  if (state.currentLocation.kind === "branch" && state.currentLocation.branchName === target.name) return { ...base, kind: "supported", events: [{ kind: "noOp" }] };
  const headId = state.currentLocation.kind === "unborn" ? undefined : state.currentLocation.head.id;
  const dirty = state.workingTree.staged.length + state.workingTree.unstaged.length + state.workingTree.untracked.length > 0;
  const uncertain = dirty && headId !== target.tipCommitId;
  const events: SimulationEvent[] = [{ kind: "headSymbolicRefChanged", branchName: target.name }, { kind: "derivedRelationInvalidated", relation: "upstream" }];
  if (headId !== target.tipCommitId) events.push({ kind: "derivedRelationInvalidated", relation: "comparison" });
  return { ...base, kind: "supported", events, risk: uncertain ? "caution" : "normal", warnings: uncertain ? [{ code: "dirtySwitchMayFail" }] : [], unknowns: uncertain ? [{ code: "futureWorkingTreeAndIndexUnknown" }, { code: "futureTrackingRelationUnknown" }] : [] };
}
function switchCreate(state: RepositoryState, command: Extract<GitCommand, { kind: "switch" }>, base: Base): SimulationResult {
  if (state.localBranches.some((branch) => branch.name === command.branchName)) return { ...base, kind: "blocked", reason: "branchAlreadyExists" };
  const assumptions: SimulationNote[] = [{ code: "branchNameAcceptedByGit", branchName: command.branchName }];
  if (state.currentLocation.kind === "unborn") return { ...base, kind: "supported", events: [{ kind: "unbornSymbolicBranchChanged", branchName: command.branchName }, { kind: "derivedRelationInvalidated", relation: "upstream" }], assumptions };
  return { ...base, kind: "supported", events: [{ kind: "branchCreated", branchName: command.branchName, target: { kind: "existingCommit", id: state.currentLocation.head.id } }, { kind: "headSymbolicRefChanged", branchName: command.branchName }, { kind: "derivedRelationInvalidated", relation: "upstream" }], assumptions };
}
function hasConflict(state: RepositoryState, path: string): boolean { return state.workingTree.conflicts.some((item) => item.path === path); }
function knownTracked(state: RepositoryState, path: string): boolean { return state.workingTree.staged.some((item) => item.path === path) || state.workingTree.unstaged.some((item) => item.path === path); }
function eventsOrNoOp(events: readonly SimulationEvent[], unknowns: readonly SimulationNote[]): readonly SimulationEvent[] { return events.length ? events : unknowns.length ? [] : [{ kind: "noOp" }]; }
