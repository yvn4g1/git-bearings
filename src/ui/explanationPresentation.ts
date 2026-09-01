import type { SelectionState } from "../domain/appViewState";
import type { CommitRef, RepositoryState } from "../domain/repositoryState";

/** Detail text derived solely from the selected, currently available Git facts. */
export interface ExplanationPresentation {
  readonly identity: string;
  readonly level1: string;
  readonly level2: string;
}

export function createExplanationPresentation(state: RepositoryState, selection: SelectionState): ExplanationPresentation | undefined {
  switch (selection.kind) {
    case "overview": return undefined;
    case "head": return head(state);
    case "branch": return branch(state, selection.branchName);
    case "commit": return commit(state, selection.commitId);
    case "workingTree": return workingTree(state, selection.section);
    case "staging": return staging(state);
    case "remote": return remote(state, selection.remoteName);
    case "upstream": return upstream(state, selection.remoteName, selection.branchName);
    case "branchComparison": return comparison(state, selection.baseRef);
    case "stashShelf": return stashShelf(state);
    case "stash": return stash(state, selection.stashCommitId);
    case "unpushedCommits": return unpushedCommits(state, selection.upstreamRef);
  }
}

function head(state: RepositoryState): ExplanationPresentation {
  const location = state.currentLocation;
  if (location.kind === "unborn") return explanation("HEAD", `HEADは ${location.branchName} branchを指していますが、このbranchにはまだ最初のcommitがありません。`, "HEADは「今どこを見ているか」を表すrefです。通常は HEAD → branch → commit の順で参照します。まだcommitがないbranchでは、指すcommitはありません。");
  if (location.kind === "detached") return explanation("HEAD", `HEADはbranchを経由せず、commit ${commitLabel(location.head)} を直接見ています。`, "HEADは「今どこを見ているか」を表すrefです。detached HEADでは HEAD → commit となり、HEADとbranchは同じものではありません。");
  return explanation("HEAD", `HEADは現在 ${location.branchName} branchを指しており、そのbranchの先端commitは ${commitLabel(location.head)} です。`, "HEADは「今どこを見ているか」を表すrefです。通常は HEAD → branch → commit の順で参照し、HEADとbranchは別のrefです。");
}

function branch(state: RepositoryState, branchName: string): ExplanationPresentation {
  if (state.currentLocation.kind === "unborn" && state.currentLocation.branchName === branchName) {
    return explanation(`branch ${branchName}`, `${branchName} は現在のbranchで、まだ最初のcommitがありません。`, "branchは履歴線そのものではなく、特定commitを指す可動のpointer（ref）です。commitが増えると、そのbranchが指す先が進みます。");
  }
  const branch = state.localBranches.find((item) => item.name === branchName);
  const current = state.currentLocation.kind === "branch" && state.currentLocation.branchName === branchName;
  const tip = branch ? state.history.find((entry) => entry.commit.id === branch.tipCommitId)?.commit : undefined;
  const fact = branch ? `${branchName} branch${current ? "は現在のbranchで、" : "は"}先端は${tip ? `commit ${commitLabel(tip)}` : `commit ${shortId(branch.tipCommitId)}です。詳細は現在取得済みの履歴範囲では表示できません。`}` : `${branchName} branchの現在の先端は確認できません。`;
  return explanation(`branch ${branchName}`, fact, "branchは履歴線そのものではなく、特定commitを指す可動のpointer（ref）です。commitが増えると、そのbranchが指す先が進みます。");
}

function commit(state: RepositoryState, commitId: string): ExplanationPresentation {
  const entry = state.history.find((item) => item.commit.id === commitId);
  if (!entry) return explanation(`commit ${shortId(commitId)}`, "このcommitは現在取得済みの履歴にはありません。", "commitはRepositoryの履歴上の記録点です。commit同士のparent relationによって履歴が形成されます。");
  return explanation(`commit ${entry.commit.shortId}`, `現在取得済みの履歴では、commit ${entry.commit.shortId} は「${entry.commit.subject}」です。`, "commitはRepositoryの履歴上の記録点です。commit同士のparent relationによって履歴が形成されます。");
}

