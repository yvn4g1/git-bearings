import { strict as assert } from "node:assert";
import test from "node:test";
import type { GitCommand } from "../domain/gitCommand";
import type { RepositoryState } from "../domain/repositoryState";
import { simulateBasicGitCommand } from "./basicCommandSimulator";

const id = "0123456789abcdef0123456789abcdef01234567";
function state(overrides: Partial<RepositoryState> = {}): RepositoryState {
  const head = { id, shortId: id.slice(0, 7), subject: "root" };
  return { repository: { rootPath: "/repo" }, currentLocation: { kind: "branch", branchName: "main", head, detached: false }, localBranches: [{ name: "main", tipCommitId: id }, { name: "feature", tipCommitId: "fedcba9876543210fedcba9876543210fedcba98" }], workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] }, history: [{ commit: head, parentIds: [] }], operation: { kind: "normal" }, remotes: { kind: "notConfigured" }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 7, refreshedAt: new Date("2026-01-01") , ...overrides };
}
const command = (value: GitCommand) => value;

test("add reflects known content into staging without moving Working Tree files", () => {
  const input = state({ workingTree: { staged: [{ path: "kept.txt", kind: "modified" }], unstaged: [{ path: "a.txt", kind: "modified" }], untracked: ["new.txt"], conflicts: [] } });
  const before = structuredClone(input);
  const result = simulateBasicGitCommand(input, command({ kind: "add", target: { kind: "repositoryRoot" } }));
  assert.equal(result.kind, "supported");
  assert.equal(result.basedOnStateVersion, 7);
  assert.deepEqual(result.events, [{ kind: "stagingReflected", path: "a.txt", source: "unstaged" }, { kind: "stagingReflected", path: "new.txt", source: "untracked" }]);
  assert.deepEqual(input, before);
});

test("add updates an existing staged path, leaves staged-only as no-op, and makes unresolved paths unknown", () => {
  const input = state({ workingTree: { staged: [{ path: "a.txt", kind: "modified" }, { path: "only.txt", kind: "modified" }], unstaged: [{ path: "a.txt", kind: "modified" }], untracked: [], conflicts: [] } });
  assert.deepEqual(simulateBasicGitCommand(input, command({ kind: "add", target: { kind: "paths", paths: ["a.txt"] } })).events, [{ kind: "stagingUpdated", path: "a.txt" }]);
  assert.deepEqual(simulateBasicGitCommand(input, command({ kind: "add", target: { kind: "paths", paths: ["only.txt"] } })).events, [{ kind: "noOp" }]);
  const unknown = simulateBasicGitCommand(input, command({ kind: "add", target: { kind: "paths", paths: ["src", "*.ts"] } }));
  assert.deepEqual(unknown.unknowns, [{ code: "unknownPathScope", path: "src" }, { code: "unknownPathScope", path: "*.ts" }]);
});

test("conflict add remains unknown while root add retains ordinary predictions", () => {
  const input = state({ workingTree: { staged: [], unstaged: [{ path: "ordinary.txt", kind: "modified" }], untracked: [], conflicts: [{ path: "conflict.txt", kind: "bothModified" }] } });
  const result = simulateBasicGitCommand(input, command({ kind: "add", target: { kind: "repositoryRoot" } }));
  assert.deepEqual(result.events, [{ kind: "stagingReflected", path: "ordinary.txt", source: "unstaged" }]);
  assert.deepEqual(result.unknowns, [{ code: "conflictResolutionNotModeled", path: "conflict.txt" }]);
  const conflict = simulateBasicGitCommand(input, command({ kind: "add", target: { kind: "paths", paths: ["conflict.txt"] } }));
  assert.deepEqual(conflict.unknowns, [{ code: "conflictResolutionNotModeled", path: "conflict.txt" }]);
});

