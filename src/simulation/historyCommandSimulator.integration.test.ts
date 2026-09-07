import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
async function git(cwd: string, ...args: string[]): Promise<string> { return (await execFile("git", args, { cwd })).stdout; }
async function repository(prefix = "git-bearings-p23-"): Promise<string> { const path = await mkdtemp(join(tmpdir(), prefix)); await git(path, "init"); await git(path, "symbolic-ref", "HEAD", "refs/heads/main"); await git(path, "config", "user.name", "Simulator Test"); await git(path, "config", "user.email", "simulator@example.test"); await git(path, "config", "commit.gpgsign", "false"); await git(path, "config", "core.hooksPath", join(path, "no-hooks")); return path; }
async function commit(path: string, name: string, content: string, message: string): Promise<void> { await writeFile(join(path, name), content); await git(path, "add", name); await git(path, "commit", "-m", message); }

test("real Git merge has no commit for up-to-date or fast-forward and creates a two-parent true merge", async () => {
  const path = await repository();
  try {
    await commit(path, "root.txt", "root\n", "root"); const root = (await git(path, "rev-parse", "HEAD")).trim();
    await git(path, "branch", "feature"); await git(path, "merge", "feature"); assert.equal((await git(path, "rev-parse", "HEAD")).trim(), root);
    await git(path, "switch", "feature"); await commit(path, "feature.txt", "feature\n", "feature"); const feature = (await git(path, "rev-parse", "HEAD")).trim(); await git(path, "switch", "main"); await git(path, "merge", "feature"); assert.equal((await git(path, "rev-parse", "HEAD")).trim(), feature); assert.equal((await git(path, "rev-list", "--parents", "-n", "1", "HEAD")).trim().split(" ").length, 2);
    await git(path, "branch", "side"); await commit(path, "main.txt", "main\n", "main"); await git(path, "switch", "side"); await commit(path, "side.txt", "side\n", "side"); await git(path, "switch", "main"); await git(path, "merge", "--no-ff", "side", "-m", "merge side"); assert.equal((await git(path, "rev-list", "--parents", "-n", "1", "HEAD")).trim().split(" ").length, 3);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("real Git rebase creates replacement commits in oldest-to-newest order while old objects remain", async () => {
  const path = await repository();
  try {
    await commit(path, "root.txt", "root\n", "root"); await git(path, "branch", "feature"); await commit(path, "main.txt", "main\n", "main"); await git(path, "switch", "feature"); await commit(path, "one.txt", "one\n", "one"); const oldOne = (await git(path, "rev-parse", "HEAD")).trim(); await commit(path, "two.txt", "two\n", "two"); const oldTwo = (await git(path, "rev-parse", "HEAD")).trim(); await git(path, "rebase", "main"); const subjects = (await git(path, "log", "--format=%s", "-2")).trim().split("\n"); const newIds = (await git(path, "rev-list", "--max-count=2", "HEAD")).trim().split("\n");
    assert.deepEqual(subjects, ["two", "one"]); assert.notEqual(newIds[0], oldTwo); assert.notEqual(newIds[1], oldOne); await git(path, "cat-file", "-e", `${oldOne}^{commit}`); await git(path, "cat-file", "-e", `${oldTwo}^{commit}`);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("real Git pull --rebase fetches from a local bare remote then replaces local commits", async () => {
  const root = await mkdtemp(join(tmpdir(), "git-bearings-p23-pull-")); const bare = join(root, "remote.git"); const source = await repository(); const clone = join(root, "clone");
  try {
    await execFile("git", ["init", "--bare", bare]); await git(source, "remote", "add", "origin", bare); await commit(source, "root.txt", "root\n", "root"); await git(source, "push", "-u", "origin", "main"); await execFile("git", ["clone", "--branch", "main", bare, clone]); await git(clone, "config", "user.name", "Simulator Test"); await git(clone, "config", "user.email", "simulator@example.test"); await git(clone, "config", "commit.gpgsign", "false"); await git(clone, "config", "core.hooksPath", join(clone, "no-hooks"));
    await commit(clone, "local.txt", "local\n", "local"); const oldLocal = (await git(clone, "rev-parse", "HEAD")).trim(); await commit(source, "remote.txt", "remote\n", "remote"); await git(source, "push"); await git(clone, "pull", "--rebase", "origin", "main"); assert.notEqual((await git(clone, "rev-parse", "HEAD")).trim(), oldLocal); assert.equal((await git(clone, "log", "--format=%s", "-2")).trim(), "local\nremote");
  } finally { await Promise.all([rm(root, { recursive: true, force: true }), rm(source, { recursive: true, force: true })]); }
});
