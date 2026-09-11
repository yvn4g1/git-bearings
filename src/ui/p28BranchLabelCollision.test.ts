import { strict as assert } from "node:assert";
import test from "node:test";
import type { HistoryCommit, RepositoryState } from "../domain/repositoryState";
import { createCommitGraphPresentation, type GraphRefBounds } from "./commitGraphPresentation";

const id = (value: string) => value.repeat(40).slice(0, 40);
const historyCommit = (value: string, parent?: string): HistoryCommit => ({
  commit: { id: id(value), shortId: value.repeat(7).slice(0, 7), subject: `${value} commit` },
  parentIds: parent ? [id(parent)] : [],
});

test("branch labels use vertical slots near their own commits instead of stretching the graph sideways", () => {
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

  for (const branch of result.localBranches) {
    const target = result.nodes.find((node) => node.commitId === branch.targetCommitId);
    assert.ok(target);
    assert.equal(branch.x, target.x, `${branch.label} moved sideways away from its tip commit`);
  }

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

  assertNoBranchLabelOverlapsCommitText(result.localBranches, result.nodes);
  assert.equal(result.localBranches.find((branch) => branch.current)?.label, "main");
});

test("crowded branch labels avoid commit hash and subject text without moving unrelated branches sideways", () => {
  const history = [
    historyCommit("a"),
    historyCommit("b", "a"),
    historyCommit("c", "b"),
    historyCommit("d", "c"),
    historyCommit("e", "c"),
    historyCommit("f", "c"),
    historyCommit("k", "d"),
    historyCommit("g", "e"),
    historyCommit("h", "f"),
  ];
  const current = history[3].commit;
  const state: RepositoryState = {
    repository: { rootPath: "/repo" },
    currentLocation: { kind: "branch", branchName: "main", head: current, detached: false },
    localBranches: [
      { name: "main", tipCommitId: current.id },
      { name: "release/very-long-layout-branch", tipCommitId: history[6].commit.id },
      { name: "feature/very-long-layout-branch", tipCommitId: history[4].commit.id },
      { name: "hotfix/very-long-layout-branch", tipCommitId: history[7].commit.id },
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
  assertNoBranchLabelOverlapsCommitText(result.localBranches, result.nodes);

  for (const branch of result.localBranches) {
    const target = result.nodes.find((node) => node.commitId === branch.targetCommitId);
    assert.ok(target);
    assert.equal(branch.x, target.x, `${branch.label} moved sideways away from its tip commit`);
  }
});

function assertNoBranchLabelOverlapsCommitText(
  branches: readonly { readonly label: string; readonly bounds: GraphRefBounds }[],
  nodes: readonly { readonly shortId: string; readonly x: number; readonly y: number }[],
): void {
  for (const branch of branches) {
    for (const node of nodes) {
      const nodeText: GraphRefBounds = { left: node.x + 9, top: node.y - 18, width: 118, height: 38 };
      assert.equal(boundsOverlap(branch.bounds, nodeText), false, `${branch.label} overlaps commit text ${node.shortId}`);
    }
  }
}

function boundsOverlap(left: GraphRefBounds, right: GraphRefBounds): boolean {
  return left.left < right.left + right.width
    && left.left + left.width > right.left
    && left.top < right.top + right.height
    && left.top + left.height > right.top;
}
