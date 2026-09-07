import * as vscode from "vscode";
import { renderGitMapHtml } from "./gitMapHtmlRenderer";
import { createGitMapPresentation } from "./gitMapPresentation";
import { RepositoryStateSnapshotStore } from "./repositoryStateSnapshot";
import { AppViewStateStore } from "../domain/appViewStateStore";
import { parseGitMapMessage } from "./gitMapMessage";
import { isSelectionValid, reconcileSelection } from "../domain/selectionReconciliation";
import { CommitDetailController } from "./commitDetailController";
import { CommandPreviewController, createCommandPreviewPresentation, type CommandPreviewSession } from "./commandPreview";
import { formatGoalCommand, resolveGoal } from "../domain/goal";

const GIT_MAP_PANEL_VIEW_TYPE = "gitBearings.gitMap";

export class GitMapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly preview: CommandPreviewController;

  constructor(private readonly snapshotStore: RepositoryStateSnapshotStore, private readonly viewState: AppViewStateStore<CommandPreviewSession>, private readonly commitDetails: CommitDetailController) {
    this.preview = new CommandPreviewController(viewState);
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
      const parsed = parseGitMapMessage(message); if (!parsed) return;
      if (parsed.type === "select") { if (isSelectionValid(parsed.selection, this.snapshotStore.current)) this.viewState.select(parsed.selection); return; }
      if (parsed.type === "detailInspect" || parsed.type === "detailCommand" || parsed.type === "detailGoal") { this.viewState.set({ ...this.viewState.current, detailMode: parsed.type === "detailInspect" ? "inspect" : parsed.type === "detailCommand" ? "commandInput" : "goal" }); return; }
      if (parsed.type === "clear") { this.preview.clear(); return; }
      if (parsed.type === "selectHistory") { this.preview.selectHistory(parsed.index); return; }
      const state = this.snapshotStore.current.kind === "available" ? this.snapshotStore.current.state : undefined;
      if (!state) return;
      if (parsed.type === "goalPreview") { const resolution = resolveGoal(state, { goalId: parsed.goalId, ...(parsed.target ? { target: parsed.target } : {}) }); const step = [resolution.primary, resolution.alternative].flatMap((item) => item?.steps ?? []).find((item) => item.id === parsed.stepId); if (step) { this.preview.analyze(state, formatGoalCommand(step.command)); this.viewState.set({ ...this.viewState.current, detailMode: "commandInput" }); } return; }
      if (parsed.type === "analyze") this.preview.analyze(state, parsed.input);
      else if (parsed.type === "recalculate") this.preview.recalculate(state);
    }));
    this.disposables.push(panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.commitDetails.setPanelOpen(false, this.snapshotStore.current, this.viewState.current.selection); } }));
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private render(): void {
    if (this.panel) { const state = this.snapshotStore.current.kind === "available" ? this.snapshotStore.current.state : undefined; const preview = createCommandPreviewPresentation(this.viewState.current.preview, state); this.panel.webview.html = renderGitMapHtml(createGitMapPresentation(this.snapshotStore.current, this.viewState.current.selection, this.commitDetails.current, preview, this.viewState.current.detailMode), createNonce()); }
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  return value;
}
