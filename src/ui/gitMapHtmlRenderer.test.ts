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
});

test("renderer emits hidden ref grammar and unborn state without injection", () => {
  const snapshot = { kind: "empty" as const };
  const normal: GitMapPresentation = { status: "available", workingTree: { kind: "clean", unstagedCount: 0, modifiedCount: 0, untrackedCount: 0, conflictsCount: 0 }, staging: { stagedCount: 0 }, stash: { kind: "none" }, graph: { kind: "graph", nodes: [{ commitId: "id", shortId: "abc", subject: "subject", x: 20, y: 80, roles: ["base", "mergeBase"] }], edges: [], omissions: [], localBranches: [{ kind: "local", label: `<script>`, targetCommitId: "id", x: 20, y: 48, targetY: 80, current: true, bounds: { left: -28, top: 38, width: 96, height: 20 }, connector: { fromX: 20, fromY: 58, toX: 20, toY: 72 } }], remoteTrackingRefs: [{ kind: "remoteTracking", label: `<img src=x>/</text><script>`, targetCommitId: "id", x: 20, y: 110, targetY: 80, current: false, bounds: { left: -32, top: 100, width: 104, height: 20 }, connector: { fromX: 20, fromY: 120, toX: 20, toY: 72 } }], head: { targetKind: "branch", targetCommitId: "id", x: 20, y: 18, targetY: 36 }, width: 200, height: 140 }, remotes: [], upstream: [], detailSnapshot: snapshot };
  const html = renderGitMapHtml(normal, "nonce");
  for (const value of ["local-branch-ref", "local-ref", "ref-line", "head-pointer", "head-line", "head-label", "remote-tracking-ref", "remote-tracking-hidden", "remote-tracking-box", "remote-tracking-line", "display:none", "stroke-dasharray"]) assert.ok(html.includes(value));
  assert.ok(html.includes('d="M 20 58 L 20 72"'));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes("&lt;img src=x&gt;")); assert.ok(!html.includes("<script>"));
  const unborn = { ...normal, graph: { kind: "unborn" as const, nodes: [], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], unbornBranch: "main", width: 0, height: 0, message: "まだ commit がありません" } };
  const unbornHtml = renderGitMapHtml(unborn, "nonce"); assert.ok(unbornHtml.includes("[ main ]")); assert.ok(!unbornHtml.includes('class="graph-node"'));
});

test("Remote unavailable uses Unknown grammar while missing Remote remains a fact", () => {
  const unavailable = renderGitMapHtml({ ...presentation(), remotes: [], remoteMessage: "Remote情報を取得できません", remoteUnavailableReason: "<remote failed>" }, "nonce");
  assert.ok(unavailable.includes("unknown-state")); assert.ok(unavailable.includes("unknown-symbol")); assert.ok(unavailable.includes("Remote情報を取得できません")); assert.ok(unavailable.includes("&lt;remote failed&gt;")); assert.ok(!unavailable.includes("<remote failed>"));
  const missing = renderGitMapHtml({ ...presentation(), remotes: [], remoteMessage: "Remote は設定されていません" }, "nonce");
  assert.ok(missing.includes("Remote は設定されていません")); assert.ok(!missing.includes('class="unknown-state">'));
});

function presentation(): GitMapPresentation {
  const snapshot = { kind: "empty" as const };
  return { status: "available", repository: `<script>`, operationBanner: `<img src=x>`, workingTree: { kind: "clean", unstagedCount: 0, modifiedCount: 0, untrackedCount: 0, conflictsCount: 0 }, staging: { stagedCount: 0 }, stash: { kind: "shelf", count: 1 }, graph: { kind: "graph", nodes: [{ commitId: "id", shortId: "abc", subject: `<script>`, x: 20, y: 80, roles: ["current", "base", "mergeBase"], visualState: "related" }], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], predictionCommits: [{ label: "Prediction", description: "NEW COMMIT", x: 50, y: 80, visualState: "selected" }], width: 200, height: 120 }, remotes: [{ name: `<img src=x>`, facts: [], liveRemote: { label: "live Remote", message: "未確認" } }], upstream: [], detailSnapshot: snapshot };
}
