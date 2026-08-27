import type { RepositoryState } from "../domain/repositoryState";
import type { RepositoryStateSnapshot } from "./repositoryStateSnapshot";

export interface OverviewFact { readonly label: string; readonly value?: string; }
export interface OverviewSection { readonly id: string; readonly title: string; readonly facts: readonly OverviewFact[]; readonly meaning?: string; readonly unavailableReason?: string; }
export interface OverviewPresentation { readonly status: "empty" | "loading" | "unavailable" | "available"; readonly repository?: string; readonly message?: string; readonly unavailableReason?: string; readonly operationBanner?: string; readonly sections: readonly OverviewSection[]; }

export function createOverviewPresentation(snapshot: RepositoryStateSnapshot): OverviewPresentation {
  if (snapshot.kind === "empty") return { status: "empty", message: "Git状態をまだ読み取っていません", sections: [] };
  if (snapshot.kind === "loading") return { status: "loading", repository: snapshot.rootPath, message: "Git状態を読み取り中…", sections: [] };
  if (snapshot.kind === "unavailable") return { status: "unavailable", repository: snapshot.rootPath, message: "Git状態を安全に取得できません", unavailableReason: snapshot.reason, sections: [] };
  const state = snapshot.state;
  return {
    status: "available", repository: state.repository.rootPath, operationBanner: operationBanner(state),
    sections: [currentSection(state), comparisonSection(state), workingTreeSection(state), upstreamSection(state)],
  };
}

function currentSection(state: RepositoryState): OverviewSection {
  const location = state.currentLocation;
  if (location.kind === "unborn") return { id: "current", title: "現在地", facts: [{ label: "branch", value: location.branchName }, { label: "HEAD", value: "まだcommitがありません" }], meaning: "このbranchにはまだ最初のcommitがありません。" };
  if (location.kind === "detached") return { id: "current", title: "現在地", facts: [{ label: "状態", value: "detached HEAD" }, { label: "HEAD", value: `${location.head.shortId} ${location.head.subject}` }], meaning: "branchではなく、このcommitを直接見ています。" };
  return { id: "current", title: "現在地", facts: [{ label: "branch", value: location.branchName }, { label: "HEAD", value: `${location.head.shortId} ${location.head.subject}` }], meaning: `現在は ${location.branchName} branch上にいます。` };
}

function comparisonSection(state: RepositoryState): OverviewSection {
  const comparison = state.comparison;
  if (comparison.kind === "notConfigured") return { id: "comparison", title: "基準branchとの関係", facts: [{ label: "状態", value: "基準branchがまだ設定されていません" }], meaning: "基準を選ぶと、今の位置との差を確認できます。" };
  if (comparison.kind === "unavailable") return unavailable("comparison", "基準branchとの関係", "基準branchとの関係を取得できません", "現在地など、取得できている他の情報はそのまま確認できます。", comparison.reason);
  const value = comparison.value;
  const base = displayBaseRef(state, value.baseRef);
  const exactBase = state.currentLocation.kind === "branch" && value.baseRef === `refs/heads/${state.currentLocation.branchName}`;
  let meaning: string;
  if (value.ahead > 0 && value.behind > 0) meaning = "あなたの現在地と基準branchが、それぞれ別方向に進んでいます。";
  else if (value.ahead > 0) meaning = "あなたの現在地だけが基準branchより先に進んでいます。";
  else if (value.behind > 0) meaning = "基準branch側に、あなたの現在地にはないcommitがあります。";
  else meaning = exactBase ? "現在、基準branch上です。" : "現在は基準branchと同じcommitを指しています。";
  if (value.mergeBase === null) meaning += " 共通祖先を確認できない別の履歴として比較しています。";
  return { id: "comparison", title: "基準branchとの関係", facts: [{ label: "基準", value: base }, { label: "あなた側のみ", value: String(value.ahead) }, { label: `${base}側のみ`, value: String(value.behind) }], meaning };
}

