import { strict as assert } from "node:assert";
import test from "node:test";
import { renderOverviewHtml } from "./overviewHtmlRenderer";

test("renderer escapes every repository-derived string", () => {
  const html = renderOverviewHtml({ status: "available", repository: `<script>&\"'`, operationBanner: `<img src=x>`, sections: [{ id: "x", title: `<section>`, facts: [{ label: `\"'`, value: `<script>&\"'` }], meaning: `<img onerror=1>`, unavailableReason: `<script>` }] });
  for (const value of ["&lt;script&gt;&amp;&quot;&#39;", "&lt;img src=x&gt;", "&lt;img onerror=1&gt;"]) assert.ok(html.includes(value));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x>"));
});
