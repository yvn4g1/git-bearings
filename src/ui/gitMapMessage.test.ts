import { strict as assert } from "node:assert";
import test from "node:test";
import { parseGitMapSelectionMessage } from "./gitMapMessage";

test("Git Map messages accept only complete SelectionState values", () => {
  assert.deepEqual(parseGitMapSelectionMessage({ type: "select", selection: { kind: "branch", branchName: "feature" } }), { kind: "branch", branchName: "feature" });
  assert.deepEqual(parseGitMapSelectionMessage({ type: "select", selection: { kind: "workingTree", section: "conflicts" } }), { kind: "workingTree", section: "conflicts" });
  for (const message of [undefined, { type: "run", command: "status" }, { type: "select", selection: { kind: "branch" } }, { type: "select", selection: { kind: "branch", branchName: 1 } }, { type: "select", selection: { kind: "unknown" } }]) assert.equal(parseGitMapSelectionMessage(message), undefined);
});