function workingTreeSection(state: RepositoryState): OverviewSection {
  const tree = state.workingTree;
  let meaning: string;
  if (tree.conflicts.length) meaning = "競合が残っています。";
  else if (!tree.staged.length && !tree.unstaged.length && !tree.untracked.length) meaning = "commitしていない変更はありません。";
  else if (tree.staged.length && (tree.unstaged.length || tree.untracked.length)) meaning = "commit対象と、まだaddしていない変更の両方があります。";
  else if (tree.staged.length) meaning = "次のcommitに入る変更があります。";
  else if (tree.untracked.length && !tree.unstaged.length) meaning = "未追跡fileがあります。";
  else meaning = "まだaddしていない変更があります。";
  return { id: "working", title: "作業中", facts: [{ label: "Staged", value: String(tree.staged.length) }, { label: "Unstaged", value: String(tree.unstaged.length) }, { label: "Untracked", value: String(tree.untracked.length) }, { label: "Conflicts", value: String(tree.conflicts.length) }], meaning };
}

function upstreamSection(state: RepositoryState): OverviewSection {
  const upstream = state.upstream;
  if (upstream.kind === "notConfigured") return { id: "upstream", title: "追跡関係 / Remote", facts: [{ label: "upstream", value: "設定されていません" }], meaning: "Remote追跡設定がない状態です。" };
  if (upstream.kind === "unavailable") return unavailable("upstream", "追跡関係 / Remote", "upstream情報を取得できません", undefined, upstream.reason);
  const value = upstream.value;
  const target = value.remoteName === "." ? `ローカルupstream: ${value.branchName}` : `upstream: ${value.remoteName}/${value.branchName}`;
  if (value.relation.kind === "unavailable") return unavailable(
    "upstream",
    "追跡関係 / Remote",
    target,
    value.remoteName === "." ? "ローカルupstreamとの差分を取得できません。" : "最後に取得したRemote情報との差分を取得できません。",
    value.relation.reason,
  );
  const relation = value.relation.value;
  let meaning: string;
  if (value.remoteName === ".") meaning = relation.ahead || relation.behind ? "ローカルupstreamとの差分があります。" : "ローカルupstreamとの差分はありません。";
  else if (!relation.ahead && !relation.behind) meaning = "最後に取得したRemote情報との差分はありません。";
  else if (relation.ahead && !relation.behind) meaning = `最後に取得したRemote情報と比べると、あなた側にだけ${relation.ahead}commitあります。`;
  else if (!relation.ahead && relation.behind) meaning = `最後に取得したRemote情報と比べると、upstream側にだけ${relation.behind}commitあります。`;
  else meaning = "最後に取得したRemote情報と比べると、両側に異なるcommitがあります。";
  return { id: "upstream", title: "追跡関係 / Remote", facts: [{ label: "追跡", value: target }, { label: "あなた側のみ", value: String(relation.ahead) }, { label: "upstream側のみ", value: String(relation.behind) }], meaning };
}

function operationBanner(state: RepositoryState): string | undefined {
  if (state.operation.kind === "merge") return "merge処理中";
  if (state.operation.kind === "rebase") return "rebase処理中";
  if (state.operation.kind === "unsupported") return `${state.operation.operationName}: Git処理の途中です`;
  return undefined;
}

function unavailable(id: string, title: string, fact: string, meaning?: string, unavailableReason?: string): OverviewSection { return { id, title, facts: [{ label: "状態", value: fact }], meaning, unavailableReason }; }
function displayBaseRef(state: RepositoryState, baseRef: string): string {
  const local = /^refs\/heads\/(.+)$/.exec(baseRef);
  if (local && state.localBranches.some((branch) => branch.name === local[1])) return local[1];
  if (state.remotes.kind === "available") { const matches = state.remotes.value.flatMap((remote) => remote.trackingRefs.filter((ref) => ref.trackingRef === baseRef).map((ref) => `${remote.name}/${ref.branchName}`)); if (matches.length === 1) return matches[0]; }
  return baseRef;
}
