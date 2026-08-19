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
    await git(repository, "config", "filter.evil.clean", `touch ${marker}`);
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
    await git(repository, "config", "core.fsmonitor", `touch ${fsmonitorMarker}`);
    await git(repository, "config", "filter.evil.clean", `touch ${filterMarker}`);
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
