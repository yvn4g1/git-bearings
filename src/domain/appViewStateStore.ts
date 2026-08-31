import { EventEmitter } from "node:events";
import type { AppViewState, SelectionState } from "./appViewState";

export class AppViewStateStore<PreviewPayload = never> {
  private readonly changed = new EventEmitter();
  private state: AppViewState<PreviewPayload> = {
    selection: { kind: "overview" },
    detailMode: "inspect",
    preview: null,
  };

  get current(): AppViewState<PreviewPayload> { return this.state; }
  onDidChange(listener: (state: AppViewState<PreviewPayload>) => void): { dispose(): void } { this.changed.on("change", listener); return { dispose: () => this.changed.off("change", listener) }; }
  set(next: AppViewState<PreviewPayload>): void { if (sameState(this.state, next)) return; this.state = next; this.changed.emit("change", this.state); }
  select(selection: SelectionState): void { if (sameSelection(this.state.selection, selection)) return; this.set({ ...this.state, selection }); }
  resetForRepositoryChange(): void {
    this.set({ selection: { kind: "overview" }, detailMode: "inspect", preview: null });
  }
}

function sameState<PreviewPayload>(left: AppViewState<PreviewPayload>, right: AppViewState<PreviewPayload>): boolean { return sameSelection(left.selection, right.selection) && left.detailMode === right.detailMode && left.preview === right.preview; }
function sameSelection(left: SelectionState, right: SelectionState): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "overview": case "head": case "staging": case "stashShelf": return true;
    case "branch": return left.branchName === (right as typeof left).branchName;
    case "commit": return left.commitId === (right as typeof left).commitId;
    case "branchComparison": return left.baseRef === (right as typeof left).baseRef;
    case "workingTree": return left.section === (right as typeof left).section;
    case "upstream": return left.remoteName === (right as typeof left).remoteName && left.branchName === (right as typeof left).branchName;
    case "unpushedCommits": return left.upstreamRef === (right as typeof left).upstreamRef;
    case "remote": return left.remoteName === (right as typeof left).remoteName;
    case "stash": return left.stashCommitId === (right as typeof left).stashCommitId;
  }
}
