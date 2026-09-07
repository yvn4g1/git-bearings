import { strict as assert } from "node:assert";
import test from "node:test";
import { AppViewStateStore } from "../domain/appViewStateStore";
import type { RepositoryState } from "../domain/repositoryState";
import { CommandPreviewController, addAnalysis, analyzeCommand, createCommandPreviewPresentation, emptyCommandPreviewSession, previewIsStale } from "./commandPreview";
import { createGitMapPresentation } from "./gitMapPresentation";

const id = "a".repeat(40);
function state(overrides: Partial<RepositoryState> = {}): RepositoryState { const head = { id, shortId: id.slice(0, 7), subject: "root" }; return { repository: { rootPath: "/repo" }, currentLocation: { kind: "branch", branchName: "main", head, detached: false }, localBranches: [{ name: "main", tipCommitId: id }, { name: "feature", tipCommitId: "b".repeat(40) }], workingTree: { staged: [{ path: "a", kind: "modified" }], unstaged: [], untracked: [], conflicts: [] }, history: [{ commit: head, parentIds: [] }], operation: { kind: "normal" }, remotes: { kind: "notConfigured" }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] }, comparison: { kind: "notConfigured" }, stateVersion: 4, refreshedAt: new Date(0), ...overrides }; }

test("analysis connects parser and simulator without mutating factual input", () => {
  const input = state(); const before = structuredClone(input); const analysis = analyzeCommand(input, 'git commit -m "save"');
  assert.equal(analysis.parse.kind, "parsed"); assert.equal(analysis.simulation?.kind, "supported"); assert.equal(analysis.basedOnStateVersion, 4); assert.deepEqual(input, before);
  for (const raw of ["git", "git status", "git commit --amend", "git reset --hard"]) { const item = analyzeCommand(input, raw); assert.equal(item.simulation, undefined); }
});

test("session is newest-first, bounded, selectable, non-persistent, and resets with AppViewState", () => {
  let session = emptyCommandPreviewSession(); for (let index = 0; index < 6; index += 1) session = addAnalysis(session, analyzeCommand(state(), `git fetch r${index}`));
  assert.equal(session.history.length, 5); assert.equal(session.history[0].rawInput, "git fetch r5");
  const store = new AppViewStateStore<typeof session>(); const controller = new CommandPreviewController(store); controller.analyze(state(), "git stash list"); controller.selectHistory(0); assert.equal(store.current.preview?.active?.rawInput, "git stash list"); store.resetForRepositoryChange(); assert.equal(store.current.preview, null);
});

test("presentation has six sections, keeps Unknown distinct, and handles stale recalculate and return-current", () => {
  const first = analyzeCommand(state(), 'git commit -m "save"'); const fresh = createCommandPreviewPresentation({ active: first, history: [first] }, state());
  assert.equal(fresh.sections.length, 6); assert.equal(fresh.map !== null, true); assert.equal(fresh.status, "supported");
  const staleState = state({ stateVersion: 5 }); assert.equal(previewIsStale(first, staleState), true); const stale = createCommandPreviewPresentation({ active: first, history: [first] }, staleState); assert.equal(stale.stale, true); assert.equal(stale.map, null); assert.ok(stale.sections[1].lines[0].includes("変更前"));
  const unknown = analyzeCommand(state(), "git merge tag-like"); const unknownPresentation = createCommandPreviewPresentation({ active: unknown, history: [unknown] }, state()); assert.equal(unknownPresentation.status, "supported"); assert.equal(unknownPresentation.map !== null, true); assert.equal(unknownPresentation.sections[3].lines[0].includes("Unknown"), true);
});

