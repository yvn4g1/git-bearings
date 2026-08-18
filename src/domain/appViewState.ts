export type SelectionState =
  | { readonly kind: "overview" }
  | { readonly kind: "head" }
  | { readonly kind: "branch"; readonly branchName: string }
  | { readonly kind: "commit"; readonly commitId: string }
  | { readonly kind: "branchComparison"; readonly baseRef: string }
  | { readonly kind: "workingTree"; readonly path: string }
  | { readonly kind: "staging"; readonly path: string }
  | { readonly kind: "upstream"; readonly remoteName: string; readonly branchName: string }
  | { readonly kind: "unpushedCommits"; readonly upstreamRef: string }
  | { readonly kind: "remote"; readonly remoteName: string }
  | { readonly kind: "stash"; readonly stashIndex: number };

export type DetailMode = "inspect" | "commandInput";

export type PreviewState<Payload = never> =
  | { readonly kind: "none" }
  | { readonly kind: "present"; readonly payload: Payload };

export interface AppViewState<PreviewPayload = never> {
  readonly selection: SelectionState;
  readonly detailMode: DetailMode;
  readonly preview: PreviewState<PreviewPayload>;
}
