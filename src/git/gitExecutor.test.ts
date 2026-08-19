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

test("ProcessRunner pipes controlled stdin only when requested", async () => {
  let capturedOptions: SpawnOptions | undefined;
  const child = createFakeChild();
  const stdin = new PassThrough();
  Object.assign(child, { stdin });
  stdin.once("finish", () => {
    child.stdout.end("path\0with spaces\0");
    child.stderr.end();
    child.emit("close", 0);
  });
  const runner = new ProcessRunner(((executable, args, options) => {
    void executable;
    void args;
    capturedOptions = options;
    return child as unknown as ChildProcess;
  }) satisfies SpawnProcess);
  const result = await runner.run({
    executable: process.execPath,
    args: ["--eval", "process.stdin.pipe(process.stdout)"],
    environment: process.env,
    timeoutMs: 1_000,
    stdin: "path\0with spaces\0",
  });

  assert.deepEqual(result, {
    kind: "completed",
    exitCode: 0,
    stdout: "path\0with spaces\0",
    stderr: "",
  });
  assert.equal(capturedOptions?.stdio?.[0], "pipe");
});

test("ProcessRunner normalizes stdin write errors without double-settling", async () => {
  const child = createFakeChild();
  const stdin = new PassThrough();
  Object.assign(child, { stdin });
  const runner = new ProcessRunner(() => child as unknown as ChildProcess);
  const resultPromise = runner.run({
    executable: process.execPath,
    args: [],
    environment: process.env,
    timeoutMs: 1_000,
    stdin: Buffer.alloc(1024),
  });
  stdin.emit("error", new Error("EPIPE"));
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0);
  const result = await resultPromise;

  assert.equal(result.kind, "spawnFailed");
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
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

test("GitExecutor passes a sanitized Git environment to ProcessExecutor", async () => {
  const processExecutor = new RecordingProcessExecutor();
  const executor = new GitExecutor(
    "git",
    processExecutor,
    silentLogger,
    undefined,
    {
      GIT_DIR: "/redirected/repository",
      git_config_parameters: "malicious.config=value",
      GIT_FUTURE_OVERRIDE: "unexpected",
      PATH: "/safe/path",
      CUSTOM_GIT_BEARINGS_TEST_VALUE: "preserved",
    },
  );

  await executor.execute(["version"]);

  const environment = processExecutor.requests[0].environment;
  assert.equal(environment.GIT_DIR, undefined);
  assert.equal(environment.git_config_parameters, undefined);
  assert.equal(environment.GIT_FUTURE_OVERRIDE, undefined);
  assert.equal(environment.PATH, "/safe/path");
  assert.equal(environment.CUSTOM_GIT_BEARINGS_TEST_VALUE, "preserved");
  assert.equal(environment.GIT_TERMINAL_PROMPT, "0");
});

test("GitExecutor requires cwd for repository commands", async () => {
  const processExecutor = new RecordingProcessExecutor();
  const executor = new GitExecutor("git", processExecutor, silentLogger);

  const result = await executor.execute(["rev-parse", "--show-toplevel"]);

  assert.deepEqual(result, { kind: "rejected", reason: "cwdRequired" });
  assert.equal(processExecutor.requests.length, 0);
});

test("GitExecutor restricts stdin and applies signature-specific fixed config", async () => {
  const processExecutor = new RecordingProcessExecutor();
  const executor = new GitExecutor("git", processExecutor, silentLogger);
  const filterArgs = ["check-attr", "--stdin", "-z", "filter"] as const;

  assert.deepEqual(await executor.execute(filterArgs, "/repository"), {
    kind: "rejected", reason: "stdinRequired",
  });
  assert.deepEqual(await executor.execute(["version"], undefined, "input"), {
    kind: "rejected", reason: "stdinNotAllowed",
  });
  await executor.execute(filterArgs, "/repository", "path\0");
  await executor.execute([
    "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all",
    "--no-ahead-behind", "--renames", "--ignore-submodules=all",
  ], "/repository");
  await executor.execute([
    "log", "-z", "--max-count=50", "--topo-order",
    "--format=format:%H%x00%h%x00%P%x00%s", "HEAD",
  ], "/repository");

  assert.deepEqual(processExecutor.requests[0].args.slice(0, 3), ["--no-pager", "-c", "core.fsmonitor="]);
  assert.equal(processExecutor.requests[0].stdin, "path\0");
  assert.deepEqual(processExecutor.requests[1].args.slice(0, 3), ["--no-pager", "-c", "core.fsmonitor="]);
  assert.deepEqual(processExecutor.requests[2].args.slice(0, 3), ["--no-pager", "-c", "log.showSignature=false"]);
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

test("Git environment removes inherited Git-specific variables", () => {
  const source: NodeJS.ProcessEnv = {
    GIT_DIR: "/redirected/repository",
    GIT_WORK_TREE: "/redirected/work-tree",
    GIT_INDEX_FILE: "/redirected/index",
    GIT_OBJECT_DIRECTORY: "/redirected/objects",
    GIT_ALTERNATE_OBJECT_DIRECTORIES: "/redirected/alternate-objects",
    GIT_COMMON_DIR: "/redirected/common",
    GIT_NAMESPACE: "redirected-namespace",
    GIT_CONFIG: "/redirected/config",
    GIT_CONFIG_GLOBAL: "/redirected/global-config",
    GIT_CONFIG_SYSTEM: "/redirected/system-config",
    GIT_CONFIG_PARAMETERS: "malicious.config=value",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "malicious.config",
    GIT_CONFIG_VALUE_0: "value",
    GIT_FUTURE_OVERRIDE: "future-value",
    git_dir: "/mixed-case/repository",
    Git_Config_Parameters: "mixed-case=value",
  };
  const environment = createGitEnvironment(source);

  for (const key of Object.keys(source)) {
    assert.equal(environment[key], undefined);
  }
});

test("Git environment preserves non-Git variables and does not mutate its source", () => {
  const source: NodeJS.ProcessEnv = {
    PATH: "/safe/path",
    HOME: "/safe/home",
    USERPROFILE: "C:\\Users\\safe",
    XDG_CONFIG_HOME: "/safe/config",
    TMPDIR: "/safe/tmp",
    LANG: "ja_JP.UTF-8",
    CUSTOM_GIT_BEARINGS_TEST_VALUE: "preserved",
    GIT_TERMINAL_PROMPT: "1",
    GIT_OPTIONAL_LOCKS: "1",
    GIT_PAGER: "malicious-command",
    PAGER: "malicious-command",
  };
  const sourceBefore = { ...source };
  const environment = createGitEnvironment(source);

  assert.deepEqual(source, sourceBefore);
  assert.equal(environment.PATH, source.PATH);
  assert.equal(environment.HOME, source.HOME);
  assert.equal(environment.USERPROFILE, source.USERPROFILE);
  assert.equal(environment.XDG_CONFIG_HOME, source.XDG_CONFIG_HOME);
  assert.equal(environment.TMPDIR, source.TMPDIR);
  assert.equal(environment.LANG, source.LANG);
  assert.equal(
    environment.CUSTOM_GIT_BEARINGS_TEST_VALUE,
    source.CUSTOM_GIT_BEARINGS_TEST_VALUE,
  );

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
