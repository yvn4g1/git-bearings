import { strict as assert } from "node:assert";
import test from "node:test";
import type { CoreRepositoryFacts, SupplementalRepositoryFacts } from "../domain/repositoryState";
import { composeRepositoryState } from "./repositoryStateComposer";

const id = "a".repeat(40);
const head = { id, shortId: "aaaaaaa", subject: "head" };
const core: CoreRepositoryFacts = {
  repository: { rootPath: "/repository" },
  currentLocation: { kind: "branch", branchName: "main", head, detached: false },
  localBranches: [{ name: "main", tipCommitId: id }],
  workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
  history: [], operation: { kind: "normal" },
};

test("composer preserves supplemental partial failures and metadata while replacing history", () => {
  const supplemental: SupplementalRepositoryFacts = {
    remotes: { kind: "unavailable", reason: "remote failed" },
    upstream: { kind: "unavailable", reason: "upstream failed" },
    stash: { kind: "unavailable", reason: "stash failed" },
  };
  const history = [{ commit: head, parentIds: [] }];
  const refreshedAt = new Date("2026-08-24T00:00:00Z");
  const state = composeRepositoryState(core, supplemental, { kind: "notConfigured" }, history, { stateVersion: 7, refreshedAt });
  assert.equal(state.history, history);
  assert.equal(state.remotes, supplemental.remotes);
  assert.equal(state.upstream, supplemental.upstream);
  assert.equal(state.stash, supplemental.stash);
  assert.equal(state.stateVersion, 7);
  assert.equal(state.refreshedAt, refreshedAt);
});
