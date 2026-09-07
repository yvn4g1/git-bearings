import { strict as assert } from "node:assert";
import test from "node:test";
import type { GitCommand } from "../domain/gitCommand";
import type { CommitRef, RepositoryState } from "../domain/repositoryState";
import { simulateGitCommand } from "./commandSimulator";

const ids = { base: "a".repeat(40), current: "b".repeat(40), target: "c".repeat(40), next: "d".repeat(40) };
const ref = (id: string): CommitRef => ({ id, shortId: id.slice(0, 7), subject: id.slice(0, 1) });
function state(overrides: Partial<RepositoryState> = {}): RepositoryState {
  return { repository: { rootPath: "/repo" }, currentLocation: { kind: "branch", branchName: "main", head: ref(ids.current), detached: false }, localBranches: [{ name: "main", tipCommitId: ids.current }, { name: "feature", tipCommitId: ids.target }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [{ commit: ref(ids.current), parentIds: [ids.base] }, { commit: ref(ids.target), parentIds: [ids.base] }, { commit: ref(ids.base), parentIds: [] }], operation: { kind: "normal" }, remotes: { kind: "available", value: [{ name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/remotes/origin/main", commitId: ids.target }, { branchName: "special", trackingRef: "refs/custom/origin/special", commitId: ids.next }], locallyKnownDefaultBranch: null }] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: ref(ids.base), ahead: 1, behind: 1 } }, stateVersion: 23, refreshedAt: new Date("2026-09-07"), ...overrides };
}
const command = (value: GitCommand) => value;

test("merge uses only exact known targets and does not call unresolved targets blocked", () => {
  const local = simulateGitCommand(state(), command({ kind: "merge", branch: "feature" }));
  assert.equal(local.kind, "supported"); assert.deepEqual(local.events[0], { kind: "commitCreated", commit: { kind: "newMergeCommit", parentCommitIds: [ids.current, ids.target] } });
  const remote = simulateGitCommand(state({ comparison: { kind: "notConfigured" } }), command({ kind: "merge", branch: "origin/main" }));
  assert.equal(remote.events.some((event) => event.kind === "commitCreated"), false);
  const custom = simulateGitCommand(state(), command({ kind: "merge", branch: "origin/special" }));
  assert.deepEqual(custom.unknowns, [{ code: "targetResolutionUnknown", operand: "origin/special" }]);
  const unresolved = simulateGitCommand(state(), command({ kind: "merge", branch: "v1.0" }));
  assert.equal(unresolved.kind, "supported"); assert.deepEqual(unresolved.unknowns, [{ code: "targetResolutionUnknown", operand: "v1.0" }]);
});

test("merge distinguishes no-op, fast-forward, true merge, unborn and detached without future hashes", () => {
  const same = simulateGitCommand(state({ localBranches: [{ name: "main", tipCommitId: ids.current }, { name: "same", tipCommitId: ids.current }] }), command({ kind: "merge", branch: "same" }));
  assert.deepEqual(same.events, [{ kind: "noOp" }]);
  const fastForward = simulateGitCommand(state({ comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: ref(ids.current), ahead: 0, behind: 1 } } }), command({ kind: "merge", branch: "feature" }));
  assert.equal(fastForward.events.some((event) => event.kind === "commitCreated"), false); assert.deepEqual(fastForward.events[0], { kind: "branchPointerMoved", branchName: "main", target: { kind: "existingCommit", id: ids.target } });
  const detached = simulateGitCommand(state({ currentLocation: { kind: "detached", branchName: null, head: ref(ids.current), detached: true }, comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: ref(ids.current), ahead: 0, behind: 1 } } }), command({ kind: "merge", branch: "feature" }));
  assert.deepEqual(detached.events[0], { kind: "headDetachedMoved", target: { kind: "existingCommit", id: ids.target } });
  const unborn = simulateGitCommand(state({ currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false }, localBranches: [{ name: "feature", tipCommitId: ids.target }], history: [] }), command({ kind: "merge", branch: "feature" }));
  assert.deepEqual(unborn.events[0], { kind: "branchPointerMoved", branchName: "main", target: { kind: "existingCommit", id: ids.target } });
  assert.equal(JSON.stringify(simulateGitCommand(state(), command({ kind: "merge", branch: "feature" }))).includes("shortId"), false);
});

test("bounded history only gives positive ancestry proofs, and merge keeps conflict and dirty uncertainty", () => {
  const unknown = simulateGitCommand(state({ comparison: { kind: "notConfigured" }, history: [{ commit: ref(ids.current), parentIds: ["e".repeat(40)] }, { commit: ref(ids.target), parentIds: [ids.base] }] }), command({ kind: "merge", branch: "feature" }));
  assert.deepEqual(unknown.unknowns, [{ code: "historyRelationUnknown" }]);
  const dirty = simulateGitCommand(state({ workingTree: { staged: [], unstaged: [{ path: "a", kind: "modified" }], untracked: [], conflicts: [] } }), command({ kind: "merge", branch: "feature" }));
  assert.equal(dirty.warnings.some((note) => note.code === "mergeMayConflict"), true); assert.equal(dirty.warnings.some((note) => note.code === "dirtyMergeMayFail"), true);
  assert.equal(simulateGitCommand(state({ workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [{ path: "a", kind: "bothModified" }] } }), command({ kind: "merge", branch: "feature" })).kind, "blocked");
  assert.equal(simulateGitCommand(state({ operation: { kind: "merge" } }), command({ kind: "merge", branch: "feature" })).kind, "unsupported");
});

