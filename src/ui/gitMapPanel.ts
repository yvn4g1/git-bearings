import * as vscode from "vscode";
import { renderGitMapHtml } from "./gitMapHtmlRenderer";
import { createGitMapPresentation } from "./gitMapPresentation";
import { RepositoryStateSnapshotStore } from "./repositoryStateSnapshot";

const GIT_MAP_PANEL_VIEW_TYPE = "gitBearings.gitMap";

export class GitMapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly snapshotStore: RepositoryStateSnapshotStore) {
    this.disposables.push(snapshotStore.onDidChange(() => this.render()));
  }

  show(): void {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.Beside); return; }
    const panel = vscode.window.createWebviewPanel(GIT_MAP_PANEL_VIEW_TYPE, "Git Bearings: Git Map", vscode.ViewColumn.Beside, { enableScripts: false });
    this.panel = panel;
    this.render();
    this.disposables.push(panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; }));
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private render(): void {
    if (this.panel) this.panel.webview.html = renderGitMapHtml(createGitMapPresentation(this.snapshotStore.current), createNonce());
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  return value;
}
