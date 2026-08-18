# Git Bearings UI/UX Direction

Phase 0 Issue #2 / #3のUX Gateで得た、MVPのUI/UX方向性を記録する。本書はpixel単位の完成デザイン仕様ではなく、後続Issueが参照する判断と、後続で磨く余地を分ける。

## 採用する方向

### Git Map

Git MapはGit Bearingsのmental mapの中心であり、第一層では文章を読むより先に状態と関係を見せる。詳細文章は第二層とする。

Working Tree、Staging、Local history、remote relationはsemanticには別状態だが、独立cardの集合として分断せず、一枚の連続したMap上で関係として表現できる。大きなsection border / cardは必要最小限とし、状態変化のarrowは概念上のsection境界をまたいでよい。

### レイアウト

Phase 0ではB' / Wide、Compact Vertical、Compact Continuousを比較した。MVP Git Mapの第一候補は**Compact Continuous / Borderless**とする。

B' / WideとCompact Verticalは比較prototypeであり、本番defaultとして採用したものではない。Compact Continuousは、狭い縦長windowでも主要Mapを読みやすく、Commit Graphへ横幅を優先でき、Terminal横の補助計器として成立しやすい。card境界による視線分断も減らせることをGateで確認した。

### Commit Graph

- Graph方向は old → new の横向きを継続する。
- commitは丸node、parent relationは線とする。
- branchはcommitを指すlabelであり、履歴線そのものとして描かない。
- HEADはbranchとは独立したpointerとし、通常は HEAD → branch → commit を維持する。

rendererは現時点で**inline SVG + HTML/CSS**を推奨する。branch、parent relation、pointer、arrowを構造的に描画でき、将来clickable要素へ発展させやすく、Canvasよりelement単位のaccessibilityを扱いやすい。MVPの約50 node規模では十分現実的であり、Canvasはperformance上必要になった場合のみ再評価する。

### 状態変化UX

将来のCommand Previewでは、Staging → NEW COMMIT生成 → branch pointer移動 → HEAD relationのように、何がどこからどこへ変わるかを一続きの視線で追えることを優先する。

通常状態は静かで低ノイズとする。Preview / 状態変化ではarrow、highlight、Prediction node、pointer移動、必要な短いmotionで視線を誘導する。色だけに意味を依存せず、position、spacing、contrast、shape、hierarchy、motionを組み合わせる。「重要なものを全部太くする」ことを基本手段にはしない。

### DetailとSidebar

Detailは第二層である。通常のMapでは詳細説明を読まなくても主要な現在状態を理解できることを優先し、必要時に展開・選択して読むことでMapの主要領域を常時圧迫しない。

Sidebarはglanceableな現在地・状態の索引とする。Git Mapを開いている間、SidebarとGit Mapの両方に詳しい自然文を重複表示して左右へ視線移動させることは避け、詳しい状態理解はGit Map側で完結できることを目指す。

### Terminal Adjacent

外部Terminal横へGit Mapをfloating windowとして配置する使い方は、有力な利用形態である。これは外部Terminalとの自動連携を実装する意味ではない。Git BearingsはCompactなMapを提供し、Git操作を行う場所に依存せず、Repository状態を観測して説明することへ集中する。

WindowsではOSのSnap / Snap Group等でTerminalとGit Bearingsを並べる利用方法を将来案内できる。Terminal検知、OS window追従、Alt+Tab連動の独自実装は少なくとも現在のMVP要件に追加しない。Integrated Terminalの利用を必須・推奨前提にはしない。

## 未確定 / 後続で磨くこと

以下はPhase 0では確定しすぎない。実RepositoryStateや本物のCommand Previewを載せながら後続Issueでブラッシュアップする。

- exact spacing、font size、node size、line width
- animation duration / easing、highlight強度
- Detailの最終interaction
- narrow幅での最終responsive調整
- Light / Darkの最終visual polish
- Terminal Adjacentをdefault配置にするか
- Editor / Panel等の最終surface構成
