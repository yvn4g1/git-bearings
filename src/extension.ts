import * as vscode from "vscode";
import { registerOpenGitBearingsCommand } from "./commands/openGitBearings";
import {
  GIT_BEARINGS_SIDEBAR_VIEW_ID,
  createGitBearingsSidebar,
} from "./ui/gitBearingsSidebar";
import { GitMapPanel } from "./ui/gitMapPanel";
import { AppViewStateStore } from "./domain/appViewStateStore";
import { RepositorySelectionController } from "./repository/repositorySelection";
import { VscodeGitRepositorySource, type GitApiLike } from "./repository/vscodeGitRepositorySource";

const selectedRepositoryKey = "gitBearings.selectedRepository";

interface GitExtensionExports { getAPI(version: 1): GitApiLike; }

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Git Bearings");
  const sidebar = createGitBearingsSidebar();
  const gitMapPanel = new GitMapPanel();
  const appViewState = new AppViewStateStore<unknown>();
  const selection = new RepositorySelectionController({
    rememberedId: () => context.workspaceState.get<string>(selectedRepositoryKey),
    remember: (id) => { void context.workspaceState.update(selectedRepositoryKey, id); },
    resetViewState: () => appViewState.resetForRepositoryChange(),
    onDidAutoSelectAfterSelectionLost: (repository) => {
      void vscode.window.showInformationMessage(`選択中のRepositoryが利用できなくなったため、${repository.rootPath} に切り替えました。`);
    },
  });
  const source = new VscodeGitRepositorySource(
    () => getGitApi(),
    (candidates) => selection.updateCandidates(candidates),
    (reason) => selection.setUnavailable(reason),
  );

  const selectRepository = async (): Promise<void> => {
    const state = selection.currentState;
    if (state.kind !== "selected" && state.kind !== "selectionRequired") return;
    const picked = await vscode.window.showQuickPick(state.candidates.map((candidate) => ({
      label: vscode.workspace.asRelativePath(candidate.rootPath, false) || candidate.rootPath,
      description: candidate.rootPath,
      detail: candidate.rootPath,
      candidate,
    })), { placeHolder: "Git Bearingsで表示するRepositoryを選択" });
    if (picked) selection.select(picked.candidate.id);
  };

  context.subscriptions.push(
    outputChannel,
    sidebar,
    gitMapPanel,
    source,
    vscode.commands.registerCommand("gitBearings.selectRepository", selectRepository),
    registerOpenGitBearingsCommand(outputChannel, async () => {
      if (selection.currentState.kind === "selectionRequired") await selectRepository();
      await vscode.commands.executeCommand(
        "setContext",
        "gitBearings.uiOpened",
        true,
      );
      await vscode.commands.executeCommand(`${GIT_BEARINGS_SIDEBAR_VIEW_ID}.focus`);
      gitMapPanel.show();
    }),
  );
  await source.initialize();
}

async function getGitApi(): Promise<GitApiLike> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
  if (!extension) throw new Error("VS Code Git extension is unavailable");
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports.getAPI(1);
}

export function deactivate(): void {
  // Resources are disposed through ExtensionContext subscriptions.
}
