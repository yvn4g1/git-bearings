import type { RepositoryState } from "../domain/repositoryState";

export type RepositoryStateFailure =
  | { readonly kind: "coreReadFailure" }
  | { readonly kind: "unsupportedGitVersion"; readonly version: string };

export type RepositoryStateSnapshot =
  | { readonly kind: "empty"; readonly reason?: "initial" | "noRepository" }
  | { readonly kind: "loading"; readonly repositoryId: string; readonly rootPath: string }
  | { readonly kind: "available"; readonly repositoryId: string; readonly state: RepositoryState }
  | { readonly kind: "unavailable"; readonly repositoryId: string; readonly rootPath: string; readonly reason: string; readonly failure?: RepositoryStateFailure };

export class RepositoryStateSnapshotStore {
  private snapshot: RepositoryStateSnapshot = { kind: "empty" };
  private readonly listeners = new Set<(snapshot: RepositoryStateSnapshot) => void>();

  get current(): RepositoryStateSnapshot { return this.snapshot; }

  set(snapshot: RepositoryStateSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  clear(reason: "initial" | "noRepository" = "initial"): void { this.set({ kind: "empty", reason }); }

  onDidChange(listener: (snapshot: RepositoryStateSnapshot) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}

export function matchesSnapshotTarget(
  current: { readonly id: string; readonly rootPath: string } | undefined,
  repositoryId: string,
  rootPath: string,
): boolean {
  return current?.id === repositoryId && current.rootPath === rootPath;
}
