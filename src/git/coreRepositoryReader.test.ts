import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  CoreRepositoryReader,
  hasActiveExternalFilter,
  parseConfiguredFilterDrivers,
  parseHistory,
  parseIndexEntries,
  parseLocalBranches,
  parsePorcelainV2,
} from "./coreRepositoryReader";
import { GitExecutor, type GitLogger } from "./gitExecutor";
import { ProcessRunner } from "./processRunner";
import type { ProcessExecutor, ProcessRequest, ProcessResult } from "./processRunner";

const execFile = promisify(execFileCallback);
const silentLogger: GitLogger = { appendLine: () => undefined };
const commitId = "0123456789abcdef0123456789abcdef01234567";

test("porcelain v2 parser handles branch, changes, rename, untracked, and conflicts", () => {
  const conflictRecords = [
    ["DD", "bothDeleted"], ["AU", "addedByUs"], ["UD", "deletedByThem"],
    ["UA", "addedByThem"], ["DU", "deletedByUs"], ["AA", "bothAdded"], ["UU", "bothModified"],
  ].map(([xy]) => `u ${xy} N... 100644 100644 100644 100644 ${commitId} ${commitId} ${commitId} conflict-${xy}`);
  const status = parsePorcelainV2([
    `# branch.oid ${commitId}`,
    "# branch.head main",
    `1 MM N... 100644 100644 100644 ${commitId} ${commitId} space name.txt`,
    `2 RM N... 100644 100644 100644 ${commitId} ${commitId} R100 renamed.txt`,
    "original name.txt",
    "? untracked 日本語.txt",
    ...conflictRecords,
    "# unknown.header ignored",
    "",
  ].join("\0"));

  assert.equal(status.headKind, "branch");
  assert.equal(status.branchName, "main");
  assert.deepEqual(status.workingTree.staged, [
    { path: "space name.txt", kind: "modified" },
    { path: "renamed.txt", originalPath: "original name.txt", kind: "renamed" },
  ]);
  assert.deepEqual(status.workingTree.unstaged, [
    { path: "space name.txt", kind: "modified" },
    { path: "renamed.txt", kind: "modified" },
  ]);
  assert.deepEqual(status.workingTree.untracked, ["untracked 日本語.txt"]);
  assert.deepEqual(
    status.workingTree.conflicts.map((file) => file.kind),
    ["bothDeleted", "addedByUs", "deletedByThem", "addedByThem", "deletedByUs", "bothAdded", "bothModified"],
  );
  assert.throws(() => parsePorcelainV2(`# branch.oid ${commitId}\0# branch.head main\0x unknown\0`));
  assert.throws(() => parsePorcelainV2(`# branch.oid ${commitId}\0# branch.head main\0${"1"} M. S... 1 1 1 ${commitId} ${commitId} submodule\0`));
  assert.throws(() => parsePorcelainV2(`# branch.oid ${commitId}\0# branch.head main\0${"2"} M. N... 1 1 1 ${commitId} ${commitId} R100 renamed\0original\0`));
});

test("porcelain v2 parser handles detached and unborn states", () => {
  assert.equal(parsePorcelainV2(`# branch.oid ${commitId}\0# branch.head (detached)\0`).headKind, "detached");
  assert.equal(parsePorcelainV2("# branch.oid (initial)\0# branch.head main\0").headKind, "unborn");
});

test("Core parsers retain NUL-safe facts and reject malformed filter output", () => {
  assert.deepEqual(parseIndexEntries(`100644 ${commitId} 0\tname with space\0${"160000"} ${commitId} 0\tsubmodule\0`), {
    paths: ["name with space", "submodule"], hasGitlink: true,
  });
  assert.deepEqual([...parseConfiguredFilterDrivers("filter.evil.clean\0filter.driver.with.dot.process\0")], ["evil", "driver.with.dot"]);
  assert.equal(hasActiveExternalFilter("file\0filter\0unspecified\0", new Set(["evil"])), false);
  assert.equal(hasActiveExternalFilter("file\0filter\0evil\0", new Set(["evil"])), true);
  assert.throws(() => hasActiveExternalFilter("file\0wrong\0evil\0", new Set(["evil"])));
  assert.deepEqual(parseLocalBranches(`refs/heads/main\t${commitId}\n`), [{ name: "main", tipCommitId: commitId }]);
  assert.deepEqual(parseHistory(`${commitId}\0${commitId.slice(0, 7)}\0\0root\0`)[0].parentIds, []);
  assert.deepEqual(parseHistory(`${commitId}\0${commitId.slice(0, 7)}\0${commitId} ${commitId}\0merge\0`)[0].parentIds, [commitId, commitId]);
});

