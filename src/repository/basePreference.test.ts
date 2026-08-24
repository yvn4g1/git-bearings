import { strict as assert } from "node:assert";
import test from "node:test";
import { BasePreferenceController, parsePreferences } from "./basePreference";

test("base preferences persist local and custom remote-tracking refs per repository", async () => {
  let stored: unknown;
  const controller = new BasePreferenceController({
    read: () => stored,
    write: (value) => { stored = value; },
  });
  await controller.save("repository-a", { kind: "local", branchName: "main", ref: "refs/heads/main" });
  await controller.save("repository-b", { kind: "remoteTracking", remoteName: "upstream", branchName: "trunk", trackingRef: "refs/custom/upstream/trunk" });
  assert.deepEqual(controller.get("repository-a"), { kind: "local", branchName: "main", ref: "refs/heads/main" });
  assert.deepEqual(controller.get("repository-b"), { kind: "remoteTracking", remoteName: "upstream", branchName: "trunk", trackingRef: "refs/custom/upstream/trunk" });
  assert.equal(controller.get("repository-c"), undefined);
  await controller.save("repository-a", { kind: "local", branchName: "release", ref: "refs/heads/release" });
  assert.equal(controller.get("repository-a")?.branchName, "release");
  assert.equal(controller.get("repository-b")?.branchName, "trunk");
});

test("malformed stored values are ignored without affecting valid repositories", () => {
  const parsed = parsePreferences({
    valid: { kind: "local", branchName: "main", ref: "refs/heads/main" },
    inconsistent: { kind: "local", branchName: "main", ref: "refs/heads/master" },
    guessed: { kind: "remoteTracking", remoteName: "origin", branchName: "main", trackingRef: "origin/main" },
    extra: { kind: "local", branchName: "main", ref: "refs/heads/main", unexpected: true },
    primitive: "main",
  });
  assert.deepEqual(parsed, { valid: { kind: "local", branchName: "main", ref: "refs/heads/main" } });
  assert.deepEqual(parsePreferences(null), {});
  assert.deepEqual(parsePreferences([]), {});
});
