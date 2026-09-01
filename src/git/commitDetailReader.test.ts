import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { CommitDetailReader, parseCommitDetailMetadata, parseCommitDetailParents, parseCommitDetailPaths } from "./commitDetailReader";
import { GitExecutor, type GitLogger } from "./gitExecutor";
import { ProcessRunner } from "./processRunner";

const silentLogger: GitLogger = { appendLine: () => undefined };
const oid = "a".repeat(40);
const execFile = promisify(execFileCallback);

test("metadata and NUL path parsers validate CommitDetail boundaries", () => {
  const metadata = `${oid}\0Author <unsafe>\0${"2024-01-02T03:04:05+09:00"}\0`;
  assert.deepEqual(parseCommitDetailMetadata(metadata, oid), { fullHash: oid, author: "Author <unsafe>", authoredAt: "2024-01-02T03:04:05+09:00" });
  assert.equal(parseCommitDetailMetadata(`${oid}\0Author\0${"2024-01-02T03:04:05Z"}\0`, oid)?.authoredAt, "2024-01-02T03:04:05Z");
  assert.equal(parseCommitDetailMetadata(`${oid}\0Author\0${"2024-01-02T03:04:05-05:00"}\0`, oid)?.authoredAt, "2024-01-02T03:04:05-05:00");
  for (const invalid of ["", `${"b".repeat(40)}\0a\0${"2024-01-02T03:04:05+09:00"}\0`, `${oid}\0a\0invalid\0`, `${oid}\0a\0${"2024-01-02 03:04:05"}\0`, `${oid}\0a\0${"2024-01-02T03:04:05+0900"}\0`]) assert.equal(parseCommitDetailMetadata(invalid, oid), undefined);
  assert.deepEqual(parseCommitDetailParents(`tree ${oid}\nparent ${"b".repeat(40)}\nparent ${"c".repeat(40)}\ngpgsig signed\n continuation\n\nmessage`), ["b".repeat(40), "c".repeat(40)]);
  assert.deepEqual(parseCommitDetailParents(`tree ${oid}\nauthor a\n\nmessage`), []); assert.equal(parseCommitDetailParents(`tree ${oid}\nparent HEAD\n\nmessage`), undefined);
  assert.deepEqual(parseCommitDetailPaths("space file\0tab\tfile\0line\nbreak\0<&\"'\0"), ["space file", "tab\tfile", "line\nbreak", "<&\"'"]);
  assert.deepEqual(parseCommitDetailPaths(""), []); assert.equal(parseCommitDetailPaths("missing terminator"), undefined);
});

test("CommitDetailReader reads root, normal, and first-parent merge paths from Git", async () => {
  const repository = await mkdtemp(join(tmpdir(), "git-bearings-detail-"));
  try {
    await git(repository, "init"); await git(repository, "config", "user.name", "Test Author"); await git(repository, "config", "user.email", "test@example.invalid"); await git(repository, "config", "commit.gpgsign", "false");
    const weird = "space file & apostrophe'.txt";
    await write(repository, weird, "root"); await git(repository, "add", weird); await git(repository, "commit", "-m", "root");
    const root = await head(repository); const baseBranch = await branch(repository); await git(repository, "branch", "feature");
    await write(repository, "main.txt", "main"); await git(repository, "add", "main.txt"); await git(repository, "commit", "-m", "main");
    const normal = await head(repository);
    await git(repository, "checkout", "feature"); await write(repository, "feature.txt", "feature"); await git(repository, "add", "feature.txt"); await git(repository, "commit", "-m", "feature");
    await git(repository, "checkout", baseBranch); await git(repository, "merge", "--no-ff", "feature", "-m", "merge");
    const merge = await head(repository);
    const reader = new CommitDetailReader(new GitExecutor("git", new ProcessRunner(), silentLogger));
    const rootDetail = await reader.read(repository, root); const normalDetail = await reader.read(repository, normal); const mergeDetail = await reader.read(repository, merge);
    assert.equal(rootDetail.kind, "available"); assert.equal(normalDetail.kind, "available"); assert.equal(mergeDetail.kind, "available");
    if (rootDetail.kind === "available") { assert.deepEqual(rootDetail.value.parents, []); assert.deepEqual(rootDetail.value.changedFiles, [weird]); assert.equal(rootDetail.value.fullHash, root); }
    if (normalDetail.kind === "available") { assert.equal(normalDetail.value.parents.length, 1); assert.deepEqual(normalDetail.value.changedFiles, ["main.txt"]); }
    if (mergeDetail.kind === "available") { assert.equal(mergeDetail.value.parents.length, 2); assert.deepEqual(mergeDetail.value.changedFiles, ["feature.txt"]); }
    await write(repository, "utc.txt", "utc"); await git(repository, "add", "utc.txt"); await gitWithEnvironment(repository, { GIT_AUTHOR_DATE: "2024-01-02T03:04:05Z", GIT_COMMITTER_DATE: "2024-01-02T03:04:05Z" }, "commit", "-m", "utc");
    const utcDetail = await reader.read(repository, await head(repository)); assert.equal(utcDetail.kind, "available"); if (utcDetail.kind === "available") assert.match(utcDetail.value.authoredAt, /^2024-01-02T03:04:05(?:Z|\+00:00)$/);
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("CommitDetailReader does not treat a shallow boundary as a root commit", async () => {
  const source = await mkdtemp(join(tmpdir(), "git-bearings-detail-source-"));
  const clone = await mkdtemp(join(tmpdir(), "git-bearings-detail-clone-"));
  try {
    await git(source, "init"); await git(source, "config", "user.name", "Test Author"); await git(source, "config", "user.email", "test@example.invalid"); await git(source, "config", "commit.gpgsign", "false");
    for (const [path, content] of [["one.txt", "one"], ["two.txt", "two"], ["three.txt", "three"]] as const) { await write(source, path, content); await git(source, "add", path); await git(source, "commit", "-m", path); }
    await rm(clone, { recursive: true, force: true }); await execFile("git", ["clone", "--depth", "1", `file://${source}`, clone]);
    const boundary = await head(clone); const raw = await execFile("git", ["cat-file", "commit", boundary], { cwd: clone });
    assert.match(raw.stdout, /^parent [0-9a-f]{40}$/m);
    const detail = await new CommitDetailReader(new GitExecutor("git", new ProcessRunner(), silentLogger)).read(clone, boundary);
    assert.equal(detail.kind, "unavailable");
  } finally { await rm(source, { recursive: true, force: true }); await rm(clone, { recursive: true, force: true }); }
});

async function write(repository: string, path: string, content: string): Promise<void> { await writeFile(join(repository, path), content); }
async function git(repository: string, ...args: string[]): Promise<void> { await execFile("git", args, { cwd: repository }); }
async function gitWithEnvironment(repository: string, environment: NodeJS.ProcessEnv, ...args: string[]): Promise<void> { await execFile("git", args, { cwd: repository, env: { ...process.env, ...environment } }); }
async function head(repository: string): Promise<string> { const result = await execFile("git", ["rev-parse", "HEAD"], { cwd: repository }); return result.stdout.trim(); }
async function branch(repository: string): Promise<string> { const result = await execFile("git", ["symbolic-ref", "--short", "HEAD"], { cwd: repository }); return result.stdout.trim(); }
