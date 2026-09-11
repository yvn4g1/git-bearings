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

  assert.ok(html.includes('<details class="goal-category goal-category-has-candidates">'));
  assert.ok(html.includes('<summary class="goal-category-summary">変更を残したい <span class="goal-category-count">候補 3件</span></summary>'));
  assert.ok(html.includes('<details id="goal-stageChanges" class="overview-section goal-item goal-item-recommended">'));
  assert.ok(html.includes('<span class="goal-status goal-status-recommended">★ 今おすすめ</span>'));
  assert.ok(html.includes('<span class="goal-status goal-status-actionable">使えそう</span>'));
  assert.ok(html.includes('<span class="goal-status goal-status-input">入力が必要</span>'));
  assert.ok(html.includes('<summary class="goal-item-summary">local commitをRemoteへ送りたい</summary>'));
  assert.ok(!html.includes('<section id="goal-pushCommits"'));
  assert.ok(html.includes(".goal-category > .goal-item"));
  assert.ok(html.includes(".goal-item-recommended"));
  assert.ok(html.includes(".goal-status"));
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

test("Graph polish truncates only the visible long branch label and strengthens ordinary edges", () => {
  const base = availableGoalPresentation();
  assert.equal(base.graph.kind, "graph");
  const longBranch = "experiment/very-long-branch-name-for-layout";
  const branch = base.graph.localBranches[0];
  assert.ok(branch);
  const html = renderGitMapHtml({
    ...base,
    graph: {
      ...base.graph,
      localBranches: [{ ...branch, label: longBranch, bounds: { ...branch.bounds, width: 220, left: branch.x - 110 } }],
    },
  }, "nonce");

  assert.ok(html.includes("experiment/very-long-branch…"));
  assert.ok(html.includes(`<title>${longBranch}</title>`));
  assert.ok(html.includes(`&quot;branchName&quot;:&quot;${longBranch}&quot;`));
  assert.ok(html.includes(".graph-edge { fill:none; stroke:var(--vscode-descriptionForeground); stroke-width:1.75; opacity:.78; }"));
});

test("Analyze saves the current command draft before rerendering the Preview", () => {
  const html = renderGitMapHtml(availableGoalPresentation(), "nonce");
  const submit = "document.addEventListener('submit',e=>";
  const saveAndAnalyze = "const i=f.querySelector('[data-command-input]');save();v.postMessage({type:'analyze',input:i?.value||''})";
  assert.ok(html.includes(submit));
  assert.ok(html.includes(saveAndAnalyze));
  assert.ok(html.indexOf(submit) < html.indexOf(saveAndAnalyze));
});

function availableGoalPresentation(): GitMapPresentation {
  const commit = { id: "a".repeat(40), shortId: "aaaaaaa", subject: "test" };
  const featureCommit = { id: "b".repeat(40), shortId: "bbbbbbb", subject: "feature" };
  const state: RepositoryState = {
    repository: { rootPath: "/repo" },
    currentLocation: { kind: "branch", branchName: "main", head: commit, detached: false },
    localBranches: [
      { name: "main", tipCommitId: commit.id },
      { name: "feature/test", tipCommitId: featureCommit.id },
    ],
    workingTree: { staged: [], unstaged: [], untracked: ["memo.txt"], conflicts: [] },
    history: [
      { commit, parentIds: [] },
      { commit: featureCommit, parentIds: [commit.id] },
    ],
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
