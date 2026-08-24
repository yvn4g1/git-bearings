import { strict as assert } from "node:assert";
import test from "node:test";
import type { CoreRepositoryFacts, Remote, SupplementalRepositoryFacts } from "../domain/repositoryState";
import { resolveBase, type SavedBase } from "./baseResolver";

const a = "a".repeat(40);
const b = "b".repeat(40);

test("saved local and remote-tracking bases are strictly revalidated", () => {
  const core = coreFacts(["main", "feature"]);
  const supplemental = remoteFacts();
  assert.equal(resolveBase(core, supplemental, { kind: "local", branchName: "feature", ref: "refs/heads/feature" }).kind, "resolved");
  assert.equal(resolveBase(core, supplemental, { kind: "local", branchName: "feature", ref: "refs/heads/main" }).kind, "unavailable");
  assert.equal(resolveBase(coreFacts(["main"]), supplemental, { kind: "local", branchName: "feature", ref: "refs/heads/feature" }).kind, "unavailable");
  const savedRemote: SavedBase = { kind: "remoteTracking", remoteName: "origin", branchName: "main", trackingRef: "refs/custom/origin/main" };
  const resolved = resolveBase(core, supplemental, savedRemote);
  assert.equal(resolved.kind, "resolved");
  if (resolved.kind === "resolved") assert.equal(resolved.base.ref, "refs/custom/origin/main");
  assert.equal(resolveBase(core, unavailableRemotes(), savedRemote).kind, "unavailable");
  assert.equal(resolveBase(core, supplemental, { ...savedRemote, trackingRef: "refs/remotes/origin/main" }).kind, "unavailable");
});

test("remote default prefers a same-name local branch and otherwise revalidates its tracking ref", () => {
  const local = resolveBase(coreFacts(["main", "feature"]), remoteFacts(), undefined);
  assert.equal(local.kind, "resolved");
  if (local.kind === "resolved") assert.equal(local.base.kind, "local");

  const remote = resolveBase(coreFacts(["feature"]), remoteFacts(), undefined);
  assert.equal(remote.kind, "resolved");
  if (remote.kind === "resolved") {
    assert.equal(remote.base.kind, "remoteTracking");
    assert.equal(remote.base.ref, "refs/custom/origin/main");
  }

  const inconsistent = remoteFacts([{ name: "origin", trackingRefs: [], locallyKnownDefaultBranch: { branchName: "main", trackingRef: "refs/custom/origin/main" } }]);
  const fallback = resolveBase(coreFacts(["master"]), inconsistent, undefined);
  assert.equal(fallback.kind, "resolved");
  if (fallback.kind === "resolved") assert.equal(fallback.base.branchName, "master");
});

test("upstream absence, failure, local upstream, and detached HEAD skip remote default", () => {
  for (const supplemental of [
    { ...remoteFacts(), upstream: { kind: "notConfigured" } as const },
    { ...remoteFacts(), upstream: { kind: "unavailable", reason: "failed" } as const },
    { ...remoteFacts(), upstream: { kind: "available", value: { remoteName: ".", branchName: "main", trackingRef: "refs/heads/main", relation: { kind: "available", value: { ahead: 0, behind: 0 } } } } as const },
  ]) {
    const result = resolveBase(coreFacts(["master"]), supplemental, undefined);
    assert.equal(result.kind, "resolved");
    if (result.kind === "resolved") assert.equal(result.base.branchName, "master");
  }
  const detached: CoreRepositoryFacts = {
    ...coreFacts(["main"]),
    currentLocation: { kind: "detached", branchName: null, head: commit(a), detached: true },
  };
  const result = resolveBase(detached, remoteFacts(), undefined);
  assert.equal(result.kind, "resolved");
  if (result.kind === "resolved") assert.equal(result.base.kind, "local");
});

test("local main and master fallback while develop requires selection", () => {
  assert.equal(resolvedName(coreFacts(["main", "master"]), noRemoteFacts()), "main");
  assert.equal(resolvedName(coreFacts(["master"]), noRemoteFacts()), "master");
  assert.equal(resolveBase(coreFacts(["develop"]), noRemoteFacts()).kind, "selectionRequired");
  assert.equal(resolveBase(coreFacts([]), noRemoteFacts()).kind, "notConfigured");
});

function resolvedName(core: CoreRepositoryFacts, supplemental: SupplementalRepositoryFacts): string | undefined {
  const result = resolveBase(core, supplemental);
  return result.kind === "resolved" ? result.base.branchName : undefined;
}

function coreFacts(branches: readonly string[]): CoreRepositoryFacts {
  return {
    repository: { rootPath: "/repository" },
    currentLocation: { kind: "branch", branchName: "feature", head: commit(a), detached: false },
    localBranches: branches.map((name, index) => ({ name, tipCommitId: index === 0 ? a : b })),
    workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    history: [{ commit: commit(a), parentIds: [] }],
    operation: { kind: "normal" },
  };
}

function remoteFacts(remotes: readonly Remote[] = [{
  name: "origin",
  trackingRefs: [{ branchName: "main", trackingRef: "refs/custom/origin/main", commitId: b }],
  locallyKnownDefaultBranch: { branchName: "main", trackingRef: "refs/custom/origin/main" },
}]): SupplementalRepositoryFacts {
  return {
    remotes: { kind: "available", value: remotes },
    upstream: { kind: "available", value: { remoteName: "origin", branchName: "feature", trackingRef: "refs/custom/origin/feature", relation: { kind: "available", value: { ahead: 0, behind: 0 } } } },
    stash: { kind: "available", value: [] },
  };
}

function noRemoteFacts(): SupplementalRepositoryFacts {
  return { remotes: { kind: "available", value: [] }, upstream: { kind: "notConfigured" }, stash: { kind: "available", value: [] } };
}

function unavailableRemotes(): SupplementalRepositoryFacts {
  return { remotes: { kind: "unavailable", reason: "failed" }, upstream: { kind: "unavailable", reason: "failed" }, stash: { kind: "available", value: [] } };
}

function commit(id: string) { return { id, shortId: id.slice(0, 7), subject: id[0] }; }
