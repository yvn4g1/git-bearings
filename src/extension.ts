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
import { resolveVscodeGitExecutable } from "./git/gitExecutableResolver";
import { ProcessRunner } from "./git/processRunner";
import { GitExecutor } from "./git/gitExecutor";
import { CoreRepositoryReader } from "./git/coreRepositoryReader";
import { SupplementalRepositoryReader } from "./git/supplementalRepositoryReader";
import { BranchComparisonReader } from "./git/branchComparisonReader";
import { RepositoryStateReader } from "./repository/repositoryStateReader";
import { BasePreferenceController, BASE_PREFERENCE_KEY } from "./repository/basePreference";
import { createBaseSelectionCandidates } from "./repository/baseSelection";

const selectedRepositoryKey = "gitBearings.selectedRepository";

interface GitExtensionExports { getAPI(version: 1): GitApiLike; }

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Git Bearings");
  const sidebar = createGitBearingsSidebar();
  const gitMapPanel = new GitMapPanel();
  const appViewState = new AppViewStateStore<unknown>();
  const basePreference = new BasePreferenceController({
    read: () => context.workspaceState.get<unknown>(BASE_PREFERENCE_KEY),
    write: (value) => context.workspaceState.update(BASE_PREFERENCE_KEY, value),
  });
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
  const gitResolution = await resolveVscodeGitExecutable(vscode.extensions);
  const gitUnavailableReason = gitResolution.kind === "unavailable" ? gitResolution.reason : undefined;
  const stateReader = gitResolution.kind === "available"
    ? createRepositoryStateReader(gitResolution.path, outputChannel)
    : undefined;

  const readSelectedState = async () => {
    const selected = selection.currentState;
    if (selected.kind !== "selected" || !stateReader) return undefined;
    return stateReader.read(
      selected.repository.rootPath,
      basePreference.get(selected.repository.id),
      { stateVersion: 1, refreshedAt: new Date() },
    );
  };

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

  const selectBaseBranch = async (): Promise<void> => {
    const selected = selection.currentState;
    if (selected.kind !== "selected") {
      await vscode.window.showInformationMessage("先にGit BearingsのRepositoryを選択してください。");
      return;
    }
    if (!stateReader) {
      await vscode.window.showWarningMessage(gitUnavailableReason ?? "Git executable is unavailable.");
      return;
    }
    const stateResult = await readSelectedState();
    if (!stateResult || stateResult.kind === "unavailable") {
      await vscode.window.showWarningMessage(stateResult?.reason ?? "Repository state is unavailable.");
      return;
    }
    const candidates = createBaseSelectionCandidates(stateResult.value);
    if (candidates.length === 0) {
      await vscode.window.showInformationMessage("選択できる基準branchがありません。");
      return;
    }
    const picked = await vscode.window.showQuickPick(candidates, {
      placeHolder: "Git Bearingsの基準branchを選択",
    });
    if (!picked) return;
    await basePreference.save(selected.repository.id, picked.savedBase);
    const refreshed = await readSelectedState();
    if (refreshed?.kind === "unavailable") {
      outputChannel.appendLine(`Git Bearings state: ${refreshed.reason}`);
    }
  };

  context.subscriptions.push(
    outputChannel,
    sidebar,
    gitMapPanel,
    source,
    vscode.commands.registerCommand("gitBearings.selectRepository", selectRepository),
    vscode.commands.registerCommand("gitBearings.selectBaseBranch", selectBaseBranch),
    registerOpenGitBearingsCommand(outputChannel, async () => {
      if (selection.currentState.kind === "selectionRequired") await selectRepository();
      const state = await readSelectedState();
      if (state?.kind === "unavailable") outputChannel.appendLine(`Git Bearings state: ${state.reason}`);
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

function createRepositoryStateReader(gitPath: string, logger: { appendLine(value: string): void }): RepositoryStateReader {
  const executor = new GitExecutor(gitPath, new ProcessRunner(), logger);
  return new RepositoryStateReader(
    new CoreRepositoryReader(executor),
    new SupplementalRepositoryReader(executor),
    new BranchComparisonReader(executor),
  );
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
