import type {
  CoreRepositoryFacts,
  Remote,
  SupplementalRepositoryFacts,
} from "../domain/repositoryState";

export type SavedBase =
  | {
      readonly kind: "local";
      readonly branchName: string;
      readonly ref: string;
    }
  | {
      readonly kind: "remoteTracking";
      readonly remoteName: string;
      readonly branchName: string;
      readonly trackingRef: string;
    };

export type ResolvedBase =
  | {
      readonly kind: "local";
      readonly branchName: string;
      readonly ref: string;
      readonly commitId: string;
    }
  | {
      readonly kind: "remoteTracking";
      readonly remoteName: string;
      readonly branchName: string;
      readonly ref: string;
      readonly commitId: string;
    };

export type BaseResolution =
  | { readonly kind: "resolved"; readonly base: ResolvedBase }
  | { readonly kind: "notConfigured" }
  | { readonly kind: "selectionRequired" }
  | { readonly kind: "unavailable"; readonly reason: string };

export function resolveBase(
  core: CoreRepositoryFacts,
  supplemental: SupplementalRepositoryFacts,
  savedBase?: SavedBase,
): BaseResolution {
  if (savedBase) return resolveSavedBase(core, supplemental, savedBase);

  const remoteDefault = resolveRemoteDefault(core, supplemental);
  if (remoteDefault) return { kind: "resolved", base: remoteDefault };

  for (const name of ["main", "master"]) {
    const branch = core.localBranches.find((candidate) => candidate.name === name);
    if (branch) return { kind: "resolved", base: localBase(branch.name, branch.tipCommitId) };
  }

  return hasSelectionCandidates(core, supplemental)
    ? { kind: "selectionRequired" }
    : { kind: "notConfigured" };
}

function resolveSavedBase(
  core: CoreRepositoryFacts,
  supplemental: SupplementalRepositoryFacts,
  savedBase: SavedBase,
): BaseResolution {
  if (savedBase.kind === "local") {
    if (savedBase.ref !== `refs/heads/${savedBase.branchName}`) {
      return unavailable("The saved local base is inconsistent.");
    }
    const branch = core.localBranches.find((candidate) => candidate.name === savedBase.branchName);
    return branch
      ? { kind: "resolved", base: localBase(branch.name, branch.tipCommitId) }
      : unavailable("The saved local base is no longer available.");
  }

  if (supplemental.remotes.kind !== "available") {
    return unavailable("The saved remote-tracking base cannot be verified.");
  }
  const remote = supplemental.remotes.value.find((candidate) => candidate.name === savedBase.remoteName);
  const tracking = remote?.trackingRefs.find((candidate) =>
    candidate.branchName === savedBase.branchName &&
    candidate.trackingRef === savedBase.trackingRef
  );
  return tracking
    ? {
        kind: "resolved",
        base: {
          kind: "remoteTracking",
          remoteName: savedBase.remoteName,
          branchName: tracking.branchName,
          ref: tracking.trackingRef,
          commitId: tracking.commitId,
        },
      }
    : unavailable("The saved remote-tracking base is no longer available.");
}

function resolveRemoteDefault(
  core: CoreRepositoryFacts,
  supplemental: SupplementalRepositoryFacts,
): ResolvedBase | undefined {
  if (core.currentLocation.kind !== "branch" || supplemental.upstream.kind !== "available") return undefined;
  const remoteName = supplemental.upstream.value.remoteName;
  if (remoteName === "." || supplemental.remotes.kind !== "available") return undefined;
  const remote = supplemental.remotes.value.find((candidate) => candidate.name === remoteName);
  if (!remote?.locallyKnownDefaultBranch) return undefined;

  const defaultBranch = remote.locallyKnownDefaultBranch;
  const local = core.localBranches.find((candidate) => candidate.name === defaultBranch.branchName);
  if (local) return localBase(local.name, local.tipCommitId);

  return remoteTrackingDefault(remote, defaultBranch.branchName, defaultBranch.trackingRef);
}

function remoteTrackingDefault(remote: Remote, branchName: string, trackingRef: string): ResolvedBase | undefined {
  const tracking = remote.trackingRefs.find((candidate) =>
    candidate.branchName === branchName && candidate.trackingRef === trackingRef
  );
  return tracking && {
    kind: "remoteTracking",
    remoteName: remote.name,
    branchName: tracking.branchName,
    ref: tracking.trackingRef,
    commitId: tracking.commitId,
  };
}

function localBase(branchName: string, commitId: string): ResolvedBase {
  return { kind: "local", branchName, ref: `refs/heads/${branchName}`, commitId };
}

function hasSelectionCandidates(core: CoreRepositoryFacts, supplemental: SupplementalRepositoryFacts): boolean {
  return core.localBranches.length > 0 || (
    supplemental.remotes.kind === "available" &&
    supplemental.remotes.value.some((remote) => remote.trackingRefs.length > 0)
  );
}

function unavailable(reason: string): BaseResolution {
  return { kind: "unavailable", reason };
}
