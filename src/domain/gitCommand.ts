export type GitCommand =
  | { readonly kind: "add"; readonly target: { readonly kind: "repositoryRoot" } | { readonly kind: "paths"; readonly paths: readonly string[] } }
  | { readonly kind: "unstage"; readonly paths: readonly string[]; readonly syntax: "restoreStaged" | "resetHead" }
  | { readonly kind: "commit"; readonly message?: string }
  | { readonly kind: "switch"; readonly branchName: string; readonly create: boolean }
  | { readonly kind: "stashPush"; readonly includeUntracked: boolean; readonly message?: string }
  | { readonly kind: "stashList" }
  | { readonly kind: "stashApply"; readonly stashIndex?: number }
  | { readonly kind: "stashPop"; readonly stashIndex?: number }
  | { readonly kind: "fetch"; readonly remote?: string }
  | { readonly kind: "push"; readonly remote?: string; readonly branch?: string; readonly setUpstream: boolean }
  | { readonly kind: "pull"; readonly remote?: string; readonly branch?: string; readonly rebase: boolean }
  | { readonly kind: "merge"; readonly branch: string }
  | { readonly kind: "rebase"; readonly upstream: string };

export type GitCommandParseResult =
  | { readonly kind: "parsed"; readonly command: GitCommand }
  | { readonly kind: "parseFailure"; readonly reason: string }
  | { readonly kind: "unsupportedCommand"; readonly commandName: string }
  | { readonly kind: "unsupportedOption"; readonly commandName: string; readonly option: string }
  | { readonly kind: "highRisk"; readonly commandName: string; readonly reason: string };
