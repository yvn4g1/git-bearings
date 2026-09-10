import type {
  ProcessExecutor,
  ProcessRequest,
  ProcessResult,
} from "./processRunner";
import { getGitVersionSupport, type GitVersionSupport } from "./gitVersion";

export const DEFAULT_GIT_TIMEOUT_MS = 5_000;

export interface GitLogger {
  appendLine(value: string): void;
}

export type GitExecutionResult =
  | ProcessResult
  | {
      readonly kind: "rejected";
      readonly reason:
        | "commandNotAllowed"
        | "cwdRequired"
        | "stdinRequired"
        | "stdinNotAllowed"
        | "stdinInvalid";
    };

interface CommandSignature {
  readonly id:
    | "version"
    | "showTopLevel"
    | "listIndex"
    | "listFilterConfig"
    | "checkFilterAttribute"
    | "status"
    | "localBranches"
    | "history"
    | "gitPath"
    | "remoteNames"
    | "remoteFetchRefspecs"
    | "allRefs"
    | "branchUpstreamMetadata"
    | "unbornBranchUpstreamConfig"
    | "upstreamRelation"
    | "stashList"
    | "shallowRepository"
    | "comparisonMergeBase"
    | "comparisonHistory"
    | "comparisonAnchors"
    | "commitDetailMetadata"
    | "commitDetailParents"
    | "commitDetailRootFiles"
    | "commitDetailParentFiles";
  readonly args: readonly string[];
  readonly requiresCwd: boolean;
  readonly stdin: "forbidden" | "required";
  readonly validateStdin?: (stdin: string | Buffer) => boolean;
  readonly fixedConfigArgs?: readonly string[];
}

const COMMAND_SIGNATURES: readonly CommandSignature[] = [
  { id: "version", args: ["version"], requiresCwd: false, stdin: "forbidden" },
  {
    id: "showTopLevel",
    args: ["rev-parse", "--show-toplevel"],
    requiresCwd: true,
    stdin: "forbidden",
  },
  {
    id: "listIndex",
    args: ["ls-files", "--stage", "-z"],
    requiresCwd: true,
    stdin: "forbidden",
    fixedConfigArgs: ["-c", "core.fsmonitor="],
  },
  {
    id: "listFilterConfig",
    args: [
      "config",
      "--null",
      "--name-only",
      "--get-regexp",
      "^filter\\..*\\.(clean|process)$",
      ".+",
    ],
    requiresCwd: true,
    stdin: "forbidden",
  },
  {
    id: "checkFilterAttribute",
    args: ["check-attr", "--stdin", "-z", "filter"],
    requiresCwd: true,
    stdin: "required",
    fixedConfigArgs: ["-c", "core.fsmonitor="],
  },
  {
    id: "status",
    args: [
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "--untracked-files=all",
      "--no-ahead-behind",
      "--renames",
      "--ignore-submodules=all",
    ],
    requiresCwd: true,
    stdin: "forbidden",
    fixedConfigArgs: ["-c", "core.fsmonitor="],
  },
  {
    id: "localBranches",
    args: ["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads/"],
    requiresCwd: true,
    stdin: "forbidden",
  },
  {
    id: "history",
    args: [
      "log",
      "-z",
      "--max-count=50",
      "--topo-order",
      "--format=format:%H%x00%h%x00%P%x00%s",
      "--branches",
      "HEAD",
    ],
    requiresCwd: true,
    stdin: "forbidden",
    fixedConfigArgs: ["-c", "log.showSignature=false"],
  },
  { id: "remoteNames", args: ["remote"], requiresCwd: true, stdin: "forbidden" },
  {
    id: "remoteFetchRefspecs",
    args: ["config", "--null", "--get-regexp", "^remote\\..*\\.fetch$"],
    requiresCwd: true,
    stdin: "forbidden",
  },
  {
    id: "allRefs",
    args: ["for-each-ref", "--format=%(objectname)%00%(refname)%00%(symref)%00", "refs/"],
    requiresCwd: true,
    stdin: "forbidden",
  },
  {
    id: "branchUpstreamMetadata",
    args: ["for-each-ref", "--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)%00", "refs/heads/"],
    requiresCwd: true,
    stdin: "forbidden",
  },
  {
    id: "unbornBranchUpstreamConfig",
    args: ["config", "--null", "--get-regexp", "^branch\\..*\\.(remote|merge)$"],
    requiresCwd: true,
    stdin: "forbidden",
  },
  {
    id: "upstreamRelation",
    args: ["rev-list", "--left-right", "--count", "--stdin"],
    requiresCwd: true,
    stdin: "required",
    validateStdin: isUpstreamRelationStdin,
  },
  {
    id: "shallowRepository",
    args: ["rev-parse", "--is-shallow-repository"],
    requiresCwd: true,
    stdin: "forbidden",
  },
  {
    id: "comparisonHistory",
    args: [
      "log",
      "-z",
      "--max-count=50",
      "--topo-order",
      "--format=format:%H%x00%h%x00%P%x00%s",
      "--stdin",
    ],
    requiresCwd: true,
    stdin: "required",
    validateStdin: isComparisonHistoryStdin,
    fixedConfigArgs: ["-c", "log.showSignature=false"],
  },
  {
    id: "comparisonAnchors",
    args: [
      "log",
      "-z",
      "--no-walk",
      "--format=format:%H%x00%h%x00%P%x00%s",
      "--stdin",
    ],
    requiresCwd: true,
    stdin: "required",
    validateStdin: isComparisonAnchorsStdin,
    fixedConfigArgs: ["-c", "log.showSignature=false"],
  },
  {
    id: "stashList",
    args: ["stash", "list", "--format=%gd%x00%H%x00%gs%x00"],
    requiresCwd: true,
    stdin: "forbidden",
    fixedConfigArgs: ["-c", "log.showSignature=false"],
  },
  ...[
    "rebase-merge",
    "rebase-apply",
    "rebase-apply/rebasing",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "sequencer/todo",
    "BISECT_START",
  ].map((path) => ({
    id: "gitPath" as const,
    args: ["rev-parse", "--git-path", path],
    requiresCwd: true,
    stdin: "forbidden" as const,
  })),
];

