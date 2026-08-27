import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { RepositoryStateSnapshotStore } from "../ui/repositoryStateSnapshot";
import type { RepositoryStateSnapshot } from "../ui/repositoryStateSnapshot";
import { RepositoryStateRefreshController, type RefreshScheduler } from "./repositoryStateRefreshController";

const oid = "a".repeat(40);
const candidate = (id: string) => ({ id, rootPath: `/${id}` });
const state = (version: number): RepositoryState => ({ repository: { rootPath: "/a" }, currentLocation: { kind: "branch", branchName: "main", head: { id: oid, shortId: "aaaaaaa", subject: "initial" }, detached: false }, localBranches: [], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [], operation: { kind: "normal" }, remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: version, refreshedAt: new Date(0) });

test("debounces selected repository events and coalesces bursts", async () => {
  let selected = candidate("a"); const scheduler = fakeScheduler(); let reads = 0;
  const controller = create({ getSelected: () => selected, scheduler, read: async (_path, _base, metadata) => { reads += 1; return { kind: "available" as const, value: state(metadata.stateVersion) }; } });
  controller.requestAutoRefresh("a"); scheduler.advance(299); assert.equal(reads, 0);
  controller.requestAutoRefresh("a"); scheduler.advance(299); assert.equal(reads, 0); scheduler.advance(1); await flush(); assert.equal(reads, 1);
  controller.requestAutoRefresh("other"); scheduler.advance(300); assert.equal(reads, 1);
});

test("read-time events become one follow-up without parallel reads", async () => {
  let selected = candidate("a"); const deferred = deferredResult(); let reads = 0;
  const controller = create({ getSelected: () => selected, read: async (_path, _base, metadata) => { reads += 1; return reads === 1 ? deferred.promise : { kind: "available" as const, value: state(metadata.stateVersion) }; } });
  void controller.refreshNow(); await flush(); controller.requestAutoRefresh("a"); controller.requestAutoRefresh("a"); assert.equal(reads, 1);
  deferred.resolve({ kind: "available", value: state(1) }); await flush(); await flush(); assert.equal(reads, 2);
});

test("refreshNow waits for the one coalesced follow-up result while a read is active", async () => {
  let selected = candidate("a"); const first = deferredResult(); let reads = 0;
  const controller = create({ getSelected: () => selected, read: async (_path, _base, metadata) => { reads += 1; return reads === 1 ? first.promise : { kind: "available" as const, value: state(metadata.stateVersion) }; } });
  void controller.refreshNow(); await flush(); const waiting = controller.refreshNow(); assert.equal(reads, 1);
  first.resolve({ kind: "available", value: state(1) }); const result = await waiting;
  assert.equal(reads, 2); assert.equal(result?.kind, "available"); if (result?.kind === "available") assert.equal(result.value.stateVersion, 2);
});

test("multiple refreshNow callers share one pending follow-up", async () => {
  let selected = candidate("a"); const first = deferredResult(); let reads = 0;
  const controller = create({ getSelected: () => selected, read: async (_path, _base, metadata) => { reads += 1; return reads === 1 ? first.promise : { kind: "available" as const, value: state(metadata.stateVersion) }; } });
  void controller.refreshNow(); await flush(); const firstWaiter = controller.refreshNow(), secondWaiter = controller.refreshNow(); assert.equal(reads, 1);
  first.resolve({ kind: "available", value: state(1) }); const [one, two] = await Promise.all([firstWaiter, secondWaiter]);
  assert.equal(reads, 2); assert.equal(one?.kind, "available"); assert.equal(two?.kind, "available");
});

test("refreshNow does not return stale results after a repository switch", async () => {
  let selected = candidate("a"); const a = deferredResult(), b = deferredResult(); const store = new RepositoryStateSnapshotStore(); let calls = 0;
  const controller = create({ store, getSelected: () => selected, read: async (_path, _base, metadata) => ++calls === 1 ? a.promise : b.promise });
  const result = controller.refreshNow(); selected = candidate("b"); controller.onSelectionChanged(); await flush(); a.resolve({ kind: "available", value: state(1) }); assert.equal(await result, undefined);
  assert.equal(store.current.kind, "loading"); b.resolve({ kind: "available", value: state(1) }); await flush(); const afterB = store.current as RepositoryStateSnapshot; if (afterB.kind === "available") assert.equal(afterB.state.stateVersion, 1);
});

