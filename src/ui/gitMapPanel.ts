import * as vscode from "vscode";

const GIT_MAP_PANEL_VIEW_TYPE = "gitBearings.gitMap";

export class GitMapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      GIT_MAP_PANEL_VIEW_TYPE,
      "Git Bearings: Git Map（UI試作）",
      vscode.ViewColumn.Beside,
      {
        enableScripts: false,
      },
    );

    panel.webview.html = createGitMapHtml(panel.webview);
    this.panel = panel;
    this.disposables.push(
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = undefined;
        }
      }),
    );
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function createGitMapHtml(webview: vscode.Webview): string {
  const nonce = createNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Git Bearings: Git Map</title>
    <style nonce="${nonce}">
      :root { color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
      body { margin: 0; padding: 16px; }
      .fixture { color: var(--vscode-descriptionForeground); margin: 0 0 16px; }
      .map { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 0.38fr); gap: 16px; }
      .map-area, .detail-pane { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 16px; }
      .regions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
      .region { border: 1px dashed var(--vscode-panel-border); border-radius: 4px; min-height: 120px; padding: 12px; }
      h1, h2, h3, p { margin-top: 0; }
      h1 { font-size: 1.15em; }
      h2 { font-size: 1em; }
      h3 { font-size: 0.9em; }
    </style>
  </head>
  <body>
    <h1>Git Bearings: Git Map</h1>
    <p class="fixture">UI試作の静的fixtureです。実際のGit状態は表示していません。</p>
    <main class="map">
      <section class="map-area" aria-label="Git Map fixture">
        <h2>Git Map</h2>
        <div class="regions">
          <section class="region">
            <h3>YOUR CHANGES</h3>
            <p>Working Tree / Staging の表示領域</p>
          </section>
          <section class="region">
            <h3>LOCAL REPOSITORY</h3>
            <p>Commit Graph の表示領域</p>
          </section>
          <section class="region">
            <h3>REMOTE</h3>
            <p>Remote の表示領域</p>
          </section>
        </div>
      </section>
      <aside class="detail-pane" aria-label="Detail Pane fixture">
        <h2>Detail Pane</h2>
        <p>選択した要素の説明を表示する領域です。</p>
      </aside>
    </main>
  </body>
</html>`;
}

function createNonce(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}