test("overlay preserves P21-P23 semantics without future hashes", () => {
  const commit = createCommandPreviewPresentation({ active: analyzeCommand(state(), 'git commit -m "save"'), history: [] }, state()); assert.equal(commit.map?.predictions[0]?.description, "NEW COMMIT");
  const pull = createCommandPreviewPresentation({ active: analyzeCommand(state(), "git pull --rebase origin main"), history: [] }, state()); assert.deepEqual(pull.map?.remote.slice(0, 2), ["STEP 1 fetch", "STEP 2 integrate (rebase)"]);
  const blocked = createCommandPreviewPresentation({ active: analyzeCommand(state({ workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [{ path: "a", kind: "bothModified" }] } }), 'git commit -m "save"'), history: [] }, state({ workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [{ path: "a", kind: "bothModified" }] } })); assert.equal(blocked.status, "blocked"); assert.equal(blocked.map, null);
  assert.equal(JSON.stringify(commit).includes("shortId"), false);
});

test("future tracking Unknown is localized to the Remote overlay", () => {
  const facts = state({ upstream: { kind: "available", value: { remoteName: "origin", branchName: "main", trackingRef: "refs/remotes/origin/main", relation: { kind: "available", value: { ahead: 0, behind: 0 } } } } });
  const preview = createCommandPreviewPresentation({ active: analyzeCommand(facts, 'git commit -m "save"'), history: [] }, facts);
  const text = "commit後のupstreamとのahead/behindは再確認するまで未確定です。";
  assert.deepEqual(preview.map?.unknowns.remote, [text]);
  assert.deepEqual(preview.map?.unknowns.workingTree, []);
  assert.deepEqual(preview.map?.unknowns.staging, []);
  assert.deepEqual(preview.map?.unknowns.stash, []);
  assert.deepEqual(preview.map?.unknowns.local, []);
});

test("fast-forward predicted branch ref does not overlap an existing same-target ref", () => {
  const current = { id, shortId: id.slice(0, 7), subject: "current" }; const targetId = "b".repeat(40); const target = { id: targetId, shortId: targetId.slice(0, 7), subject: "target" };
  const facts = state({ currentLocation: { kind: "branch", branchName: "main", head: current, detached: false }, localBranches: [{ name: "main", tipCommitId: id }, { name: "feature/test", tipCommitId: targetId }], history: [{ commit: target, parentIds: [id] }, { commit: current, parentIds: [] }] });
  const preview = createCommandPreviewPresentation({ active: analyzeCommand(facts, "git merge feature/test"), history: [] }, facts); const map = createGitMapPresentation({ kind: "available", repositoryId: "repo", state: facts }, { kind: "overview" }, { kind: "idle" }, preview);
  if (map.graph.kind !== "graph") throw new Error("graph expected"); const existing = map.graph.localBranches.find((ref) => ref.label === "feature/test")!; const predicted = map.graph.predictionPointers?.find((pointer) => pointer.kind === "branch")!;
  const predictedBounds = { left: predicted.x - 42, top: predicted.y - 14, width: 84, height: 18 };
  assert.equal(preview.map?.predictions.length, 0); assert.equal(predicted.label, "main"); assert.equal(predicted.toX, map.graph.nodes.find((node) => node.commitId === targetId)?.x); assert.equal(boundsOverlap(existing.bounds, predictedBounds), false);
});

test("commit prediction is placed right of factual refs with separate predicted branch and HEAD", () => {
  const facts = state(); const preview = createCommandPreviewPresentation({ active: analyzeCommand(facts, 'git commit -m "save"'), history: [] }, facts); const map = createGitMapPresentation({ kind: "available", repositoryId: "repo", state: facts }, { kind: "overview" }, { kind: "idle" }, preview);
  if (map.graph.kind !== "graph") throw new Error("graph expected"); const predicted = map.graph.predictionCommits?.[0]; const factRight = Math.max(...map.graph.localBranches.map((ref) => ref.bounds.left + ref.bounds.width));
  assert.ok(predicted && predicted.x > factRight); assert.equal(map.graph.predictionPointers?.some((item) => item.kind === "branch"), true); assert.ok((map.graph.predictionPointers?.find((item) => item.kind === "branch")?.y ?? 0) < (predicted?.y ?? 0));
});

function boundsOverlap(left: { left: number; top: number; width: number; height: number }, right: { left: number; top: number; width: number; height: number }): boolean { return left.left < right.left + right.width && right.left < left.left + left.width && left.top < right.top + right.height && right.top < left.top + left.height; }
