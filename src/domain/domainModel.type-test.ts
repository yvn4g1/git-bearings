import type {
  AvailabilityResult,
  CommitRef,
  CurrentLocation,
  DataResult,
  FileChange,
  HistoryCommit,
  OperationState,
  RepositoryState,
  StashEntry,
  WorkingTreeState,
} from "./repositoryState";
import type {
  AppViewState,
  SelectionState,
} from "./appViewState";

declare const dataResult: DataResult<number>;

if (dataResult.kind === "available") {
  const value: number = dataResult.value;
  void value;
} else if (dataResult.kind === "notConfigured") {
  // @ts-expect-error A notConfigured result has no value.
  dataResult.value;
} else {
  const reason: string = dataResult.reason;
  void reason;
}

// @ts-expect-error An available result must have a value.
const invalidDataResult: DataResult<string> = { kind: "available" };
void invalidDataResult;

function operationLabel(operation: OperationState): string {
  switch (operation.kind) {
    case "normal":
      return "normal";
    case "merge":
      return "merge";
    case "rebase":
      return "rebase";
    case "unsupported":
      return operation.operationName;
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}
void operationLabel;

const head: CommitRef = {
  id: "0123456789abcdef",
  shortId: "0123456",
  subject: "Initial commit",
};

const branchLocation: CurrentLocation = {
  kind: "branch",
  branchName: "main",
  head,
  detached: false,
};
const detachedLocation: CurrentLocation = {
  kind: "detached",
  branchName: null,
  head,
  detached: true,
};
const unbornLocation: CurrentLocation = {
  kind: "unborn",
  branchName: "main",
  head: null,
  detached: false,
};
// @ts-expect-error An unborn repository still has its HEAD branch name.
const invalidUnbornLocation: CurrentLocation = {
  kind: "unborn",
  branchName: null,
  head: null,
  detached: false,
};
void branchLocation;
void detachedLocation;
void unbornLocation;
void invalidUnbornLocation;

const modifiedFile: FileChange = { path: "src/example.ts", kind: "modified" };
const renamedFile: FileChange = {
  path: "src/renamed.ts",
  kind: "renamed",
  originalPath: "src/original.ts",
};
const copiedFile: FileChange = {
  path: "src/copied.ts",
  kind: "copied",
  originalPath: "src/original.ts",
};
// @ts-expect-error Renames require their original path.
const invalidRenamedFile: FileChange = { path: "src/renamed.ts", kind: "renamed" };
// @ts-expect-error Copies require their original path.
const invalidCopiedFile: FileChange = { path: "src/copied.ts", kind: "copied" };
// @ts-expect-error Ordinary changes do not have an original path.
const invalidModifiedFile: FileChange = {
  path: "src/example.ts",
  kind: "modified",
  originalPath: "src/original.ts",
};
void modifiedFile;
void renamedFile;
void copiedFile;
void invalidRenamedFile;
void invalidCopiedFile;
void invalidModifiedFile;

const workingTree: WorkingTreeState = {
  staged: [{ path: "src/example.ts", kind: "modified" }],
  unstaged: [{ path: "src/example.ts", kind: "modified" }],
  untracked: ["notes.txt"],
  conflicts: [{ path: "src/conflicted.ts", kind: "bothModified" }],
};
void workingTree;

const selection: SelectionState = { kind: "commit", commitId: head.id };
if (selection.kind === "commit") {
  const commitId: string = selection.commitId;
  void commitId;
}
const workingTreeSelection: SelectionState = {
  kind: "workingTree",
  section: "overview",
};
const unstagedSelection: SelectionState = {
  kind: "workingTree",
  section: "unstaged",
};
const untrackedSelection: SelectionState = {
  kind: "workingTree",
  section: "untracked",
};
const stagingSelection: SelectionState = { kind: "staging" };
const invalidWorkingTreeSelection: SelectionState = {
  kind: "workingTree",
  section: "overview",
  // @ts-expect-error File-level Working Tree selection is not part of this contract.
  path: "src/example.ts",
};
void workingTreeSelection;
void unstagedSelection;
void untrackedSelection;
void stagingSelection;
void invalidWorkingTreeSelection;

// @ts-expect-error Selection kinds are closed by the discriminated union.
const invalidSelection: SelectionState = { kind: "allTheThings" };
void invalidSelection;

type PreviewPayload = { readonly fixtureId: string };
const preview: PreviewPayload = { fixtureId: "preview-1" };
const appViewState: AppViewState<PreviewPayload> = {
  selection: { kind: "overview" },
  detailMode: "inspect",
  preview,
};
const viewStateWithoutPreview: AppViewState = {
  selection: { kind: "overview" },
  detailMode: "commandInput",
  preview: null,
};
void appViewState;
void viewStateWithoutPreview;

const stashEntry: StashEntry = {
  index: 0,
  commitId: "stash-commit-id",
  message: "WIP on main",
};
const emptyStash: AvailabilityResult<readonly StashEntry[]> = {
  kind: "available",
  value: [],
};
const invalidStash: AvailabilityResult<readonly StashEntry[]> = {
  // @ts-expect-error Stash is not a configurable feature.
  kind: "notConfigured",
};
const stashSelection: SelectionState = {
  kind: "stash",
  stashCommitId: stashEntry.commitId,
};
// @ts-expect-error A mutable stash index is not a stash selection identity.
const invalidStashSelection: SelectionState = { kind: "stash", stashIndex: 0 };
void emptyStash;
void stashEntry;
void invalidStash;
void stashSelection;
void invalidStashSelection;

const remoteResult: DataResult<readonly string[]> = { kind: "notConfigured" };
void remoteResult;

const history: readonly HistoryCommit[] = [
  { commit: head, parentIds: [] },
  { commit: head, parentIds: ["parent-id"] },
  { commit: head, parentIds: ["first-parent-id", "second-parent-id"] },
];

const repositoryState: RepositoryState = {
  repository: { rootPath: "/workspace/example" },
  currentLocation: branchLocation,
  workingTree,
  comparison: { kind: "notConfigured" },
  remotes: { kind: "notConfigured" },
  upstream: { kind: "notConfigured" },
  history,
  stash: emptyStash,
  operation: { kind: "normal" },
  stateVersion: 1,
  refreshedAt: new Date(0),
};

// @ts-expect-error RepositoryState contains facts only, not Preview state.
repositoryState.preview;
// @ts-expect-error RepositoryState contains facts only, not Graph coordinates.
repositoryState.graphCoordinates;
