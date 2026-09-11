import { strict as assert } from "node:assert";
import test from "node:test";
import type { HistoryCommit, RepositoryState } from "../domain/repositoryState";
import { createCommitGraphPresentation, type GraphRefBounds } from "./commitGraphPresentation";

const id = (value: string) => value.repeat(40).slice(0, 40);
const historyCommit = (value: string, parent?: string): HistoryCommit => ({
  commit: { id: id(value), shortId: value.repeat(7).slice(0, 7), subject: `${value} commit` },
  parentIds: parent ? [id(parent)] : [],
});

test("branch labels stay near their own commits instead of stretching the graph sideways", () => {
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
    if (branch.current) assert.equal(branch.x, target.x + 64, "current branch should use a short offset so its ref line cannot look like another lane");
    else assert.equal(branch.x, target.x, `${branch.label} moved sideways away from its tip commit`);
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
    if (branch.current) assert.equal(branch.x, target.x + 64);
    else assert.equal(branch.x, target.x, `${branch.label} moved sideways away from its tip commit`);
  }
});

test("current branch and HEAD use a short horizontal offset so stacked lanes do not look like one vertical ref line", () => {
  const root = historyCommit("a");
  const upper = historyCommit("b", "a");
  const currentEntry = historyCommit("c", "a");
  const history = [root, upper, currentEntry];
  const state: RepositoryState = {
    repository: { rootPath: "/repo" },
    currentLocation: { kind: "branch", branchName: "main", head: currentEntry.commit, detached: false },
    localBranches: [
      { name: "feature/simple", tipCommitId: upper.commit.id },
      { name: "main", tipCommitId: currentEntry.commit.id },
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
  const currentNode = result.nodes.find((node) => node.commitId === currentEntry.commit.id);
  const upperNode = result.nodes.find((node) => node.commitId === upper.commit.id);
  const currentBranch = result.localBranches.find((branch) => branch.current);
  assert.ok(currentNode && upperNode && currentBranch && result.head);
  assert.equal(currentNode.x, upperNode.x, "fixture should place both rank-1 commits on different lanes at the same x");
  assert.equal(currentBranch.x, currentNode.x + 64);
  assert.equal(currentBranch.y, currentNode.y - 34);
  assert.equal(result.head.x, currentBranch.x);
  assert.equal(result.head.y, currentBranch.y - 30);
  assert.equal(result.head.targetY, currentBranch.bounds.top - 2);
  assert.notEqual(result.head.x, upperNode.x, "HEAD pointer should not share the other lane's commit x coordinate");
  assert.notEqual(currentBranch.connector.fromX, upperNode.x, "current branch connector should visibly separate from the other lane's ref line");
  assert.equal(currentBranch.connector.toX, currentNode.x);
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
