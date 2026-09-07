import type { SelectionState } from "../domain/appViewState";

export type GitMapMessage = { readonly type: "select"; readonly selection: SelectionState } | { readonly type: "detailInspect" | "detailCommand" | "recalculate" | "clear" } | { readonly type: "analyze"; readonly input: string } | { readonly type: "selectHistory"; readonly index: number };

export function parseGitMapMessage(value: unknown): GitMapMessage | undefined {
  const selection = parseGitMapSelectionMessage(value); if (selection) return { type: "select", selection };
  if (!isRecord(value) || !isString(value.type)) return undefined;
  if ((value.type === "detailInspect" || value.type === "detailCommand" || value.type === "recalculate" || value.type === "clear") && hasOnly(value, ["type"])) return { type: value.type };
  if (value.type === "analyze" && isString(value.input) && value.input.length <= 4096 && hasOnly(value, ["type", "input"])) return { type: "analyze", input: value.input };
  if (value.type === "selectHistory" && typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0 && hasOnly(value, ["type", "index"])) return { type: "selectHistory", index: value.index };
  return undefined;
}

export function parseGitMapSelectionMessage(value: unknown): SelectionState | undefined {
  if (!isRecord(value) || value.type !== "select" || !isRecord(value.selection)) return undefined;
  const selection = value.selection;
  if (!hasOnly(value, ["type", "selection"])) return undefined;
  if ((selection.kind === "overview" || selection.kind === "head" || selection.kind === "staging" || selection.kind === "stashShelf") && hasOnly(selection, ["kind"])) return { kind: selection.kind };
  if (!isString(selection.kind)) return undefined;
  if (selection.kind === "branch" && isString(selection.branchName) && hasOnly(selection, ["kind", "branchName"])) return { kind: "branch", branchName: selection.branchName };
  if (selection.kind === "commit" && isString(selection.commitId) && hasOnly(selection, ["kind", "commitId"])) return { kind: "commit", commitId: selection.commitId };
  if (selection.kind === "branchComparison" && isString(selection.baseRef) && hasOnly(selection, ["kind", "baseRef"])) return { kind: "branchComparison", baseRef: selection.baseRef };
  if (selection.kind === "workingTree" && (selection.section === "overview" || selection.section === "unstaged" || selection.section === "untracked" || selection.section === "conflicts") && hasOnly(selection, ["kind", "section"])) return { kind: "workingTree", section: selection.section };
  if (selection.kind === "upstream" && isString(selection.remoteName) && isString(selection.branchName) && hasOnly(selection, ["kind", "remoteName", "branchName"])) return { kind: "upstream", remoteName: selection.remoteName, branchName: selection.branchName };
  if (selection.kind === "unpushedCommits" && isString(selection.upstreamRef) && hasOnly(selection, ["kind", "upstreamRef"])) return { kind: "unpushedCommits", upstreamRef: selection.upstreamRef };
  if (selection.kind === "remote" && isString(selection.remoteName) && hasOnly(selection, ["kind", "remoteName"])) return { kind: "remote", remoteName: selection.remoteName };
  if (selection.kind === "stash" && isString(selection.stashCommitId) && hasOnly(selection, ["kind", "stashCommitId"])) return { kind: "stash", stashCommitId: selection.stashCommitId };
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isString(value: unknown): value is string { return typeof value === "string"; }
function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