function workingTree(state: RepositoryState, section: "overview" | "unstaged" | "untracked" | "conflicts"): ExplanationPresentation {
  const tree = state.workingTree;
  const count = section === "unstaged" ? tree.unstaged.length : section === "untracked" ? tree.untracked.length : section === "conflicts" ? tree.conflicts.length : undefined;
  const label = section === "overview" ? "Working Tree" : `Working Tree / ${section}`;
  const level1 = section === "unstaged" ? `まだStagingへ内容を記録していない変更が ${count} 件あります。` : section === "untracked" ? `Gitがまだ追跡していないfileが ${count} 件あります。` : section === "conflicts" ? `解決が必要な競合が ${count} 件あります。` : tree.unstaged.length || tree.untracked.length || tree.conflicts.length ? `Working Treeには、Unstaged ${tree.unstaged.length}件、Untracked ${tree.untracked.length}件、Conflicts ${tree.conflicts.length}件があります。` : tree.staged.length ? "Working Tree側にStagingへ未反映の変更はありません。" : "Working Treeにcommitしていない変更はありません。";
  return explanation(label, level1, "Working Treeは、実際に編集している作業内容がある状態です。Stagingとは別の状態で、git addでfile自体が物理的に移動するわけではありません。");
}

function staging(state: RepositoryState): ExplanationPresentation {
  const count = state.workingTree.staged.length;
  return explanation("Staging", count ? `次のcommitに含める内容として、${count} 件の変更がStagingに記録されています。` : "次のcommitに含める変更は、現在Stagingに記録されていません。", "Stagingは次のcommitに含める内容を組み立てる状態です。Working Tree → 内容を反映 → Staging → commit → Commit と進み、file自体を物理的に移動するものではありません。");
}

function remote(state: RepositoryState, remoteName: string): ExplanationPresentation {
  if (state.remotes.kind === "notConfigured") return explanation(`Remote ${remoteName}`, "Remoteは現在設定されていません。", remoteConcept());
  if (state.remotes.kind === "unavailable") return explanation(`Remote ${remoteName}`, "Remote情報は現在取得できません。", remoteConcept());
  const value = state.remotes.value.find((remote) => remote.name === remoteName);
  if (!value) return explanation(`Remote ${remoteName}`, `${remoteName} Remoteは現在の設定から確認できません。`, remoteConcept());
  return explanation(`Remote ${remoteName}`, `${remoteName}にはローカルに保持された追跡refが ${value.trackingRefs.length} 件あります。ここで分かるのはローカルGitが最後に取得した情報であり、live Remoteの現在状態ではありません。`, remoteConcept());
}

function upstream(state: RepositoryState, remoteName: string, branchName: string): ExplanationPresentation {
  const identity = `upstream ${remoteName}/${branchName}`;
  if (state.upstream.kind === "notConfigured") return explanation(identity, "現在のbranchにはupstreamが設定されていません。", upstreamConcept());
  if (state.upstream.kind === "unavailable") return explanation(identity, "upstream情報は現在取得できません。", upstreamConcept());
  const value = state.upstream.value;
  if (value.remoteName !== remoteName || value.branchName !== branchName) return explanation(identity, "選択したupstreamは現在の設定から確認できません。", upstreamConcept());
  const target = value.remoteName === "." ? `ローカルbranch ${value.branchName}` : `${value.remoteName}/${value.branchName}`;
  const tracking = value.remoteName === "." ? "これはRemoteではないローカルupstreamです。" : `対応する ${value.trackingRef} はactual Remoteそのものではなく、ローカルに保持された追跡情報です。`;
  const relation = value.relation.kind === "available" ? ` あなた側のみ${value.relation.value.ahead}commit、upstream側のみ${value.relation.value.behind}commitです。` : " 差分は現在取得できません。";
  return explanation(identity, `現在のbranchは ${target} をupstreamとして追跡しています。${tracking}${relation}`, upstreamConcept());
}

