import * as vscode from "vscode";

/**
 * Bootstrap entry point. Product commands and UI are intentionally deferred to
 * the MVP implementation plan, beginning with Phase 0 / Issue 1.
 */
export function activate(_context: vscode.ExtensionContext): void {
  // Intentionally empty: loading the extension is the only Bootstrap behavior.
}

export function deactivate(): void {
  // No resources are created during Bootstrap.
}

