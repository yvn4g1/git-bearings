import * as vscode from "vscode";
import { renderGitMapHtml } from "./gitMapHtmlRenderer";
import { createGitMapPresentation } from "./gitMapPresentation";
import { RepositoryStateSnapshotStore } from "./repositoryStateSnapshot";
import { AppViewStateStore } from "../domain/appViewStateStore";
import { parseGitMapSelectionMessage } from "./gitMapMessage";
import { isSelectionValid, reconcileSelection } from "../domain/selectionReconciliation";
import { CommitDetailController } from "./commitDetailController";

const GIT_MAP_PANEL_VIEW_TYPE = "gitBearings.gitMap";

export class GitMapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly snapshotStore: RepositoryStateSnapshotStore, private readonly viewState: AppViewStateStore<unknown>, private readonly commitDetails: CommitDetailController) {
    this.disposables.push(snapshotStore.onDidChange((snapshot) => { this.viewState.select(reconcileSelection(this.viewState.current.selection, snapshot)); this.commitDetails.sync(snapshot, this.viewState.current.selection); this.render(); }));
    this.disposables.push(viewState.onDidChange((state) => { this.commitDetails.sync(this.snapshotStore.current, state.selection); this.render(); }));
    this.disposables.push(commitDetails.onDidChange(() => this.render()));
  }

  show(): void {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.Beside); return; }
    const panel = vscode.window.createWebviewPanel(GIT_MAP_PANEL_VIEW_TYPE, "Git Bearings: Git Map", vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    this.panel = panel;
    this.commitDetails.setPanelOpen(true, this.snapshotStore.current, this.viewState.current.selection);
    this.render();
    this.disposables.push(panel.webview.onDidReceiveMessage((message: unknown) => {
      const selection = parseGitMapSelectionMessage(message);
      if (selection && isSelectionValid(selection, this.snapshotStore.current)) this.viewState.select(selection);
    }));
    this.disposables.push(panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.commitDetails.setPanelOpen(false, this.snapshotStore.current, this.viewState.current.selection); } }));
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private render(): void {
    if (this.panel) this.panel.webview.html = renderGitMapHtml(createGitMapPresentation(this.snapshotStore.current, this.viewState.current.selection, this.commitDetails.current), createNonce());
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  return value;
}
