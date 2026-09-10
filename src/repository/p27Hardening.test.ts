import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { BranchComparisonReader } from "../git/branchComparisonReader";
import { CoreRepositoryReader } from "../git/coreRepositoryReader";
import { GitExecutor, type GitLogger } from "../git/gitExecutor";
import { ProcessRunner, type ProcessExecutor, type ProcessRequest, type ProcessResult } from "../git/processRunner";
import { SupplementalRepositoryReader } from "../git/supplementalRepositoryReader";
import { RepositoryStateReader } from "./repositoryStateReader";

const execFile = promisify(execFileCallback);

test("production reader chain preserves semantic Git state and never contacts a remote or logs private payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "git-bearings-p27-"));
  const repository = join(root, "repository");
  const remote = join(root, "remote-url-credential-sentinel.git");
  const secret = "credential=token-p27-secret";
  try {
    await git(root, "init", "--bare", remote);
    await git(root, "init", "-b", "main", repository);
    await git(repository, "config", "user.name", "Author <script>");
    await git(repository, "config", "user.email", "author@example.invalid");
    await git(repository, "config", "commit.gpgsign", "false");
    await writeFile(join(repository, "base <path>.txt"), "base\n");
    await git(repository, "add", ".");
    await git(repository, "commit", "-m", "base <commit>");
    await git(repository, "checkout", "-b", "feature-<branch>&");
    await writeFile(join(repository, "feature.txt"), "feature\n");
    await git(repository, "add", "feature.txt");
    await git(repository, "commit", "-m", "feature <commit>");
    await writeFile(join(repository, "stash <path>.txt"), "stash\n");
    await git(repository, "add", "stash <path>.txt");
    await git(repository, "stash", "push", "-m", `stash <message> ${secret}`);
    await writeFile(join(repository, "same <staged>.txt"), "staged\n");
    await git(repository, "add", "same <staged>.txt");
    await writeFile(join(repository, "same <staged>.txt"), "staged\nunstaged\n");
    await writeFile(join(repository, "untracked <path>.txt"), "untracked\n");
    await git(repository, "remote", "add", "origin", remote);
    await git(repository, "config", "branch.feature-<branch>&.remote", "origin");
    await git(repository, "config", "branch.feature-<branch>&.merge", "refs/heads/main");
    await git(repository, "config", "p27.sentinel", secret);

    const before = await semanticSnapshot(repository);
    const requests: ProcessRequest[] = [];
    const logger = new RecordingLogger();
    const executor = new GitExecutor("git", new RecordingProcessRunner(requests), logger);
    const reader = new RepositoryStateReader(
      new CoreRepositoryReader(executor),
      new SupplementalRepositoryReader(executor),
      new BranchComparisonReader(executor),
    );

    const result = await reader.read(repository, { kind: "local", branchName: "main", ref: "refs/heads/main" }, { stateVersion: 1, refreshedAt: new Date(0) });

    assert.equal(result.kind, "available");
    if (result.kind === "available") {
      assert.equal(result.value.workingTree.staged.length, 1);
      assert.equal(result.value.workingTree.unstaged.length, 1);
      assert.deepEqual(result.value.workingTree.untracked, ["untracked <path>.txt"]);
      assert.equal(result.value.stash.kind, "available");
    }
    assert.deepEqual(await semanticSnapshot(repository), before);
    assert.equal(await readFile(join(repository, "untracked <path>.txt"), "utf8"), "untracked\n");

    for (const forbidden of ["fetch", "pull", "push", "ls-remote"]) {
      assert.ok(!requests.some((request) => request.args.includes(forbidden)), `must not run ${forbidden}`);
    }
    const logs = logger.lines.join("\n");
    assert.ok(!logs.includes(secret));
    assert.ok(!logs.includes(remote));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class RecordingProcessRunner implements ProcessExecutor {
  private readonly runner = new ProcessRunner();
  constructor(private readonly requests: ProcessRequest[]) {}
  run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    return this.runner.run(request);
  }
}

class RecordingLogger implements GitLogger {
  readonly lines: string[] = [];
  appendLine(value: string): void { this.lines.push(value); }
}

async function semanticSnapshot(repository: string): Promise<Record<string, string>> {
  return {
    head: await gitOutput(repository, "rev-parse", "HEAD"),
    symbolicHead: await gitOutput(repository, "symbolic-ref", "-q", "HEAD"),
    refs: await gitOutput(repository, "for-each-ref", "--format=%(refname)%00%(objectname)%00", "refs/"),
    status: await gitOutput(repository, "status", "--porcelain=v2", "-z"),
    staged: await gitOutput(repository, "diff", "--cached", "--binary"),
    unstaged: await gitOutput(repository, "diff", "--binary"),
    stash: await gitOutput(repository, "stash", "list", "--format=%gd%x00%H%x00%gs%x00"),
    config: await gitOutput(repository, "config", "--local", "--list", "--null"),
  };
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFile("git", args, { cwd: repository });
}

async function gitOutput(repository: string, ...args: string[]): Promise<string> {
  return (await execFile("git", args, { cwd: repository })).stdout;
}
