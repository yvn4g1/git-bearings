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
  assert.ok(html.includes("↓ add：内容をStagingへ反映"));
  assert.ok(html.includes("↓ commit：Staging内容からcommitを作成"));
  assert.ok(!html.includes(">↓ add<"));
  assert.ok(!html.includes(">↓ commit<"));
  assert.ok(html.includes("BASE COMMON ANCESTOR"));
  assert.ok(!html.includes(">CURRENT<"));
  assert.ok(!html.includes("BRANCH POINT"));
  assert.ok(!html.includes("BRANCH CREATED HERE"));
});

function presentation(): GitMapPresentation {
  const snapshot = { kind: "empty" as const };
  return { status: "available", repository: `<script>`, operationBanner: `<img src=x>`, workingTree: [{ label: "Modified", value: "0" }], staging: { label: "Staged", value: "0" }, graph: { kind: "graph", nodes: [{ commitId: "id", shortId: "abc", subject: `<script>`, x: 20, y: 80, roles: ["current", "base", "mergeBase"] }], edges: [], omissions: [], localBranches: [], remoteTrackingRefs: [], width: 200, height: 120 }, remotes: [{ name: `<img src=x>`, facts: [] }], upstream: [], detailSnapshot: snapshot };
}
