import type { AppViewState } from "./appViewState";

export class AppViewStateStore<PreviewPayload = never> {
  private state: AppViewState<PreviewPayload> = {
    selection: { kind: "overview" },
    detailMode: "inspect",
    preview: null,
  };

  get current(): AppViewState<PreviewPayload> { return this.state; }
  set(next: AppViewState<PreviewPayload>): void { this.state = next; }
  resetForRepositoryChange(): void {
    this.state = { selection: { kind: "overview" }, detailMode: "inspect", preview: null };
  }
}
