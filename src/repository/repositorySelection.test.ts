import { strict as assert } from "node:assert";
import test from "node:test";
import { RepositorySelectionController, type RepositoryCandidate } from "./repositorySelection";

const a = { id: "a", rootPath: "/a" };
const b = { id: "b", rootPath: "/b" };
const nested = { id: "nested", rootPath: "/a/nested" };

function createController(remembered?: string) {
  let memory = remembered;
  let resets = 0;
  const changes: string[] = [];
  const autoSelections: string[] = [];
  const controller = new RepositorySelectionController({
    rememberedId: () => memory, remember: (id) => { memory = id; }, resetViewState: () => { resets++; },
    onDidChange: (state) => { changes.push(state.kind); },
    onDidAutoSelectAfterSelectionLost: (repository) => { autoSelections.push(repository.id); },
  });
  return { controller, memory: () => memory, resets: () => resets, changes, autoSelections };
}

test("initial candidates distinguish zero, one, and multiple repositories", () => {
  const zero = createController(); zero.controller.updateCandidates([]); assert.equal(zero.controller.currentState.kind, "noRepository");
  const one = createController(); one.controller.updateCandidates([a]); assert.equal(one.controller.selectedRootPath, "/a"); assert.equal(one.memory(), "a");
  const multiple = createController(); multiple.controller.updateCandidates([a, b]); assert.equal(multiple.controller.currentState.kind, "selectionRequired");
});
test("a valid remembered repository is restored and an invalid one requires selection", () => {
  const valid = createController("b"); valid.controller.updateCandidates([a, b]); assert.equal(valid.controller.selectedRootPath, "/b");
  const invalid = createController("missing"); invalid.controller.updateCandidates([a, b]); assert.equal(invalid.controller.currentState.kind, "selectionRequired");
});
test("explicit selection changes memory and resets only for another repository", () => {
  const result = createController(); result.controller.updateCandidates([a, b]); result.controller.select("a");
  assert.equal(result.memory(), "a"); result.controller.select("b"); assert.equal(result.memory(), "b"); assert.equal(result.resets(), 1);
  result.controller.select("b"); assert.equal(result.resets(), 1); assert.equal(result.controller.select("missing"), false);
});
test("candidate updates preserve a selected repository, including nested repositories", () => {
  const result = createController(); result.controller.updateCandidates([a, nested]); result.controller.select("a"); result.controller.updateCandidates([a, b, nested, a]);
  assert.equal(result.controller.selectedRootPath, "/a"); assert.equal(result.resets(), 0); assert.deepEqual(result.changes, ["selected"]); assert.deepEqual(result.autoSelections, []);
  const state = result.controller.currentState; assert.equal(state.kind, "selected"); if (state.kind === "selected") assert.equal(state.candidates.length, 3);
});
test("losing a selected repository resets state for zero, one, and multiple remaining candidates", () => {
  for (const [candidates, kind] of [[[], "noRepository"], [[b], "selected"], [[b, nested], "selectionRequired"]] as readonly [readonly RepositoryCandidate[], string][]) {
    const result = createController(); result.controller.updateCandidates([a, b]); result.controller.select("a"); result.controller.updateCandidates(candidates);
    assert.equal(result.controller.currentState.kind, kind); assert.equal(result.resets(), 1);
  }
});
test("losing the selected repository auto-selects the only remaining repository and notifies once", () => {
  const result = createController(); result.controller.updateCandidates([a, b]); result.controller.select("a"); result.controller.updateCandidates([b]);
  assert.equal(result.controller.selectedRootPath, "/b"); assert.equal(result.memory(), "b"); assert.equal(result.resets(), 1); assert.deepEqual(result.autoSelections, ["b"]);
  result.controller.updateCandidates([b]); assert.deepEqual(result.autoSelections, ["b"]);
});
test("selection changes notify observers and unavailable clears a selected repository", () => {
  const result = createController(); result.controller.updateCandidates([a]); result.controller.setUnavailable("Git unavailable");
  assert.equal(result.controller.currentState.kind, "unavailable"); assert.equal(result.resets(), 1); assert.deepEqual(result.changes, ["selected", "unavailable"]);
});
