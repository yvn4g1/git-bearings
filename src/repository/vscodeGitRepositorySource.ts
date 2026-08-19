import type { RepositoryCandidate } from "./repositorySelection";
export interface DisposableLike { dispose(): void; }
export interface GitRepositoryLike { readonly rootUri: { toString(): string; fsPath: string }; }
export interface GitApiLike { readonly repositories: readonly GitRepositoryLike[]; readonly state: string; readonly onDidOpenRepository: (listener: () => void) => DisposableLike; readonly onDidCloseRepository: (listener: () => void) => DisposableLike; readonly onDidChangeState: (listener: () => void) => DisposableLike; }
export class VscodeGitRepositorySource implements DisposableLike {
  private readonly subscriptions: DisposableLike[] = [];
  constructor(private readonly getApi: () => Promise<GitApiLike>, private readonly onCandidates: (candidates: readonly RepositoryCandidate[]) => void, private readonly onUnavailable: (reason: string) => void) {}
  async initialize(): Promise<void> {
    try {
      const api = await this.getApi(); const refresh = () => this.onCandidates(toCandidates(api.repositories)); const refreshWhenInitialized = () => { if (api.state === "initialized") refresh(); };
      this.subscriptions.push(api.onDidOpenRepository(refresh), api.onDidCloseRepository(refresh), api.onDidChangeState(refreshWhenInitialized)); refreshWhenInitialized();
    } catch (error) { this.onUnavailable(error instanceof Error ? error.message : "VS Code Git API is unavailable"); }
  }
  dispose(): void { for (const subscription of this.subscriptions) subscription.dispose(); }
}
export function toCandidates(repositories: readonly GitRepositoryLike[]): RepositoryCandidate[] {
  return [...new Map(repositories.map((repository) => { const id = repository.rootUri.toString(); return [id, { id, rootPath: repository.rootUri.fsPath }]; })).values()];
}
