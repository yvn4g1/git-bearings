import { strict as assert } from "node:assert";
import test from "node:test";
import { renderGitMapHtml } from "./gitMapHtmlRenderer";
import type { GitMapPresentation } from "./gitMapPresentation";

test("Git Map renderer escapes repository-derived strings and preserves CSP", () => {
  const html = renderGitMapHtml(presentation(), "nonce-value");
  assert.ok(html.includes("default-src 'none'; style-src 'nonce-nonce-value'"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img src=x&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("fixture"));
  assert.ok(html.includes('aria-label="git addは内容をStagingへ記録"'));
  assert.ok(html.includes('aria-label="commitはStaging内容からcommitを作成"'));
  assert.ok(html.includes("あなたは今ここ"));
  assert.ok(html.includes('class="current-location-label"'));
  for (const value of ["fact-state", "unknown-state", "unknown-symbol", "stash-shelf", "prediction-commit", "prediction-node", "Prediction", "NEW COMMIT", "warning-state", "warning-symbol", "selected-state", "related-state", "prefers-reduced-motion"]) assert.ok(html.includes(value));
  assert.ok(!html.includes("future shortId"));
  assert.ok(html.includes("base / merge-base (common ancestor)"));
  assert.ok(!html.includes(">CURRENT<"));
  assert.ok(!html.includes("BRANCH POINT"));
  assert.ok(!html.includes("BRANCH CREATED HERE"));
  assert.ok(html.includes("script-src 'nonce-nonce-value'"));
  assert.ok(!html.includes("unsafe-inline")); assert.ok(!html.includes("unsafe-eval"));
  for (const selection of ['&quot;workingTree&quot;,&quot;section&quot;:&quot;overview&quot;', '&quot;staging&quot;', '&quot;stashShelf&quot;', '&quot;remote&quot;']) assert.ok(html.includes(selection));
  assert.ok(html.includes('role="button"')); assert.ok(html.includes('tabindex="0"'));
  assert.ok(html.includes("選択中: Overview"));
});

test("renderer emits hidden ref grammar and unborn state without injection", () => {
  const snapshot = { kind: "empty" as const };
  const normal: GitMapPresentation = { status: "available", workingTree: { kind: "clean", unstagedCount: 0, modifiedCount: 0, untrackedCount: 0, conflictsCount: 0 }, staging: { stagedCount: 0 }, stash: { kind: "none" }, graph: { kind: "graph", nodes: [{ commitId: "id", shortId: "abc", subject: "subject", x: 20, y: 80, roles: ["base", "mergeBase"] }], edges: [], omissions: [], localBranches: [{ kind: "local", label: `<script>`, targetCommitId: "id", x: 20, y: 48, targetY: 80, current: true, bounds: { left: -28, top: 38, width: 96, height: 20 }, connector: { fromX: 20, fromY: 58, toX: 20, toY: 72 } }], remoteTrackingRefs: [{ kind: "remoteTracking", label: `<img src=x>/</text><script>`, targetCommitId: "id", x: 20, y: 110, targetY: 80, current: false, bounds: { left: -32, top: 100, width: 104, height: 20 }, connector: { fromX: 20, fromY: 120, toX: 20, toY: 72 } }], head: { targetKind: "branch", targetCommitId: "id", x: 20, y: 18, targetY: 36 }, width: 200, height: 140 }, remotes: [], upstream: [], detailSnapshot: snapshot };
  const html = renderGitMapHtml(normal, "nonce");
  for (const value of ["local-branch-ref", "local-ref", "ref-line", "head-pointer", "head-line", "head-label", "remote-tracking-ref", "remote-tracking-hidden", "remote-tracking-box", "remote-tracking-line", "display:none", "stroke-dasharray"]) assert.ok(html.includes(value));
  assert.ok(html.includes('d="M 20 58 L 20 72"'));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes("&lt;img src=x&gt;")); assert.ok(!html.includes("<script>"));
  const unborn = { ...normal, graph: { kind: "unborn" as const, nodes: [], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], unbornBranch: "main", width: 0, height: 0, message: "まだ commit がありません" } };
  const unbornHtml = renderGitMapHtml(unborn, "nonce"); assert.ok(unbornHtml.includes("[ main ]")); assert.ok(!unbornHtml.includes('class="graph-node"')); assert.ok(unbornHtml.includes('&quot;kind&quot;:&quot;head&quot;')); assert.ok(unbornHtml.includes('&quot;branchName&quot;:&quot;main&quot;'));
});

