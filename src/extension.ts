import * as vscode from "vscode";
import { registerOpenGitBearingsCommand } from "./commands/openGitBearings";
import {
  GIT_BEARINGS_SIDEBAR_VIEW_ID,
  createGitBearingsSidebar,
} from "./ui/gitBearingsSidebar";
import { GitMapPanel } from "./ui/gitMapPanel";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Git Bearings");
  const sidebar = createGitBearingsSidebar();
  const gitMapPanel = new GitMapPanel();

  context.subscriptions.push(
    outputChannel,
    sidebar,
    gitMapPanel,
    registerOpenGitBearingsCommand(outputChannel, async () => {
      await vscode.commands.executeCommand(
        "setContext",
        "gitBearings.uiOpened",
        true,
      );
      await vscode.commands.executeCommand(`${GIT_BEARINGS_SIDEBAR_VIEW_ID}.focus`);
      gitMapPanel.show();
    }),
  );
}

export function deactivate(): void {
  // Resources are disposed through ExtensionContext subscriptions.
}
