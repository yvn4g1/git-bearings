# Git Bearings — Codex Working Agreement

Git BearingsでCodexが作業するときの共通ルール。
Issue固有の仕様や一時的な進捗はここへ書かない。

## 1. 正本

設計や実装内容を推測せず、以下を正本として扱う。

- 製品仕様: `docs/mvp-spec.md`
- 実装順序: `docs/implementation-plan.md`
- 重要な設計原則: `docs/adr/`
- 今回の実装範囲・対象外・完了条件: 対象GitHub Issue

Issueと設計文書に矛盾がある場合は、独断で解釈せず報告して停止する。

## 2. 作業原則

原則として1 Issueずつ、必要な最小限の変更だけを行う。

後続Issueの機能、不要なrefactor、将来用の抽象化・依存package・設定を
「ついでに」追加しない。

Git Bearingsでは以下を守る。

- Gitの状態変化を正しく伝える
- 簡略化してもGitの意味を変えない
- 分からない状態を推測しない
- Fact / Prediction / Unknownを混同しない
- Repositoryの意味的Git状態を書き換えない
- auto-fetch / 不要なexternal network / Telemetry / MVPでのAIを導入しない
- user入力をshell commandとして実行しない

実装中に、
Issue範囲外の変更が必要になった場合、
重要な仕様判断が必要になった場合、
Securityやread-only保証を維持できない場合は、
推測して進めず停止して報告する。

## 3. 作業開始時

ファイル変更前に最低限以下を確認する。

- current directory
- branch
- HEAD
- `git status`
- remote / upstream
- 既存の未commit変更

無関係な変更をreset / restore / stash / 削除 / 上書きしない。

remoteとの同期は明示的に指示された場合のみ行い、
勝手にfetch / pullしない。

## 4. 実装と検証

変更は小さく、Issueとの対応が追える形にする。
既存構造で十分なら、新しいarchitecture layerを増やさない。

実装後は最低限、

- `npm run compile`
- `npm run check`

を実行する。

Issueに追加testがある場合はそれも実行する。

手動UX確認が必要な場合は、
Codexだけで完了扱いにせず、
確認手順を提示して停止する。

test failureや予期しないerrorを無視して先へ進まない。

## 5. Git操作

commit / push / mainへの統合は、
現在の指示で明示的に許可された場合のみ行う。

commitする場合は、

- 今回のIssueに関係するfileだけstageする
- staged diffを確認する
- commit messageは日本語で具体的にする
- 無関係なlocal設定を含めない

force push / hard reset / 不要なstash / 強引なconflict解消は行わない。

予期しないdivergeやconflictがある場合は停止して報告する。

## 6. 完了報告

最低限以下を報告する。

- 開始時のbranch / HEAD / working tree
- 変更file
- 実装内容
- 実行したtest / checkと結果
- 必要な手動確認
- 最終branch / HEAD / `git status`
- commit / pushの有無

未完了事項や判断待ちがあれば明示する。