test("renderer applies presentation selection state to actual elements", () => {
  const html = renderGitMapHtml({ ...presentation(), detailIdentity: "Remote & <origin>", workingTree: { ...presentation().workingTree, visualState: "selected" }, staging: { stagedCount: 1, visualState: "related" }, stash: { kind: "shelf", count: 1, visualState: "selected" }, upstreamSelection: { remoteName: "origin", branchName: "main" }, upstreamVisualState: "selected", remotes: [{ ...presentation().remotes[0], visualState: "selected" }], graph: { ...presentation().graph, remoteTrackingRefs: [{ kind: "remoteTracking", label: "origin/main", targetCommitId: "id", x: 20, y: 110, targetY: 80, current: false, bounds: { left: -32, top: 100, width: 104, height: 20 }, connector: { fromX: 20, fromY: 120, toX: 20, toY: 72 }, revealed: true, visualState: "related" }] } }, "nonce");
  assert.ok(html.includes('map-working fact-state selected-state')); assert.ok(html.includes('map-staging staging fact-state related-state'));
  assert.ok(html.includes('stash-shelf fact-state selected-state')); assert.ok(html.includes('remote-tracking-ref related-state'));
  assert.ok(html.includes('&quot;kind&quot;:&quot;upstream&quot;')); assert.ok(html.includes('data-primary-selection="true"'));
  assert.ok(html.includes("選択中: Remote &amp; &lt;origin&gt;"));
});

test("Detail renders selected explanation in two levels and escapes its facts", () => {
  const html = renderGitMapHtml({ ...presentation(), explanation: { identity: "branch <unsafe>", level1: "現在 <fact>", level2: "concept <detail>" } }, "nonce");
  assert.ok(html.includes("選択中: branch &lt;unsafe&gt;"));
  assert.ok(html.includes("現在 &lt;fact&gt;"));
  assert.ok(html.includes("もっと詳しく"));
  assert.ok(html.includes("concept &lt;detail&gt;"));
  assert.ok(html.includes('<section class="detail-pane">'));
  assert.ok(html.includes('<details class="detail-content"><summary>Detail / Command Preview / Goal</summary>'));
  assert.ok(!html.includes('<details class="detail-content" open'));
  assert.ok(!html.includes("type:'explain'"));
});

test("Commit detail is local to commit Detail, escaped, and caps paths at 100", () => {
  const paths = Array.from({ length: 101 }, (_, index) => `path-${index}${index === 0 ? " <&>" : ""}`);
  const html = renderGitMapHtml({ ...presentation(), explanation: { identity: "commit abc", level1: "Level 1", level2: "Level 2" }, commitDetail: { kind: "available", repositoryId: "repo", rootPath: "/repo", commitId: "id", detail: { fullHash: "a".repeat(40), author: "Author <unsafe>", authoredAt: "2024-01-02T03:04:05+09:00", parents: [], changedFiles: paths, changedFileCount: 101 } } }, "nonce");
  assert.ok(html.includes("Level 1")); assert.ok(html.includes("もっと詳しく")); assert.ok(html.includes("Full hash")); assert.ok(html.includes("Author &lt;unsafe&gt;")); assert.ok(html.includes("path-0 &lt;&amp;&gt;")); assert.ok(html.includes("他 1 件"));
  assert.equal((html.match(/<li>/g) ?? []).length, 100); assert.ok(html.includes("Parents</dt><dd>なし"));
  const loading = renderGitMapHtml({ ...presentation(), explanation: { identity: "commit abc", level1: "Level 1", level2: "Level 2" }, commitDetail: { kind: "loading", repositoryId: "repo", rootPath: "/repo", commitId: "id" } }, "nonce");
  assert.ok(loading.includes("Commit詳細を読み込み中…"));
  const failure = renderGitMapHtml({ ...presentation(), explanation: { identity: "commit abc", level1: "Level 1", level2: "Level 2" }, commitDetail: { kind: "unavailable", repositoryId: "repo", rootPath: "/repo", commitId: "id" } }, "nonce");
  assert.ok(failure.includes("Commit詳細を取得できません"));
});

test("Remote unavailable uses Unknown grammar while missing Remote remains a fact", () => {
  const unavailable = renderGitMapHtml({ ...presentation(), remotes: [], remoteMessage: "Remote情報を取得できません", remoteUnavailableReason: "<remote failed>" }, "nonce");
  assert.ok(unavailable.includes("unknown-state")); assert.ok(unavailable.includes("unknown-symbol")); assert.ok(unavailable.includes("Remote情報を取得できません")); assert.ok(unavailable.includes("&lt;remote failed&gt;")); assert.ok(!unavailable.includes("<remote failed>"));
  const missing = renderGitMapHtml({ ...presentation(), remotes: [], remoteMessage: "Remote は設定されていません" }, "nonce");
  assert.ok(missing.includes("Remote は設定されていません")); assert.ok(!missing.includes('class="unknown-state">'));
});

