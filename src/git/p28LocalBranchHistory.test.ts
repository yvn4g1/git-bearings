import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { createCommitGraphPresentation } from "../ui/commitGraphPresentation";
import { CoreRepositoryReader } from "./coreRepositoryReader";
import { GitExecutor, type GitLogger } from "./gitExecutor";
import { ProcessRunner, type ProcessExecutor, type ProcessRequest, type ProcessResult } from "./processRunner";

const execFile = promisify(execFileCallback);
const silentLogger: GitLogger = { appendLine: () => undefined };

const currentOid = "a".repeat(40);
const otherBranchOid = "b".repeat(40);

test("Core reader and Commit Graph include an unmerged local branch without mixing Remote refs", async () => {
  const repository = await createRepository();
  try {
    await commitFile(repository, "root.txt", "root\n", "root");
    await git(repository, "switch", "-c", "feature/manual-graph-test");
    await commitFile(repository, "feature.txt", "feature\n", "feature側のmanual test");
    const featureTip = await revParse(repository, "HEAD");

    await git(repository, "switch", "main");
    await commitFile(repository, "main.txt", "main\n", "main側のmanual test");
    const mainTip = await revParse(repository, "HEAD");

    const reader = new CoreRepositoryReader(new GitExecutor("git", new ProcessRunner(), silentLogger));
    const result = await reader.read(repository);
    assert.equal(result.kind, "available");
    if (result.kind !== "available") return;

    assert.equal(result.value.currentLocation.kind, "branch");
    if (result.value.currentLocation.kind !== "branch") return;
    assert.equal(result.value.currentLocation.branchName, "main");
    assert.equal(result.value.currentLocation.head.id, mainTip);

    const ids = new Set(result.value.history.map((entry) => entry.commit.id));
    assert.equal(ids.has(mainTip), true);
    assert.equal(ids.has(featureTip), true);

    const graphState: RepositoryState = {
      ...result.value,
      remotes: { kind: "notConfigured" },
      upstream: { kind: "notConfigured" },
      stash: { kind: "available", value: [] },
      comparison: { kind: "notConfigured" },
      stateVersion: 1,
      refreshedAt: new Date(0),
    };
    const graph = createCommitGraphPresentation(graphState);
    assert.equal(graph.kind, "graph");
    if (graph.kind !== "graph") return;
    assert.deepEqual(graph.localBranches.map((ref) => ref.label).sort(), ["feature/manual-graph-test", "main"]);
    const mainNode = graph.nodes.find((node) => node.commitId === mainTip);
    const featureNode = graph.nodes.find((node) => node.commitId === featureTip);
    assert.ok(mainNode);
    assert.ok(featureNode);
    assert.equal(mainNode.roles.includes("current"), true);
    assert.notEqual(mainNode.y, featureNode.y);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("current HEAD is resolved by status OID instead of history array position", async () => {
  const processExecutor = new BranchHistoryFixtureExecutor();
  const reader = new CoreRepositoryReader(new GitExecutor("git", processExecutor, silentLogger));
  const result = await reader.read(process.cwd());

  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.equal(result.value.history[0].commit.id, otherBranchOid);
  assert.equal(result.value.currentLocation.kind, "branch");
  if (result.value.currentLocation.kind !== "branch") return;
  assert.equal(result.value.currentLocation.branchName, "main");
  assert.equal(result.value.currentLocation.head.id, currentOid);

  const historyRequest = processExecutor.requests.find((request) => request.args.includes("log") && request.args.includes("--max-count=50"));
  assert.ok(historyRequest);
  assert.equal(historyRequest.args.includes("--branches"), true);
  assert.equal(historyRequest.args.includes("HEAD"), true);
  assert.equal(historyRequest.args.includes("--all"), false);
});

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "git-bearings-p28-branches-"));
  await git(repository, "init");
  await git(repository, "symbolic-ref", "HEAD", "refs/heads/main");
  await git(repository, "config", "user.name", "Git Bearings Test");
  await git(repository, "config", "user.email", "test@example.invalid");
  return repository;
}

async function commitFile(repository: string, path: string, content: string, message: string): Promise<void> {
  await mkdir(join(repository, path, ".."), { recursive: true });
  await writeFile(join(repository, path), content);
  await git(repository, "add", path);
  await git(repository, "commit", "-m", message);
}

async function revParse(repository: string, ref: string): Promise<string> {
  const { stdout } = await execFile("git", ["rev-parse", ref], { cwd: repository });
  return stdout.trim();
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFile("git", args, { cwd: repository });
}

class BranchHistoryFixtureExecutor implements ProcessExecutor {
  readonly requests: ProcessRequest[] = [];

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const args = request.args;
    const completed = (stdout: string, exitCode = 0): ProcessResult => ({ kind: "completed", exitCode, stdout, stderr: "" });

    if (args.at(-1) === "version") return completed("git version 2.39.0\n");
    if (args.includes("--show-toplevel")) return completed(process.cwd() + "\n");
    if (args.includes("ls-files")) return completed("");
    if (args.includes("config")) return completed("", 1);
    if (args.includes("status")) return completed(`# branch.oid ${currentOid}\0# branch.head main\0`);
    if (args.includes("for-each-ref")) return completed(`refs/heads/feature/manual-graph-test\t${otherBranchOid}\nrefs/heads/main\t${currentOid}\n`);
    if (args.includes("log")) return completed(`${otherBranchOid}\0bbbbbbb\0${currentOid}\0feature\0${currentOid}\0aaaaaaa\0\0main\0`);
    return completed(".git/git-bearings-does-not-exist\n");
  }
}
