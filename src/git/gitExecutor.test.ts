import { strict as assert } from "node:assert";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  createGitEnvironment,
  GitExecutor,
  type GitLogger,
} from "./gitExecutor";
import {
  resolveGitExecutableFromLookup,
  type VscodeGitExtension,
} from "./gitExecutableResolver";
import { getGitVersionSupport } from "./gitVersion";
import {
  ProcessRunner,
  type ProcessExecutor,
  type ProcessRequest,
  type ProcessResult,
  type SpawnProcess,
} from "./processRunner";

const silentLogger: GitLogger = { appendLine: () => undefined };

test("ProcessRunner returns stdout and passes cwd without a shell", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "git-bearings-process-"));
  let capturedExecutable: string | undefined;
  let capturedArgs: readonly string[] | undefined;
  let capturedOptions: SpawnOptions | undefined;
  const runner = new ProcessRunner(((executable, args, options) => {
    capturedExecutable = executable;
    capturedArgs = args;
    capturedOptions = options;
    return completeFakeChild(cwd, "", 0) as unknown as ChildProcess;
  }) satisfies SpawnProcess);

  try {
    const result = await runner.run({
      executable: process.execPath,
      args: ["--eval", "process.stdout.write(process.cwd())"],
      cwd,
      environment: process.env,
      timeoutMs: 1_000,
    });

    assert.deepEqual(result, {
      kind: "completed",
      exitCode: 0,
      stdout: cwd,
      stderr: "",
    });
    assert.equal(capturedExecutable, process.execPath);
    assert.deepEqual(capturedArgs, ["--eval", "process.stdout.write(process.cwd())"]);
    assert.equal(capturedOptions?.cwd, cwd);
    assert.equal(capturedOptions?.shell, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ProcessRunner preserves non-zero exits as completed results", async () => {
  const runner = new ProcessRunner(() =>
    completeFakeChild("", "missing ref", 12) as unknown as ChildProcess,
  );
  const result = await runner.run({
    executable: process.execPath,
    args: [
      "--eval",
      "process.stderr.write('missing ref'); process.exit(12)",
    ],
    environment: process.env,
    timeoutMs: 1_000,
  });

  assert.equal(result.kind, "completed");
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.notEqual(result.stderr, "");
});

test("ProcessRunner reports timeouts separately", async () => {
  const child = createFakeChild();
  const runner = new ProcessRunner(() => child as unknown as ChildProcess);
  const result = await runner.run({
    executable: process.execPath,
    args: ["--eval", "setTimeout(() => undefined, 1_000)"],
    environment: process.env,
    timeoutMs: 20,
  });

  assert.deepEqual(result, { kind: "timedOut", timeoutMs: 20 });
  assert.deepEqual(child.killSignals, ["SIGTERM"]);

  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result, { kind: "timedOut", timeoutMs: 20 });
});

test("ProcessRunner explicitly disables the shell", async () => {
  let capturedOptions: SpawnOptions | undefined;
  const runner = new ProcessRunner(((executable, args, options) => {
    void executable;
    void args;
    capturedOptions = options;
    const child = createFakeChild();
    queueMicrotask(() => {
      child.stdout.end("ok");
      child.stderr.end();
      child.emit("close", 0);
    });
    return child as unknown as ChildProcess;
  }) satisfies SpawnProcess);

  const result = await runner.run({
    executable: "git",
    args: ["version"],
    environment: process.env,
    timeoutMs: 1_000,
  });

  assert.equal(capturedOptions?.shell, false);
  assert.equal(result.kind, "completed");
});

test("GitExecutor rejects non-allowlisted and write signatures before spawn", async () => {
  const processExecutor = new RecordingProcessExecutor();
  const executor = new GitExecutor("git", processExecutor, silentLogger);

  for (const args of [
    ["status"],
    ["add", "file.txt"],
    ["commit", "-m", "message"],
    ["push"],
    ["fetch"],
    ["switch", "main"],
    ["checkout", "main"],
    ["merge", "main"],
    ["rebase", "main"],
    ["stash", "pop"],
    ["--exec-path=/tmp", "version"],
    ["-c", "core.pager=cat", "version"],
  ]) {
    const result = await executor.execute(args, "/repository");
    assert.deepEqual(result, { kind: "rejected", reason: "commandNotAllowed" });
  }

  assert.equal(processExecutor.requests.length, 0);
});

test("GitExecutor runs only exact allowed signatures with Git environment", async () => {
  const processExecutor = new RecordingProcessExecutor({
    kind: "completed",
    exitCode: 0,
    stdout: "/repository",
    stderr: "",
  });
  const executor = new GitExecutor("vscode-git", processExecutor, silentLogger);

  const result = await executor.execute(
    ["rev-parse", "--show-toplevel"],
    "/repository",
  );

  assert.equal(result.kind, "completed");
  assert.deepEqual(processExecutor.requests[0].args, [
    "--no-pager",
    "rev-parse",
    "--show-toplevel",
  ]);
  assert.equal(processExecutor.requests[0].cwd, "/repository");
  assert.equal(processExecutor.requests[0].environment.GIT_TERMINAL_PROMPT, "0");
  assert.equal(processExecutor.requests[0].environment.GIT_OPTIONAL_LOCKS, "0");
  assert.equal(processExecutor.requests[0].environment.GIT_PAGER, "cat");
  assert.equal(processExecutor.requests[0].environment.PAGER, "cat");
});

