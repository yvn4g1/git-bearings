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
  | { readonly kind: "rejected"; readonly reason: "commandNotAllowed" | "cwdRequired" };

interface CommandSignature {
  readonly id: "version" | "showTopLevel";
  readonly args: readonly string[];
  readonly requiresCwd: boolean;
}

const COMMAND_SIGNATURES: readonly CommandSignature[] = [
  { id: "version", args: ["version"], requiresCwd: false },
  {
    id: "showTopLevel",
    args: ["rev-parse", "--show-toplevel"],
    requiresCwd: true,
  },
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

    const startedAt = Date.now();
    const request: ProcessRequest = {
      executable: this.executable,
      args: ["--no-pager", ...signature.args],
      cwd: repositoryPath,
      environment: createGitEnvironment(this.environmentSource),
      timeoutMs: this.timeoutMs,
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
  return COMMAND_SIGNATURES.find(
    (signature) =>
      signature.args.length === args.length &&
      signature.args.every((argument, index) => argument === args[index]),
  );
}

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
