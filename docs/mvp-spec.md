# Git Bearings MVP Specification

## 1. Product Purpose

Git Bearingsは、実際のGit Repositoryを教材に「今どこにいるか」「ここまでどう来たか」「このコマンドで何が変わるか」を可視化し、Gitのmental map形成を支援するVS Code拡張である。コマンドを覚えさせるのではなく、状態変化を理解できるようにする。

## 2. Target User

自分のRepositoryでGitを使う初学者から中級者。Gitの状態や操作結果を予測する力を身につけたいVS Code Desktop利用者を対象とする。

## 3. Problems to Solve

Working Tree、Staging、local repository、remote情報、HEAD、branchの関係が見えにくい。Git用語だけでは操作の影響を理解しにくく、未知の外部状態を断定してしまうUIは誤解を招く。

## 4. Product Principles

- コマンドではなく状態変化を教える。
- 初心者向けに簡略化してもGitの意味を変えない。
- 分からない外部状態を推測しない。
- Git Bearings自身はRepositoryの意味的状態を変更しない。
- Fact、Prediction、Unknownを混同しない。

## 5. Main User Flows

Repositoryを選択して現在地を確認する。Map上の対象を選んで詳細を読む。入力されたGit commandの影響を安全にPreviewする。「こうしたい」という目的から必要な状態変化と推奨commandを知る。

## 6. UI Architecture

Sidebarは現在地・状態の索引、Git Mapはmental mapの中心、Detail Paneは選択対象の説明を担う。Git MapはEditor AreaのWebview Panelとし、第一試作ではコードと左右分割する。狭い場合はMapをtab表示し、それでも不適切なら縦Graphを検討する。画面幅に応じたGraph方向の自動変更はMVPでは行わない。Webviewを最初に作る時点からCSP、Repository由来文字列の安全な描画、message validationを適用する。

## 7. Git Map

基本レイアウトはYOUR CHANGES（Working Tree、Staging）、LOCAL REPOSITORY（Commit Graph）、REMOTE、Detail Paneで構成する。Commit Graphは原則`old → new`の横向きとする。全履歴Viewerにはせず、初期node上限は約50、必要に応じ中間履歴を省略する。

## 8. Visual Grammar

commitは丸node、local branchはcommitを指す角丸label、HEADはbranchと独立したpointerで表す。通常は`HEAD → branch → commit`、detachedでは`HEAD → commit`である。branchを履歴線そのものとして描かない。remote-tracking branchはlocal branchと形状を変え通常は隠し、Remote branchはRemote領域に表示する。色だけを意味の正本にしない。

## 9. Repository State Model

RepositoryStateはGitの事実のみを保持し、UI座標・色・animation・HTML・初心者向け説明文を含めない。Gitの事実とUI representationを分離する。補助情報は`available`、`notConfigured`、`unavailable`を区別する。OperationStateは少なくとも`normal`、`merge`、`rebase`、`unsupported`/other operationを区別し、未対応operationをnormalとして扱わない。

## 10. Repository Selection

VS CodeのRepository認識を候補として扱い、対象Repositoryを明示的に選択・記憶できるようにする。選択不能・未構成・取得不能は別の状態として表示する。

## 11. Base Branch and Comparison

比較対象のbase branchは明示的に判定・表示する。merge-baseは比較上の共通祖先であり、branch作成地点とは説明しない。

## 12. Remote and Upstream Semantics

`origin/main`などのremote-tracking refをlive Remote branchとして扱わない。Remote情報は「ローカルGitが最後に取得したRemote情報」である。Git Bearingsは自動fetchしない。upstreamの設定有無も事実として表現する。

## 13. Selection and Detail Model

SelectionStateはdiscriminated unionとし、「今何を見ているか」は常に1つにする。AppViewStateでは`selection`、`detailMode`、`preview`を分離する。

## 14. Command Analysis

Command Previewは`Raw Input → Parser → GitCommand → Simulator → SimulationResult`で構成する。ユーザー入力をshellへ渡さず、Git Bearings自身からcommandを実行しない。Preview中もSidebarは実RepositoryStateを表示する。

## 15. Command Simulation

成功した場合の状態変化だけをPredictionとして表し、未来hashは生成しない（例：`◌ NEW COMMIT`）。実在commitは`● f37ed3c`、外部情報不足は`? Unknown`と示しPredictionとUnknownを区別する。Animationは反映、生成、pointer移動、適用・再生成、不明・外部待ちの5種類とし、変わらないものは動かさない。rebaseでは既存commitを移動させず、新commitを生成する。

## 16. Goal Resolver

主カテゴリは「変更を残したい」「他の変更を取り込みたい」「別の場所で作業したい」「やり直したい」とする。Git用語をカテゴリ主語にせず、`目的 → 現在状態 → 必要な状態変化 → 推奨command`を示す。すでに目的達成済みなら無理にcommandを提案しない。

## 17. Special Git States

merge、rebase、detached HEAD、conflict、stash、未対応operationなどを状態として明示する。未対応または不足情報は安全にUnknownまたはunsupportedとして扱う。

## 18. Supported Git Commands

MVPの対象commandはParser/Simulatorの実装段階で定義する。Git CLIの観測はread-only command signature allowlist方式とし、単なるsubcommand名allowlistにはしない。たとえば`stash list`、`config --get`、remote一覧取得は許可し、`stash pop`、config変更、`remote add`は許可しない。

## 19. Out of Scope

Git書き込み操作、shell execution、Remote自動fetch、外部通信、Telemetry、AI、全履歴Viewer、画面幅に応じたGraph方向の自動変更はMVP外とする。Remote SSHとDev ContainersはMVP正式保証外。

## 20. Non-functional Requirements

Git 2.23以上を対象とする。MVP正式確認対象はWindows、macOS、Linux、VS Code Desktop、WSLである。巨大Repositoryではnode上限・遅延取得・段階的表示により応答性を保つ。

## 21. Security Principles

Repositoryの意味的状態を変更しないことを保証する。確認対象はHEAD、refs、Staged内容、Working Tree内容、stash、Git configであり、`.git/index`のbinary内容が一切変化しないことまでは保証対象としない。Git CLIはexecutableとargvで呼び、shellを使わない。WebviewはCSP、エスケープ/安全なDOM API、message validationを最初から用いる。

## 22. MVP Completion Criteria

実Repositoryの事実を安全に読み、状態をSidebar・Git Map・Detail Paneで一貫して示せること。対象commandの影響を実行せず予測でき、Fact/Prediction/Unknownを区別できること。対応OS/VS Code Desktop/WSLで検証し、read-only、安全性、性能、VSIXを最終確認する。

