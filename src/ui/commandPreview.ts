import { parseGitCommand } from "../commands/gitCommandParser";
import type { GitCommandParseResult } from "../domain/gitCommand";
import type { RepositoryState } from "../domain/repositoryState";
import type { SimulationEvent, SimulationNote, SimulationResult } from "../domain/simulation";
import { simulateGitCommand } from "../simulation/commandSimulator";
import type { AppViewStateStore } from "../domain/appViewStateStore";

export const COMMAND_INPUT_MAX_LENGTH = 4096;
export interface CommandPreviewAnalysis { readonly rawInput: string; readonly repositoryRoot: string; readonly basedOnStateVersion: number; readonly parse: GitCommandParseResult; readonly simulation?: SimulationResult; }
export interface CommandPreviewSession { readonly active: CommandPreviewAnalysis | null; readonly history: readonly CommandPreviewAnalysis[]; }
export const emptyCommandPreviewSession = (): CommandPreviewSession => ({ active: null, history: [] });

export function analyzeCommand(state: RepositoryState, rawInput: string): CommandPreviewAnalysis {
  const parse = rawInput.length > COMMAND_INPUT_MAX_LENGTH ? { kind: "parseFailure" as const, reason: `入力は${COMMAND_INPUT_MAX_LENGTH}文字以内にしてください。` } : parseGitCommand(rawInput);
  return { rawInput, repositoryRoot: state.repository.rootPath, basedOnStateVersion: state.stateVersion, parse, ...(parse.kind === "parsed" ? { simulation: simulateGitCommand(state, parse.command) } : {}) };
}
export function addAnalysis(session: CommandPreviewSession, analysis: CommandPreviewAnalysis): CommandPreviewSession { return { active: analysis, history: [analysis, ...session.history].slice(0, 5) }; }
export function previewIsStale(analysis: CommandPreviewAnalysis, state: RepositoryState | undefined): boolean { return !state || analysis.repositoryRoot !== state.repository.rootPath || analysis.basedOnStateVersion !== state.stateVersion; }

export class CommandPreviewController {
  constructor(private readonly viewState: AppViewStateStore<CommandPreviewSession>) {}
  analyze(state: RepositoryState, rawInput: string): void { const session = this.viewState.current.preview ?? emptyCommandPreviewSession(); this.viewState.set({ ...this.viewState.current, preview: addAnalysis(session, analyzeCommand(state, rawInput)) }); }
  recalculate(state: RepositoryState): void { const active = this.viewState.current.preview?.active; if (active) this.analyze(state, active.rawInput); }
  clear(): void { const session = this.viewState.current.preview; if (session?.active) this.viewState.set({ ...this.viewState.current, preview: { ...session, active: null } }); }
  selectHistory(index: number): void { const session = this.viewState.current.preview; const selected = session?.history[index]; if (session && selected) this.viewState.set({ ...this.viewState.current, preview: { ...session, active: selected } }); }
}

export interface CommandPreviewPresentation { readonly active: CommandPreviewAnalysis | null; readonly stale: boolean; readonly banner: boolean; readonly status: "none" | "parseFailure" | "unsupportedCommand" | "unsupportedOption" | "highRisk" | "supported" | "blocked" | "unsupported"; readonly sections: readonly PreviewSection[]; readonly map: PreviewMapOverlay | null; readonly history: readonly { readonly label: string; readonly stale: boolean }[]; readonly examples: readonly string[]; }
export interface PreviewSection { readonly title: "一言で何する" | "今のあなたの場合" | "変わるもの" | "変わらないもの" | "Git Map Preview" | "注意・前提"; readonly lines: readonly string[]; }
export interface PreviewMapOverlay { readonly events: readonly string[]; readonly predictions: readonly { readonly label: string; readonly description: string }[]; readonly remoteSteps: readonly string[]; readonly unknown: readonly string[]; }

