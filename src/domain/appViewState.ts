export type SelectionState =
  | { readonly kind: "overview" }
  | { readonly kind: "head" }
  | { readonly kind: "branch"; readonly branchName: string }
  | { readonly kind: "commit"; readonly commitId: string }
  | { readonly kind: "branchComparison"; readonly baseRef: string }
  | {
      readonly kind: "workingTree";
      readonly section: "overview" | "unstaged" | "untracked";
    }
  | { readonly kind: "staging" }
  | { readonly kind: "upstream"; readonly remoteName: string; readonly branchName: string }
  | { readonly kind: "unpushedCommits"; readonly upstreamRef: string }
  | { readonly kind: "remote"; readonly remoteName: string }
  | { readonly kind: "stash"; readonly stashCommitId: string };

export type DetailMode = "inspect" | "commandInput";

export interface AppViewState<PreviewPayload = never> {
  readonly selection: SelectionState;
  readonly detailMode: DetailMode;
  readonly preview: PreviewPayload | null;
}
