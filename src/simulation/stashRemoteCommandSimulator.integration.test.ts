import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
async function git(cwd: string, ...args: string[]): Promise<string> { return (await execFile("git", args, { cwd })).stdout; }
async function repository(): Promise<string> { const path = await mkdtemp(join(tmpdir(), "git-bearings-p22-")); await git(path, "init"); await git(path, "symbolic-ref", "HEAD", "refs/heads/main"); await git(path, "config", "user.name", "Simulator Test"); await git(path, "config", "user.email", "simulator@example.test"); await git(path, "config", "commit.gpgsign", "false"); await git(path, "config", "core.hooksPath", join(path, "no-hooks")); return path; }
async function commit(path: string, name: string, value: string, message: string): Promise<void> { await writeFile(join(path, name), value); await git(path, "add", name); await git(path, "commit", "-m", message); }

test("real Git stash keeps untracked by default, includes it with -u, and apply/pop have distinct shelf effects", async () => {
  const path = await repository();
  try {
    await commit(path, "a.txt", "one\n", "root"); await writeFile(join(path, "a.txt"), "two\n"); await git(path, "add", "a.txt"); await writeFile(join(path, "u.txt"), "u\n");
    await git(path, "stash", "push", "-m", "tracked"); assert.equal(await git(path, "show", "HEAD:a.txt"), "one\n"); assert.equal((await git(path, "status", "--porcelain", "u.txt")).startsWith("??"), true);
    await git(path, "stash", "apply"); assert.equal((await git(path, "stash", "list")).includes("tracked"), true); assert.equal(await git(path, "diff", "--cached", "--", "a.txt"), ""); assert.equal((await git(path, "diff", "--", "a.txt")).includes("+two"), true); await git(path, "restore", "--staged", "a.txt"); await git(path, "restore", "a.txt"); await git(path, "stash", "pop"); assert.equal((await git(path, "stash", "list")).includes("tracked"), false);
    await git(path, "restore", "--staged", "a.txt"); await git(path, "restore", "a.txt"); await git(path, "stash", "push", "-u", "-m", "with-untracked"); assert.equal((await git(path, "status", "--porcelain", "u.txt")), "");
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("real Git fetch and push alter remote refs only through local bare remote operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "git-bearings-p22-remote-")); const bare = join(root, "remote.git"); const source = await repository(); const clone = join(root, "clone");
  try {
    await execFile("git", ["init", "--bare", bare]); await git(source, "remote", "add", "origin", bare); await commit(source, "a.txt", "one\n", "root"); await git(source, "push", "-u", "origin", "main");
    await execFile("git", ["clone", "--branch", "main", bare, clone]); await git(clone, "config", "user.name", "Simulator Test"); await git(clone, "config", "user.email", "simulator@example.test"); await git(clone, "config", "commit.gpgsign", "false"); await git(clone, "config", "core.hooksPath", join(clone, "no-hooks")); await commit(source, "remote.txt", "remote\n", "remote"); const old = await git(clone, "rev-parse", "refs/remotes/origin/main"); await git(source, "push"); await git(clone, "fetch", "origin"); assert.notEqual(await git(clone, "rev-parse", "refs/remotes/origin/main"), old); await git(clone, "merge", "--ff-only", "origin/main"); await git(clone, "branch", "feature"); await git(clone, "push", "-u", "origin", "feature"); assert.equal(await git(clone, "config", "--get", "branch.feature.remote"), "origin\n"); assert.equal(await git(clone, "config", "--get", "branch.feature.merge"), "refs/heads/feature\n");
    const bareOld = await git(bare, "rev-parse", "main"); await commit(clone, "local.txt", "local\n", "local"); await writeFile(join(clone, "uncommitted.txt"), "not pushed\n"); await git(clone, "push", "-u", "origin", "main"); assert.notEqual(await git(bare, "rev-parse", "main"), bareOld); assert.equal(await git(bare, "show", "main:local.txt"), "local\n"); await assert.rejects(git(bare, "show", "main:uncommitted.txt"));
  } finally { await Promise.all([rm(root, { recursive: true, force: true }), rm(source, { recursive: true, force: true })]); }
});
