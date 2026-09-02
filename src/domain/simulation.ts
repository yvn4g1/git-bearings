import type { GitCommand } from "./gitCommand";
import type { RepositoryIdentity } from "./repositoryState";

export type SimulationNote =
  | { readonly code: "interactiveCommitMessageRequired" }
  | { readonly code: "unknownPathScope"; readonly path: string }
  | { readonly code: "conflictResolutionNotModeled"; readonly path: string }
  | { readonly code: "dirtySwitchMayFail" }
  | { readonly code: "futureWorkingTreeAndIndexUnknown" }
  | { readonly code: "futureTrackingRelationUnknown" }
  | { readonly code: "branchNameAcceptedByGit"; readonly branchName: string }
  | { readonly code: "implicitRemoteGuessNotModeled"; readonly branchName: string };

export interface PredictedCommit {
  readonly kind: "newCommit";
  readonly parentCommitIds: readonly string[];
}

export type SimulationEvent =
  | { readonly kind: "stagingReflected"; readonly path: string; readonly source: "unstaged" | "untracked" }
  | { readonly kind: "stagingUpdated"; readonly path: string }
  | { readonly kind: "stagingRemoved"; readonly path: string; readonly workingTreeRetained: true }
  | { readonly kind: "stagedChangesCleared" }
  | { readonly kind: "commitCreated"; readonly commit: PredictedCommit }
  | { readonly kind: "branchPointerMoved"; readonly branchName: string; readonly target: PredictedCommit | { readonly kind: "existingCommit"; readonly id: string } }
  | { readonly kind: "headSymbolicRefChanged"; readonly branchName: string }
  | { readonly kind: "headBranchRelationRetained"; readonly branchName: string }
  | { readonly kind: "headDetachedMoved"; readonly target: PredictedCommit }
  | { readonly kind: "branchCreated"; readonly branchName: string; readonly target: { readonly kind: "existingCommit"; readonly id: string } }
  | { readonly kind: "unbornSymbolicBranchChanged"; readonly branchName: string }
  | { readonly kind: "derivedRelationInvalidated"; readonly relation: "comparison" | "upstream" }
  | { readonly kind: "noOp" };

interface SimulationBase {
  readonly repository: RepositoryIdentity;
  readonly basedOnStateVersion: number;
  readonly command: GitCommand;
  readonly events: readonly SimulationEvent[];
  readonly warnings: readonly SimulationNote[];
  readonly assumptions: readonly SimulationNote[];
  readonly unknowns: readonly SimulationNote[];
  readonly risk: "normal" | "caution";
}

export interface SupportedSimulation extends SimulationBase {
  readonly kind: "supported";
}
export interface BlockedSimulation extends SimulationBase {
  readonly kind: "blocked";
  readonly reason: "operationInProgress" | "unbornHead" | "nothingStaged" | "conflictsPresent" | "emptyCommitMessage" | "branchAlreadyExists" | "switchHasConflicts";
}
export interface UnsupportedSimulation extends SimulationBase {
  readonly kind: "unsupported";
  readonly reason: "commandNotImplemented" | "implicitRemoteGuessNotModeled" | "operationNotNormal";
}
export type SimulationResult = SupportedSimulation | BlockedSimulation | UnsupportedSimulation;
