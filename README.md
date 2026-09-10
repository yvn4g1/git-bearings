# Git Bearings

Git Bearingsは、実際のGit Repositoryを読み取り、Gitの状態変化を理解しやすくするVS Code拡張です。

次の4つの問いに答えることを目指します。

- 今どこ？ — HEAD、branch、Working Tree、Staging、Remoteの現在のFact
- ここまでどう来た？ — bounded commit graphとbranch・HEADの関係
- このコマンド何する？ — 実行しないCommand Preview
- こうしたい。何を使う？ — 状態に応じたGoalからの案内

## Safety

Git BearingsはGit 2.23以降を対象に、Repositoryの状態をread-onlyで観測します。Git書き込み、auto-fetch、外部network通信、Telemetryは行いません。PreviewとGoal UIは操作を実行せず、Fact・Prediction・Unknownを区別して表示します。

Git CLIの観測は厳格なcommand signature allowlistとshellなしのargv実行に限定しています。MVPで対応していないcommand、option、high-risk操作も実行しません。

## Supported environment

正式確認対象はWindows、macOS、Linux上のVS Code DesktopとWSLです。Remote SSHとDev ContainersはMVPの正式保証対象外です。

## Development

```sh
npm install
npm run compile
npm run check
```

テストは`package.json`の`test:*` scriptsで実行できます。設計と実装方針は[docs](docs/)を参照してください。
