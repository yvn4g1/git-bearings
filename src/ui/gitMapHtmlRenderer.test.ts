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
});

function presentation(): GitMapPresentation {
  const snapshot = { kind: "empty" as const };
  return { status: "available", repository: `<script>`, operationBanner: `<img src=x>`, workingTree: [{ label: "Modified", value: "0" }], staging: { label: "Staged", value: "0" }, local: [{ label: "HEAD", value: `<script>` }], remotes: [{ name: `<img src=x>`, facts: [] }], upstream: [], detailSnapshot: snapshot };
}
