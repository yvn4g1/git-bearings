import type {
  BranchComparison,
  CoreRepositoryFacts,
  DataResult,
  HistoryCommit,
} from "../domain/repositoryState";
import type { ResolvedBase } from "../repository/baseResolver";
import { parseHistory } from "./coreRepositoryReader";
import { GitExecutor, type GitExecutionResult } from "./gitExecutor";
import { parseAheadBehind } from "./supplementalRepositoryReader";

const SHALLOW_ARGS = ["rev-parse", "--is-shallow-repository"] as const;
const RELATION_ARGS = ["rev-list", "--left-right", "--count", "--stdin"] as const;
const HISTORY_ARGS = [
  "log",
  "-z",
  "--max-count=50",
  "--topo-order",
  "--format=format:%H%x00%h%x00%P%x00%s",
  "--stdin",
] as const;
const ANCHOR_ARGS = [
  "log",
  "-z",
  "--no-walk",
  "--format=format:%H%x00%h%x00%P%x00%s",
  "--stdin",
] as const;
const HISTORY_LIMIT = 50;

export interface BranchComparisonReadResult {
  readonly comparison: DataResult<BranchComparison>;
  readonly history: readonly HistoryCommit[];
}

export class BranchComparisonReader {
  constructor(private readonly gitExecutor: GitExecutor) {}

  async read(
    repositoryPath: string,
    coreFacts: CoreRepositoryFacts,
    base: ResolvedBase,
  ): Promise<BranchComparisonReadResult> {
    const location = coreFacts.currentLocation;
    if (location.kind === "unborn") {
      return failed(coreFacts.history, "The current branch has no commit tip.");
    }

    const currentOid = location.head.id;
    const baseOid = base.commitId;
    if (!isFullOid(currentOid) || !isFullOid(baseOid)) {
      return failed(coreFacts.history, "Comparison commit ids are invalid.");
    }

    if (currentOid === baseOid) {
      return {
        comparison: {
          kind: "available",
          value: {
            baseRef: base.ref,
            mergeBase: location.head,
            ahead: 0,
            behind: 0,
          },
        },
        history: coreFacts.history,
      };
    }

    try {
      if (parseShallow((await this.success(SHALLOW_ARGS, repositoryPath)).stdout)) {
        return failed(coreFacts.history, "Comparison is unavailable for different tips in a shallow repository.");
      }

      const mergeBaseIds = await this.readMergeBases(repositoryPath, currentOid, baseOid);
      if (mergeBaseIds.length > 1) {
        return failed(coreFacts.history, "Multiple best common ancestors cannot be represented safely.");
      }

      const relation = parseAheadBehind((await this.success(
        RELATION_ARGS,
        repositoryPath,
        `${currentOid}...${baseOid}\n`,
      )).stdout);
      const comparisonHistory = parseHistory((await this.success(
        HISTORY_ARGS,
        repositoryPath,
        `${currentOid}\n${baseOid}\n`,
      )).stdout);
      const requiredIds = [currentOid, baseOid, ...mergeBaseIds];
      const known = deduplicateHistory([...comparisonHistory, ...coreFacts.history]);
      const missingIds = requiredIds.filter((id) => !known.some((entry) => entry.commit.id === id));
      const anchors = missingIds.length === 0
        ? []
        : parseHistory((await this.success(
          ANCHOR_ARGS,
          repositoryPath,
          missingIds.map((id) => id + "\n").join(""),
        )).stdout);
      assertAnchors(requiredIds, [...known, ...anchors]);
      const history = boundHistory(known, anchors, requiredIds);
      const mergeBase = mergeBaseIds.length === 0
        ? null
        : history.find((entry) => entry.commit.id === mergeBaseIds[0])!.commit;

      return {
        comparison: {
          kind: "available",
          value: {
            baseRef: base.ref,
            mergeBase,
            ahead: relation.ahead,
            behind: relation.behind,
          },
        },
        history,
      };
    } catch {
      return failed(coreFacts.history, "Branch comparison could not be read safely.");
    }
  }

  private async readMergeBases(repositoryPath: string, currentOid: string, baseOid: string): Promise<readonly string[]> {
    const result = await this.gitExecutor.execute(
      ["merge-base", "--all", currentOid, baseOid],
      repositoryPath,
    );
    if (result.kind !== "completed") throw new Error("Merge-base command failed.");
    if (result.exitCode === 1 && result.stdout === "") return [];
    if (result.exitCode !== 0) throw new Error("Merge-base command failed.");
    const ids = result.stdout.split("\n").filter(Boolean);
    if (!ids.every(isFullOid) || new Set(ids).size !== ids.length) {
      throw new Error("Invalid merge-base output.");
    }
    return ids;
  }

  private async success(
    args: readonly string[],
    repositoryPath: string,
    stdin?: string,
  ): Promise<{ readonly stdout: string; readonly stderr: string }> {
    return requireSuccess(await this.gitExecutor.execute(args, repositoryPath, stdin));
  }
}

export function parseShallow(stdout: string): boolean {
  if (stdout === "true\n" || stdout === "true") return true;
  if (stdout === "false\n" || stdout === "false") return false;
  throw new Error("Invalid shallow repository output.");
}

function boundHistory(
  known: readonly HistoryCommit[],
  anchors: readonly HistoryCommit[],
  requiredIds: readonly string[],
): readonly HistoryCommit[] {
  const selected = deduplicateHistory(known).slice(0, HISTORY_LIMIT);
  const all = deduplicateHistory([...known, ...anchors]);
  for (const id of requiredIds) {
    if (selected.some((entry) => entry.commit.id === id)) continue;
    selected.push(all.find((entry) => entry.commit.id === id)!);
  }
  return selected;
}

function deduplicateHistory(history: readonly HistoryCommit[]): HistoryCommit[] {
  return [...new Map(history.map((entry) => [entry.commit.id, entry])).values()];
}

function assertAnchors(requiredIds: readonly string[], history: readonly HistoryCommit[]): void {
  const ids = new Set(history.map((entry) => entry.commit.id));
  if (!requiredIds.every((id) => ids.has(id))) throw new Error("Comparison history is missing an anchor.");
}

function isFullOid(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{40}$/.test(value);
}

function requireSuccess(result: GitExecutionResult): { readonly stdout: string; readonly stderr: string } {
  if (result.kind !== "completed" || result.exitCode !== 0) throw new Error("Git command failed.");
  return result;
}

function failed(history: readonly HistoryCommit[], reason: string): BranchComparisonReadResult {
  return { comparison: { kind: "unavailable", reason }, history };
}
