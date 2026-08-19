import { strict as assert } from "node:assert";
import test from "node:test";
import { VscodeGitRepositorySource, toCandidates, type DisposableLike, type GitApiLike } from "./vscodeGitRepositorySource";
function event() { let listener: (() => void) | undefined; return { subscribe: (next: () => void): DisposableLike => { listener = next; return { dispose: () => { listener = undefined; } }; }, fire: () => listener?.() }; }
function repository(path: string) { return { rootUri: { toString: () => `file://${path}`, fsPath: path } }; }
test("maps and deduplicates VS Code Git repositories without changing nested candidates", () => assert.deepEqual(toCandidates([repository("/parent"), repository("/parent/nested"), repository("/parent")]), [{ id: "file:///parent", rootPath: "/parent" }, { id: "file:///parent/nested", rootPath: "/parent/nested" }]));
test("waits for Git API initialization and refreshes on repository open and close", async () => {
  const open = event(), close = event(), state = event(); let repositories = [repository("/a")]; const snapshots: unknown[] = [];
  const api: GitApiLike = { get repositories() { return repositories; }, state: "uninitialized", onDidOpenRepository: open.subscribe, onDidCloseRepository: close.subscribe, onDidChangeState: state.subscribe };
  const source = new VscodeGitRepositorySource(async () => api, (candidates) => snapshots.push(candidates), () => assert.fail("unavailable")); await source.initialize(); assert.equal(snapshots.length, 0);
  (api as { state: string }).state = "initialized"; state.fire(); assert.equal(snapshots.length, 1); repositories = [repository("/a"), repository("/b")]; open.fire(); assert.equal((snapshots[1] as readonly unknown[]).length, 2); repositories = [repository("/b")]; close.fire(); assert.deepEqual(snapshots[2], [{ id: "file:///b", rootPath: "/b" }]); source.dispose();
});
test("reports activation or API acquisition failures as unavailable", async () => { let reason: string | undefined; const source = new VscodeGitRepositorySource(async () => { throw new Error("Git extension unavailable"); }, () => assert.fail("candidates"), (value) => { reason = value; }); await source.initialize(); assert.equal(reason, "Git extension unavailable"); });
