export interface CommitDetail {
  readonly fullHash: string;
  readonly author: string;
  /** Git's ISO 8601 author timestamp; it is not converted for display. */
  readonly authoredAt: string;
  readonly parents: readonly string[];
  readonly changedFiles: readonly string[];
  readonly changedFileCount: number;
}

export type CommitDetailState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly repositoryId: string; readonly rootPath: string; readonly commitId: string }
  | { readonly kind: "available"; readonly repositoryId: string; readonly rootPath: string; readonly commitId: string; readonly detail: CommitDetail }
  | { readonly kind: "unavailable"; readonly repositoryId: string; readonly rootPath: string; readonly commitId: string };
