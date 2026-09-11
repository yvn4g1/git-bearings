import { strict as assert } from "node:assert";
import test from "node:test";
import type { HistoryCommit, RepositoryState } from "../domain/repositoryState";
import { createCommitGraphPresentation, type GraphRefBounds } from "./commitGraphPresentation";

const id = (value: string) => value.repeat(40).slice(0, 40);
const historyCommit = (value: string, parent?: string): HistoryCommit => ({
  commit: { id: id(value), shortId: value.repeat(7).slice(0, 7), subject: `${value} commit` },
  parentIds: parent ? [id(parent)] : [],
});

test("branch labels on different commits avoid each other and the current-location annotation", () => {
  const history = [
    historyCommit("a"),
    historyCommit("b", "a"),
    historyCommit("c", "b"),
    historyCommit("d", "c"),
    historyCommit("e", "d"),
  ];
  const current = history[3].commit;
  const state: RepositoryState = {
    repository: { rootPath: "/repo" },
    currentLocation: { kind: "branch", branchName: "main", head: current, detached: false },
    localBranches: [
      { name: "feature/graph-beta", tipCommitId: history[1].commit.id },
      { name: "experiment/very-long-branch-name-for-layout", tipCommitId: history[2].commit.id },
      { name: "main", tipCommitId: current.id },
      { name: "release/0.1", tipCommitId: history[4].commit.id },
    ],
    workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    history,
    operation: { kind: "normal" },
    remotes: { kind: "available", value: [] },
    upstream: { kind: "notConfigured" },
    stash: { kind: "available", value: [] },
    comparison: { kind: "notConfigured" },
    stateVersion: 1,
    refreshedAt: new Date(0),
  };

  const result = createCommitGraphPresentation(state);
  assert.equal(result.kind, "graph");
  assert.equal(result.localBranches.length, 4);

  for (const [index, branch] of result.localBranches.entries()) {
    for (const other of result.localBranches.slice(index + 1)) {
      assert.equal(boundsOverlap(branch.bounds, other.bounds), false, `${branch.label} overlaps ${other.label}`);
    }
  }

  const currentNode = result.nodes.find((node) => node.commitId === current.id);
  assert.ok(currentNode);
  const currentContext: GraphRefBounds = { left: currentNode.x + 9, top: currentNode.y + 18, width: 230, height: 40 };
  for (const branch of result.localBranches.filter((item) => !item.current)) {
    assert.equal(boundsOverlap(branch.bounds, currentContext), false, `${branch.label} overlaps current-location context`);
  }

  const maxBranchRight = Math.max(...result.localBranches.map((branch) => branch.bounds.left + branch.bounds.width));
  assert.ok(result.width >= maxBranchRight + 28);
  assert.equal(result.localBranches.find((branch) => branch.current)?.label, "main");
});

function boundsOverlap(left: GraphRefBounds, right: GraphRefBounds): boolean {
  return left.left < right.left + right.width
    && left.left + left.width > right.left
    && left.top < right.top + right.height
    && left.top + left.height > right.top;
}