test("unstage removes staging but retains Working Tree and distinguishes reset from restore uncertainty", () => {
  const input = state({ workingTree: { staged: [{ path: "a.txt", kind: "modified" }], unstaged: [{ path: "a.txt", kind: "modified" }], untracked: [], conflicts: [] } });
  const restore = simulateBasicGitCommand(input, command({ kind: "unstage", syntax: "restoreStaged", paths: ["a.txt"] }));
  assert.deepEqual(restore.events, [{ kind: "stagingRemoved", path: "a.txt", workingTreeRetained: true }]);
  const reset = simulateBasicGitCommand(input, command({ kind: "unstage", syntax: "resetHead", paths: ["missing.txt"] }));
  assert.deepEqual(reset.events, [{ kind: "noOp" }]);
  const unknown = simulateBasicGitCommand(input, command({ kind: "unstage", syntax: "restoreStaged", paths: ["new.txt"] }));
  assert.deepEqual(unknown.unknowns, [{ code: "unknownPathScope", path: "new.txt" }]);
});

test("commit separates predicted commit and pointer movement and never invents a hash", () => {
  const input = state({ workingTree: { staged: [{ path: "a.txt", kind: "modified" }], unstaged: [{ path: "a.txt", kind: "modified" }], untracked: ["later.txt"], conflicts: [] } });
  const result = simulateBasicGitCommand(input, command({ kind: "commit", message: "save" }));
  assert.equal(result.kind, "supported");
  assert.deepEqual(result.events.slice(0, 3).map((event) => event.kind), ["stagingCleared", "commitCreated", "branchPointerMoved"]);
  assert.deepEqual(result.events[1], { kind: "commitCreated", commit: { kind: "newCommit", parentCommitIds: [id] } });
  assert.equal(JSON.stringify(result).includes("shortId"), false);
  assert.equal(JSON.stringify(result).includes("subject"), false);
});

test("commit blocks invalid states and models detached and unborn parents", () => {
  assert.equal(simulateBasicGitCommand(state(), command({ kind: "commit" })).kind, "blocked");
  assert.equal(simulateBasicGitCommand(state({ workingTree: { staged: [{ path: "a", kind: "modified" }], unstaged: [], untracked: [], conflicts: [{ path: "a", kind: "bothModified" }] } }), command({ kind: "commit", message: "x" })).kind, "blocked");
  assert.equal(simulateBasicGitCommand(state({ workingTree: { staged: [{ path: "a", kind: "modified" }], unstaged: [], untracked: [], conflicts: [] } }), command({ kind: "commit", message: "" })).kind, "blocked");
  const unborn = state({ currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false }, history: [], localBranches: [], workingTree: { staged: [{ path: "a", kind: "added" }], unstaged: [], untracked: [], conflicts: [] } });
  const result = simulateBasicGitCommand(unborn, command({ kind: "commit" }));
  assert.deepEqual(result.events[1], { kind: "commitCreated", commit: { kind: "newCommit", parentCommitIds: [] } });
  assert.deepEqual(result.assumptions, [{ code: "interactiveCommitMessageRequired" }]);
});

test("switch respects known local branches, dirty uncertainty, and switch -c unborn semantics", () => {
  const dirty = state({ workingTree: { staged: [], unstaged: [{ path: "a", kind: "modified" }], untracked: [], conflicts: [] } });
  const existing = simulateBasicGitCommand(dirty, command({ kind: "switch", branchName: "feature", create: false }));
  assert.equal(existing.kind, "supported"); assert.deepEqual(existing.warnings, [{ code: "dirtySwitchMayFail" }]);
  assert.equal(simulateBasicGitCommand(state(), command({ kind: "switch", branchName: "missing", create: false })).kind, "unsupported");
  const unborn = state({ currentLocation: { kind: "unborn", branchName: "main", head: null, detached: false }, localBranches: [], history: [] });
  const created = simulateBasicGitCommand(unborn, command({ kind: "switch", branchName: "feature", create: true }));
  assert.deepEqual(created.events, [{ kind: "unbornSymbolicBranchChanged", branchName: "feature" }]);
  assert.equal(JSON.stringify(created).includes("newCommit"), false);
});

test("non-normal and later commands are explicitly unsupported", () => {
  assert.equal(simulateBasicGitCommand(state({ operation: { kind: "merge" } }), command({ kind: "add", target: { kind: "repositoryRoot" } })).kind, "unsupported");
  assert.equal(simulateBasicGitCommand(state(), command({ kind: "stashList" })).kind, "unsupported");
});
