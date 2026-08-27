import type { RepositoryCandidate } from "./repositorySelection";
export interface DisposableLike { dispose(): void; }
export interface GitRepositoryStateLike { readonly onDidChange: (listener: () => void) => DisposableLike; }
export interface GitRepositoryLike { readonly rootUri: { toString(): string; fsPath: string }; readonly state: GitRepositoryStateLike; }
export interface GitApiLike { readonly repositories: readonly GitRepositoryLike[]; readonly state: string; readonly onDidOpenRepository: (listener: () => void) => DisposableLike; readonly onDidCloseRepository: (listener: () => void) => DisposableLike; readonly onDidChangeState: (listener: () => void) => DisposableLike; }
export class VscodeGitRepositorySource implements DisposableLike {
  private readonly subscriptions: DisposableLike[] = [];
  private readonly stateSubscriptions = new Map<string, DisposableLike>();
  constructor(private readonly getApi: () => Promise<GitApiLike>, private readonly onCandidates: (candidates: readonly RepositoryCandidate[]) => void, private readonly onUnavailable: (reason: string) => void, private readonly onRepositoryStateChange: (repositoryId: string) => void = () => undefined) {}
  async initialize(): Promise<void> {
    try {
      const api = await this.getApi();
      await new Promise<void>((resolve) => {
        let initialized = false;
        const refresh = () => { if (initialized) { this.onCandidates(toCandidates(api.repositories)); this.syncStateListeners(api.repositories); } };
        const markInitialized = () => {
          if (api.state !== "initialized" || initialized) return;
          initialized = true;
          refresh();
          resolve();
        };
        this.subscriptions.push(api.onDidOpenRepository(refresh), api.onDidCloseRepository(refresh), api.onDidChangeState(markInitialized));
        markInitialized();
      });
    } catch (error) { this.onUnavailable(error instanceof Error ? error.message : "VS Code Git API is unavailable"); }
  }
  dispose(): void { for (const subscription of this.subscriptions) subscription.dispose(); for (const subscription of this.stateSubscriptions.values()) subscription.dispose(); this.stateSubscriptions.clear(); }
  private syncStateListeners(repositories: readonly GitRepositoryLike[]): void {
    const ids = new Set(repositories.map((repository) => repository.rootUri.toString()));
    for (const [id, subscription] of this.stateSubscriptions) if (!ids.has(id)) { subscription.dispose(); this.stateSubscriptions.delete(id); }
    for (const repository of repositories) {
      const id = repository.rootUri.toString();
      if (!this.stateSubscriptions.has(id)) this.stateSubscriptions.set(id, repository.state.onDidChange(() => this.onRepositoryStateChange(id)));
    }
  }
}
export function toCandidates(repositories: readonly GitRepositoryLike[]): RepositoryCandidate[] {
  return [...new Map(repositories.map((repository) => { const id = repository.rootUri.toString(); return [id, { id, rootPath: repository.rootUri.fsPath }]; })).values()];
}
