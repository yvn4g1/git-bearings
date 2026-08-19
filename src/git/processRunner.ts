import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

export interface ProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly stdin?: string | Buffer;
}

export type ProcessResult =
  | {
      readonly kind: "completed";
      readonly exitCode: number | null;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: "timedOut"; readonly timeoutMs: number }
  | { readonly kind: "spawnFailed"; readonly error: Error };

export type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface ProcessExecutor {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

export class ProcessRunner implements ProcessExecutor {
  constructor(private readonly spawnProcess: SpawnProcess = nodeSpawn) {}

  run(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise((resolve) => {
      let child: ChildProcess;

      try {
        child = this.spawnProcess(request.executable, request.args, {
          cwd: request.cwd,
          env: request.environment,
          shell: false,
          stdio: [request.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        });
      } catch (error) {
        resolve({ kind: "spawnFailed", error: toError(error) });
        return;
      }

      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutEnded = child.stdout === null;
      let stderrEnded = child.stderr === null;
      let closed = false;
      let closeExitCode: number | null = null;
      const finish = (result: ProcessResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        resolve(result);
      };

      const finishCompleted = (): void => {
        if (!closed || !stdoutEnded || !stderrEnded) {
          return;
        }

        finish({
          kind: "completed",
          exitCode: closeExitCode,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout.push(Buffer.from(chunk));
      });
      child.stdout?.once("end", () => {
        stdoutEnded = true;
        finishCompleted();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr.push(Buffer.from(chunk));
      });
      child.stderr?.once("end", () => {
        stderrEnded = true;
        finishCompleted();
      });
      child.once("error", (error) => {
        finish({ kind: "spawnFailed", error: toError(error) });
      });
      child.once("close", (exitCode) => {
        closed = true;
        closeExitCode = exitCode;
        finishCompleted();
      });

      if (request.stdin !== undefined) {
        child.stdin?.end(request.stdin);
      }

      timeout = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // The timeout result still takes precedence if process termination fails.
        }
        finish({ kind: "timedOut", timeoutMs: request.timeoutMs });
      }, request.timeoutMs);
    });
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
