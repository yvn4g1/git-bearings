import * as vscode from "vscode";

interface VscodeGitApi {
  readonly git: {
    readonly path: string;
  };
}

interface VscodeGitExtensionExports {
  getAPI(version: 1): VscodeGitApi;
}

export type GitExecutableResolution =
  | { readonly kind: "available"; readonly path: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export async function resolveVscodeGitExecutable(): Promise<GitExecutableResolution> {
  const extension =
    vscode.extensions.getExtension<VscodeGitExtensionExports>("vscode.git");

  if (!extension) {
    return {
      kind: "unavailable",
      reason: "VS Code Git extension is unavailable.",
    };
  }

  const gitExtension = extension.isActive
    ? extension.exports
    : await extension.activate();
  const gitPath = gitExtension.getAPI(1).git.path;

  if (gitPath.length === 0) {
    return {
      kind: "unavailable",
      reason: "VS Code Git extension did not provide a Git executable path.",
    };
  }

  return { kind: "available", path: gitPath };
}
