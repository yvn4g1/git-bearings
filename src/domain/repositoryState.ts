export interface Available<T> {
  readonly kind: "available";
  readonly value: T;
}

export interface NotConfigured {
  readonly kind: "notConfigured";
}

export interface Unavailable {
  readonly kind: "unavailable";
  readonly reason: string;
}

export type DataResult<T> = Available<T> | NotConfigured | Unavailable;

export type AvailabilityResult<T> = Available<T> | Unavailable;

export interface RepositoryIdentity {
  readonly rootPath: string;
}

export interface CommitRef {
  readonly id: string;
  readonly shortId: string;
  readonly subject: string;
}

export type CurrentLocation =
  | {
      readonly kind: "branch";
      readonly branchName: string;
      readonly head: CommitRef;
      readonly detached: false;
    }
  | {
      readonly kind: "detached";
      readonly branchName: null;
      readonly head: CommitRef;
      readonly detached: true;
    }
  | {
      readonly kind: "unborn";
      readonly branchName: string;
      readonly head: null;
      readonly detached: false;
    };

export type FileChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typeChanged";

export interface OrdinaryFileChange {
  readonly path: string;
  readonly kind: "added" | "modified" | "deleted" | "typeChanged";
  readonly originalPath?: never;
}

export interface RenamedOrCopiedFileChange {
  readonly path: string;
  readonly kind: "renamed" | "copied";
  readonly originalPath: string;
}

export type FileChange = OrdinaryFileChange | RenamedOrCopiedFileChange;

export type ConflictKind =
  | "bothAdded"
  | "bothDeleted"
  | "bothModified"
  | "deletedByUs"
  | "deletedByThem"
  | "addedByUs"
  | "addedByThem";

export interface ConflictFile {
  readonly path: string;
  readonly kind: ConflictKind;
}

export interface WorkingTreeState {
  readonly staged: readonly FileChange[];
  readonly unstaged: readonly FileChange[];
  readonly untracked: readonly string[];
  readonly conflicts: readonly ConflictFile[];
}

export interface BranchComparison {
  readonly baseRef: string;
  readonly mergeBase: CommitRef | null;
  readonly ahead: number;
  readonly behind: number;
}

export interface LocalBranch {
  readonly name: string;
  readonly tipCommitId: string;
}

export interface RemoteTrackingRef {
  readonly branchName: string;
  readonly trackingRef: string;
  readonly commitId: string;
}

export interface LocallyKnownRemoteDefaultBranch {
  readonly branchName: string;
  readonly trackingRef: string;
}

export interface Remote {
  readonly name: string;
  readonly trackingRefs: readonly RemoteTrackingRef[];
  readonly locallyKnownDefaultBranch: LocallyKnownRemoteDefaultBranch | null;
}

export interface AheadBehind {
  readonly ahead: number;
  readonly behind: number;
}

export interface Upstream {
  readonly remoteName: string;
  readonly branchName: string;
  readonly trackingRef: string;
  readonly relation: AvailabilityResult<AheadBehind>;
}

export interface StashEntry {
  readonly index: number;
  readonly commitId: string;
  readonly message: string;
}

export interface HistoryCommit {
  readonly commit: CommitRef;
  readonly parentIds: readonly string[];
}

export type OperationState =
  | { readonly kind: "normal" }
  | { readonly kind: "merge" }
  | { readonly kind: "rebase" }
  | { readonly kind: "unsupported"; readonly operationName: string };

export interface CoreRepositoryFacts {
  readonly repository: RepositoryIdentity;
  readonly currentLocation: CurrentLocation;
  readonly localBranches: readonly LocalBranch[];
  readonly workingTree: WorkingTreeState;
  readonly history: readonly HistoryCommit[];
  readonly operation: OperationState;
}

export interface SupplementalRepositoryFacts {
  readonly remotes: DataResult<readonly Remote[]>;
  readonly upstream: DataResult<Upstream>;
  readonly stash: AvailabilityResult<readonly StashEntry[]>;
}

export interface RepositoryState
  extends CoreRepositoryFacts,
    SupplementalRepositoryFacts {
  readonly comparison: DataResult<BranchComparison>;
  readonly stateVersion: number;
  readonly refreshedAt: Date;
}