export class GitExecutor {
  constructor(
    private readonly executable: string,
    private readonly processExecutor: ProcessExecutor,
    private readonly logger: GitLogger,
    private readonly timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
    private readonly environmentSource: NodeJS.ProcessEnv = process.env,
  ) {}

  async execute(
    args: readonly string[],
    repositoryPath?: string,
    stdin?: string | Buffer,
  ): Promise<GitExecutionResult> {
    const signature = findSignature(args);

    if (!signature) {
      this.logger.appendLine("Git command rejected: commandNotAllowed.");
      return { kind: "rejected", reason: "commandNotAllowed" };
    }
    if (signature.requiresCwd && !repositoryPath) {
      this.logger.appendLine(
        "Git command rejected: " + signature.id + " requires cwd.",
      );
      return { kind: "rejected", reason: "cwdRequired" };
    }
    if (signature.stdin === "required" && stdin === undefined) {
      this.logger.appendLine("Git command rejected: " + signature.id + " requires stdin.");
      return { kind: "rejected", reason: "stdinRequired" };
    }
    if (signature.stdin === "forbidden" && stdin !== undefined) {
      this.logger.appendLine("Git command rejected: " + signature.id + " forbids stdin.");
      return { kind: "rejected", reason: "stdinNotAllowed" };
    }
    if (stdin !== undefined && signature.validateStdin && !signature.validateStdin(stdin)) {
      this.logger.appendLine("Git command rejected: " + signature.id + " has invalid stdin.");
      return { kind: "rejected", reason: "stdinInvalid" };
    }

    const startedAt = Date.now();
    const request: ProcessRequest = {
      executable: this.executable,
      args: ["--no-pager", ...(signature.fixedConfigArgs ?? []), ...signature.args],
      cwd: repositoryPath,
      environment: createGitEnvironment(this.environmentSource),
      timeoutMs: this.timeoutMs,
      stdin,
    };
    const result = await this.processExecutor.run(request);
    const durationMs = Date.now() - startedAt;

    this.logger.appendLine(formatResultLog(signature.id, result, durationMs));
    return result;
  }

