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
  assert.ok(html.includes("↓ git add：内容をStagingへ記録"));
  assert.ok(html.includes("↓ commit：Staging内容からcommitを作成"));
  assert.ok(!html.includes(">↓ add<"));
  assert.ok(!html.includes(">↓ commit<"));
  for (const value of ["fact-state", "unknown-state", "unknown-symbol", "stash-shelf", "prediction-commit", "prediction-node", "Prediction", "NEW COMMIT", "warning-state", "warning-symbol", "selected-state", "related-state", "prefers-reduced-motion"]) assert.ok(html.includes(value));
  assert.ok(!html.includes("future shortId"));
  assert.ok(html.includes("BASE COMMON ANCESTOR"));
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
  assert.ok(html.includes('region fact-state selected-state')); assert.ok(html.includes('staging fact-state related-state'));
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
  assert.ok(html.includes('<details open><summary>Detail</summary>'));
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
  const map = { workingTree: ["Working Tree → Staging"], staging: ["Staging ← Working Tree"], stash: [], local: ["◌ NEW MERGE COMMITを生成"], predictions: [{ id: "prediction-1", description: "<NEW MERGE COMMIT>", parentCommitIds: [] }], pointers: [], remote: ["STEP 1 fetch", "STEP 2 integrate (rebase)"], warnings: ["注意が必要です。"], unknowns: ["外部結果は未確定です。"] };
  const commandPreview = { active: { rawInput: 'git commit -m "<unsafe>"', repositoryRoot: "/repo", basedOnStateVersion: 1, parse: { kind: "parseFailure" as const, reason: "<unsafe>" } }, stale: false, banner: true, status: "parseFailure" as const, sections: ["一言で何する", "今のあなたの場合", "変わるもの", "変わらないもの", "Git Map Preview", "注意・前提"].map((title) => ({ title: title as "一言で何する", lines: ["<unsafe>"] })), map, history: [{ label: "<unsafe>", stale: false }], examples: ["git add ."] };
  const html = renderGitMapHtml({ ...presentation(), detailMode: "commandInput", commandPreview }, "nonce");
  assert.ok(html.includes("PREVIEW")); assert.ok(html.includes("Repositoryは変更されていません")); assert.ok(html.includes("STEP 1 fetch")); assert.ok(html.includes("warning-state")); assert.ok(html.includes("unknown-state")); assert.ok(html.includes("data-command-input")); assert.ok(html.includes("Analyze")); assert.ok(html.includes("&lt;unsafe&gt;")); assert.ok(!html.includes("Execute")); assert.ok(!html.includes("Run"));
});

function presentation(): GitMapPresentation {
  const snapshot = { kind: "empty" as const };
  return { status: "available", repository: `<script>`, operationBanner: `<img src=x>`, workingTree: { kind: "clean", unstagedCount: 0, modifiedCount: 0, untrackedCount: 0, conflictsCount: 0 }, staging: { stagedCount: 0 }, stash: { kind: "shelf", count: 1 }, graph: { kind: "graph", nodes: [{ commitId: "id", shortId: "abc", subject: `<script>`, x: 20, y: 80, roles: ["current", "base", "mergeBase"], visualState: "related" }], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], predictionCommits: [{ id: "prediction-1", label: "Prediction", description: "NEW COMMIT", x: 50, y: 80, visualState: "selected" }], width: 200, height: 120 }, remotes: [{ name: `<img src=x>`, facts: [], liveRemote: { label: "live Remote", message: "未確認" } }], upstream: [], detailSnapshot: snapshot };
}
