import { strict as assert } from "node:assert";
import test from "node:test";
import { parseGitMapMessage, parseGitMapSelectionMessage } from "./gitMapMessage";

test("Git Map messages accept only complete SelectionState values", () => {
  assert.deepEqual(parseGitMapSelectionMessage({ type: "select", selection: { kind: "branch", branchName: "feature" } }), { kind: "branch", branchName: "feature" });
  assert.deepEqual(parseGitMapSelectionMessage({ type: "select", selection: { kind: "workingTree", section: "conflicts" } }), { kind: "workingTree", section: "conflicts" });
  for (const message of [undefined, { type: "run", command: "status" }, { type: "select", selection: { kind: "branch" } }, { type: "select", selection: { kind: "branch", branchName: 1 } }, { type: "select", selection: { kind: "unknown" } }]) assert.equal(parseGitMapSelectionMessage(message), undefined);
  for (const selection of [{ kind: "upstream", remoteName: "origin", branchName: "main" }, { kind: "unpushedCommits", upstreamRef: "refs/remotes/origin/main" }, { kind: "remote", remoteName: "origin" }, { kind: "stash", stashCommitId: "a" }]) assert.deepEqual(parseGitMapSelectionMessage({ type: "select", selection }), selection);
  for (const message of [{ type: "select", extra: true, selection: { kind: "head" } }, { type: "select", selection: { kind: "branch", branchName: "main", extra: true } }, { type: "select", selection: { kind: "upstream", remoteName: "origin", branchName: "main", extra: true } }, { type: "select", selection: { kind: "unpushedCommits", upstreamRef: "x", extra: true } }, { type: "select", selection: { kind: "remote", remoteName: "origin", extra: true } }, { type: "select", selection: { kind: "stash", stashCommitId: "x", extra: true } }]) assert.equal(parseGitMapSelectionMessage(message), undefined);
});

test("command preview messages are strictly validated", () => {
  assert.deepEqual(parseGitMapMessage({ type: "detailCommand" }), { type: "detailCommand" });
  assert.deepEqual(parseGitMapMessage({ type: "analyze", input: "git status" }), { type: "analyze", input: "git status" });
  assert.deepEqual(parseGitMapMessage({ type: "selectHistory", index: 0 }), { type: "selectHistory", index: 0 });
  for (const value of [{ type: "analyze", input: "x", extra: true }, { type: "analyze", input: 3 }, { type: "selectHistory", index: -1 }, { type: "selectHistory", index: 1.2 }, { type: "unknown" }, { type: "analyze", input: "x".repeat(4097) }]) assert.equal(parseGitMapMessage(value), undefined);
});

test("goal preview accepts only goal identity, strict target and step", () => {
  assert.deepEqual(parseGitMapMessage({ type: "goalPreview", goalId: "switchBranch", stepId: "switch", target: { kind: "branch", branchName: "feature" } }), { type: "goalPreview", goalId: "switchBranch", stepId: "switch", target: { kind: "branch", branchName: "feature" } });
  for (const value of [{ type: "goalPreview", goalId: "unknown", stepId: "x" }, { type: "goalPreview", goalId: "switchBranch", stepId: "x", command: "git reset --hard" }, { type: "goalPreview", goalId: "switchBranch", stepId: "x", target: { kind: "branch", branchName: "" } }, { type: "goalPreview", goalId: "createBranch", stepId: "create", target: { kind: "newBranch", branchName: "x", extra: true } }]) assert.equal(parseGitMapMessage(value), undefined);
});
