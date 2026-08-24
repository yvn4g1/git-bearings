import type {
  CoreRepositoryFacts,
  DataResult,
  BranchComparison,
  HistoryCommit,
  RepositoryState,
  SupplementalRepositoryFacts,
} from "../domain/repositoryState";

export interface RepositoryStateMetadata {
  readonly stateVersion: number;
  readonly refreshedAt: Date;
}

export function composeRepositoryState(
  core: CoreRepositoryFacts,
  supplemental: SupplementalRepositoryFacts,
  comparison: DataResult<BranchComparison>,
  history: readonly HistoryCommit[],
  metadata: RepositoryStateMetadata,
): RepositoryState {
  return {
    ...core,
    history,
    ...supplemental,
    comparison,
    stateVersion: metadata.stateVersion,
    refreshedAt: metadata.refreshedAt,
  };
}
