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

test("Goal catalog keeps individual Goal details collapsed inside their category", () => {
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
  const presentation = createGitMapPresentation(snapshot, { kind: "overview" }, { kind: "idle" }, undefined, "goal");
  const html = renderGitMapHtml(presentation, "nonce");

  const category = "<summary>変更を残したい</summary>";
  const goal = '<details id="goal-pushCommits" class="overview-section"><summary><strong>local commitをRemoteへ送りたい</strong></summary>';
  assert.ok(html.includes(category));
  assert.ok(html.includes(goal));
  assert.ok(html.indexOf(category) < html.indexOf(goal));
  assert.ok(!html.includes('<section id="goal-pushCommits"'));
  assert.ok(!goal.includes(" open"));
});
