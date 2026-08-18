import type {
  CommitRef,
  CurrentLocation,
  DataResult,
  OperationState,
  RepositoryState,
  WorkingTreeState,
} from "./repositoryState";
import type {
  AppViewState,
  PreviewState,
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
void branchLocation;
void detachedLocation;
void unbornLocation;

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

// @ts-expect-error Selection kinds are closed by the discriminated union.
const invalidSelection: SelectionState = { kind: "allTheThings" };
void invalidSelection;

type PreviewPayload = { readonly fixtureId: string };
const preview: PreviewState<PreviewPayload> = {
  kind: "present",
  payload: { fixtureId: "preview-1" },
};
const appViewState: AppViewState<PreviewPayload> = {
  selection: { kind: "overview" },
  detailMode: "inspect",
  preview,
};
const viewStateWithoutPreview: AppViewState = {
  selection: { kind: "overview" },
  detailMode: "commandInput",
  preview: { kind: "none" },
};
void appViewState;
void viewStateWithoutPreview;

const repositoryState: RepositoryState = {
  repository: { rootPath: "/workspace/example" },
  currentLocation: branchLocation,
  workingTree,
  comparison: { kind: "notConfigured" },
  remotes: { kind: "available", value: [] },
  upstream: { kind: "notConfigured" },
  history: [head],
  stash: { kind: "available", value: [] },
  operation: { kind: "normal" },
  stateVersion: 1,
  refreshedAt: new Date(0),
};

// @ts-expect-error RepositoryState contains facts only, not Preview state.
repositoryState.preview;
