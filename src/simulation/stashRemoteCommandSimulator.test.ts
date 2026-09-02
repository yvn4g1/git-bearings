import { strict as assert } from "node:assert";
import test from "node:test";
import type { GitCommand } from "../domain/gitCommand";
import type { RepositoryState } from "../domain/repositoryState";
import { simulateGitCommand } from "./commandSimulator";

const id = "0123456789abcdef0123456789abcdef01234567";
function state(overrides: Partial<RepositoryState> = {}): RepositoryState {
  const head = { id, shortId: id.slice(0, 7), subject: "root" };
  return { repository: { rootPath: "/repo" }, currentLocation: { kind: "branch", branchName: "main", head, detached: false }, localBranches: [{ name: "main", tipCommitId: id }, { name: "feature", tipCommitId: "fedcba9876543210fedcba9876543210fedcba98" }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [{ commit: head, parentIds: [] }], operation: { kind: "normal" }, remotes: { kind: "available", value: [{ name: "origin", trackingRefs: [{ branchName: "main", trackingRef: "refs/remotes/origin/main", commitId: id }], locallyKnownDefaultBranch: null }] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [{ index: 0, commitId: id, message: "fact" }] }, comparison: { kind: "notConfigured" }, stateVersion: 9, refreshedAt: new Date("2026-01-01"), ...overrides };
}
const command = (value: GitCommand) => value;

test("stash push distinguishes tracked, untracked, no-op, and blocked facts", () => {
  const tracked = simulateGitCommand(state({ workingTree: { staged: [{ path: "a", kind: "modified" }], unstaged: [{ path: "b", kind: "modified" }], untracked: ["u"], conflicts: [] } }), command({ kind: "stashPush", includeUntracked: false, message: "save" }));
  assert.deepEqual(tracked.events, [{ kind: "stashCreated", message: "save" }, { kind: "trackedChangesStashed" }]);
  assert.equal(JSON.stringify(tracked).includes("commitId"), false);
  assert.deepEqual(simulateGitCommand(state({ workingTree: { staged: [], unstaged: [], untracked: ["u"], conflicts: [] } }), command({ kind: "stashPush", includeUntracked: false })).events, [{ kind: "noOp" }]);
  const include = simulateGitCommand(state({ workingTree: { staged: [], unstaged: [], untracked: ["u"], conflicts: [] } }), command({ kind: "stashPush", includeUntracked: true }));
  assert.deepEqual(include.events, [{ kind: "stashCreated" }, { kind: "untrackedChangesStashed" }]);
  assert.equal(simulateGitCommand(state({ workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [{ path: "a", kind: "bothModified" }] } }), command({ kind: "stashPush", includeUntracked: false })).kind, "blocked");
});

test("stash list is no-op and apply/pop preserve target uncertainty and ordering", () => {
  assert.deepEqual(simulateGitCommand(state(), command({ kind: "stashList" })).events, [{ kind: "noOp" }]);
  const apply = simulateGitCommand(state(), command({ kind: "stashApply" }));
  assert.deepEqual(apply.events, [{ kind: "stashChangesApplied" }]); assert.equal(apply.risk, "caution");
  const pop = simulateGitCommand(state(), command({ kind: "stashPop", stashIndex: 0 }));
  assert.deepEqual(pop.events, [{ kind: "stashChangesApplied", stashIndex: 0 }, { kind: "stashEntryRemovedAfterSuccessfulApply", stashIndex: 0 }]);
  assert.equal(simulateGitCommand(state(), command({ kind: "stashApply", stashIndex: 3 })).kind, "blocked");
  const unavailable = simulateGitCommand(state({ stash: { kind: "unavailable", reason: "read failed" } }), command({ kind: "stashPop" }));
  assert.deepEqual(unavailable.events, []); assert.deepEqual(unavailable.unknowns, [{ code: "futureWorkingTreeAndIndexUnknown" }, { code: "stashTargetUnknown" }]);
});

test("fetch keeps its default target and only predicts conditional remote-tracking refresh", () => {
  const result = simulateGitCommand(state(), command({ kind: "fetch" }));
  assert.equal(result.risk, "caution");
  assert.deepEqual(result.events[0], { kind: "fetchRequested", target: "default" });
  assert.deepEqual(result.unknowns, [{ code: "futureTrackingRelationUnknown" }, { code: "defaultTargetUnknown", operation: "fetch" }]);
  assert.equal(JSON.stringify(result).includes("refs/remotes/origin/main"), false);
});

test("push uses a known local ref only when factual, never sends uncommitted changes, and keeps default target unknown", () => {
  const input = state({ workingTree: { staged: [{ path: "a", kind: "modified" }], unstaged: [], untracked: ["u"], conflicts: [] } }); const before = structuredClone(input);
  const explicit = simulateGitCommand(input, command({ kind: "push", target: { kind: "explicit", remote: "origin", branch: "feature" }, setUpstream: true }));
  assert.deepEqual(explicit.events[0], { kind: "pushRequested", target: { remote: "origin", branch: "feature", localTipCommitId: "fedcba9876543210fedcba9876543210fedcba98" } });
  assert.deepEqual(explicit.events.at(-1), { kind: "branchUpstreamConfigured", branchName: "feature", remoteName: "origin", remoteBranchName: "feature" });
  assert.equal(explicit.warnings.some((note) => note.code === "uncommittedChangesNotPushed"), true); assert.deepEqual(input, before);
  const missing = simulateGitCommand(state(), command({ kind: "push", target: { kind: "explicit", remote: "origin", branch: "tag-like" }, setUpstream: false })); assert.equal(missing.kind, "supported");
  const fallback = simulateGitCommand(state(), command({ kind: "push", target: { kind: "default" }, setUpstream: false }));
  assert.deepEqual(fallback.events[0], { kind: "pushRequested", target: "default" }); assert.equal(fallback.unknowns.some((note) => note.code === "defaultTargetUnknown"), true);
  const unknownUpstream = simulateGitCommand(state({ remotes: { kind: "unavailable", reason: "read failed" } }), command({ kind: "push", target: { kind: "explicit", remote: "origin", branch: "feature" }, setUpstream: true }));
  assert.equal(unknownUpstream.unknowns.some((note) => note.code === "upstreamConfigurationUnknown"), true);
});