test("Command Preview stays outside Detail, escapes input, and offers analysis only", () => {
  const trackingUnknown = "commit後のupstreamとのahead/behindは再確認するまで未確定です。";
  const map = { workingTree: ["Working Tree → Staging"], staging: ["Staging ← Working Tree"], stash: [], local: ["◌ NEW MERGE COMMITを生成"], predictions: [{ id: "prediction-1", description: "<NEW MERGE COMMIT>", parentCommitIds: [] }], pointers: [], remote: ["STEP 1 fetch", "STEP 2 integrate (rebase)"], warnings: { workingTree: [], staging: [], stash: [], local: ["注意が必要です。"], remote: [] }, unknowns: { workingTree: [], staging: [], stash: [], local: [], remote: [trackingUnknown] } };
  const commandPreview = { active: { rawInput: 'git commit -m "<unsafe>"', repositoryRoot: "/repo", basedOnStateVersion: 1, parse: { kind: "parseFailure" as const, reason: "<unsafe>" } }, stale: false, banner: true, status: "parseFailure" as const, sections: ["一言で何する", "今のあなたの場合", "変わるもの", "変わらないもの", "Git Map Preview", "注意・前提"].map((title) => ({ title: title as "一言で何する", lines: ["<unsafe>"] })), map, history: [{ label: "<unsafe>", stale: false }], examples: ["git add ."] };
  const html = renderGitMapHtml({ ...presentation(), detailMode: "commandInput", commandPreview }, "nonce");
  assert.ok(html.includes("PREVIEW")); assert.ok(html.includes("Repositoryは変更されていません")); assert.ok(html.includes("STEP 1 fetch")); assert.ok(html.includes("warning-state")); assert.ok(html.includes("unknown-state")); assert.equal((html.match(new RegExp(trackingUnknown, "g")) ?? []).length, 1); assert.ok(html.indexOf("<h2>REMOTE / UPSTREAM CONTEXT</h2>") < html.indexOf(trackingUnknown)); assert.ok(html.includes("data-command-input")); assert.ok(html.includes("Analyze")); assert.ok(html.includes("&lt;unsafe&gt;")); assert.ok(!html.includes("Execute")); assert.ok(!html.includes("Run"));
});

test("Git Map gives Commit History the full upper region and keeps context compact below", () => {
  const html = renderGitMapHtml({ ...presentation(), detailMode: "inspect" }, "nonce");
  const working = html.indexOf('class="map-zone map-working');
  const staging = html.indexOf('class="map-zone map-staging');
  const history = html.indexOf('class="map-zone map-history');
  const remote = html.indexOf('class="map-zone map-remote');
  const detail = html.indexOf('class="detail-pane"');
  assert.ok(history < working && working < staging && staging < remote && remote < detail);
  for (const value of ["mental-map", "map-history", "map-context", "graph-scroll", "overflow-x:auto", "LOCAL COMMIT HISTORY", "REMOTE / UPSTREAM CONTEXT", "commit ↑ Local History", "current commit ↔ tracking context"]) assert.ok(html.includes(value));
  assert.ok(!html.includes("grid-template-columns:minmax(112px,.7fr)"));
  assert.ok(html.includes("body { margin:0; padding:8px 10px; line-height:1.25; overflow-x:hidden;"));
  assert.ok(html.includes(".map-scroll { min-width:0; overflow-x:hidden;"));
  assert.ok(html.includes("remote-trackingは最後に取得した情報です。live Remoteは未確認です。"));
  assert.ok(html.includes('class="detail-nav"'));
  assert.ok(html.includes('class="detail-tab detail-tab-active"'));
  assert.ok(!html.includes('class="region"'));
});

test("clean context is one line while changed Working Tree retains every fact", () => {
  const clean = renderGitMapHtml(presentation(), "nonce");
  assert.ok(clean.includes('Working Tree: <strong>clean</strong>'));
  assert.ok(clean.includes('Staged: <strong>0</strong>'));
  const changed = renderGitMapHtml({ ...presentation(), workingTree: { kind: "changes", unstagedCount: 2, modifiedCount: 1, untrackedCount: 1, conflictsCount: 0 } }, "nonce");
  for (const value of ["changesあり", "Unstaged</dt><dd>2", "Modified</dt><dd>1", "Untracked</dt><dd>1", "Conflicts</dt><dd>0"]) assert.ok(changed.includes(value));
});

test("current annotation and base roles stay below the current commit labels", () => {
  const html = renderGitMapHtml(presentation(), "nonce");
  assert.ok(html.includes('class="graph-role" x="33" y="107">base / merge-base (common ancestor)</text>'));
  assert.ok(html.includes('class="current-location-label" x="33" y="123">↑ あなたは今ここ</text>'));
  assert.ok(!html.includes('text-anchor="middle">BASE'));
});

function presentation(): GitMapPresentation {
  const snapshot = { kind: "empty" as const };
  return { status: "available", repository: `<script>`, operationBanner: `<img src=x>`, workingTree: { kind: "clean", unstagedCount: 0, modifiedCount: 0, untrackedCount: 0, conflictsCount: 0 }, staging: { stagedCount: 0 }, stash: { kind: "shelf", count: 1 }, graph: { kind: "graph", nodes: [{ commitId: "id", shortId: "abc", subject: `<script>`, x: 20, y: 80, roles: ["current", "base", "mergeBase"], visualState: "related" }], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], predictionCommits: [{ id: "prediction-1", label: "Prediction", description: "NEW COMMIT", x: 50, y: 80, visualState: "selected" }], width: 200, height: 120 }, remotes: [{ name: `<img src=x>`, facts: [], liveRemote: { label: "live Remote", message: "未確認" } }], upstream: [], detailSnapshot: snapshot };
}