test("CoreRepositoryReader reads core facts and preserves staged and unstaged changes", async () => {
  const repository = await createRepository();
  try {
    await writeFile(join(repository, "tracked file.txt"), "one\n");
    await git(repository, "add", "tracked file.txt");
    await git(repository, "commit", "-m", "root");
    await git(repository, "branch", "feature/example");
    await writeFile(join(repository, "tracked file.txt"), "two\n");
    await git(repository, "add", "tracked file.txt");
    await writeFile(join(repository, "tracked file.txt"), "three\n");
    await writeFile(join(repository, "untracked 日本語.txt"), "untracked\n");

    const result = await readCore(repository);
    assert.equal(result.kind, "available");
    if (result.kind !== "available") return;
    assert.equal(result.value.currentLocation.kind, "branch");
    assert.equal(result.value.history.length, 1);
    assert.equal(result.value.history[0].parentIds.length, 0);
    assert.deepEqual(result.value.localBranches.map((branch) => branch.name).sort(), ["feature/example", "main"]);
    assert.deepEqual(result.value.workingTree.staged, [{ path: "tracked file.txt", kind: "modified" }]);
    assert.deepEqual(result.value.workingTree.unstaged, [{ path: "tracked file.txt", kind: "modified" }]);
    assert.deepEqual(result.value.workingTree.untracked, ["untracked 日本語.txt"]);
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CoreRepositoryReader represents a staged rename with an unstaged modification", async () => {
  const repository = await createRepository();
  try {
    await commitFile(repository, "a.txt", "one\n", "root");
    await git(repository, "mv", "a.txt", "b.txt");
    await writeFile(join(repository, "b.txt"), "two\n");
    const result = await readCore(repository);
    assert.equal(result.kind, "available");
    if (result.kind === "available") {
      assert.deepEqual(result.value.workingTree.staged, [{ path: "b.txt", originalPath: "a.txt", kind: "renamed" }]);
      assert.deepEqual(result.value.workingTree.unstaged, [{ path: "b.txt", kind: "modified" }]);
    }
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CoreRepositoryReader reports a clean normal repository", async () => {
  const repository = await createRepository();
  try {
    await commitFile(repository, "clean.txt", "clean\n", "root");
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: repository });
    const result = await readCore(repository);
    assert.equal(result.kind, "available");
    if (result.kind === "available") {
      assert.equal(result.value.currentLocation.kind, "branch");
      assert.deepEqual(result.value.workingTree, { staged: [], unstaged: [], untracked: [], conflicts: [] });
      assert.equal(result.value.history[0].commit.id, stdout.trim());
      assert.deepEqual(result.value.operation, { kind: "normal" });
    }
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CoreRepositoryReader reads true merges, merge conflicts, and rebase conflicts", async () => {
  const mergeRepository = await createRepository();
  const conflictRepository = await createRepository();
  const rebaseRepository = await createRepository();
  try {
    await commitFile(mergeRepository, "root.txt", "root\n", "root");
    await git(mergeRepository, "branch", "feature");
    await commitFile(mergeRepository, "main.txt", "main\n", "main");
    await git(mergeRepository, "checkout", "feature");
    await commitFile(mergeRepository, "feature.txt", "feature\n", "feature");
    await git(mergeRepository, "checkout", "main");
    await git(mergeRepository, "merge", "--no-ff", "feature", "-m", "merge feature");
    const mergeResult = await readCore(mergeRepository);
    assert.equal(mergeResult.kind, "available");
    if (mergeResult.kind === "available") assert.equal(mergeResult.value.history[0].parentIds.length, 2);

    await createDivergedConflict(conflictRepository);
    await gitFails(conflictRepository, "merge", "feature");
    const conflictResult = await readCore(conflictRepository);
    assert.equal(conflictResult.kind, "available");
    if (conflictResult.kind === "available") {
      assert.deepEqual(conflictResult.value.operation, { kind: "merge" });
      assert.equal(conflictResult.value.workingTree.conflicts[0]?.path, "shared.txt");
    }

    await createDivergedConflict(rebaseRepository);
    await git(rebaseRepository, "checkout", "feature");
    await gitFails(rebaseRepository, "rebase", "main");
    const rebaseResult = await readCore(rebaseRepository);
    assert.equal(rebaseResult.kind, "available");
    if (rebaseResult.kind === "available") assert.deepEqual(rebaseResult.value.operation, { kind: "rebase" });
  } finally {
    await Promise.all([mergeRepository, conflictRepository, rebaseRepository].map((path) => rm(path, { recursive: true, force: true })));
  }
});

test("CoreRepositoryReader supports unborn and detached repositories", async () => {
  const unborn = await createRepository();
  const detached = await createRepository();
  try {
    const unbornResult = await readCore(unborn);
    assert.equal(unbornResult.kind, "available");
    if (unbornResult.kind === "available") {
      assert.deepEqual(unbornResult.value.currentLocation, { kind: "unborn", branchName: "main", head: null, detached: false });
      assert.deepEqual(unbornResult.value.history, []);
    }
    await commitFile(detached, "file.txt", "one\n", "root");
    await git(detached, "checkout", "--detach");
    const detachedResult = await readCore(detached);
    assert.equal(detachedResult.kind, "available");
    if (detachedResult.kind === "available") assert.equal(detachedResult.value.currentLocation.kind, "detached");
  } finally {
    await rm(unborn, { recursive: true, force: true });
    await rm(detached, { recursive: true, force: true });
  }
});

test("CoreRepositoryReader refuses active external filters before status", async () => {
  const repository = await createRepository();
  const marker = join(repository, "filter-ran");
  try {
    await commitFile(repository, "filtered.txt", "content\n", "root");
    await git(repository, "config", "filter.evil.clean", await markerCommand(repository, marker));
    await writeFile(join(repository, ".gitattributes"), "filtered.txt filter=evil\n");
    await git(repository, "add", ".gitattributes");
    await git(repository, "commit", "-m", "configure filter attribute");
    await rm(marker, { force: true });
    const result = await readCore(repository);
    assert.deepEqual(result.kind, "unavailable");
    await assert.rejects(access(marker));
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CoreRepositoryReader neutralizes fsmonitor and allows inactive configured filters", async () => {
  const repository = await createRepository();
  const fsmonitorMarker = join(repository, "fsmonitor-ran");
  const filterMarker = join(repository, "filter-ran");
  try {
    await commitFile(repository, "tracked.txt", "content\n", "root");
    await git(repository, "config", "core.fsmonitor", await markerCommand(repository, fsmonitorMarker));
    await git(repository, "config", "filter.evil.clean", await markerCommand(repository, filterMarker));
    const result = await readCore(repository);
    assert.equal(result.kind, "available");
    await assert.rejects(access(fsmonitorMarker));
    await assert.rejects(access(filterMarker));
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CoreRepositoryReader identifies rebase and unsupported operation paths", async () => {
  const repository = await createRepository();
  try {
    await commitFile(repository, "tracked.txt", "content\n", "root");
    await mkdir(join(repository, ".git", "rebase-merge"));
    const rebase = await readCore(repository);
    assert.equal(rebase.kind, "available");
    if (rebase.kind === "available") assert.deepEqual(rebase.value.operation, { kind: "rebase" });
    await rm(join(repository, ".git", "rebase-merge"), { recursive: true });
    await writeFile(join(repository, ".git", "CHERRY_PICK_HEAD"), commitId);
    const cherryPick = await readCore(repository);
    assert.equal(cherryPick.kind, "available");
    if (cherryPick.kind === "available") assert.deepEqual(cherryPick.value.operation, { kind: "unsupported", operationName: "cherry-pick" });
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CoreRepositoryReader rejects gitlinks before reading status", async () => {
  const repository = await createRepository();
  try {
    await commitFile(repository, "tracked.txt", "content\n", "root");
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: repository });
    await git(repository, "update-index", "--add", "--cacheinfo", `160000,${stdout.trim()},nested-submodule`);
    const result = await readCore(repository);
    assert.equal(result.kind, "unavailable");
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CoreRepositoryReader reads with log.showSignature enabled", async () => {
  const repository = await createRepository();
  try {
    await commitFile(repository, "signed.txt", "content\n", "root");
    await git(repository, "config", "log.showSignature", "true");
    assert.equal((await readCore(repository)).kind, "available");
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CoreRepositoryReader normalizes command failures and version-gate failures", async () => {
  const unsupported = new CoreFixtureExecutor({ version: "git version 2.22.9\n" });
  assert.equal((await new CoreRepositoryReader(new GitExecutor("git", unsupported, silentLogger)).read(process.cwd())).kind, "unavailable");
  assert.deepEqual(unsupported.requests.map((request) => request.args.at(-1)), ["version"]);
  const versionFailure = new CoreFixtureExecutor({ versionFailure: true });
  assert.equal((await new CoreRepositoryReader(new GitExecutor("git", versionFailure, silentLogger)).read(process.cwd())).kind, "unavailable");
  assert.equal(versionFailure.requests.length, 1);
  const commandFailure = new CoreFixtureExecutor({ failRoot: true });
  assert.equal((await new CoreRepositoryReader(new GitExecutor("git", commandFailure, silentLogger)).read(process.cwd())).kind, "unavailable");
});

test("CoreRepositoryReader rejects snapshot mismatches and caches supported versions", async () => {
  const mismatch = new CoreFixtureExecutor({ historyId: "b".repeat(40) });
  assert.equal((await new CoreRepositoryReader(new GitExecutor("git", mismatch, silentLogger)).read(process.cwd())).kind, "unavailable");
  const cached = new CoreFixtureExecutor({});
  const reader = new CoreRepositoryReader(new GitExecutor("git", cached, silentLogger));
  assert.equal((await reader.read(process.cwd())).kind, "available");
  assert.equal((await reader.read(process.cwd())).kind, "available");
  assert.equal(cached.requests.filter((request) => request.args.at(-1) === "version").length, 1);
});

test("CoreRepositoryReader stops before status for gitlinks and active filters", async () => {
  for (const mode of ["gitlink", "activeFilter"] as const) {
    const executor = new CoreFixtureExecutor({ mode });
    assert.equal((await new CoreRepositoryReader(new GitExecutor("git", executor, silentLogger)).read(process.cwd())).kind, "unavailable");
    assert.equal(executor.requests.some((request) => request.args.includes("status")), false);
  }
});

async function readCore(repository: string) {
  return new CoreRepositoryReader(new GitExecutor("git", new ProcessRunner(), silentLogger)).read(repository);
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "git-bearings-core-"));
  await git(repository, "init");
  await git(repository, "symbolic-ref", "HEAD", "refs/heads/main");
  await git(repository, "config", "user.name", "Git Bearings Test");
  await git(repository, "config", "user.email", "test@example.invalid");
  return repository;
}

async function commitFile(repository: string, path: string, content: string, message: string): Promise<void> {
  const directory = join(repository, path, "..");
  await mkdir(directory, { recursive: true });
  await writeFile(join(repository, path), content);
  await git(repository, "add", path);
  await git(repository, "commit", "-m", message);
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFile("git", args, { cwd: repository });
}

async function gitFails(repository: string, ...args: string[]): Promise<void> {
  await assert.rejects(execFile("git", args, { cwd: repository }));
}

async function createDivergedConflict(repository: string): Promise<void> {
  await commitFile(repository, "shared.txt", "base\n", "root");
  await git(repository, "branch", "feature");
  await writeFile(join(repository, "shared.txt"), "main\n");
  await git(repository, "add", "shared.txt");
  await git(repository, "commit", "-m", "main change");
  await git(repository, "checkout", "feature");
  await writeFile(join(repository, "shared.txt"), "feature\n");
  await git(repository, "add", "shared.txt");
  await git(repository, "commit", "-m", "feature change");
  await git(repository, "checkout", "main");
}

async function markerCommand(repository: string, marker: string): Promise<string> {
  const script = join(repository, ".git", "git-bearings-marker.js");
  await writeFile(script, "require('node:fs').writeFileSync(process.argv[2], 'marker');\n");
  return [process.execPath, script, marker].map((value) => JSON.stringify(value)).join(" ");
}

class CoreFixtureExecutor implements ProcessExecutor {
  readonly requests: ProcessRequest[] = [];
  constructor(private readonly options: { version?: string; versionFailure?: boolean; failRoot?: boolean; historyId?: string; mode?: "gitlink" | "activeFilter" }) {}
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const args = request.args;
    const completed = (stdout: string, exitCode = 0): ProcessResult => ({ kind: "completed", exitCode, stdout, stderr: "" });
    if (args.at(-1) === "version") return this.options.versionFailure ? { kind: "spawnFailed", error: new Error("ENOENT") } : completed(this.options.version ?? "git version 2.39.0\n");
    if (args.includes("--show-toplevel")) return this.options.failRoot ? { kind: "spawnFailed", error: new Error("failure") } : completed(process.cwd() + "\n");
    if (args.includes("ls-files")) return completed(this.options.mode === "gitlink" ? `160000 ${"a".repeat(40)} 0\tsub\0` : `100644 ${"a".repeat(40)} 0\tfile\0`);
    if (args.includes("config")) return this.options.mode === "activeFilter" ? completed("filter.evil.clean\0") : completed("", 1);
    if (args.includes("check-attr")) return completed("file\0filter\0evil\0");
    if (args.includes("status")) return completed(`# branch.oid ${"a".repeat(40)}\0# branch.head main\0`);
    if (args.includes("for-each-ref")) return completed(`refs/heads/main\t${"a".repeat(40)}\n`);
    if (args.includes("log")) return completed(`${this.options.historyId ?? "a".repeat(40)}\0aaaaaaa\0\0root\0`);
    return completed(".git/unused\n");
  }
}