test("GitExecutor requires cwd for repository commands", async () => {
  const processExecutor = new RecordingProcessExecutor();
  const executor = new GitExecutor("git", processExecutor, silentLogger);

  const result = await executor.execute(["rev-parse", "--show-toplevel"]);

  assert.deepEqual(result, { kind: "rejected", reason: "cwdRequired" });
  assert.equal(processExecutor.requests.length, 0);
});

test("Git version support parses integer components and platform suffixes", () => {
  assert.deepEqual(getGitVersionSupport("git version 2.23.0\n"), {
    kind: "supported",
    version: { major: 2, minor: 23, patch: 0 },
  });
  assert.deepEqual(getGitVersionSupport("git version 2.39.2.windows.1\n"), {
    kind: "supported",
    version: { major: 2, minor: 39, patch: 2 },
  });
  assert.deepEqual(getGitVersionSupport("git version 2.39.2 (Apple Git-143)\n"), {
    kind: "supported",
    version: { major: 2, minor: 39, patch: 2 },
  });
  assert.deepEqual(getGitVersionSupport("git version 2.22.9\n"), {
    kind: "unsupported",
    version: { major: 2, minor: 22, patch: 9 },
  });
  assert.deepEqual(getGitVersionSupport("not git"), {
    kind: "unavailable",
    reason: "Unrecognized Git version output.",
  });
  assert.deepEqual(getGitVersionSupport("noise\ngit version 2.39.2\n"), {
    kind: "unavailable",
    reason: "Unrecognized Git version output.",
  });
});

test("VS Code Git executable resolver normalizes extension failures", async () => {
  const unavailable = {
    kind: "unavailable",
    reason: "VS Code Git extension did not provide a usable Git executable path.",
  } as const;

  assert.deepEqual(await resolveGitExecutableFromLookup(missingGitExtension), unavailable);
  assert.deepEqual(
    await resolveGitExecutableFromLookup(() => throwingGitExtension("activate")),
    unavailable,
  );
  assert.deepEqual(
    await resolveGitExecutableFromLookup(() => throwingGitExtension("getAPI")),
    unavailable,
  );
  assert.deepEqual(
    await resolveGitExecutableFromLookup(() => {
      throw new Error("disabled");
    }),
    unavailable,
  );
  assert.deepEqual(
    await resolveGitExecutableFromLookup(() => activeGitExtension("/vscode/git")),
    { kind: "available", path: "/vscode/git" },
  );
});

test("GitExecutor logger never includes command output payloads", async () => {
  const logger = new RecordingLogger();
  const executor = new GitExecutor(
    "git",
    new RecordingProcessExecutor({
      kind: "completed",
      exitCode: 1,
      stdout: "token=top-secret",
      stderr: "password=also-secret",
    }),
    logger,
  );

  await executor.execute(["version"]);

  assert.equal(logger.lines.length, 1);
  assert.equal(logger.lines[0].includes("top-secret"), false);
  assert.equal(logger.lines[0].includes("also-secret"), false);
});

test("GitExecutor reports unavailable when version execution fails", async () => {
  const processExecutor = new RecordingProcessExecutor({
    kind: "spawnFailed",
    error: new Error("ENOENT"),
  });
  const executor = new GitExecutor("git", processExecutor, silentLogger);

  assert.deepEqual(await executor.checkVersion(), {
    kind: "unavailable",
    reason: "Git version command did not complete successfully.",
  });
});

test("Git environment disables prompts, locks, and pagers", () => {
  const environment = createGitEnvironment();

  assert.equal(environment.GIT_TERMINAL_PROMPT, "0");
  assert.equal(environment.GIT_OPTIONAL_LOCKS, "0");
  assert.equal(environment.GIT_PAGER, "cat");
  assert.equal(environment.PAGER, "cat");
});

class RecordingProcessExecutor implements ProcessExecutor {
  readonly requests: ProcessRequest[] = [];

  constructor(
    private readonly result: ProcessResult = {
      kind: "completed",
      exitCode: 0,
      stdout: "",
      stderr: "",
    },
  ) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    return this.result;
  }
}

class RecordingLogger implements GitLogger {
  readonly lines: string[] = [];

  appendLine(value: string): void {
    this.lines.push(value);
  }
}

function createFakeChild(): EventEmitter & {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly killSignals: string[];
  kill(signal?: NodeJS.Signals): boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    readonly stdout: PassThrough;
    readonly stderr: PassThrough;
    readonly killSignals: string[];
    kill(signal?: NodeJS.Signals): boolean;
  };
  const killSignals: string[] = [];
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killSignals,
    kill: (signal?: NodeJS.Signals) => {
      if (signal) {
        killSignals.push(signal);
      }
      return true;
    },
  });
  return child;
}

function completeFakeChild(
  stdout: string,
  stderr: string,
  exitCode: number,
): ReturnType<typeof createFakeChild> {
  const child = createFakeChild();
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    child.emit("close", exitCode);
  });
  return child;
}

function missingGitExtension(): VscodeGitExtension | undefined {
  return undefined;
}

function throwingGitExtension(
  failure: "activate" | "getAPI",
): VscodeGitExtension {
  return {
    isActive: failure === "getAPI",
    exports:
      failure === "getAPI"
        ? { getAPI: () => { throw new Error("getAPI failed"); } }
        : undefined,
    activate: async () => {
      throw new Error("activate failed");
    },
  };
}

function activeGitExtension(path: string): VscodeGitExtension {
  return {
    isActive: true,
    exports: { getAPI: () => ({ git: { path } }) },
    activate: async () => ({ getAPI: () => ({ git: { path } }) }),
  };
}
