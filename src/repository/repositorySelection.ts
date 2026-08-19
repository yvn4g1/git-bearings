export interface RepositoryCandidate {
  readonly id: string;
  readonly rootPath: string;
}
export type RepositorySelectionState =
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "noRepository" }
  | { readonly kind: "selectionRequired"; readonly candidates: readonly RepositoryCandidate[] }
  | { readonly kind: "selected"; readonly repository: RepositoryCandidate; readonly candidates: readonly RepositoryCandidate[] };

export interface RepositorySelectionDependencies {
  readonly rememberedId?: () => string | undefined;
  readonly remember?: (id: string) => void;
  readonly resetViewState?: () => void;
  readonly onDidChange?: (state: RepositorySelectionState) => void;
  readonly onDidAutoSelectAfterSelectionLost?: (repository: RepositoryCandidate) => void;
}

export class RepositorySelectionController {
  private state: RepositorySelectionState = { kind: "noRepository" };
  constructor(private readonly dependencies: RepositorySelectionDependencies = {}) {}
  get currentState(): RepositorySelectionState { return this.state; }
  get selectedRootPath(): string | undefined { return this.state.kind === "selected" ? this.state.repository.rootPath : undefined; }
  setUnavailable(reason: string): void { this.setState({ kind: "unavailable", reason }, this.state.kind === "selected"); }
  updateCandidates(candidates: readonly RepositoryCandidate[]): void {
    const unique = deduplicateCandidates(candidates);
    const current = this.state;
    const selected = current.kind === "selected" ? unique.find((candidate) => candidate.id === current.repository.id) : undefined;
    if (selected) {
      this.setState({ kind: "selected", repository: selected, candidates: unique }, false);
      return;
    }
    const selectionWasLost = current.kind === "selected";
    if (unique.length === 0) return this.setState({ kind: "noRepository" }, selectionWasLost);
    if (unique.length === 1) {
      this.applySelection(unique[0], unique, selectionWasLost);
      if (selectionWasLost) this.dependencies.onDidAutoSelectAfterSelectionLost?.(unique[0]);
      return;
    }
    const remembered = !selectionWasLost ? this.dependencies.rememberedId?.() : undefined;
    const restored = remembered ? unique.find((candidate) => candidate.id === remembered) : undefined;
    if (restored) return this.applySelection(restored, unique, false);
    this.setState({ kind: "selectionRequired", candidates: unique }, selectionWasLost);
  }
  select(id: string): boolean {
    const candidates = this.state.kind === "selected" || this.state.kind === "selectionRequired" ? this.state.candidates : [];
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) return false;
    this.applySelection(candidate, candidates, this.state.kind === "selected");
    return true;
  }
  private applySelection(repository: RepositoryCandidate, candidates: readonly RepositoryCandidate[], reset: boolean): void {
    const changed = this.state.kind !== "selected" || this.state.repository.id !== repository.id;
    if (changed) this.dependencies.remember?.(repository.id);
    this.setState({ kind: "selected", repository, candidates }, reset && changed);
  }
  private setState(state: RepositorySelectionState, reset: boolean): void {
    const previousId = this.state.kind === "selected" ? this.state.repository.id : undefined;
    const nextId = state.kind === "selected" ? state.repository.id : undefined;
    if (reset) this.dependencies.resetViewState?.();
    this.state = state;
    if (previousId !== nextId) this.dependencies.onDidChange?.(state);
  }
}

function deduplicateCandidates(candidates: readonly RepositoryCandidate[]): RepositoryCandidate[] {
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}
