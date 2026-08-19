import { strict as assert } from "node:assert";
import test from "node:test";
import { RepositorySelectionController } from "./repositorySelection";
import { VscodeGitRepositorySource, toCandidates, type DisposableLike, type GitApiLike } from "./vscodeGitRepositorySource";
function event() { let listener: (() => void) | undefined; return { subscribe: (next: () => void): DisposableLike => { listener = next; return { dispose: () => { listener = undefined; } }; }, fire: () => listener?.() }; }
function repository(path: string) { return { rootUri: { toString: () => `file://${path}`, fsPath: path } }; }
test("maps and deduplicates VS Code Git repositories without changing nested candidates", () => assert.deepEqual(toCandidates([repository("/parent"), repository("/parent/nested"), repository("/parent")]), [{ id: "file:///parent", rootPath: "/parent" }, { id: "file:///parent/nested", rootPath: "/parent/nested" }]));
test("waits for initialization, ignores early events, then refreshes the complete repository set", async () => {
  const open = event(), close = event(), state = event(); let repositories = [repository("/a")]; const snapshots: unknown[] = [];
  const api: GitApiLike = { get repositories() { return repositories; }, state: "uninitialized", onDidOpenRepository: open.subscribe, onDidCloseRepository: close.subscribe, onDidChangeState: state.subscribe };
  const source = new VscodeGitRepositorySource(async () => api, (candidates) => snapshots.push(candidates), () => assert.fail("unavailable"));
  let complete = false; const initialization = source.initialize().then(() => { complete = true; });
  await Promise.resolve(); assert.equal(complete, false); open.fire(); close.fire(); assert.equal(snapshots.length, 0);
  repositories = [repository("/a"), repository("/b")]; (api as { state: string }).state = "initialized"; state.fire();
  await initialization; assert.equal(complete, true); assert.deepEqual(snapshots[0], [{ id: "file:///a", rootPath: "/a" }, { id: "file:///b", rootPath: "/b" }]);
  repositories = [repository("/a"), repository("/b"), repository("/c")]; open.fire(); assert.equal((snapshots[1] as readonly unknown[]).length, 3); repositories = [repository("/b"), repository("/c")]; close.fire(); assert.equal((snapshots[2] as readonly unknown[]).length, 2); source.dispose();
});

test("final initialized snapshot prevents an early one-repository auto-selection", async () => {
  const open = event(), close = event(), state = event(); let repositories = [repository("/a")];
  const api: GitApiLike = { get repositories() { return repositories; }, state: "uninitialized", onDidOpenRepository: open.subscribe, onDidCloseRepository: close.subscribe, onDidChangeState: state.subscribe };
  const controller = new RepositorySelectionController();
  const source = new VscodeGitRepositorySource(async () => api, (candidates) => controller.updateCandidates(candidates), () => assert.fail("unavailable"));
  const initialization = source.initialize(); open.fire(); repositories = [repository("/a"), repository("/b")]; (api as { state: string }).state = "initialized"; state.fire(); await initialization;
  assert.equal(controller.currentState.kind, "selectionRequired"); source.dispose(); close.fire();
});
test("reports activation or API acquisition failures as unavailable", async () => { let reason: string | undefined; const source = new VscodeGitRepositorySource(async () => { throw new Error("Git extension unavailable"); }, () => assert.fail("candidates"), (value) => { reason = value; }); await source.initialize(); assert.equal(reason, "Git extension unavailable"); });
