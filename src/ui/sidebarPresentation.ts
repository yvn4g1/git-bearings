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

export const WORKING_TREE_PATH_LIMIT = 1_000;

export function createSidebarPresentation(snapshot: RepositoryStateSnapshot): readonly SidebarNode[] {
  switch (snapshot.kind) {
    case "empty":
      return snapshot.reason === "noRepository"
        ? [
          leaf("empty:no-repository", "このworkspaceではGit Repositoryが見つかっていません"),
          leaf("empty:no-repository-help", "Git Bearingsは既存Repositoryの状態を読み取るツールです。"),
        ]
        : [leaf("empty", "Git状態をまだ読み取っていません")];
    case "loading": return [repositoryNode(snapshot.rootPath), leaf("loading", "Git状態を読み取り中…")];
    case "unavailable": {
      const repository = {
        ...repositoryNode(snapshot.rootPath),
        description: "Git Bearings Outputを開く",
        tooltip: `${snapshot.rootPath}\nGit Bearings Outputを開く`,
        command: { command: "gitBearings.showOutput", title: "Git Bearings: Outputを開く" },
      };
      const summary = snapshot.failure?.kind === "unsupportedGitVersion"
        ? leaf("unavailable", "Git BearingsはGit 2.23以降を必要とします", `現在: Git ${snapshot.failure.version} · 再読み込み`, snapshot.reason)
        : leaf("unavailable", "Git状態を安全に取得できません", "再読み込み", snapshot.reason);
      return [
        repository,
        { ...summary, command: { command: "gitBearings.refresh", title: "Git Bearings: Git状態を再読み込み" } },
      ];
    }
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
  let remaining = WORKING_TREE_PATH_LIMIT;
  if (tree.staged.length) {
    const result = fileGroup("working:staged", "次のcommitに入る変更", "Staged", tree.staged, remaining);
    remaining -= result.displayedCount;
    groups.push({ ...result.node, selection: { kind: "staging" } });
  }
  if (tree.unstaged.length) {
    const result = fileGroup("working:unstaged", "まだaddしていない変更", "Unstaged", tree.unstaged, remaining);
    remaining -= result.displayedCount;
    groups.push({ ...result.node, selection: { kind: "workingTree", section: "unstaged" } });
  }
  if (tree.untracked.length) {
    const result = pathGroup("working:untracked", "未追跡", "Untracked", tree.untracked, remaining);
    remaining -= result.displayedCount;
    groups.push({ ...result.node, selection: { kind: "workingTree", section: "untracked" } });
  }
  if (tree.conflicts.length) {
    const result = conflictGroup(tree.conflicts, remaining);
    groups.push({ ...result.node, selection: { kind: "workingTree", section: "conflicts" } });
  }
  return { ...group("working", "作業中", groups.length ? "Working Tree" : "変更なし", groups.length ? groups : [leaf("working:clean", "変更なし")]), selection: { kind: "workingTree", section: "overview" } };
}

function upstreamNode(state: RepositoryState): SidebarNode {
  const upstream = state.upstream;
  const origin = state.remotes.kind === "available" ? state.remotes.value.find((remote) => remote.name === "origin") : undefined;
  const remote = origin ? [selectable("remote:origin", "Remote origin", { kind: "remote", remoteName: origin.name }, "最後に取得したRemote情報")] : [];
  if (upstream.kind === "notConfigured") return group("upstream", "追跡関係", "Upstream / Remote", [...remote, leaf("upstream:not-configured", "upstreamは設定されていません")]);
  if (upstream.kind === "unavailable") return group("upstream", "追跡関係", "Upstream / Remote", [...remote, leaf("upstream:unavailable", "upstream情報を取得できません", undefined, upstream.reason)]);
  const value = upstream.value;
  if (value.remoteName === ".") {
    return group("upstream", "追跡関係", "Upstream / Remote", [
      ...remote,
      selectable("upstream:local", `ローカルupstream: ${value.branchName}`, { kind: "upstream", remoteName: value.remoteName, branchName: value.branchName }),
      relationNode(value.relation, value.trackingRef),
    ]);
  }
  return group("upstream", "追跡関係", "Upstream / Remote", [
    ...remote,
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

function fileGroup(id: string, label: string, description: string, files: readonly FileChange[], limit: number): { readonly node: SidebarNode; readonly displayedCount: number } {
  const displayed = files.slice(0, limit);
  return limitedGroup(id, label, description, files.length, displayed.map((file, index) => leaf(`${id}:${index}`, formatFileChange(file), file.kind)));
}

function pathGroup(id: string, label: string, description: string, paths: readonly string[], limit: number): { readonly node: SidebarNode; readonly displayedCount: number } {
  const displayed = paths.slice(0, limit);
  return limitedGroup(id, label, description, paths.length, displayed.map((path, index) => leaf(`${id}:${index}`, path)));
}

function conflictGroup(files: readonly { readonly path: string; readonly kind: string }[], limit: number): { readonly node: SidebarNode; readonly displayedCount: number } {
  const displayed = files.slice(0, limit);
  return limitedGroup("working:conflicts", "競合", "Conflicts", files.length, displayed.map((file, index) => leaf(`working:conflicts:${index}`, file.path, file.kind)));
}

function limitedGroup(id: string, label: string, description: string, total: number, children: readonly SidebarNode[]): { readonly node: SidebarNode; readonly displayedCount: number } {
  const omitted = total - children.length;
  return {
    node: group(id, label, `${description} · ${total}件`, omitted === 0 ? children : [...children, leaf(`${id}:omitted`, `残り ${omitted} 件は省略`)], "collapsed"),
    displayedCount: children.length,
  };
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
