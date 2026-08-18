interface VscodeGitApi {
  readonly git: {
    readonly path: string;
  };
}

interface VscodeGitExtensionExports {
  getAPI(version: 1): VscodeGitApi;
}

interface VscodeGitExtension {
  readonly isActive: boolean;
  readonly exports: VscodeGitExtensionExports | undefined;
  activate(): Promise<VscodeGitExtensionExports>;
}

export interface VscodeExtensions {
  getExtension<T>(id: string): VscodeGitExtension | undefined;
}

export type GitExecutableResolution =
  | { readonly kind: "available"; readonly path: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export async function resolveVscodeGitExecutable(
  extensions: VscodeExtensions,
): Promise<GitExecutableResolution> {
  try {
    const extension = extensions.getExtension<VscodeGitExtensionExports>("vscode.git");

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