function comparison(state: RepositoryState, baseRef: string): ExplanationPresentation {
  const identity = `comparison ${baseRef}`;
  if (state.comparison.kind === "notConfigured") return explanation(identity, "基準branchはまだ設定されていません。", comparisonConcept());
  if (state.comparison.kind === "unavailable") return explanation(identity, "基準branchとの関係は現在取得できません。", comparisonConcept());
  const value = state.comparison.value;
  if (value.baseRef !== baseRef) return explanation(identity, "選択した基準branchとの関係は現在確認できません。", comparisonConcept());
  const mergeBase = value.mergeBase ? `共通祖先は ${commitLabel(value.mergeBase)} です。` : "共通祖先は現在確認できません。";
  return explanation(identity, `${baseRef} と比較すると、あなた側のみ${value.ahead}commit、基準branch側のみ${value.behind}commitです。${mergeBase}`, comparisonConcept());
}

function stashShelf(state: RepositoryState): ExplanationPresentation {
  if (state.stash.kind === "unavailable") return explanation("Stash Shelf", "Stash情報は現在取得できません。", stashConcept());
  return explanation("Stash Shelf", `現在 ${state.stash.value.length} 件のstashが保存されています。`, stashConcept());
}

function stash(state: RepositoryState, stashCommitId: string): ExplanationPresentation {
  if (state.stash.kind === "unavailable") return explanation(`stash ${shortId(stashCommitId)}`, "Stash情報は現在取得できません。", stashConcept());
  const entry = state.stash.value.find((item) => item.commitId === stashCommitId);
  if (!entry) return explanation(`stash ${shortId(stashCommitId)}`, "選択したstashは現在確認できません。", stashConcept());
  return explanation(`stash ${shortId(entry.commitId)}`, `stash@{${entry.index}} は ${shortId(entry.commitId)} で、「${entry.message}」として保存されています。`, stashConcept());
}

function unpushedCommits(state: RepositoryState, upstreamRef: string): ExplanationPresentation {
  const upstream = state.upstream;
  const count = upstream.kind === "available" && upstream.value.trackingRef === upstreamRef && upstream.value.relation.kind === "available" ? upstream.value.relation.value.ahead : undefined;
  return explanation("local-only commits", count === undefined ? "upstreamとの差分は現在確認できません。" : `${upstreamRef} と比べて、ローカルにのみ ${count} commitあります。`, "これはupstreamとの比較でローカル側にだけあるcommitです。actual Remoteの現在状態は、ここからは分かりません。");
}

function explanation(identity: string, level1: string, level2: string): ExplanationPresentation { return { identity, level1, level2 }; }
function commitLabel(commit: CommitRef): string { return `${commit.shortId}（${commit.subject}）`; }
function shortId(id: string): string { return id.slice(0, 7); }
function remoteConcept(): string { return "local branch、remote-tracking ref、actual Remoteは別の概念です。origin/mainのようなremote-tracking refは、ローカルにある追跡情報であり、live Remote branchそのものではありません。Git Bearingsは自動fetchしません。"; }
function upstreamConcept(): string { return "upstreamはlocal branchが追跡対象として設定しているrefとの関係です。base branchとは別の概念で、local upstream（.）のようにRemoteではない設定もあります。"; }
function comparisonConcept(): string { return "branch comparisonはbase branchとの位置関係を確認するものです。merge-baseは今回比較している履歴の共通祖先であり、branch作成地点とは限りません。upstreamとは別の概念です。"; }
function stashConcept(): string { return "stashは作業中の変更を一時的に退避し、後で再適用できるGit機能です。Stash ShelfはGit Bearingsが理解しやすさのために使うUI上の比喩で、Git内部にShelfという領域があるわけではありません。"; }
