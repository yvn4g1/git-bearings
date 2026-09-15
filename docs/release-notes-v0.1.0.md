# Git Bearings v0.1.0

Git BearingsのMVP初回公開版です。

Git Repositoryの状態を、HEAD / branch / Commit Graph / Working Tree / Staging / Stash / Remoteの関係として可視化します。Git commandを実行せずに状態変化を確認する「このコマンド何する？」と、目的からcommand候補を探す「こうしたい。何を使う？」を含みます。

## 主な機能

- HEAD / branch / Commit Graphの可視化
- Working Tree / Staging / Stash / Remoteの状態表示
- Git commandを実行しないCommand Preview
- 現在の状態に応じたGoal UI
- Fact / Prediction / Unknownの分離表示

## Safety

Git Bearings自身はRepositoryを書き換えるGit commandを実行しません。Command PreviewとGoalも解析・案内のみです。auto-fetch、外部network通信、Telemetryは行いません。

partial clone / promisor remoteは現在の対応対象外です。Restricted Modeでは動作対象外です。

## 対応環境

- VS Code ^1.93.0
- Git 2.23以降
- Windows / macOS / Linux上のVS Code Desktop、WSLを対象
- 手動の代表smokeは主にWindows / WSLで実施

Remote SSH / Dev ContainersはMVPの正式保証対象外です。

## Install

GitHub ReleaseのAssetsから `git-bearings-0.1.0.vsix` を取得し、VS Codeの `Extensions: Install from VSIX...` から選択してください。

CLIでは次でもインストールできます。

```sh
code --install-extension git-bearings-0.1.0.vsix
```

VS Code Marketplaceにはまだ公開していません。
