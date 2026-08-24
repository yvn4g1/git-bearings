import type { RepositoryState } from "../domain/repositoryState";
import type { SavedBase } from "./baseResolver";

export interface BaseSelectionCandidate {
  readonly label: string;
  readonly description: string;
  readonly detail: string;
  readonly savedBase: SavedBase;
}

export function createBaseSelectionCandidates(state: RepositoryState): readonly BaseSelectionCandidate[] {
  const local = state.localBranches.map((branch) => ({
    label: `ローカル branch: ${branch.name}`,
    description: `refs/heads/${branch.name}`,
    detail: `refs/heads/${branch.name}`,
    savedBase: {
      kind: "local" as const,
      branchName: branch.name,
      ref: `refs/heads/${branch.name}`,
    },
  }));
  if (state.remotes.kind !== "available") return local;
  const tracking = state.remotes.value.flatMap((remote) => remote.trackingRefs.map((branch) => ({
    label: `取得済み Remote: ${remote.name}/${branch.branchName}`,
    description: branch.trackingRef,
    detail: branch.trackingRef,
    savedBase: {
      kind: "remoteTracking" as const,
      remoteName: remote.name,
      branchName: branch.branchName,
      trackingRef: branch.trackingRef,
    },
  })));
  return [...local, ...tracking];
}
