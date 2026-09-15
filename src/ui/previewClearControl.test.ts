import { strict as assert } from "node:assert";
import test from "node:test";
import { addCurrentPreviewClearAction } from "./previewClearControl";

const status = '<aside class="preview-banner">PREVIEW<br /><span>Repositoryは変更されていません</span></aside>';
const clearAction = '<button data-preview-action="clear">現在地へ戻る</button>';

test("current Preview gets a clear action without changing its input draft", () => {
  const html = addCurrentPreviewClearAction(status, true);
  assert.ok(html.includes(clearAction));
  assert.ok(html.indexOf("Repositoryは変更されていません") < html.indexOf(clearAction));
});

test("non-Preview HTML is left untouched", () => {
  const html = '<main>Fact Map</main>';
  assert.equal(addCurrentPreviewClearAction(html, true), html);
  assert.equal(addCurrentPreviewClearAction(status, false), status);
});

test("an existing stale Preview clear action is not duplicated", () => {
  const stale = status.replace("</aside>", `${clearAction}</aside>`);
  const html = addCurrentPreviewClearAction(stale, true);
  assert.equal((html.match(/data-preview-action="clear"/g) ?? []).length, 1);
});
