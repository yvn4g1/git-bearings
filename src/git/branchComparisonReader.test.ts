import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { CoreRepositoryFacts, HistoryCommit } from "../domain/repositoryState";
import type { ResolvedBase } from "../repository/baseResolver";
import { BranchComparisonReader, parseShallow } from "./branchComparisonReader";
import { GitExecutor, type GitLogger } from "./gitExecutor";
import { ProcessRunner, type ProcessExecutor, type ProcessRequest, type ProcessResult } from "./processRunner";

const execFile = promisify(execFileCallback);
const silentLogger: GitLogger = { appendLine: () => undefined };
const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);

test("same-tip fast path skips Git, including shallow repositories", async () => {
  const process = new RecordingProcessExecutor();
  const reader = new BranchComparisonReader(new GitExecutor("git", process, silentLogger));
  const result = await reader.read("/repository", coreFacts(a), localBase(a));
  assert.equal(result.comparison.kind, "available");
  if (result.comparison.kind === "available") {
    assert.equal(result.comparison.value.ahead, 0);
    assert.equal(result.comparison.value.behind, 0);
    assert.equal(result.comparison.value.mergeBase?.id, a);
  }
  assert.equal(process.requests.length, 0);
});

test("shallow, multiple merge-bases, and invalid ids become local comparison failures", async () => {
  const shallow = new BranchComparisonReader(new GitExecutor("git", new ComparisonFixture({ shallow: true }), silentLogger));
  assert.equal((await shallow.read("/repository", coreFacts(a), localBase(b))).comparison.kind, "unavailable");

  const multiple = new BranchComparisonReader(new GitExecutor("git", new ComparisonFixture({ mergeBases: [a, b] }), silentLogger));
  assert.equal((await multiple.read("/repository", coreFacts(c), localBase(b))).comparison.kind, "unavailable");

  const invalidCore = coreFacts(a.toUpperCase());
  const process = new RecordingProcessExecutor();
  assert.equal((await new BranchComparisonReader(new GitExecutor("git", process, silentLogger)).read("/repository", invalidCore, localBase(b))).comparison.kind, "unavailable");
  assert.equal(process.requests.length, 0);
  assert.throws(() => parseShallow("unknown\n"));
});

test("unborn repositories with a resolved base are unavailable without Git reads", async () => {
  const process = new RecordingProcessExecutor();
  const core = coreFacts(a);
  const unborn: CoreRepositoryFacts = {
    ...core,
    currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false },
    history: [],
  };
  const result = await new BranchComparisonReader(new GitExecutor("git", process, silentLogger)).read("/repository", unborn, localBase(b));
  assert.equal(result.comparison.kind, "unavailable");
  assert.equal(process.requests.length, 0);
});

test("detached HEAD compares normally and preserves ahead/behind direction", async () => {
  for (const [relation, expected] of [["3\t0\n", [3, 0]], ["0\t4\n", [0, 4]], ["2\t5\n", [2, 5]]] as const) {
    const current = coreFacts(a);
    const detached: CoreRepositoryFacts = {
      ...current,
      currentLocation: { kind: "detached", branchName: null, head: commitRef(a), detached: true },
    };
    const fixture = new ComparisonFixture({ mergeBases: [c], relation });
    const result = await new BranchComparisonReader(new GitExecutor("git", fixture, silentLogger)).read("/repository", detached, localBase(b));
    assert.equal(result.comparison.kind, "available");
    if (result.comparison.kind === "available") {
      assert.deepEqual([result.comparison.value.ahead, result.comparison.value.behind], expected);
    }
  }
});

test("history and anchor failures preserve P06 history", async () => {
  for (const fail of ["history", "anchors"] as const) {
    const fixture = new ComparisonFixture({ mergeBases: [c], fail });
    const core = coreFacts(a);
    const result = await new BranchComparisonReader(new GitExecutor("git", fixture, silentLogger)).read("/repository", core, localBase(b));
    assert.equal(result.comparison.kind, "unavailable");
    assert.equal(result.history, core.history);
  }
});