export function createCommandPreviewPresentation(session: CommandPreviewSession | null, state: RepositoryState | undefined): CommandPreviewPresentation {
  const active = session?.active ?? null; const stale = active ? previewIsStale(active, state) : false; const examples = state ? relatedExamples(state) : [];
  if (!active) return { active: null, stale: false, banner: false, status: "none", sections: [], map: null, history: session?.history.map((item) => ({ label: item.rawInput, stale: previewIsStale(item, state) })) ?? [], examples };
  const status = statusOf(active); const simulation = active.simulation;
  const sections: PreviewSection[] = [
    { title: "一言で何する", lines: [summary(active)] },
    { title: "今のあなたの場合", lines: [stale ? "このPreviewは変更前の状態を元にしています。" : situation(active)] },
    { title: "変わるもの", lines: simulation?.events.length ? simulation.events.map(eventText) : [status === "supported" ? "変化はありません。" : "Predictionは作成されていません。"] },
    { title: "変わらないもの", lines: unchanged(active) },
    { title: "Git Map Preview", lines: [stale ? "現在のFact Mapへは重ねません。" : mapText(active)] },
    { title: "注意・前提", lines: notices(active) },
  ];
  return { active, stale, banner: true, status, sections, map: stale || !simulation || simulation.kind !== "supported" ? null : overlay(simulation), history: session?.history.map((item) => ({ label: item.rawInput, stale: previewIsStale(item, state) })) ?? [], examples };
}

