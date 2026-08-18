import * as vscode from "vscode";
import { registerOpenGitBearingsCommand } from "./commands/openGitBearings";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Git Bearings");

  context.subscriptions.push(
    outputChannel,
    registerOpenGitBearingsCommand(outputChannel),
  );
}

export function deactivate(): void {
  // Resources are disposed through ExtensionContext subscriptions.
}
