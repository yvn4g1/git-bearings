# Git Bearings MVP Implementation Plan

本書はMVPを実装する順序の正本である。各Issue本文の詳細はここへ複製しない。

## Phase 0 — 技術成立性

**目的:** 拡張の起点、SidebarとEditor Webviewの組合せ、B'レイアウトと横Graphの成立性を確認する。

**Issue一覧:** 1. VS Code拡張の初期構成と起点コマンド / 2. Sidebar＋Git MapハイブリッドUI / 3. B'レイアウト＋横Graphの技術試作・Gate

**依存関係:** Bootstrap完了後に開始する。

**Phase完了Gate:** split / tab判断、横Graph継続判断、Commit Graph renderer方式を記録する。Webview作成時からCSP、安全な文字列描画、message validationを適用する。

## Phase 1 — Gitの事実

**目的:** UIから独立した安全なRepositoryの事実モデルと読取基盤を確立する。

**Issue一覧:** 4. RepositoryState / AppViewState / 5. 安全なread-only Git実行基盤 / 6. Core Repository Reader / 7. Repository選択・記憶 / 8. 基準branch判定・branch比較 / 9. Remote / upstream / stash Reader

**依存関係:** Phase 0 Gate、およびIssue 4・5を基礎とする。

**Phase完了Gate:** 意味的にread-onlyなallowlist実行でRepositoryStateを取得し、available/notConfigured/unavailable、operation、remote/upstreamを誤って断定せず表現できる。

## Phase 2 — 現在地

**目的:** 現在のRepository状態を安定して見せる。

**Issue一覧:** 10. Sidebar現在地表示 / 11. Overview詳細ペイン / 12. 自動Refresh＋stateVersion

**依存関係:** Phase 1のRepositoryState。

**Phase完了Gate:** SidebarとDetailが同一stateVersionに基づく事実を示し、更新失敗や未対応状態を安全に扱える。

## Phase 3 — Git Map

**目的:** Gitの状態を横向きCommit Graph中心のMapで表現する。

**Issue一覧:** 13. Git Map基本レイアウトを実データへ接続 / 14. Commit Graph Renderer / 15. HEAD / branch / Remote視覚文法 / 16. Working Tree / Staging / Stash / Prediction等の状態表現

**依存関係:** Phase 0のrenderer判断、Phase 1のread model、Phase 2の更新基盤。

**Phase完了Gate:** 約50 node上限と省略表現を含み、HEAD・branch・remoteの意味を混同せず、Fact/Prediction/Unknownを識別可能に表示する。

## Phase 4 — 触って理解

**目的:** 選択と説明を連動させ、Mapを探索可能にする。

**Issue一覧:** 17. Sidebar / Map / DetailのSelection同期 / 18. Git Map要素の2段階説明 / 19. Commit詳細の遅延取得

**依存関係:** Phase 2・3の表示とSelectionState。

**Phase完了Gate:** 一意のdiscriminated selectionが3領域で同期し、詳細取得は必要時のみ行われる。

## Phase 5 — Command理解

**目的:** commandを実行せずに状態変化を理解できるPreviewを作る。

**Issue一覧:** 20. MVP Git Command Parser / 21. 基本Git操作Command Simulator / 22. Stash / Fetch / Push Simulator / 23. Merge / Rebase / Pull統合Simulator / 24. 「このコマンド何する？」UI＋Preview

**依存関係:** Phase 1の事実モデル、Phase 3・4の表示・説明。

**Phase完了Gate:** Raw InputからSimulationResultまでshellを介さず処理し、実状態とpreviewを分離する。Unknownな外部結果をPredictionとして断定しない。

## Phase 6 — GoalからCommand

**目的:** Git用語ではなく目的から状態変化とcommandを案内する。

**Issue一覧:** 25. Goal Resolver＋「こうしたい」UI

**依存関係:** Phase 5のSimulatorとPhase 4の説明モデル。

**Phase完了Gate:** 4主カテゴリから、現在状態・必要な変化・候補commandを示し、達成済みの場合は不要な提案をしない。

## Phase 7 — 完成工程

**目的:** 未対応状態、性能、安全性、実環境UXを完成度まで高める。

**Issue一覧:** 26. 特殊Git状態＋Error UX / 27. 性能・Security・巨大Repository hardening / 28. Integration Test＋実VS Code UX＋VSIX最終検証

**依存関係:** Phase 0から6の統合。

**Phase完了Gate:** 特殊operationとError UX、攻撃的Webview/security test、巨大Repository、Windows/macOS/Linux/WSL、VS Code Desktop、VSIXを検証する。Securityはここで初めて導入するものではなく、初期からの方針をhardeningする。

