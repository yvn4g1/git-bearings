# ADR-0001: Git Bearings MVP Principles

## Status

Accepted

## Context

Git Bearingsは、ユーザー自身のGit Repositoryを教材にGitの状態変化を説明するVS Code拡張である。誤った単純化、意図しないRepository変更、外部状態の推測は学習を損なう。

## Decision

- Platform: VS Code extensionとして開発する。
- Data source: VS CodeのRepository認識・イベントとGit CLIを組み合わせる。UIからGit CLIを直接呼ばない。
- Read-only product: Git Bearings自身からRepositoryの意味的な状態を変更するGit操作を実行しない。
- No shell: Git CLIはexecutable＋argvで実行し、user inputをshellへ渡さない。
- No automatic fetch: remote-tracking refを更新するfetchは純粋な観測ではないため自動実行しない。
- No external network: MVPでは外部通信しない。
- No telemetry: Telemetryを実装しない。
- No AI in MVP: AIを利用せず、Gitの事実と状態変化をdeterministicに説明する。
- Real repository as learning material: tutorial用の架空repoではなく、ユーザー自身のRepositoryを教材にする。
- Simplify without lying: 初心者向けに簡略化してもGitの意味を変えない。
- Fact / Prediction / Unknown separation: 現在の事実、成功時の予測、現時点で分からない状態を明確に区別する。
- Remote semantics: remote-tracking branchをlive Remote branchとみなさない。
- Commit Graph semantics: Graphからbranch作成時点を推測しない。merge-baseは比較上の共通祖先として扱う。
- Product success: ユーザーがGit BearingsなしでもGit状態変化を予測できるようになることを成功とする。

## Rationale

実Repositoryを使うことで学習を実際の作業へ結び付けられる。一方、Gitを変更したりRemoteを更新したりすれば観測者としての信頼性が損なわれる。データ取得、UI、simulationを分けることで、事実と説明・予測の混同を防ぐ。

Webviewを導入するPhase 0からCSP、Repository文字列の安全な描画、message validationを適用する。Phase 7はこれらの最終hardeningと攻撃的testを行う段階である。

## Consequences

MVPはread-only Git CLI command signature allowlistを維持し、書込みcommand・shell execution・自動fetch・外部通信を実装しない。read-onlyの保証はHEAD、refs、Staged内容、Working Tree内容、stash、Git configなどRepositoryの意味的状態に対するものであり、`.git/index`のbinary内容が不変であることまでは保証対象としない。外部の最新状態が必要な箇所はUnknownとして扱う。
