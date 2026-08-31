import type { AheadBehind, AvailabilityResult, FileChange, RepositoryState } from "../domain/repositoryState";
import type { SelectionState } from "../domain/appViewState";
import type { RepositoryStateSnapshot } from "./repositoryStateSnapshot";

export type SidebarCollapsible = "none" | "collapsed" | "expanded";

export interface SidebarCommand {
  readonly command: string;
  readonly title: string;
  readonly arguments?: any[];
}

export interface SidebarNode {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly collapsible: SidebarCollapsible;
  readonly children?: readonly SidebarNode[];
  readonly command?: SidebarCommand;
  readonly selection?: SelectionState;
}

export function createSidebarPresentation(snapshot: RepositoryStateSnapshot): readonly SidebarNode[] {
  switch (snapshot.kind) {
    case "empty": return [leaf("empty", "Git状態をまだ読み取っていません")];
    case "loading": return [repositoryNode(snapshot.rootPath), leaf("loading", "Git状態を読み取り中…")];
    case "unavailable": return [repositoryNode(snapshot.rootPath), leaf("unavailable", "Git状態を安全に取得できません", undefined, snapshot.reason)];
    case "available": return availablePresentation(snapshot.state);
  }
}

function availablePresentation(state: RepositoryState): readonly SidebarNode[] {
  const nodes = [
    repositoryNode(state.repository.rootPath),
    currentLocationNode(state),
    comparisonNode(state),
    workingTreeNode(state),
    upstreamNode(state),
  ];
  const stash = stashNode(state);
  if (stash) nodes.push(stash);
  return nodes;
}

function repositoryNode(rootPath: string): SidebarNode {
  return selectable("repository", basename(rootPath), { kind: "overview" }, rootPath, rootPath);
}

function currentLocationNode(state: RepositoryState): SidebarNode {
  const location = state.currentLocation;
  if (location.kind === "unborn") {
    return group("current", "あなたは今ここ", "Current location", [
      selectable("current:branch", location.branchName, { kind: "branch", branchName: location.branchName }),
      selectable("current:unborn", "まだcommitがありません", { kind: "head" }),
    ]);
  }
  const head = location.head;
  if (location.kind === "detached") {
    return group("current", "あなたは今ここ", "Current location", [
      selectable("current:detached", "detached HEAD", { kind: "head" }, head.shortId, `${head.shortId} ${head.subject}`),
      selectable("current:subject", head.subject, { kind: "commit", commitId: head.id }),
    ]);
  }
  return group("current", "あなたは今ここ", "Current location", [
    selectable("current:head", "HEAD", { kind: "head" }, location.branchName),
    selectable("current:branch", location.branchName, { kind: "branch", branchName: location.branchName }, `HEAD ${head.shortId}`, `${head.shortId} ${head.subject}`),
    selectable("current:subject", head.subject, { kind: "commit", commitId: head.id }),
  ]);
}

function comparisonNode(state: RepositoryState): SidebarNode {
  const comparison = state.comparison;
  if (comparison.kind === "notConfigured") {
    return group("comparison", "基準branchとの関係", "Comparison", [
      { ...leaf("comparison:not-configured", "基準branchがまだ設定されていません"), command: { command: "gitBearings.selectBaseBranch", title: "Git Bearings: 基準branchを選択" } },
    ]);
  }
  if (comparison.kind === "unavailable") {
    return group("comparison", "基準branchとの関係", "Comparison", [
      leaf("comparison:unavailable", "基準branchとの関係を取得できません", undefined, comparison.reason),
    ]);
  }
  const value = comparison.value;
  const base = displayBaseRef(state, value.baseRef);
  const exactBase = state.currentLocation.kind === "branch" && value.baseRef === `refs/heads/${state.currentLocation.branchName}`;
  const children = exactBase
    ? [leaf("comparison:exact-base", "現在、基準branch上です", base)]
    : [
      selectable("comparison:ahead", `あなた側のみ ${value.ahead} commits`, { kind: "branchComparison", baseRef: value.baseRef }),
      leaf("comparison:behind", `${base}側のみ ${value.behind} commits`),
    ];
  return group("comparison", "基準branchとの関係", "Comparison", [
    { ...group("comparison:relation", `${base}との関係`, undefined, children), selection: { kind: "branchComparison", baseRef: value.baseRef } },
  ]);
}

function workingTreeNode(state: RepositoryState): SidebarNode {
  const tree = state.workingTree;
  const groups: SidebarNode[] = [];
  if (tree.staged.length) groups.push({ ...fileGroup("working:staged", "次のcommitに入る変更", "Staged", tree.staged), selection: { kind: "staging" } });
  if (tree.unstaged.length) groups.push({ ...fileGroup("working:unstaged", "まだaddしていない変更", "Unstaged", tree.unstaged), selection: { kind: "workingTree", section: "unstaged" } });
  if (tree.untracked.length) groups.push({ ...group("working:untracked", "未追跡", `Untracked · ${tree.untracked.length}件`, tree.untracked.map((path, index) => leaf(`working:untracked:${index}`, path)), "collapsed"), selection: { kind: "workingTree", section: "untracked" } });
  if (tree.conflicts.length) groups.push({ ...group("working:conflicts", "競合", `Conflicts · ${tree.conflicts.length}件`, tree.conflicts.map((file, index) => leaf(`working:conflicts:${index}`, file.path, file.kind)), "collapsed"), selection: { kind: "workingTree", section: "conflicts" } });
  return { ...group("working", "作業中", groups.length ? "Working Tree" : "変更なし", groups.length ? groups : [leaf("working:clean", "変更なし")]), selection: { kind: "workingTree", section: "overview" } };
}

