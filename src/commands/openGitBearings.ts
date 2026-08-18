import * as vscode from "vscode";

export function registerOpenGitBearingsCommand(
  outputChannel: vscode.OutputChannel,
): vscode.Disposable {
  return vscode.commands.registerCommand("gitBearings.open", () => {
    outputChannel.appendLine("Git Bearings: open command invoked.");
  });
}
