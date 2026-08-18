import * as vscode from "vscode";

export function registerOpenGitBearingsCommand(
  outputChannel: vscode.OutputChannel,
  openGitBearingsUi: () => Thenable<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand("gitBearings.open", async () => {
    await openGitBearingsUi();
    outputChannel.appendLine("Git Bearings: open command invoked.");
  });
}
