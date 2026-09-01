import type { CommitDetail, CommitDetailState } from "../domain/commitDetail";
import type { SelectionState } from "../domain/appViewState";
import type { AvailabilityResult } from "../domain/repositoryState";
import type { RepositoryStateSnapshot } from "./repositoryStateSnapshot";

export interface CommitDetailControllerDependencies {
  readonly read: (repositoryPath: string, commitId: string) => Promise<AvailabilityResult<CommitDetail>>;
}

interface Target { readonly repositoryId: string; readonly rootPath: string; readonly commitId: string; }

export class CommitDetailController {
  private readonly cache = new Map<string, CommitDetail>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(state: CommitDetailState) => void>();
  private state: CommitDetailState = { kind: "idle" };
  private target: Target | undefined;
  private panelOpen = false;

  constructor(private readonly dependencies: CommitDetailControllerDependencies) {}

  get current(): CommitDetailState { return this.state; }
  onDidChange(listener: (state: CommitDetailState) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  setPanelOpen(open: boolean, snapshot: RepositoryStateSnapshot, selection: SelectionState): void {
    this.panelOpen = open;
    this.sync(snapshot, selection);
  }

  sync(snapshot: RepositoryStateSnapshot, selection: SelectionState): void {
    const target = this.panelOpen ? targetFor(snapshot, selection) : undefined;
    if (!target) { this.target = undefined; this.set({ kind: "idle" }); return; }
    if (sameTarget(target, this.target)) return;
    this.target = target;
    const key = cacheKey(target);
    const cached = this.cache.get(key);
    if (cached) { this.set({ kind: "available", ...target, detail: cached }); return; }
    this.set({ kind: "loading", ...target });
    const running = this.inFlight.get(key) ?? this.load(target, key);
    this.inFlight.set(key, running);
  }

  private async load(target: Target, key: string): Promise<void> {
    const result = await this.dependencies.read(target.rootPath, target.commitId);
    this.inFlight.delete(key);
    if (result.kind === "available") this.cache.set(key, result.value);
    if (!sameTarget(target, this.target)) return;
    this.set(result.kind === "available" ? { kind: "available", ...target, detail: result.value } : { kind: "unavailable", ...target });
  }

  private set(next: CommitDetailState): void {
    if (JSON.stringify(this.state) === JSON.stringify(next)) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

function targetFor(snapshot: RepositoryStateSnapshot, selection: SelectionState): Target | undefined {
  if (snapshot.kind !== "available" || selection.kind !== "commit") return undefined;
  if (!snapshot.state.history.some((entry) => entry.commit.id === selection.commitId)) return undefined;
  return { repositoryId: snapshot.repositoryId, rootPath: snapshot.state.repository.rootPath, commitId: selection.commitId };
}

function cacheKey(target: Target): string { return `${target.repositoryId}\0${target.rootPath}\0${target.commitId}`; }
function sameTarget(left: Target | undefined, right: Target | undefined): boolean { return left?.repositoryId === right?.repositoryId && left?.rootPath === right?.rootPath && left?.commitId === right?.commitId; }
