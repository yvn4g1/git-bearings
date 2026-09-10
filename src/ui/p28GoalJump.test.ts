import { strict as assert } from "node:assert";
import test from "node:test";
import type { RepositoryState } from "../domain/repositoryState";
import { renderGitMapHtml } from "./gitMapHtmlRenderer";
import { createGitMapPresentation } from "./gitMapPresentation";
import type { GitMapPresentation } from "./gitMapPresentation";

test("Goal recommendation jump opens its Goal and category before scrolling to the target", () => {
  const presentation = { status: "unavailable", message: "test" } as GitMapPresentation;
  const html = renderGitMapHtml(presentation, "nonce");

  const findTarget = "const target=document.getElementById(j.dataset.goalJump||'')";
  const openGoal = "if(target.tagName==='DETAILS')target.open=true";
  const findCategory = "const category=target.parentElement?.closest('details')";
  const openCategory = "if(category)category.open=true";
  const scrollTarget = "target.scrollIntoView({block:'nearest'})";

  for (const value of [findTarget, openGoal, findCategory, openCategory, scrollTarget]) assert.ok(html.includes(value));
  assert.ok(html.indexOf(openGoal) < html.indexOf(openCategory));
  assert.ok(html.indexOf(openCategory) < html.indexOf(scrollTarget));
});

test("Goal catalog keeps individual Goal details collapsed and visually subordinate to their category", () => {
  const html = renderGitMapHtml(availableGoalPresentation(), "nonce");

  const category = '<details class="goal-category"><summary class="goal-category-summary">変更を残したい</summary>';
  const goal = '<details id="goal-pushCommits" class="overview-section goal-item"><summary class="goal-item-summary">local commitをRemoteへ送りたい</summary>';
  assert.ok(html.includes(category));
  assert.ok(html.includes(goal));
  assert.ok(html.indexOf(category) < html.indexOf(goal));
  assert.ok(!html.includes('<section id="goal-pushCommits"'));
  assert.ok(!goal.includes(" open"));
  assert.ok(html.includes(".goal-category > .goal-category-summary"));
  assert.ok(html.includes(".goal-category > .goal-item"));
  assert.ok(html.includes(".goal-item > .goal-item-summary"));
});

test("Working Tree to Staging guidance has its own wrapping row instead of a narrow separator column", () => {
  const html = renderGitMapHtml(availableGoalPresentation(), "nonce");

  assert.ok(html.includes("grid-template-columns:minmax(170px,220px) minmax(145px,190px) minmax(320px,1fr)"));
  assert.ok(html.includes(".map-context-flow { grid-column:1 / 3; grid-row:2;"));
  assert.ok(html.includes(".map-flow { color:var(--vscode-descriptionForeground); font-weight:700; text-align:center; white-space:normal;"));
  assert.ok(html.includes("git add → Stagingへ内容を記録"));
  assert.ok(html.includes("@media (max-width:760px) { .map-context { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }"));
  assert.ok(html.includes("@media (max-width:520px) { .map-context { grid-template-columns:minmax(0,1fr); }"));
});

function availableGoalPresentation(): GitMapPresentation {
  const commit = { id: "a".repeat(40), shortId: "aaaaaaa", subject: "test" };
  const state: RepositoryState = {
    repository: { rootPath: "/repo" },
    currentLocation: { kind: "branch", branchName: "main", head: commit, detached: false },
    localBranches: [{ name: "main", tipCommitId: commit.id }],
    workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    history: [{ commit, parentIds: [] }],
    operation: { kind: "normal" },
    remotes: { kind: "notConfigured" },
    upstream: { kind: "notConfigured" },
    stash: { kind: "available", value: [] },
    comparison: { kind: "notConfigured" },
    stateVersion: 1,
    refreshedAt: new Date(0),
  };
  const snapshot = { kind: "available" as const, repositoryId: "repo", state };
  return createGitMapPresentation(snapshot, { kind: "overview" }, { kind: "idle" }, undefined, "goal");
}