function statusOf(analysis: CommandPreviewAnalysis): CommandPreviewPresentation["status"] { if (analysis.parse.kind !== "parsed") return analysis.parse.kind; return analysis.simulation!.kind; }
function summary(analysis: CommandPreviewAnalysis): string { if (analysis.parse.kind === "parseFailure") return "入力を解析できません。"; if (analysis.parse.kind === "unsupportedCommand") return "このcommandはMVP対象外です。"; if (analysis.parse.kind === "unsupportedOption") return "このoptionはMVP対象外です。"; if (analysis.parse.kind === "highRisk") return "high risk commandを検出しました。"; const kind = analysis.parse.command.kind; return ({ add: "内容をStagingへ記録します。", unstage: "Stagingから外します。", commit: "Staging内容からcommitを作成します。", switch: "branchを切り替えます。", stashPush: "変更をStash Shelfへ退避します。", stashList: "Stash Shelfを確認します。", stashApply: "Stashを適用します。", stashPop: "Stashを適用後に削除します。", fetch: "Remote情報を取得します。", push: "local commitをRemoteへ送信します。", merge: "対象の履歴を統合します。", rebase: "local commitを別のbase上に再生成します。", pull: "fetchしてから統合します。" } satisfies Record<typeof kind, string>)[kind]; }
function situation(analysis: CommandPreviewAnalysis): string { if (analysis.parse.kind !== "parsed") return parseText(analysis.parse); const result = analysis.simulation!; return result.kind === "supported" ? "現在のFactを元に成功した場合のPreviewです。" : result.kind === "blocked" ? "現在のFactから、この操作は成立しないと判断できます。" : "この操作の詳細は現在のSimulatorでは扱いません。"; }
function unchanged(analysis: CommandPreviewAnalysis): readonly string[] { const simulation = analysis.simulation; if (!simulation) return ["Repositoryは変更されていません。"];
  const unknown = simulation.unknowns.length > 0 || simulation.warnings.length > 0;
  if (unknown) return ["Unknownまたは注意がある領域は、変わらないとは断定しません。", "Repositoryは変更されていません。"];
  return simulation.events.some((event) => event.kind === "noOp") ? ["pointerやcommitは変わりません。", "Repositoryは変更されていません。"] : ["PreviewはRepositoryStateを書き換えません。", "Repositoryは変更されていません。"];
}
function mapText(analysis: CommandPreviewAnalysis): string { const result = analysis.simulation; if (!result) return "Predictionはありません。"; if (result.kind !== "supported") return "future change overlayは作りません。"; return result.events.some((event) => event.kind === "noOp") ? "変更なしをMapに示します。" : "Fact MapにPrediction / Unknownを重ねます。"; }
function notices(analysis: CommandPreviewAnalysis): readonly string[] { if (analysis.parse.kind !== "parsed") return [parseText(analysis.parse), "このUIは実行しません。"]; const result = analysis.simulation!; return [...result.warnings.map(noteText), ...result.assumptions.map(noteText), ...result.unknowns.map(noteText), ...(result.risk === "caution" ? ["注意が必要な操作です。"] : []), ...(result.kind === "blocked" ? [`blocked: ${result.reason}`] : result.kind === "unsupported" ? [`unsupported: ${result.reason}`] : []), "このUIは実行しません。"]; }
function parseText(parse: Exclude<GitCommandParseResult, { kind: "parsed" }>): string { switch (parse.kind) { case "parseFailure": return parse.reason; case "unsupportedCommand": return `${parse.commandName} はMVP対象外です。`; case "unsupportedOption": return `${parse.commandName} の ${parse.option} はMVP対象外です。`; case "highRisk": return `${parse.reason} 安全のため実行しません。`; } }
function eventText(event: SimulationEvent): string { switch (event.kind) { case "stagingReflected": return `${event.path}をStagingへ記録`; case "stagingUpdated": return `${event.path}のStaging内容を更新`; case "stagingRemoved": return `${event.path}をStagingから外す（Working Treeは残る）`; case "stagedChangesCleared": return "Stagingをclear"; case "commitCreated": return event.commit.kind === "newMergeCommit" ? "◌ NEW MERGE COMMITを生成" : event.commit.kind === "rewrittenCommit" ? `◌ replacementを生成（Original ${event.commit.originalCommitId.slice(0, 7)}）` : "◌ NEW COMMITを生成"; case "branchPointerMoved": return `${event.branchName} pointerをPredictionへ進める`; case "headSymbolicRefChanged": return `HEADを${event.branchName}へ向ける`; case "headBranchRelationRetained": return `HEADは${event.branchName}を参照したまま`; case "headDetachedMoved": return "detached HEADをPredictionへ進める"; case "branchCreated": return `${event.branchName} branchを作成`; case "unbornSymbolicBranchChanged": return `unborn branchを${event.branchName}へ切替`; case "derivedRelationInvalidated": return `${event.relation}のfuture relationはUnknown`; case "stashCreated": return "Stash ShelfにPredictionを作成"; case "trackedChangesStashed": return "tracked changesをstash"; case "untrackedChangesStashed": return "untracked changesをstash"; case "stashChangesApplied": return "Stashを適用"; case "stashEntryRemovedAfterSuccessfulApply": return "成功した場合にStash entryを削除"; case "fetchRequested": return "fetchを要求"; case "remoteTrackingMayRefresh": return "remote-trackingは更新されるかもしれない"; case "pullFetchRequested": return "STEP 1 fetch"; case "pullIntegrationPlanned": return `STEP 2 integrate (${event.method === "rebase" ? "rebase" : "Unknown"})`; case "pushRequested": return "local commit/refをRemoteへ送信試行"; case "branchUpstreamConfigured": return "upstream設定をPrediction"; case "noOp": return "変更なし"; } }
function noteText(note: SimulationNote): string { const value = "path" in note ? note.path : "operand" in note ? note.operand : "branchName" in note ? note.branchName : "remoteName" in note ? note.remoteName : ""; return `? ${note.code}${value ? `: ${value}` : ""}`; }
function overlay(result: SimulationResult): PreviewMapOverlay { const predictions = result.events.filter((event): event is Extract<SimulationEvent, { kind: "commitCreated" }> => event.kind === "commitCreated").map((event) => ({ label: "Prediction", description: event.commit.kind === "newMergeCommit" ? "NEW MERGE COMMIT" : event.commit.kind === "rewrittenCommit" ? `REPLACEMENT for ${event.commit.originalCommitId.slice(0, 7)}` : "NEW COMMIT" })); const remoteSteps = result.events.filter((event) => event.kind === "fetchRequested" || event.kind === "pushRequested" || event.kind === "pullFetchRequested" || event.kind === "pullIntegrationPlanned" || event.kind === "remoteTrackingMayRefresh").map(eventText); return { events: result.events.map(eventText), predictions, remoteSteps, unknown: [...result.warnings, ...result.unknowns].map(noteText) }; }
function relatedExamples(state: RepositoryState): readonly string[] { const examples: string[] = []; if (state.workingTree.unstaged.length || state.workingTree.untracked.length) examples.push("git add ."); if (state.workingTree.staged.length) examples.push('git commit -m "message"'); if (state.stash.kind === "available" && state.stash.value.length) examples.push("git stash list"); if (state.upstream.kind === "available" && state.upstream.value.remoteName !== ".") examples.push(`git fetch ${state.upstream.value.remoteName}`); const branch = state.localBranches.find((item) => state.currentLocation.kind !== "branch" || item.name !== state.currentLocation.branchName); if (branch) examples.push(`git switch ${branch.name}`); return examples.slice(0, 4); }
