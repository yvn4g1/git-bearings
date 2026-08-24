import { strict as assert } from "node:assert";
import test from "node:test";
import type { CoreRepositoryFacts, SupplementalRepositoryFacts } from "../domain/repositoryState";
import type { ResolvedBase } from "./baseResolver";
import { RepositoryStateReader } from "./repositoryStateReader";

const a = "a".repeat(40);
const b = "b".repeat(40);
const core: CoreRepositoryFacts = {
  repository: { rootPath: "/repository" },
  currentLocation: { kind: "branch", branchName: "feature", head: commit(a), detached: false },
  localBranches: [{ name: "main", tipCommitId: b }, { name: "feature", tipCommitId: a }],
  workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
  history: [{ commit: commit(a), parentIds: [] }], operation: { kind: "normal" },
};
const supplemental: SupplementalRepositoryFacts = {
  remotes: { kind: "unavailable", reason: "remote failed" },
  upstream: { kind: "unavailable", reason: "upstream failed" },
  stash: { kind: "unavailable", reason: "stash failed" },
};

test("reader stops at Core failure", async () => {
  let supplementalReads = 0;
  const reader = new RepositoryStateReader(
    { read: async () => ({ kind: "unavailable", reason: "core failed" }) },
    { read: async () => { supplementalReads++; return supplemental; } },
    { read: async () => { throw new Error("must not run"); } },
  );
  assert.deepEqual(await reader.read("/repository", undefined, metadata()), { kind: "unavailable", reason: "core failed" });
  assert.equal(supplementalReads, 0);
});

test("reader composes partial Supplemental facts and comparison history", async () => {
  const replacement = [{ commit: commit(b), parentIds: [a] }];
  let receivedBase: ResolvedBase | undefined;
  const reader = new RepositoryStateReader(
    { read: async () => ({ kind: "available", value: core }) },
    { read: async () => supplemental },
    { read: async (_path, _core, base) => {
      receivedBase = base;
      return { comparison: { kind: "available", value: { baseRef: base.ref, mergeBase: null, ahead: 1, behind: 1 } }, history: replacement };
    } },
  );
  const result = await reader.read("/repository", undefined, metadata());
  assert.equal(receivedBase?.kind, "local");
  assert.equal(result.kind, "available");
  if (result.kind === "available") {
    assert.equal(result.value.history, replacement);
    assert.equal(result.value.remotes, supplemental.remotes);
    assert.equal(result.value.stash, supplemental.stash);
  }
});

test("reader localizes saved-base failure and maps selection-required to notConfigured", async () => {
  let comparisonReads = 0;
  const create = (facts: CoreRepositoryFacts) => new RepositoryStateReader(
    { read: async () => ({ kind: "available", value: facts }) },
    { read: async () => supplemental },
    { read: async () => { comparisonReads++; throw new Error("must not run"); } },
  );
  const missing = await create(core).read("/repository", { kind: "local", branchName: "missing", ref: "refs/heads/missing" }, metadata());
  assert.equal(missing.kind, "available");
  if (missing.kind === "available") assert.equal(missing.value.comparison.kind, "unavailable");

  const develop = { ...core, localBranches: [{ name: "develop", tipCommitId: a }] };
  const notConfigured = await create(develop).read("/repository", undefined, metadata());
  assert.equal(notConfigured.kind, "available");
  if (notConfigured.kind === "available") assert.deepEqual(notConfigured.value.comparison, { kind: "notConfigured" });
  assert.equal(comparisonReads, 0);
});

function metadata() { return { stateVersion: 3, refreshedAt: new Date(0) }; }
function commit(id: string) { return { id, shortId: id.slice(0, 7), subject: id[0] }; }
