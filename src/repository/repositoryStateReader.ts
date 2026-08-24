import type {
  AvailabilityResult,
  CoreRepositoryFacts,
  RepositoryState,
  SupplementalRepositoryFacts,
} from "../domain/repositoryState";
import type { BranchComparisonReadResult } from "../git/branchComparisonReader";
import type { SavedBase, ResolvedBase } from "./baseResolver";
import { resolveBase } from "./baseResolver";
import { composeRepositoryState, type RepositoryStateMetadata } from "./repositoryStateComposer";

export interface CoreFactsReader {
  read(repositoryPath: string): Promise<AvailabilityResult<CoreRepositoryFacts>>;
}

export interface SupplementalFactsReader {
  read(repositoryPath: string, coreFacts: Pick<CoreRepositoryFacts, "currentLocation">): Promise<SupplementalRepositoryFacts>;
}

export interface ComparisonFactsReader {
  read(repositoryPath: string, coreFacts: CoreRepositoryFacts, base: ResolvedBase): Promise<BranchComparisonReadResult>;
}

export class RepositoryStateReader {
  constructor(
    private readonly coreReader: CoreFactsReader,
    private readonly supplementalReader: SupplementalFactsReader,
    private readonly comparisonReader: ComparisonFactsReader,
  ) {}

  async read(
    repositoryPath: string,
    savedBase: SavedBase | undefined,
    metadata: RepositoryStateMetadata,
  ): Promise<AvailabilityResult<RepositoryState>> {
    const coreResult = await this.coreReader.read(repositoryPath);
    if (coreResult.kind === "unavailable") return coreResult;

    const core = coreResult.value;
    const supplemental = await this.supplementalReader.read(repositoryPath, core);
    const resolution = resolveBase(core, supplemental, savedBase);
    let result: BranchComparisonReadResult;
    if (resolution.kind === "resolved") {
      result = await this.comparisonReader.read(repositoryPath, core, resolution.base);
    } else if (resolution.kind === "unavailable") {
      result = {
        comparison: { kind: "unavailable", reason: resolution.reason },
        history: core.history,
      };
    } else {
      result = { comparison: { kind: "notConfigured" }, history: core.history };
    }

    return {
      kind: "available",
      value: composeRepositoryState(core, supplemental, result.comparison, result.history, metadata),
    };
  }
}
