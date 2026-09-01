import { strict as assert } from "node:assert";
import test from "node:test";
import { parseGitMapSelectionMessage } from "./gitMapMessage";

test("Git Map messages accept only complete SelectionState values", () => {
  assert.deepEqual(parseGitMapSelectionMessage({ type: "select", selection: { kind: "branch", branchName: "feature" } }), { kind: "branch", branchName: "feature" });
  assert.deepEqual(parseGitMapSelectionMessage({ type: "select", selection: { kind: "workingTree", section: "conflicts" } }), { kind: "workingTree", section: "conflicts" });
  for (const message of [undefined, { type: "run", command: "status" }, { type: "select", selection: { kind: "branch" } }, { type: "select", selection: { kind: "branch", branchName: 1 } }, { type: "select", selection: { kind: "unknown" } }]) assert.equal(parseGitMapSelectionMessage(message), undefined);
  for (const selection of [{ kind: "upstream", remoteName: "origin", branchName: "main" }, { kind: "unpushedCommits", upstreamRef: "refs/remotes/origin/main" }, { kind: "remote", remoteName: "origin" }, { kind: "stash", stashCommitId: "a" }]) assert.deepEqual(parseGitMapSelectionMessage({ type: "select", selection }), selection);
  for (const message of [{ type: "select", extra: true, selection: { kind: "head" } }, { type: "select", selection: { kind: "branch", branchName: "main", extra: true } }, { type: "select", selection: { kind: "upstream", remoteName: "origin", branchName: "main", extra: true } }, { type: "select", selection: { kind: "unpushedCommits", upstreamRef: "x", extra: true } }, { type: "select", selection: { kind: "remote", remoteName: "origin", extra: true } }, { type: "select", selection: { kind: "stash", stashCommitId: "x", extra: true } }]) assert.equal(parseGitMapSelectionMessage(message), undefined);
});
