import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
async function git(cwd: string, ...args: string[]): Promise<string> { return (await execFile("git", args, { cwd })).stdout; }
async function repository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "git-bearings-simulator-"));
  await git(path, "init"); await git(path, "symbolic-ref", "HEAD", "refs/heads/main");
  await git(path, "config", "user.name", "Simulator Test"); await git(path, "config", "user.email", "simulator@example.test");
  await git(path, "config", "commit.gpgsign", "false"); await git(path, "config", "core.hooksPath", join(path, "no-hooks"));
  return path;
}
async function commitFile(path: string, name: string, content: string, message = "root"): Promise<void> { await writeFile(join(path, name), content); await git(path, "add", name); await git(path, "commit", "-m", message); }

test("real Git keeps latest add in the index and unstage keeps Working Tree content", async () => {
  const path = await repository();
  try {
    await commitFile(path, "a.txt", "one\n");
    await writeFile(join(path, "a.txt"), "two\n"); await git(path, "add", "a.txt");
    assert.equal(await git(path, "show", ":a.txt"), "two\n");
    await writeFile(join(path, "a.txt"), "three\n"); await git(path, "add", "a.txt");
    assert.equal(await git(path, "show", ":a.txt"), "three\n");
    await git(path, "restore", "--staged", "a.txt");
    assert.equal(await git(path, "show", ":a.txt"), "one\n");
    assert.equal((await git(path, "diff", "--", "a.txt")).includes("+three"), true);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("real Git commit leaves a later unstaged edit and switch -c preserves dirtiness", async () => {
  const path = await repository();
  try {
    await commitFile(path, "a.txt", "one\n");
    await writeFile(join(path, "a.txt"), "two\n"); await git(path, "add", "a.txt"); await writeFile(join(path, "a.txt"), "three\n");
    await git(path, "commit", "-m", "staged two");
    assert.equal(await git(path, "show", "HEAD:a.txt"), "two\n"); assert.equal((await git(path, "diff", "--", "a.txt")).includes("+three"), true);
    await git(path, "switch", "-c", "feature");
    assert.equal((await git(path, "branch", "--show-current")).trim(), "feature"); assert.equal((await git(path, "diff", "--", "a.txt")).includes("+three"), true);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("real Git can retarget an unborn symbolic branch without creating a commit", async () => {
  const path = await repository();
  try {
    await git(path, "switch", "-c", "feature");
    assert.equal((await git(path, "branch", "--show-current")).trim(), "feature");
    await assert.rejects(git(path, "rev-parse", "HEAD"));
  } finally { await rm(path, { recursive: true, force: true }); }
});