test("real Git computes diverged direction and retains current, base, and distant merge-base anchors", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "root");
    const mergeBase = await gitOutput(repository, "rev-parse", "HEAD");
    await git(repository, "branch", "base");
    for (let index = 0; index < 28; index++) await commit(repository, `current-${index}`);
    const current = await gitOutput(repository, "rev-parse", "HEAD");
    await git(repository, "checkout", "base");
    for (let index = 0; index < 28; index++) await commit(repository, `base-${index}`);
    const base = await gitOutput(repository, "rev-parse", "HEAD");
    await git(repository, "checkout", "main");

    const result = await realReader().read(repository, coreFacts(current), localBase(base));
    assert.equal(result.comparison.kind, "available");
    if (result.comparison.kind === "available") {
      assert.equal(result.comparison.value.ahead, 28);
      assert.equal(result.comparison.value.behind, 28);
      assert.equal(result.comparison.value.mergeBase?.id, mergeBase);
    }
    const ids = result.history.map((entry) => entry.commit.id);
    assert.equal(ids.includes(current), true);
    assert.equal(ids.includes(base), true);
    assert.equal(ids.includes(mergeBase), true);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(result.history.length <= 53);
    const boundary = result.history.find((entry) => entry.parentIds.some((parent) => !ids.includes(parent)));
    assert.ok(boundary);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("real Git represents unrelated histories with null merge-base and counts", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "main-root");
    const base = await gitOutput(repository, "rev-parse", "HEAD");
    await git(repository, "checkout", "--orphan", "unrelated");
    await git(repository, "rm", "-rf", ".");
    await commit(repository, "other-root");
    const current = await gitOutput(repository, "rev-parse", "HEAD");
    const result = await realReader().read(repository, coreFacts(current), localBase(base));
    assert.equal(result.comparison.kind, "available");
    if (result.comparison.kind === "available") {
      assert.equal(result.comparison.value.mergeBase, null);
      assert.deepEqual([result.comparison.value.ahead, result.comparison.value.behind], [1, 1]);
    }
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("real Git preserves a true merge commit and all of its parent ids", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "root");
    await git(repository, "branch", "base");
    await commit(repository, "current-side");
    await git(repository, "checkout", "base");
    await commit(repository, "base-side");
    const base = await gitOutput(repository, "rev-parse", "HEAD");
    await git(repository, "checkout", "main");
    await git(repository, "merge", "--no-ff", "base", "-m", "merge base");
    const current = await gitOutput(repository, "rev-parse", "HEAD");
    const parents = (await gitOutput(repository, "show", "-s", "--format=%P", current)).split(" ");
    const currentCore = coreFacts(current);
    const result = await realReader().read(repository, { ...currentCore, history: [history(current, parents)] }, localBase(base));
    assert.equal(result.comparison.kind, "available");
    const merge = result.history.find((entry) => entry.commit.id === current);
    assert.equal(merge?.parentIds.length, 2);
    assert.equal(merge?.parentIds.includes(base), true);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("real criss-cross topology reports multiple merge-bases as unavailable", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "root");
    const root = await gitOutput(repository, "rev-parse", "HEAD");
    const tree = await gitOutput(repository, "rev-parse", "HEAD^{tree}");
    const first = await commitTree(repository, tree, [root], "first");
    const second = await commitTree(repository, tree, [root], "second");
    const current = await commitTree(repository, tree, [first, second], "current merge");
    const base = await commitTree(repository, tree, [second, first], "base merge");
    const actual = (await gitOutput(repository, "merge-base", "--all", current, base)).split("\n");
    assert.equal(actual.length, 2);
    const result = await realReader().read(repository, coreFacts(current), localBase(base));
    assert.equal(result.comparison.kind, "unavailable");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

function realReader(): BranchComparisonReader {
  return new BranchComparisonReader(new GitExecutor("git", new ProcessRunner(), silentLogger));
}

function coreFacts(id: string): CoreRepositoryFacts {
  const current = history(id);
  return {
    repository: { rootPath: "/repository" },
    currentLocation: { kind: "branch", branchName: "feature", head: current.commit, detached: false },
    localBranches: [{ name: "feature", tipCommitId: id }],
    workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    history: [current], operation: { kind: "normal" },
  };
}

function localBase(commitId: string): ResolvedBase {
  return { kind: "local", branchName: "main", ref: "refs/heads/main", commitId };
}

function history(id: string, parentIds: readonly string[] = []): HistoryCommit {
  return { commit: commitRef(id), parentIds };
}

function commitRef(id: string) { return { id, shortId: id.slice(0, 7), subject: id[0] }; }

function encodedHistory(entries: readonly HistoryCommit[]): string {
  return entries.map((entry) => `${entry.commit.id}\0${entry.commit.shortId}\0${entry.parentIds.join(" ")}\0${entry.commit.subject}\0`).join("");
}

class ComparisonFixture implements ProcessExecutor {
  constructor(private readonly options: { shallow?: boolean; mergeBases?: readonly string[]; relation?: string; fail?: "history" | "anchors" } = {}) {}
  async run(request: ProcessRequest): Promise<ProcessResult> {
    const completed = (stdout: string, exitCode = 0): ProcessResult => ({ kind: "completed", exitCode, stdout, stderr: "" });
    if (request.args.includes("--is-shallow-repository")) return completed(this.options.shallow ? "true\n" : "false\n");
    if (request.args.includes("merge-base")) return completed((this.options.mergeBases ?? [c]).join("\n") + "\n");
    if (request.args.includes("rev-list")) return completed(this.options.relation ?? "2\t3\n");
    if (request.args.includes("--max-count=50")) return this.options.fail === "history" ? completed("", 2) : completed(encodedHistory([history(a), history(b)]));
    if (request.args.includes("--no-walk")) return this.options.fail === "anchors" ? completed("", 2) : completed(encodedHistory([history(c)]));
    return completed("");
  }
}

class RecordingProcessExecutor implements ProcessExecutor {
  readonly requests: ProcessRequest[] = [];
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    return { kind: "completed", exitCode: 0, stdout: "", stderr: "" };
  }
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "git-bearings-comparison-"));
  await git(repository, "init");
  await git(repository, "symbolic-ref", "HEAD", "refs/heads/main");
  await git(repository, "config", "user.name", "Git Bearings Test");
  await git(repository, "config", "user.email", "test@example.invalid");
  return repository;
}

async function commit(repository: string, message: string): Promise<void> {
  const path = `${message}.txt`;
  await writeFile(join(repository, path), `${message}\n`);
  await git(repository, "add", path);
  await git(repository, "commit", "-m", message);
}

async function commitTree(repository: string, tree: string, parents: readonly string[], message: string): Promise<string> {
  const args = ["commit-tree", tree];
  for (const parent of parents) args.push("-p", parent);
  args.push("-m", message);
  return (await execFile("git", args, { cwd: repository })).stdout.trim();
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFile("git", args, { cwd: repository });
}

async function gitOutput(repository: string, ...args: string[]): Promise<string> {
  return (await execFile("git", args, { cwd: repository })).stdout.trim();
}