function upstreamNode(state: RepositoryState): SidebarNode {
  const upstream = state.upstream;
  if (upstream.kind === "notConfigured") return group("upstream", "追跡関係", "Upstream / Remote", [leaf("upstream:not-configured", "upstreamは設定されていません")]);
  if (upstream.kind === "unavailable") return group("upstream", "追跡関係", "Upstream / Remote", [leaf("upstream:unavailable", "upstream情報を取得できません", undefined, upstream.reason)]);
  const value = upstream.value;
  if (value.remoteName === ".") {
    return group("upstream", "追跡関係", "Upstream / Remote", [
      selectable("upstream:local", `ローカルupstream: ${value.branchName}`, { kind: "upstream", remoteName: value.remoteName, branchName: value.branchName }),
      relationNode(value.relation, value.trackingRef),
    ]);
  }
  const origin = state.remotes.kind === "available" ? state.remotes.value.find((remote) => remote.name === "origin") : undefined;
  return group("upstream", "追跡関係", "Upstream / Remote", [
    ...(origin ? [selectable("remote:origin", "Remote origin", { kind: "remote", remoteName: origin.name }, "最後に取得したRemote情報")] : []),
    selectable("upstream:remote", `upstream: ${value.remoteName}/${value.branchName}`, { kind: "upstream", remoteName: value.remoteName, branchName: value.branchName }, "最後に取得したRemote情報", "これはlive Remote状態ではなく、ローカルGitが最後に取得したRemote情報です。"),
    relationNode(value.relation, value.trackingRef),
  ]);
}

function relationNode(relation: AvailabilityResult<AheadBehind>, upstreamRef?: string): SidebarNode {
  if (relation.kind === "unavailable") return leaf("upstream:relation-unavailable", "差分を取得できません", undefined, relation.reason);
  return group("upstream:relation", "差分", undefined, [
    relation.value.ahead > 0 && upstreamRef ? selectable("upstream:ahead", `あなた側のみ ${relation.value.ahead} commits`, { kind: "unpushedCommits", upstreamRef }) : leaf("upstream:ahead", `あなた側のみ ${relation.value.ahead} commits`),
    leaf("upstream:behind", `upstream側のみ ${relation.value.behind} commits`),
  ]);
}

function stashNode(state: RepositoryState): SidebarNode | undefined {
  const stash = state.stash;
  if (stash.kind === "unavailable") return group("stash", "Stash", "取得できません", [leaf("stash:unavailable", "Stash情報を取得できません", undefined, stash.reason)]);
  if (stash.value.length === 0) return undefined;
  return { ...group("stash", "Stash", `${stash.value.length}件`, stash.value.map((entry) => selectable(`stash:${entry.index}`, `stash@{${entry.index}}`, { kind: "stash", stashCommitId: entry.commitId }, entry.message, entry.commitId)), "collapsed"), selection: { kind: "stashShelf" } };
}

function displayBaseRef(state: RepositoryState, baseRef: string): string {
  const local = /^refs\/heads\/(.+)$/.exec(baseRef);
  if (local && state.localBranches.some((branch) => branch.name === local[1])) return local[1];
  if (state.remotes.kind === "available") {
    const matches = state.remotes.value.flatMap((remote) => remote.trackingRefs.filter((ref) => ref.trackingRef === baseRef).map((ref) => `${remote.name}/${ref.branchName}`));
    if (matches.length === 1) return matches[0];
  }
  return baseRef;
}

function fileGroup(id: string, label: string, description: string, files: readonly FileChange[]): SidebarNode {
  return group(id, label, `${description} · ${files.length}件`, files.map((file, index) => leaf(`${id}:${index}`, formatFileChange(file), file.kind)), "collapsed");
}

function formatFileChange(file: FileChange): string {
  return "originalPath" in file ? `${file.originalPath} → ${file.path}` : file.path;
}

function group(id: string, label: string, description: string | undefined, children: readonly SidebarNode[], collapsible: SidebarCollapsible = "expanded"): SidebarNode {
  return { id, label, description, collapsible, children };
}

function leaf(id: string, label: string, description?: string, tooltip?: string): SidebarNode {
  return { id, label, description, tooltip, collapsible: "none" };
}

function selectable(id: string, label: string, selection: SelectionState, description?: string, tooltip?: string): SidebarNode {
  return { ...leaf(id, label, description, tooltip), selection };
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const name = normalized.split(/[\\/]/).pop();
  return name || path;
}
