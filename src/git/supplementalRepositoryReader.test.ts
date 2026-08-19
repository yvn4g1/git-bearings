import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { CoreRepositoryFacts } from "../domain/repositoryState";
import { GitExecutor, type GitLogger } from "./gitExecutor";
import { ProcessRunner, type ProcessExecutor, type ProcessRequest, type ProcessResult } from "./processRunner";
import { SupplementalRepositoryReader, parseAheadBehind, parseStash } from "./supplementalRepositoryReader";

const execFile = promisify(execFileCallback);
const silentLogger: GitLogger = { appendLine: () => undefined };
const idA = "a".repeat(40); const idB = "b".repeat(40);

test("reads remote tracking refs, a symbolic default, upstream relation, and NUL-safe stash entries", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "base.txt", "base\n", "base"); const head = await gitOutput(repository, "rev-parse", "HEAD");
    await git(repository, "remote", "add", "origin", join(repository, "remote.git")); await git(repository, "update-ref", "refs/remotes/origin/main", head);
    await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"); await git(repository, "config", "branch.main.remote", "origin"); await git(repository, "config", "branch.main.merge", "refs/heads/main");
    await writeFile(join(repository, "stash file.txt"), "stash\n"); await git(repository, "add", "stash file.txt"); await git(repository, "stash", "push", "-m", "Unicode 日本語 message"); await writeFile(join(repository, "second stash.txt"), "stash\n"); await git(repository, "add", "second stash.txt"); await git(repository, "stash", "push", "-m", "second message");
    const facts = await read(repository, normalFacts("main", head));
    assert.deepEqual(facts.remotes, { kind: "available", value: [{ name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/remotes/origin/main", commitId: head }], locallyKnownDefaultBranch: { branchName: "main", trackingRef: "refs/remotes/origin/main" } }] });
    assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") assert.deepEqual(facts.upstream.value.relation, { kind: "available", value: { ahead: 0, behind: 0 } });
    assert.equal(facts.stash.kind, "available"); if (facts.stash.kind === "available") { assert.deepEqual(facts.stash.value.map((entry) => entry.index), [0, 1]); assert.equal(facts.stash.value[1].message, "On main: Unicode 日本語 message"); assert.match(facts.stash.value[0].commitId, /^[0-9a-f]{40}$/); }
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("maps exact, custom, negative, and prefix-colliding fetch refspecs without path inference", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "base.txt", "base\n", "base"); const head = await gitOutput(repository, "rev-parse", "HEAD");
    await git(repository, "remote", "add", "foo", join(repository, "foo.git")); await git(repository, "config", "remote.foo/bar.url", join(repository, "foo-bar.git"));
    await git(repository, "config", "--unset-all", "remote.foo.fetch"); await git(repository, "config", "--add", "remote.foo.fetch", "+refs/heads/*:refs/custom/foo/*"); await git(repository, "config", "--add", "remote.foo.fetch", "^refs/heads/skip");
    await git(repository, "config", "--add", "remote.foo/bar.fetch", "refs/heads/release:refs/custom/foo-bar/release");
    await git(repository, "update-ref", "refs/custom/foo/main", head); await git(repository, "update-ref", "refs/custom/foo/feature", head); await git(repository, "update-ref", "refs/custom/foo/skip", head); await git(repository, "update-ref", "refs/custom/foo-bar/release", head);
    const facts = await read(repository, normalFacts("main", head)); assert.equal(facts.remotes.kind, "available"); if (facts.remotes.kind === "available") {
      assert.deepEqual(facts.remotes.value.map((remote) => [remote.name, remote.trackingRefs.map((ref) => ref.trackingRef)]), [["foo", ["refs/custom/foo/feature", "refs/custom/foo/main"]], ["foo/bar", ["refs/custom/foo-bar/release"]]]);
    }
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("represents no remote, detached, unborn upstream configuration, and missing tracking refs distinctly", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "base.txt", "base\n", "base"); const head = await gitOutput(repository, "rev-parse", "HEAD");
    let facts = await read(repository, normalFacts("main", head)); assert.deepEqual(facts.remotes, { kind: "available", value: [] }); assert.deepEqual(facts.upstream, { kind: "notConfigured" }); assert.deepEqual(facts.stash, { kind: "available", value: [] });
    await git(repository, "checkout", "--detach"); facts = await read(repository, detachedFacts(head)); assert.deepEqual(facts.upstream, { kind: "notConfigured" }); await git(repository, "checkout", "main");
    await git(repository, "remote", "add", "origin", join(repository, "remote.git")); await git(repository, "config", "branch.main.remote", "origin"); await git(repository, "config", "branch.main.merge", "refs/heads/missing");
    facts = await read(repository, normalFacts("main", head)); assert.deepEqual(facts.remotes, { kind: "available", value: [{ name: "origin", trackingRefs: [], locallyKnownDefaultBranch: null }] });
    assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") assert.equal(facts.upstream.value.relation.kind, "unavailable");
    await git(repository, "update-ref", "refs/remotes/origin/main", head); await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/missing");
    facts = await read(repository, normalFacts("main", head)); assert.deepEqual(facts.remotes, { kind: "available", value: [{ name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/remotes/origin/main", commitId: head }], locallyKnownDefaultBranch: null }] });
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("rejects incomplete remote mappings and uses P06's commit id for a local upstream relation", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "base.txt", "base\n", "base"); const base = await gitOutput(repository, "rev-parse", "HEAD"); await git(repository, "branch", "base"); await commit(repository, "local.txt", "local\n", "local"); const local = await gitOutput(repository, "rev-parse", "HEAD");
    await git(repository, "config", "branch.main.remote", "."); await git(repository, "config", "branch.main.merge", "refs/heads/base");
    let facts = await read(repository, normalFacts("main", local)); assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") { assert.equal(facts.upstream.value.remoteName, "."); assert.deepEqual(facts.upstream.value.relation, { kind: "available", value: { ahead: 1, behind: 0 } }); }
    facts = await read(repository, normalFacts("main", base)); assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") assert.deepEqual(facts.upstream.value.relation, { kind: "available", value: { ahead: 0, behind: 0 } });
    await git(repository, "remote", "add", "origin", join(repository, "origin.git")); await git(repository, "config", "remote.other.url", join(repository, "other.git")); await git(repository, "config", "remote.other.fetch", "refs/heads/main:refs/shared/main"); await git(repository, "config", "--unset-all", "remote.origin.fetch"); await git(repository, "config", "remote.origin.fetch", "refs/heads/main:refs/shared/main"); await git(repository, "update-ref", "refs/shared/main", local);
    facts = await read(repository, normalFacts("main", local)); assert.equal(facts.remotes.kind, "unavailable");
    await git(repository, "config", "--remove-section", "remote.other"); await git(repository, "config", "--unset-all", "remote.origin.fetch"); await git(repository, "config", "remote.origin.fetch", "not-a-refspec");
    facts = await read(repository, normalFacts("main", local)); assert.equal(facts.remotes.kind, "unavailable");
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("counts behind and diverged commits with local-only ahead semantics", async () => {
  const repository = await createRepository();
  try {
    await commit(repository, "base.txt", "base\n", "base"); const base = await gitOutput(repository, "rev-parse", "HEAD"); await git(repository, "branch", "upstream"); await git(repository, "checkout", "upstream"); await commit(repository, "upstream.txt", "upstream\n", "upstream"); const upstream = await gitOutput(repository, "rev-parse", "HEAD"); await git(repository, "checkout", "main"); await git(repository, "config", "branch.main.remote", "."); await git(repository, "config", "branch.main.merge", "refs/heads/upstream");
    let facts = await read(repository, normalFacts("main", base)); assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") assert.deepEqual(facts.upstream.value.relation, { kind: "available", value: { ahead: 0, behind: 1 } });
    await commit(repository, "local.txt", "local\n", "local"); const local = await gitOutput(repository, "rev-parse", "HEAD"); facts = await read(repository, normalFacts("main", local)); assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") assert.deepEqual(facts.upstream.value.relation, { kind: "available", value: { ahead: 1, behind: 1 } }); void upstream;
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("unborn upstream configuration and partial failures stay independent", async () => {
  const process = new FixtureProcessExecutor(); const reader = new SupplementalRepositoryReader(new GitExecutor("git", process, silentLogger));
  const unborn = { currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false } } satisfies Pick<CoreRepositoryFacts, "currentLocation">;
  let noConfigFacts = await new SupplementalRepositoryReader(new GitExecutor("git", new FixtureProcessExecutor({ unbornConfig: "none" }), silentLogger)).read("/repository", unborn); assert.deepEqual(noConfigFacts.upstream, { kind: "notConfigured" });
  let facts = await reader.read("/repository", unborn); assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") assert.equal(facts.upstream.value.relation.kind, "unavailable");
  const remoteFailure = new FixtureProcessExecutor({ fail: "remote" }); facts = await new SupplementalRepositoryReader(new GitExecutor("git", remoteFailure, silentLogger)).read("/repository", unborn); assert.equal(facts.remotes.kind, "unavailable"); assert.equal(facts.stash.kind, "available");
  const stashFailure = new FixtureProcessExecutor({ fail: "stash" }); facts = await new SupplementalRepositoryReader(new GitExecutor("git", stashFailure, silentLogger)).read("/repository", unborn); assert.equal(facts.stash.kind, "unavailable"); assert.equal(facts.upstream.kind, "available");
  const normal = normalFacts("main", idA);
  const upstreamFailure = new FixtureProcessExecutor({ fail: "upstream" }); facts = await new SupplementalRepositoryReader(new GitExecutor("git", upstreamFailure, silentLogger)).read("/repository", normal); assert.equal(facts.upstream.kind, "unavailable"); assert.equal(facts.remotes.kind, "available"); assert.equal(facts.stash.kind, "available");
  const relationFailure = new FixtureProcessExecutor({ fail: "relation" }); facts = await new SupplementalRepositoryReader(new GitExecutor("git", relationFailure, silentLogger)).read("/repository", normal); assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") assert.equal(facts.upstream.value.relation.kind, "unavailable");
  const refsFailure = new FixtureProcessExecutor({ fail: "refs" }); facts = await new SupplementalRepositoryReader(new GitExecutor("git", refsFailure, silentLogger)).read("/repository", normal); assert.equal(facts.remotes.kind, "unavailable"); assert.equal(facts.stash.kind, "available"); assert.equal(facts.upstream.kind, "available"); if (facts.upstream.kind === "available") { assert.equal(facts.upstream.value.remoteName, "origin"); assert.equal(facts.upstream.value.branchName, "main"); assert.equal(facts.upstream.value.trackingRef, "refs/remotes/origin/main"); assert.equal(facts.upstream.value.relation.kind, "unavailable"); }
});

test("parser rejects ambiguous refspecs and preserves relation direction", () => {
  assert.deepEqual(parseAheadBehind("3\t2\n"), { ahead: 3, behind: 2 }); assert.throws(() => parseAheadBehind("2 3\n"));
  assert.deepEqual(parseStash(`stash@{1}\0${idA}\0message with spaces 日本語\0`), [{ index: 1, commitId: idA, message: "message with spaces 日本語" }]);
});

async function read(repository: string, coreFacts: Pick<CoreRepositoryFacts, "currentLocation">) { return new SupplementalRepositoryReader(new GitExecutor("git", new ProcessRunner(), silentLogger)).read(repository, coreFacts); }
function normalFacts(branchName: string, id: string): Pick<CoreRepositoryFacts, "currentLocation"> { return { currentLocation: { kind: "branch", branchName, head: { id, shortId: id.slice(0, 7), subject: "test" }, detached: false } }; }
function detachedFacts(id: string): Pick<CoreRepositoryFacts, "currentLocation"> { return { currentLocation: { kind: "detached", branchName: null, head: { id, shortId: id.slice(0, 7), subject: "test" }, detached: true } }; }
async function createRepository(): Promise<string> { const repository = await mkdtemp(join(tmpdir(), "git-bearings-supplemental-")); await git(repository, "init"); await git(repository, "symbolic-ref", "HEAD", "refs/heads/main"); await git(repository, "config", "user.name", "Git Bearings Test"); await git(repository, "config", "user.email", "test@example.invalid"); return repository; }
async function commit(repository: string, path: string, content: string, message: string): Promise<void> { await mkdir(join(repository, path, ".."), { recursive: true }); await writeFile(join(repository, path), content); await git(repository, "add", path); await git(repository, "commit", "-m", message); }
async function git(repository: string, ...args: string[]): Promise<void> { await execFile("git", args, { cwd: repository }); }
async function gitOutput(repository: string, ...args: string[]): Promise<string> { return (await execFile("git", args, { cwd: repository })).stdout.trim(); }

class FixtureProcessExecutor implements ProcessExecutor {
  constructor(private readonly options: { fail?: "remote" | "upstream" | "relation" | "refs" | "stash"; unbornConfig?: "none" } = {}) {}
  async run(request: ProcessRequest): Promise<ProcessResult> {
    const args = request.args; const completed = (stdout: string, exitCode = 0): ProcessResult => ({ kind: "completed", exitCode, stdout, stderr: "" });
    if (args.includes("remote")) return this.options.fail === "remote" ? completed("", 2) : completed("origin\n");
    if (args.includes("stash")) return this.options.fail === "stash" ? completed("", 2) : completed("");
    if (args.includes("^remote\\..*\\.fetch$")) return completed("remote.origin.fetch\n+refs/heads/*:refs/remotes/origin/*\0");
    if (args.includes("^branch\\..*\\.(remote|merge)$")) return this.options.unbornConfig === "none" ? completed("", 1) : this.options.fail === "upstream" ? completed("", 2) : completed("branch.main.remote\norigin\0branch.main.merge\nrefs/heads/main\0");
    if (args.includes("refs/heads/")) return this.options.fail === "upstream" ? completed("", 2) : completed("refs/heads/main\0origin\0refs/heads/main\0refs/remotes/origin/main\0");
    if (args.includes("rev-list")) return this.options.fail === "relation" ? completed("", 2) : completed("0\t0\n");
    if (args.includes("refs/")) return this.options.fail === "refs" ? completed("", 2) : completed(`${idB}\0refs/remotes/origin/main\0\0`);
    return completed("");
  }
}
