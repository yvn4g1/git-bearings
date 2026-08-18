import type * as vscode from "vscode";

interface VscodeGitApi {
  readonly git: {
    readonly path: string;
  };
}

interface VscodeGitExtensionExports {
  getAPI(version: 1): VscodeGitApi;
}

export interface VscodeGitExtension {
  readonly isActive: boolean;
  readonly exports: VscodeGitExtensionExports | undefined;
  activate(): PromiseLike<VscodeGitExtensionExports>;
}

export type VscodeExtensions = Pick<typeof vscode.extensions, "getExtension">;

export type GitExecutableResolution =
  | { readonly kind: "available"; readonly path: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export async function resolveVscodeGitExecutable(
  extensions: VscodeExtensions,
): Promise<GitExecutableResolution> {
  return resolveGitExecutableFromLookup(() =>
    extensions.getExtension<VscodeGitExtensionExports>("vscode.git"),
  );
}

export async function resolveGitExecutableFromLookup(
  getGitExtension: () => VscodeGitExtension | undefined,
): Promise<GitExecutableResolution> {
  try {
    const extension = getGitExtension();

    if (!extension) {
      return unavailable();
    }

    const gitExtension = extension.isActive
      ? extension.exports
      : await extension.activate();
    const gitPath = gitExtension?.getAPI(1)?.git?.path;

    if (typeof gitPath !== "string" || gitPath.trim().length === 0) {
      return unavailable();
    }

    return { kind: "available", path: gitPath };
  } catch {
    return unavailable();
  }
}

function unavailable(): GitExecutableResolution {
  return {
    kind: "unavailable",
    reason: "VS Code Git extension did not provide a usable Git executable path.",
  };
}