  async checkVersion(): Promise<GitVersionSupport> {
    const result = await this.execute(["version"]);

    if (result.kind !== "completed" || result.exitCode !== 0) {
      return {
        kind: "unavailable",
        reason: "Git version command did not complete successfully.",
      };
    }

    return getGitVersionSupport(result.stdout);
  }
}

export function createGitEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (!key.toUpperCase().startsWith("GIT_")) {
      environment[key] = value;
    }
  }

  return {
    ...environment,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

function findSignature(args: readonly string[]): CommandSignature | undefined {
  const exact = COMMAND_SIGNATURES.find(
    (signature) =>
      signature.args.length === args.length &&
      signature.args.every((argument, index) => argument === args[index]),
  );
  if (exact) return exact;

  if (
    args.length === 4 &&
    args[0] === "merge-base" &&
    args[1] === "--all" &&
    isFullOid(args[2]) &&
    isFullOid(args[3])
  ) {
    return {
      id: "comparisonMergeBase",
      args,
      requiresCwd: true,
      stdin: "forbidden",
    };
  }

  if (args.length === 6 && args.slice(0, 5).every((argument, index) => argument === ["show", "-s", "--format=format:%H%x00%an%x00%aI%x00", "--no-ext-diff", "--no-textconv"][index]) && isFullOid(args[5])) {
    return { id: "commitDetailMetadata", args, requiresCwd: true, stdin: "forbidden", fixedConfigArgs: ["-c", "log.showSignature=false"] };
  }
  if (args.length === 3 && args[0] === "cat-file" && args[1] === "commit" && isFullOid(args[2])) {
    return { id: "commitDetailParents", args, requiresCwd: true, stdin: "forbidden" };
  }
  if (args.length === 9 && args.slice(0, 8).every((argument, index) => argument === ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--no-ext-diff", "--no-textconv", "--root"][index]) && isFullOid(args[8])) {
    return { id: "commitDetailRootFiles", args, requiresCwd: true, stdin: "forbidden" };
  }
  if (args.length === 9 && args.slice(0, 7).every((argument, index) => argument === ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--no-ext-diff", "--no-textconv"][index]) && isFullOid(args[7]) && isFullOid(args[8])) {
    return { id: "commitDetailParentFiles", args, requiresCwd: true, stdin: "forbidden" };
  }

  return undefined;
}

function isFullOid(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{40}$/.test(value);
}

function isUpstreamRelationStdin(stdin: string | Buffer): boolean {
  return typeof stdin === "string" && new RegExp(`^${FULL_OID}\\.\\.\\.${FULL_OID}\\n$`).test(stdin);
}

function isComparisonHistoryStdin(stdin: string | Buffer): boolean {
  return typeof stdin === "string" && new RegExp(`^(?:${FULL_OID}\\n){2}$`).test(stdin);
}

function isComparisonAnchorsStdin(stdin: string | Buffer): boolean {
  return typeof stdin === "string" && new RegExp(`^(?:${FULL_OID}\\n){1,3}$`).test(stdin);
}

const FULL_OID = "[0-9a-f]{40}";

function formatResultLog(
  signature: CommandSignature["id"],
  result: ProcessResult,
  durationMs: number,
): string {
  switch (result.kind) {
    case "completed":
      return (
        "Git " +
        signature +
        ": exit=" +
        (result.exitCode ?? "signal") +
        " duration=" +
        durationMs +
        "ms"
      );
    case "timedOut":
      return (
        "Git " +
        signature +
        ": timedOut after " +
        result.timeoutMs +
        "ms duration=" +
        durationMs +
        "ms"
      );
    case "spawnFailed":
      return "Git " + signature + ": spawnFailed duration=" + durationMs + "ms";
  }
}
