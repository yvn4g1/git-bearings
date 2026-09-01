import { strict as assert } from "node:assert";
import test from "node:test";
import type { CommitDetail } from "../domain/commitDetail";
import { CommitDetailController } from "./commitDetailController";
import type { RepositoryStateSnapshot } from "./repositoryStateSnapshot";

const a = "a".repeat(40); const b = "b".repeat(40);
const detail = (hash: string): CommitDetail => ({ fullHash: hash, author: "author", authoredAt: "2024-01-02T03:04:05+09:00", parents: [], changedFiles: [], changedFileCount: 0 });

test("CommitDetail loads only for an open panel and valid commit selection", async () => {
  const reads: string[] = [];
  const controller = new CommitDetailController({ read: async (_path, hash) => { reads.push(hash); return { kind: "available", value: detail(hash) }; } });
  const snapshot = available("repo-a", "/a", a);
  controller.sync(snapshot, { kind: "commit", commitId: a });
  controller.setPanelOpen(true, snapshot, { kind: "overview" });
  controller.sync(snapshot, { kind: "head" });
  assert.deepEqual(reads, []);
  controller.sync(snapshot, { kind: "commit", commitId: a });
  assert.equal(controller.current.kind, "loading"); await settled();
  assert.deepEqual(reads, [a]); assert.equal(current(controller).kind, "available");
  controller.sync(snapshot, { kind: "branch", branchName: "main" }); controller.sync(snapshot, { kind: "commit", commitId: a });
  assert.deepEqual(reads, [a]); assert.equal(controller.current.kind, "available");
});

test("CommitDetail isolates cache, deduplicates inflight work, retries failures, and ignores stale responses", async () => {
  const deferred = new Map<string, Deferred>(); const reads: string[] = [];
  const controller = new CommitDetailController({ read: (_path, hash) => { reads.push(hash); const next = new Deferred(); deferred.set(`${reads.length}:${hash}`, next); return next.promise; } });
  const repoA = available("repo-a", "/a", a, b); const repoB = available("repo-b", "/b", a);
  controller.setPanelOpen(true, repoA, { kind: "commit", commitId: a });
  controller.sync(repoA, { kind: "commit", commitId: a }); assert.deepEqual(reads, [a]);
  controller.sync(repoA, { kind: "commit", commitId: b }); assert.deepEqual(reads, [a, b]);
  deferred.get(`1:${a}`)?.resolve({ kind: "available", value: detail(a) }); await settled();
  assert.equal(controller.current.kind, "loading");
  deferred.get(`2:${b}`)?.resolve({ kind: "unavailable", reason: "failed" }); await settled(); assert.equal(controller.current.kind, "unavailable");
  controller.sync(repoA, { kind: "overview" }); controller.sync(repoA, { kind: "commit", commitId: b }); assert.deepEqual(reads, [a, b, b]);
  deferred.get(`3:${b}`)?.resolve({ kind: "available", value: detail(b) }); await settled();
  controller.sync(repoB, { kind: "commit", commitId: a }); assert.deepEqual(reads, [a, b, b, a]);
  deferred.get(`4:${a}`)?.resolve({ kind: "available", value: detail(a) }); await settled();
  const state = current(controller); assert.equal(state.kind, "available"); if (state.kind === "available") assert.equal(state.rootPath, "/b");
});

test("CommitDetail ignores an old repository response after a repository switch", async () => {
  const pending: Deferred[] = [];
  const controller = new CommitDetailController({ read: () => { const next = new Deferred(); pending.push(next); return next.promise; } });
  controller.setPanelOpen(true, available("repo-a", "/a", a), { kind: "commit", commitId: a });
  controller.sync(available("repo-b", "/b", a), { kind: "commit", commitId: a });
  assert.equal(pending.length, 2);
  pending[0].resolve({ kind: "available", value: detail(a) }); await settled();
  assert.equal(current(controller).kind, "loading");
  pending[1].resolve({ kind: "available", value: detail(a) }); await settled();
  const state = current(controller); assert.equal(state.kind, "available"); if (state.kind === "available") assert.equal(state.rootPath, "/b");
});

test("CommitDetail reuses an in-flight request when returning to the same commit", async () => {
  const pending: Deferred[] = [];
  const controller = new CommitDetailController({ read: () => { const next = new Deferred(); pending.push(next); return next.promise; } });
  const snapshot = available("repo", "/repo", a, b);
  controller.setPanelOpen(true, snapshot, { kind: "commit", commitId: a });
  controller.sync(snapshot, { kind: "commit", commitId: b });
  controller.sync(snapshot, { kind: "commit", commitId: a });
  assert.equal(pending.length, 2);
  pending[0].resolve({ kind: "available", value: detail(a) }); await settled();
  const state = current(controller); assert.equal(state.kind, "available"); if (state.kind === "available") assert.equal(state.commitId, a);
});

function available(repositoryId: string, rootPath: string, ...ids: string[]): RepositoryStateSnapshot {
  return { kind: "available", repositoryId, state: { repository: { rootPath }, currentLocation: { kind: "branch", branchName: "main", head: { id: ids[0], shortId: ids[0].slice(0, 7), subject: "subject" }, detached: false }, localBranches: [{ name: "main", tipCommitId: ids[0] }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: ids.map((id) => ({ commit: { id, shortId: id.slice(0, 7), subject: "subject" }, parentIds: [] })), operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 1, refreshedAt: new Date(0) } };
}

class Deferred {
  readonly promise: Promise<{ kind: "available"; value: CommitDetail } | { kind: "unavailable"; reason: string }>;
  private readonly resolvePromise: (value: { kind: "available"; value: CommitDetail } | { kind: "unavailable"; reason: string }) => void;
  constructor() { let resolve!: (value: { kind: "available"; value: CommitDetail } | { kind: "unavailable"; reason: string }) => void; this.promise = new Promise((next) => { resolve = next; }); this.resolvePromise = resolve; }
  resolve(value: { kind: "available"; value: CommitDetail } | { kind: "unavailable"; reason: string }): void { this.resolvePromise(value); }
}
async function settled(): Promise<void> { await new Promise((resolve) => setImmediate(resolve)); }
function current(controller: CommitDetailController) { return controller.current; }
