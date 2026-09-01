import { strict as assert } from "node:assert";
import test from "node:test";
import { parseGitCommand, tokenizeGitCommand } from "./gitCommandParser";

test("tokenizer handles quotes, whitespace, literals, and rejects shell syntax", () => {
  const cases: readonly [string, readonly string[] | undefined][] = [
    ["  git\tadd  file.txt  ", ["git", "add", "file.txt"]], ["git commit -m 'A && B'", ["git", "commit", "-m", "A && B"]], ["git commit -m \"A \\\"B\\\"\"", ["git", "commit", "-m", "A \"B\""]], ["git add ''", ["git", "add", ""]], ["git add src\\file.ts", ["git", "add", "src\\file.ts"]], ["git add 'unterminated", undefined], ["git add \"unterminated", undefined], ["git add file\n", undefined], ["git add file\r", undefined], ["git add . && git commit", undefined], ["git log | less", undefined],
  ];
  for (const [input, expected] of cases) assert.deepEqual(tokenizeGitCommand(input), expected, input);
});

test("parser supports the specified grammar with typed semantics", () => {
  const cases: readonly [string, unknown][] = [
    ["git add file.txt", { kind: "add", target: { kind: "paths", paths: ["file.txt"] } }], ["git add \"folder/file name.txt\"", { kind: "add", target: { kind: "paths", paths: ["folder/file name.txt"] } }], ["git add one two", { kind: "add", target: { kind: "paths", paths: ["one", "two"] } }], ["git add .", { kind: "add", target: { kind: "repositoryRoot" } }], ["git restore --staged file", { kind: "unstage", syntax: "restoreStaged", paths: ["file"] }], ["git reset HEAD file", { kind: "unstage", syntax: "resetHead", paths: ["file"] }], ["git commit", { kind: "commit" }], ["git commit -m 'message with spaces'", { kind: "commit", message: "message with spaces" }], ["git switch main", { kind: "switch", branchName: "main", create: false }], ["git switch -c feature/test", { kind: "switch", branchName: "feature/test", create: true }],
    ["git stash", { kind: "stashPush", includeUntracked: false }], ["git stash push", { kind: "stashPush", includeUntracked: false }], ["git stash push -u", { kind: "stashPush", includeUntracked: true }], ["git stash push -m msg", { kind: "stashPush", includeUntracked: false, message: "msg" }], ["git stash push -u -m msg", { kind: "stashPush", includeUntracked: true, message: "msg" }], ["git stash push -m msg -u", { kind: "stashPush", includeUntracked: true, message: "msg" }], ["git stash list", { kind: "stashList" }], ["git stash apply", { kind: "stashApply" }], ["git stash apply stash@{0}", { kind: "stashApply", stashIndex: 0 }], ["git stash pop stash@{12}", { kind: "stashPop", stashIndex: 12 }],
    ["git fetch", { kind: "fetch" }], ["git fetch origin", { kind: "fetch", remote: "origin" }], ["git push", { kind: "push", setUpstream: false }], ["git push origin main", { kind: "push", remote: "origin", branch: "main", setUpstream: false }], ["git push -u origin main", { kind: "push", remote: "origin", branch: "main", setUpstream: true }], ["git pull", { kind: "pull", rebase: false }], ["git pull origin main", { kind: "pull", remote: "origin", branch: "main", rebase: false }], ["git pull --rebase", { kind: "pull", rebase: true }], ["git pull --rebase origin main", { kind: "pull", remote: "origin", branch: "main", rebase: true }], ["git merge main", { kind: "merge", branch: "main" }], ["git rebase main", { kind: "rebase", upstream: "main" }],
  ];
  for (const [input, command] of cases) assert.deepEqual(parseGitCommand(input), { kind: "parsed", command }, input);
});

test("parser rejects shell, unsupported commands/options, wrong shapes, and high risk in priority order", () => {
  for (const input of ["git add . && git commit", "git add . || git commit", "git add .; git commit", "git add . & git commit", "git log | less", "git status > out.txt", "git status >> out.txt", "git status < in.txt", "", "git", "git add", "git add . file.txt", "git restore --staged", "git reset HEAD", "git commit extra", "git switch", "git switch -c", "git stash apply stash@{-1}", "git stash apply stash@{x}", "git fetch origin extra", "git push origin", "git push -u origin", "git pull origin", "git pull --rebase origin", "git merge", "git rebase"]) assert.equal(parseGitCommand(input).kind, "parseFailure", input);
  for (const input of ["git tag v1", "git log", "git checkout main"]) assert.equal(parseGitCommand(input).kind, "unsupportedCommand", input);
  for (const input of ["git add -p", "git commit --amend", "git rebase -i main", "git merge --squash main", "git fetch --all", "git pull -r", "git switch --detach main", "git -C ../other status", "git -c core.foo=bar status", "git --git-dir=x status", "git add -file"]) assert.equal(parseGitCommand(input).kind, "unsupportedOption", input);
  for (const input of ["git reset --hard HEAD", "git push --force origin main", "git push -f origin main", "git push --force-with-lease origin main", "git clean -fd", "git clean -df", "git clean -fdx", "git clean --force -d"]) assert.equal(parseGitCommand(input).kind, "highRisk", input);
});
