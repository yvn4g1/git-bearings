import { strict as assert } from "node:assert";
import test from "node:test";
import { AppViewStateStore } from "./appViewStateStore";

test("repository changes reset selection, detail mode, and preview", () => {
  const store = new AppViewStateStore<string>();
  store.set({ selection: { kind: "branch", branchName: "feature" }, detailMode: "commandInput", preview: "old repository preview" });
  store.resetForRepositoryChange();
  assert.deepEqual(store.current, { selection: { kind: "overview" }, detailMode: "inspect", preview: null });
});

test("selection notifies once and supports all UI-only identities", () => {
  const store = new AppViewStateStore();
  let changes = 0;
  store.onDidChange(() => { changes += 1; });
  store.select({ kind: "workingTree", section: "conflicts" });
  store.select({ kind: "workingTree", section: "conflicts" });
  store.select({ kind: "stashShelf" });
  assert.equal(changes, 2);
  assert.deepEqual(store.current.selection, { kind: "stashShelf" });
});
