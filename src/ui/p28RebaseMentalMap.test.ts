import { strict as assert } from "node:assert";
import test from "node:test";
import type { CommitRef, RepositoryState } from "../domain/repositoryState";
import { analyzeCommand, createCommandPreviewPresentation } from "./commandPreview";
import { createCommitGraphPresentation } from "./commitGraphPresentation";
import { createGitMapPresentation } from "./gitMapPresentation";

const ids = {
  a: "a".repeat(40),
  b: "b".repeat(40),
  c: "c".repeat(40),
  d: "d".repeat(40),
  e: "e".repeat(40),
};
const ref = (id: string, subject: string): CommitRef => ({ id, shortId: id.slice(0, 7), subject });

function rebaseState(): RepositoryState {
  const a = ref(ids.a, "A");
  const b = ref(ids.b, "B");
  const c = ref(ids.c, "C main");
  const d = ref(ids.d, "D feature");
  const e = ref(ids.e, "E feature");
  return {
    repository: { rootPath: "/repo" },
    currentLocation: { kind: "branch", branchName: "feature", head: e, detached: false },
    localBranches: [{ name: "feature", tipCommitId: e.id }, { name: "main", tipCommitId: c.id }],
    workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    history: [
      { commit: e, parentIds: [d.id] },
      { commit: d, parentIds: [b.id] },
      { commit: c, parentIds: [b.id] },
      { commit: b, parentIds: [a.id] },
      { commit: a, parentIds: [] },
    ],
    operation: { kind: "normal" },
    remotes: { kind: "available", value: [] },
    upstream: { kind: "notConfigured" },
    stash: { kind: "available", value: [] },
    comparison: { kind: "available", value: { baseRef: "refs/heads/main", mergeBase: b, ahead: 2, behind: 1 } },
    stateVersion: 28,
    refreshedAt: new Date("2026-09-11T00:00:00Z"),
  };
}

function node(graph: ReturnType<typeof createCommitGraphPresentation>, id: string) {
  const found = graph.nodes.find((item) => item.commitId === id);
  assert.ok(found);
  return found;
}

test("configured base branch stays on the straight spine while feature branches away", () => {
  const state = rebaseState();
  const graph = createCommitGraphPresentation(state);
  assert.equal(graph.kind, "graph");
  const a = node(graph, ids.a);
  const b = node(graph, ids.b);
  const c = node(graph, ids.c);
  const d = node(graph, ids.d);
  const e = node(graph, ids.e);
  assert.equal(a.y, b.y);
  assert.equal(b.y, c.y);
  assert.notEqual(c.y, d.y);
  assert.equal(d.y, e.y);
  assert.equal(graph.localBranches.find((branch) => branch.label === "main")?.targetCommitId, ids.c);
});

test("rebase Preview keeps originals and draws regenerated commits from the base spine", () => {
  const state = rebaseState();
  const analysis = analyzeCommand(state, "git rebase main");
  const preview = createCommandPreviewPresentation({ active: analysis, history: [analysis] }, state);
  assert.equal(preview.status, "supported");
  assert.deepEqual(preview.map?.predictions.map((item) => item.rewrittenFromCommitId), [ids.d, ids.e]);

  const map = createGitMapPresentation({ kind: "available", repositoryId: "repo", state }, { kind: "overview" }, { kind: "idle" }, preview);
  assert.equal(map.graph.kind, "graph");
  const base = node(map.graph, ids.c);
  const originalD = node(map.graph, ids.d);
  const originalE = node(map.graph, ids.e);
  const predictions = map.graph.predictionCommits ?? [];
  assert.equal(predictions.length, 2);
  assert.equal(predictions[0].y, base.y);
  assert.equal(predictions[1].y, base.y);
  assert.equal(predictions[0].x, base.x + 130);
  assert.equal(predictions[1].x, predictions[0].x + 130);

  assert.deepEqual(map.graph.rewrittenOriginalCommitIds, [ids.d, ids.e]);
  assert.equal(map.graph.rewriteEdges?.length, 2);
  assert.deepEqual(map.graph.rewriteEdges?.map((edge) => [edge.fromX, edge.fromY]), [[originalD.x, originalD.y], [originalE.x, originalE.y]]);
  assert.deepEqual(map.graph.rewriteEdges?.map((edge) => [edge.toX, edge.toY]), predictions.map((item) => [item.x, item.y]));
  assert.equal(map.graph.localBranches.find((branch) => branch.label === "main")?.targetCommitId, ids.c);
  assert.equal(map.graph.localBranches.find((branch) => branch.label === "feature")?.targetCommitId, ids.e);
  assert.ok(map.graph.predictionPointers?.some((pointer) => pointer.kind === "branch" && pointer.label === "feature" && pointer.toX === predictions[1].x));
});
