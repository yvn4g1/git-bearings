import type { AvailabilityResult, RepositoryState } from "../domain/repositoryState";
import type { SavedBase } from "./baseResolver";
import type { RepositoryStateMetadata } from "./repositoryStateComposer";
import type { RepositoryCandidate } from "./repositorySelection";
import { RepositoryStateSnapshotStore, type RepositoryStateFailure } from "../ui/repositoryStateSnapshot";

export interface RefreshTimer { dispose(): void; }
export interface RefreshScheduler { schedule(delayMs: number, callback: () => void): RefreshTimer; }
export interface RepositoryStateRefreshControllerDependencies {
  readonly getSelectedRepository: () => RepositoryCandidate | undefined;
  readonly getSavedBase: (repositoryId: string) => SavedBase | undefined;
  readonly read: (repositoryPath: string, savedBase: SavedBase | undefined, metadata: RepositoryStateMetadata) => Promise<AvailabilityResult<RepositoryState>>;
  readonly snapshotStore: RepositoryStateSnapshotStore;
  readonly getFailure?: () => RepositoryStateFailure;
  readonly onUnavailable?: (reason: string) => void;
  readonly now?: () => Date;
  readonly scheduler?: RefreshScheduler;
}

export class RepositoryStateRefreshController {
  private generation = 0;
  private version = 0;
  private timer: RefreshTimer | undefined;
  private active: ActiveRefresh | undefined;
  private readonly now: () => Date;
  private readonly scheduler: RefreshScheduler;

  constructor(private readonly dependencies: RepositoryStateRefreshControllerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.scheduler = dependencies.scheduler ?? { schedule: (delayMs, callback) => {
      const timer = setTimeout(callback, delayMs);
      return { dispose: () => clearTimeout(timer) };
    } };
  }

  onSelectionChanged(): void {
    this.generation += 1;
    this.cancelTimer();
    const selected = this.dependencies.getSelectedRepository();
    if (!selected) { this.dependencies.snapshotStore.clear(); return; }
    this.dependencies.snapshotStore.set({ kind: "loading", repositoryId: selected.id, rootPath: selected.rootPath });
    void this.startRefresh(this.generation);
  }

  requestAutoRefresh(repositoryId: string): void {
    const selected = this.dependencies.getSelectedRepository();
    if (!selected || selected.id !== repositoryId) return;
    if (this.active?.generation === this.generation) { this.active.pending = true; return; }
    this.cancelTimer();
    const generation = this.generation;
    this.timer = this.scheduler.schedule(300, () => { this.timer = undefined; void this.startRefresh(generation); });
  }

  async refreshNow(): Promise<AvailabilityResult<RepositoryState> | undefined> {
    const selected = this.dependencies.getSelectedRepository();
    if (!selected) return undefined;
    this.cancelTimer();
    const active = this.active;
    if (active?.generation === this.generation) {
      active.pending = true;
      return new Promise((resolve) => active.waiters.push(resolve));
    }
    return this.startRefresh(this.generation);
  }

  dispose(): void { this.generation += 1; this.cancelTimer(); this.active?.waiters.forEach((resolve) => resolve(undefined)); this.active = undefined; }

  private async startRefresh(generation: number, waiters: RefreshWaiter[] = []): Promise<AvailabilityResult<RepositoryState> | undefined> {
    if (generation !== this.generation || this.active?.generation === generation) return undefined;
    const selected = this.dependencies.getSelectedRepository();
    if (!selected) return undefined;
    const target = { id: selected.id, rootPath: selected.rootPath };
    const active: ActiveRefresh = { generation, pending: false, waiters };
    this.active = active;
    const result = await this.dependencies.read(target.rootPath, this.dependencies.getSavedBase(target.id), { stateVersion: this.version + 1, refreshedAt: this.now() });
    const current = this.dependencies.getSelectedRepository();
    const currentRequest = this.generation === generation && current?.id === target.id && current.rootPath === target.rootPath;
    if (currentRequest) {
      if (result.kind === "available") {
        this.version += 1;
        this.dependencies.snapshotStore.set({ kind: "available", repositoryId: target.id, state: result.value });
      } else {
        const failure = this.dependencies.getFailure?.() ?? { kind: "coreReadFailure" as const };
        this.dependencies.snapshotStore.set({ kind: "unavailable", repositoryId: target.id, rootPath: target.rootPath, reason: result.reason, failure });
        this.dependencies.onUnavailable?.(result.reason);
      }
    }
    if (this.active === active) this.active = undefined;
    if (currentRequest && active.pending) void this.startRefresh(generation, active.waiters);
    else active.waiters.forEach((resolve) => resolve(currentRequest ? result : undefined));
    return currentRequest ? result : undefined;
  }

  private cancelTimer(): void { this.timer?.dispose(); this.timer = undefined; }
}

type RefreshWaiter = (result: AvailabilityResult<RepositoryState> | undefined) => void;
interface ActiveRefresh { readonly generation: number; pending: boolean; readonly waiters: RefreshWaiter[]; }
