export interface GitVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export type GitVersionSupport =
  | { readonly kind: "supported"; readonly version: GitVersion }
  | { readonly kind: "unsupported"; readonly version: GitVersion }
  | { readonly kind: "unavailable"; readonly reason: string };

const MINIMUM_GIT_VERSION: GitVersion = { major: 2, minor: 23, patch: 0 };

export function parseGitVersion(stdout: string): GitVersion | undefined {
  const match = /^git version (\d+)\.(\d+)\.(\d+)(?:[.+-].*)?$/m.exec(stdout);

  if (!match) {
    return undefined;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export function getGitVersionSupport(stdout: string): GitVersionSupport {
  const version = parseGitVersion(stdout);

  if (!version) {
    return { kind: "unavailable", reason: "Unrecognized Git version output." };
  }

  return isAtLeast(version, MINIMUM_GIT_VERSION)
    ? { kind: "supported", version }
    : { kind: "unsupported", version };
}

function isAtLeast(version: GitVersion, minimum: GitVersion): boolean {
  if (version.major !== minimum.major) {
    return version.major > minimum.major;
  }
  if (version.minor !== minimum.minor) {
    return version.minor > minimum.minor;
  }
  return version.patch >= minimum.patch;
}
