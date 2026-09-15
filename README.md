# Git Bearings

Git Bearingsは、実際のGit Repositoryを読み取り、Gitの状態変化を理解しやすくするVS Code拡張です。

次の4つの問いに答えることを目指します。

- 今どこ？ — HEAD、branch、Working Tree、Staging、Remoteの現在のFact
- ここまでどう来た？ — bounded commit graphとbranch・HEADの関係
- このコマンド何する？ — 実行しないCommand Preview
- こうしたい。何を使う？ — 状態に応じたGoalからの案内

## Safety

Git BearingsはGit 2.23以降を対象に、Repositoryの状態をread-onlyで観測します。Git書き込み、auto-fetch、外部network通信、Telemetryは行いません。PreviewとGoal UIは操作を実行せず、Fact・Prediction・Unknownを区別して表示します。

Git CLIの観測は厳格なcommand signature allowlistとshellなしのargv実行に限定しています。Gitがmissing objectを暗黙に取得することを避けるためlazy fetchも無効化し、partial cloneまたはpromisor / partial-clone用Remote設定を検出したRepositoryは、安全側に倒して現在は対象外とします。Git commandのstdout / stderrにも上限を設け、巨大出力は部分的なFactとして扱わず取得失敗にします。

Repository由来のbranch名、commit subject、path、stash messageなどにUnicode bidi制御文字が含まれる場合は、その制御文字を`[RLO]`や`[PDI]`のような可視マーカーへ変換して表示します。見た目の文字順だけを偽装して別の名前やpathに見せることを避けるためです。

Git BearingsはVS Codeが信頼済みとしたworkspaceでの利用を前提とし、Restricted Modeでは動作対象外です。敵対的な`.git` directoryそのものを安全な入力として保証するものではありません。

## Command Preview の対応範囲

Previewは次の限定した構文だけを解析し、状態変化の予測を表示します。Git操作は実行しません。

- `git add <path...>` / `git add .`、`git restore --staged <path...>`、`git reset HEAD <path...>`、`git commit` / `git commit -m <message>`
- `git switch <branch>` / `git switch -c <branch>`
- `git stash` / `push`（`-u`、`-m`のみ）、`list`、`apply` / `pop`（`stash@{n}`のみ）
- `git fetch [remote]`、`git push` / `git push [-u] <remote> <branch>`、`git pull [--rebase] [<remote> <branch>]`
- `git merge <branch>`、`git rebase <upstream>`

これ以外のcommandやoptionは未対応です。shell演算子やshell展開を含む入力は解析しません。Goalからcommandとして案内するRepository由来のbranch / remote等も、安全に表示できる限定した文字集合だけを対象とします。`git reset --hard`、force push、`git clean --force`などのhigh-risk操作は安全のためPreview対象外です。

## Supported environment

正式確認対象はWindows、macOS、Linux上のVS Code DesktopとWSLです。Remote SSHとDev ContainersはMVPの正式保証対象外です。partial cloneおよびpromisor remoteを利用するRepositoryも現在は正式対応外です。

## Development

```sh
npm install
npm run compile
npm run check
npm test
```

個別テストは`package.json`の`test:*` scriptsでも実行できます。設計と実装方針は[docs](docs/)を参照してください。
