import { strict as assert } from "node:assert";
import test from "node:test";
import { renderGitMapHtml } from "./gitMapHtmlRenderer";
import type { GitMapPresentation } from "./gitMapPresentation";

test("Goal recommendation jump opens its category before scrolling to the target", () => {
  const presentation = { status: "unavailable", message: "test" } as GitMapPresentation;
  const html = renderGitMapHtml(presentation, "nonce");

  const findTarget = "const target=document.getElementById(j.dataset.goalJump||'')";
  const openCategory = "const container=target?.closest('details');if(container)container.open=true";
  const scrollTarget = "target?.scrollIntoView({block:'nearest'})";

  assert.ok(html.includes(findTarget));
  assert.ok(html.includes(openCategory));
  assert.ok(html.includes(scrollTarget));
  assert.ok(html.indexOf(openCategory) < html.indexOf(scrollTarget));
});