test("A to B to A does not return the old A result to its refreshNow caller", async () => {
  let selected = candidate("a"); const oldA = deferredResult(); let calls = 0;
  const controller = create({ getSelected: () => selected, read: async (_path, _base, metadata) => ++calls === 1 ? oldA.promise : { kind: "available" as const, value: state(metadata.stateVersion) } });
  const result = controller.refreshNow(); selected = candidate("b"); controller.onSelectionChanged(); await flush(); selected = candidate("a"); controller.onSelectionChanged(); await flush(); oldA.resolve({ kind: "available", value: state(1) });
  assert.equal(await result, undefined);
});

test("versions advance only for current available publications and failures replace old facts", async () => {
  let selected = candidate("a"); const store = new RepositoryStateSnapshotStore(); const results = [{ kind: "available" as const }, { kind: "unavailable" as const, reason: "core failed" }, { kind: "available" as const }];
  const controller = create({ store, getSelected: () => selected, read: async (_path, _base, metadata) => { const next = results.shift()!; return next.kind === "available" ? { ...next, value: { ...state(metadata.stateVersion), comparison: { kind: "unavailable", reason: "comparison failed" } } } : next; } });
  await controller.refreshNow(); assert.equal(store.current.kind, "available"); if (store.current.kind === "available") assert.equal(store.current.state.stateVersion, 1);
  await controller.refreshNow(); assert.equal(store.current.kind, "unavailable");
  await controller.refreshNow(); const third = store.current as RepositoryStateSnapshot; if (third.kind === "available") assert.equal(third.state.stateVersion, 2); else assert.fail("available expected");
});

test("selection generations discard A results after A to B to A while B starts immediately", async () => {
  let selected = candidate("a"); const store = new RepositoryStateSnapshotStore(); const firstA = deferredResult(); let calls: string[] = [];
  const controller = create({ store, getSelected: () => selected, read: async (path, _base, metadata) => { calls.push(path); if (calls.length === 1) return firstA.promise; return { kind: "available" as const, value: { ...state(metadata.stateVersion), repository: { rootPath: path } } }; } });
  controller.onSelectionChanged(); await flush(); selected = candidate("b"); controller.onSelectionChanged(); await flush(); assert.ok(calls.includes("/b")); selected = candidate("a"); controller.onSelectionChanged(); await flush(); firstA.resolve({ kind: "available", value: state(1) }); await flush();
  assert.equal(store.current.kind, "available"); if (store.current.kind === "available") assert.equal(store.current.state.stateVersion, 2);
});

test("manual refresh does not wait for debounce and selection changes show loading", async () => {
  let selected = candidate("a"); const store = new RepositoryStateSnapshotStore(); let reads = 0;
  const controller = create({ store, getSelected: () => selected, read: async (_path, _base, metadata) => { reads += 1; return { kind: "available" as const, value: state(metadata.stateVersion) }; } });
  controller.onSelectionChanged(); assert.equal(store.current.kind, "loading"); await flush();
  controller.requestAutoRefresh("a"); assert.equal(store.current.kind, "available");
  await controller.refreshNow(); assert.equal(reads, 2);
});

function create(options: { getSelected: () => ReturnType<typeof candidate>; read: (path: string, base: unknown, metadata: { stateVersion: number; refreshedAt: Date }) => Promise<any>; scheduler?: RefreshScheduler; store?: RepositoryStateSnapshotStore }) { return new RepositoryStateRefreshController({ getSelectedRepository: options.getSelected, getSavedBase: () => undefined, read: options.read, snapshotStore: options.store ?? new RepositoryStateSnapshotStore(), scheduler: options.scheduler }); }
function deferredResult() { let resolve!: (value: any) => void; const promise = new Promise<any>((next) => { resolve = next; }); return { promise, resolve }; }
function flush() { return new Promise<void>((resolve) => setImmediate(resolve)); }
function fakeScheduler(): RefreshScheduler & { advance(ms: number): void } { let nextId = 0; const timers = new Map<number, { at: number; callback: () => void }>(); let now = 0; return { schedule: (delayMs, callback) => { const id = nextId++; timers.set(id, { at: now + delayMs, callback }); return { dispose: () => timers.delete(id) }; }, advance: (ms: number) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } } }; }
