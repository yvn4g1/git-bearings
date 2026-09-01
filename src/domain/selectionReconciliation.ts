import type { SelectionState } from "./appViewState";
import type { RepositoryState } from "./repositoryState";
import type { RepositoryStateSnapshot } from "../ui/repositoryStateSnapshot";

/** Returns a selection that can still be represented by the current facts. */
export function reconcileSelection(selection: SelectionState, snapshot: RepositoryStateSnapshot): SelectionState {
  if (selection.kind === "overview") return selection;
  if (snapshot.kind !== "available") return { kind: "overview" };
  const state = snapshot.state;
  switch (selection.kind) {
    case "head": return state.currentLocation.kind === "unborn" || state.currentLocation.head ? selection : { kind: "overview" };
    case "branch": return state.localBranches.some((branch) => branch.name === selection.branchName) ? selection : { kind: "overview" };
    case "commit": return state.history.some((entry) => entry.commit.id === selection.commitId) ? selection : { kind: "overview" };
    case "branchComparison": return state.comparison.kind === "available" && state.comparison.value.baseRef === selection.baseRef ? selection : { kind: "overview" };
    case "workingTree": return selection;
    case "staging": return selection;
    case "upstream": return state.upstream.kind === "available" && state.upstream.value.remoteName === selection.remoteName && state.upstream.value.branchName === selection.branchName ? selection : { kind: "overview" };
    case "unpushedCommits": return state.upstream.kind === "available" && state.upstream.value.trackingRef === selection.upstreamRef && state.upstream.value.relation.kind === "available" && state.upstream.value.relation.value.ahead > 0 ? selection : { kind: "overview" };
    case "remote": return state.remotes.kind === "available" && state.remotes.value.some((remote) => remote.name === selection.remoteName) ? selection : { kind: "overview" };
    case "stashShelf": return state.stash.kind === "available" && state.stash.value.length > 0 ? selection : { kind: "overview" };
    case "stash": return state.stash.kind === "available" && state.stash.value.some((stash) => stash.commitId === selection.stashCommitId) ? selection : { kind: "overview" };
  }
}

export function isSelectionValid(selection: SelectionState, snapshot: RepositoryStateSnapshot): boolean {
  return sameSelection(selection, reconcileSelection(selection, snapshot));
}

function sameSelection(left: SelectionState, right: SelectionState): boolean { return JSON.stringify(left) === JSON.stringify(right); }
