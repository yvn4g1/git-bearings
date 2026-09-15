const PREVIEW_STATUS_MARKUP = '<span>Repositoryは変更されていません</span>';
const CLEAR_ACTION_MARKUP = '<button data-preview-action="clear">現在地へ戻る</button>';

export function addCurrentPreviewClearAction(html: string, shouldShow: boolean): string {
  if (!shouldShow || html.includes(CLEAR_ACTION_MARKUP)) return html;
  if (!html.includes(PREVIEW_STATUS_MARKUP)) return html;
  return html.replace(PREVIEW_STATUS_MARKUP, `${PREVIEW_STATUS_MARKUP}${CLEAR_ACTION_MARKUP}`);
}
