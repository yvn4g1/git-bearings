import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseGitCommand } from "../commands/gitCommandParser";
import type { RepositoryState } from "../domain/repositoryState";
import { formatGoalCommand, resolveGoal } from "../domain/goal";
import { CoreRepositoryReader } from "../git/coreRepositoryReader";
import {
  createGitEnvironment,
  GitExecutor,
  type GitLogger,
} from "../git/gitExecutor";
import type {
  ProcessExecutor,
  ProcessRequest,
  ProcessResult,
} from "../git/processRunner";

const silentLogger: GitLogger = { appendLine: () => undefined };
const id = "a".repeat(40);
const head = { id, shortId: "aaaaaaa", subject: "head" };

function state(overrides: Partial<RepositoryState> = {}): RepositoryState {
  return {
    repository: { rootPath: "/repo" },
    currentLocation: { kind: "branch", branchName: "main", head, detached: false },
    localBranches: [
      { name: "main", tipCommitId: id },
      { name: "feature/one", tipCommitId: id },
      { name: "feature/two", tipCommitId: id },
    ],
    workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    history: [{ commit: head, parentIds: [] }],
    operation: { kind: "normal" },
    remotes: {
      kind: "available",
      value: [
        {
          name: "origin",
          trackingRefs: [],
          locallyKnownDefaultBranch: null,
        },
      ],
    },
    upstream: { kind: "notConfigured" },
    stash: { kind: "available", value: [] },
    comparison: { kind: "notConfigured" },
    stateVersion: 1,
    refreshedAt: new Date(0),
    ...overrides,
  };
}

test("Git environment overrides inherited Git variables and disables lazy fetch", () => {
  const environment = createGitEnvironment({
    PATH: "/usr/bin",
    GIT_DIR: "/attacker/gitdir",
    GIT_NO_LAZY_FETCH: "0",
    GIT_CONFIG_GLOBAL: "/attacker/config",
  });

  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.GIT_DIR, undefined);
  assert.equal(environment.GIT_CONFIG_GLOBAL, undefined);
  assert.equal(environment.GIT_NO_LAZY_FETCH, "1");
  assert.equal(environment.GIT_TERMINAL_PROMPT, "0");
  assert.equal(environment.GIT_OPTIONAL_LOCKS, "0");
});

test("Core reader rejects a partial clone before object-reading commands", async () => {
  const repository = await mkdtemp(join(tmpdir(), "git-bearings-p29-"));
  const requests: ProcessRequest[] = [];
  const executor = new GitExecutor(
    "git",
    new PartialCloneProcessExecutor(repository, requests),
    silentLogger,
  );

  try {
    const result = await new CoreRepositoryReader(executor).read(repository);

    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") {
      assert.match(result.reason, /Partial clone repositories are not supported/);
    }
    assert.ok(requests.some((request) => request.args.includes("extensions.partialClone")));
    assert.ok(!requests.some((request) => request.args.includes("ls-files")));
    assert.ok(!requests.some((request) => request.args.includes("status")));
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("Command Preview rejects shell expansion syntax instead of interpreting it", () => {
  for (const input of [
    "git switch 'feature/$(touch-pwned)'",
    "git switch \"feature/$HOME\"",
    "git switch 'feature/`whoami`'",
    "git switch feature/%USERNAME%",
    "git switch feature/!PATH!",
  ]) {
    const result = parseGitCommand(input);
    assert.equal(result.kind, "parseFailure", input);
    if (result.kind === "parseFailure") {
      assert.match(result.reason, /shell展開/);
    }
  }
});

test("Goal excludes unsafe repository-derived operands and formatter fails closed", () => {
  const unsafeBranch = "feature/$(touch-pwned)";
  const input = state({
    localBranches: [
      { name: "main", tipCommitId: id },
      { name: "feature/one", tipCommitId: id },
      { name: "feature/two", tipCommitId: id },
      { name: unsafeBranch, tipCommitId: id },
    ],
  });

  const switchGoal = resolveGoal(input, { goalId: "switchBranch" });
  assert.equal(switchGoal.outcome, "needsTarget");
  assert.deepEqual(
    switchGoal.targetChoices?.map((target) => target.kind === "branch" ? target.branchName : ""),
    ["feature/one", "feature/two"],
  );

  const createGoal = resolveGoal(input, {
    goalId: "createBranch",
    target: { kind: "newBranch", branchName: unsafeBranch },
  });
  assert.equal(createGoal.outcome, "blocked");

  assert.throws(
    () => formatGoalCommand({ kind: "switch", branchName: unsafeBranch, create: false }),
    /unsafe operand/,
  );
});

class PartialCloneProcessExecutor implements ProcessExecutor {
  constructor(
    private readonly repository: string,
    private readonly requests: ProcessRequest[],
  ) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const args = request.args;

    if (same(args, ["--no-pager", "version"])) {
      return completed("git version 2.45.0\n");
    }
    if (same(args, ["--no-pager", "rev-parse", "--show-toplevel"])) {
      return completed(this.repository + "\n");
    }
    if (same(args, ["--no-pager", "config", "--local", "--get", "extensions.partialClone"])) {
      return completed("origin\n");
    }

    return {
      kind: "spawnFailed",
      error: new Error(`Unexpected Git invocation: ${args.join(" ")}`),
    };
  }
}

function same(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function completed(stdout: string): ProcessResult {
  return { kind: "completed", exitCode: 0, stdout, stderr: "" };
}