test("rebase preserves old commits and creates ordered replacement predictions only for a complete linear range", () => {
  const result = simulateGitCommand(state(), command({ kind: "rebase", upstream: "feature" }));
  assert.equal(result.kind, "supported"); assert.deepEqual(result.events.slice(0, 1), [{ kind: "commitCreated", commit: { kind: "rewrittenCommit", originalCommitId: ids.current, basedOn: { kind: "existingCommit", id: ids.target } } }]);
  assert.equal(JSON.stringify(result).includes("shortId"), false);
  const multiple = simulateGitCommand(state({ history: [{ commit: ref(ids.next), parentIds: [ids.current] }, { commit: ref(ids.current), parentIds: [ids.base] }, { commit: ref(ids.target), parentIds: [ids.base] }, { commit: ref(ids.base), parentIds: [] }], currentLocation: { kind: "branch", branchName: "main", head: ref(ids.next), detached: false }, localBranches: [{ name: "main", tipCommitId: ids.next }, { name: "feature", tipCommitId: ids.target }], comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: ref(ids.base), ahead: 2, behind: 1 } } }), command({ kind: "rebase", upstream: "feature" }));
  assert.deepEqual(multiple.events.slice(0, 2).map((event) => (event as Extract<typeof event, { kind: "commitCreated" }>).commit), [{ kind: "rewrittenCommit", originalCommitId: ids.current, basedOn: { kind: "existingCommit", id: ids.target } }, { kind: "rewrittenCommit", originalCommitId: ids.next, basedOn: { kind: "previousRewrittenCommit", originalCommitId: ids.current } }]);
  const mergeRange = simulateGitCommand(state({ history: [{ commit: ref(ids.current), parentIds: [ids.base, ids.target] }, { commit: ref(ids.target), parentIds: [ids.base] }, { commit: ref(ids.base), parentIds: [] }] }), command({ kind: "rebase", upstream: "feature" }));
  assert.equal(mergeRange.kind, "unsupported");
  const incomplete = simulateGitCommand(state({ history: [{ commit: ref(ids.current), parentIds: ["e".repeat(40)] }] }), command({ kind: "rebase", upstream: "feature" }));
  assert.deepEqual(incomplete.unknowns, [{ code: "rebaseReplayRangeUnknown" }]);
});

test("rebase handles already-based, behind-only, unborn, detached, conflicts and dirty uncertainty", () => {
  const already = simulateGitCommand(state({ comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: ref(ids.target), ahead: 1, behind: 0 } } }), command({ kind: "rebase", upstream: "feature" })); assert.deepEqual(already.events, [{ kind: "noOp" }]);
  const behind = simulateGitCommand(state({ comparison: { kind: "available", value: { baseRef: "refs/heads/feature", mergeBase: ref(ids.current), ahead: 0, behind: 1 } } }), command({ kind: "rebase", upstream: "feature" })); assert.equal(behind.events.some((event) => event.kind === "commitCreated"), false);
  assert.equal(simulateGitCommand(state({ currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false }, history: [] }), command({ kind: "rebase", upstream: "feature" })).kind, "blocked");
  const detached = simulateGitCommand(state({ currentLocation: { kind: "detached", branchName: null, head: ref(ids.current), detached: true } }), command({ kind: "rebase", upstream: "feature" })); assert.equal(detached.events.at(-3)?.kind, "headDetachedMoved");
  const dirty = simulateGitCommand(state({ workingTree: { staged: [], unstaged: [{ path: "a", kind: "modified" }], untracked: [], conflicts: [] } }), command({ kind: "rebase", upstream: "feature" })); assert.equal(dirty.warnings.some((note) => note.code === "dirtyRebaseMayBeRejected"), true); assert.equal(dirty.warnings.some((note) => note.code === "rebaseMayConflict"), true);
});

test("pull is always fetch then integration and never fabricates a fetched tip", () => {
  const normal = simulateGitCommand(state(), command({ kind: "pull", target: { kind: "default" }, rebase: false }));
  assert.deepEqual(normal.events.slice(0, 2), [{ kind: "pullFetchRequested", target: "default" }, { kind: "pullIntegrationPlanned", method: "unknown" }]);
  assert.equal(normal.unknowns.some((note) => note.code === "pullIntegrationMethodUnknown"), true); assert.equal(JSON.stringify(normal).includes(ids.target), false);
  const rebase = simulateGitCommand(state(), command({ kind: "pull", target: { kind: "explicit", remote: "upstream", branch: "next" }, rebase: true }));
  assert.deepEqual(rebase.events.slice(0, 2), [{ kind: "pullFetchRequested", target: { remote: "upstream", branch: "next" } }, { kind: "pullIntegrationPlanned", method: "rebase" }]);
  assert.equal(rebase.unknowns.some((note) => note.code === "pullIntegrationMethodUnknown"), false);
  assert.equal(simulateGitCommand(state({ workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [{ path: "a", kind: "bothModified" }] } }), command({ kind: "pull", target: { kind: "default" }, rebase: false })).kind, "blocked");
});
