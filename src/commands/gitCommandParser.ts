import type { GitCommand, GitCommandParseResult } from "../domain/gitCommand";

export function parseGitCommand(input: string): GitCommandParseResult {
  const tokenized = tokenize(input);
  if (tokenized.kind === "failure") return failure(tokenized.reason);
  const tokens = tokenized.tokens;
  if (tokens[0] !== "git") return failure("入力は git で始める必要があります。");
  if (tokens.length === 1) return failure("Git subcommandが必要です。");
  const subcommand = tokens[1];
  if (option(subcommand)) return unsupportedOption("git", subcommand);
  const args = tokens.slice(2);
  const risk = highRisk(subcommand, args);
  if (risk) return risk;
  switch (subcommand) {
    case "add": return add(args);
    case "restore": return restore(args);
    case "reset": return reset(args);
    case "commit": return commit(args);
    case "switch": return switchBranch(args);
    case "stash": return stash(args);
    case "fetch": return fetch(args);
    case "push": return push(args);
    case "pull": return pull(args);
    case "merge": return oneOperand("merge", args, (branch) => ({ kind: "merge", branch }));
    case "rebase": return oneOperand("rebase", args, (upstream) => ({ kind: "rebase", upstream }));
    default: return { kind: "unsupportedCommand", commandName: subcommand };
  }
}

export function tokenizeGitCommand(input: string): readonly string[] | undefined {
  const result = tokenize(input); return result.kind === "tokens" ? result.tokens : undefined;
}

type TokenizeResult = { readonly kind: "tokens"; readonly tokens: readonly string[] } | { readonly kind: "failure"; readonly reason: string };
function tokenize(input: string): TokenizeResult {
  if (input.includes("\r") || input.includes("\n")) return { kind: "failure", reason: "複数行入力は解析できません。" };
  const tokens: string[] = []; let token = ""; let started = false; let quote: "single" | "double" | undefined;
  const finish = () => { if (started) { tokens.push(token); token = ""; started = false; } };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote === "single") { if (char === "'") quote = undefined; else token += char; continue; }
    if (quote === "double") {
      if (char === '"') { quote = undefined; continue; }
      if (char === "\\" && (input[index + 1] === '"' || input[index + 1] === "\\")) { token += input[index + 1]; index += 1; continue; }
      token += char; continue;
    }
    if (char === "'") { quote = "single"; started = true; continue; }
    if (char === '"') { quote = "double"; started = true; continue; }
    if (char === " " || char === "\t") { finish(); continue; }
    if ("&|;<>".includes(char)) return { kind: "failure", reason: "shell構文は解析できません。" };
    token += char; started = true;
  }
  if (quote) return { kind: "failure", reason: "quoteが閉じられていません。" };
  finish();
  return tokens.length ? { kind: "tokens", tokens } : { kind: "failure", reason: "入力がありません。" };
}

function add(args: readonly string[]): GitCommandParseResult {
  const bad = firstOption(args); if (bad) return unsupportedOption("add", bad);
  if (!args.length || args.some((value) => value === "")) return failure("pathが必要です。");
  if (args.includes(".")) return args.length === 1 ? parsed({ kind: "add", target: { kind: "repositoryRoot" } }) : failure(". と個別pathは混在できません。");
  return parsed({ kind: "add", target: { kind: "paths", paths: args } });
}
function restore(args: readonly string[]): GitCommandParseResult {
  const bad = firstOption(args.filter((value) => value !== "--staged")); if (bad) return unsupportedOption("restore", bad);
  if (args[0] !== "--staged" || !validOperands(args.slice(1))) return failure("restore --staged のpathが必要です。");
  return parsed({ kind: "unstage", syntax: "restoreStaged", paths: args.slice(1) });
}
function reset(args: readonly string[]): GitCommandParseResult {
  const bad = firstOption(args.filter((value) => value !== "HEAD")); if (bad) return unsupportedOption("reset", bad);
  if (args[0] !== "HEAD" || !validOperands(args.slice(1))) return failure("reset HEAD のpathが必要です。");
  return parsed({ kind: "unstage", syntax: "resetHead", paths: args.slice(1) });
}
function commit(args: readonly string[]): GitCommandParseResult {
  const bad = firstOption(args.filter((value) => value !== "-m")); if (bad) return unsupportedOption("commit", bad);
  if (!args.length) return parsed({ kind: "commit" });
  if (args[0] !== "-m" || args.length !== 2) return failure("commitの引数形が不正です。");
  return parsed({ kind: "commit", message: args[1] });
}
function switchBranch(args: readonly string[]): GitCommandParseResult {
  const bad = firstOption(args.filter((value) => value !== "-c")); if (bad) return unsupportedOption("switch", bad);
  if (args[0] === "-c") return args.length === 2 && operand(args[1]) ? parsed({ kind: "switch", branchName: args[1], create: true }) : failure("作成するbranch名が必要です。");
  return args.length === 1 && operand(args[0]) ? parsed({ kind: "switch", branchName: args[0], create: false }) : failure("branch名が必要です。");
}
function stash(args: readonly string[]): GitCommandParseResult {
  if (!args.length) return parsed({ kind: "stashPush", includeUntracked: false });
  const action = args[0]; const rest = args.slice(1);
  if (action === "push") {
    let includeUntracked = false; let message: string | undefined;
    for (let index = 0; index < rest.length; index += 1) {
      const value = rest[index];
      if (value === "-u") { if (includeUntracked) return failure("-uを重複指定できません。"); includeUntracked = true; continue; }
      if (value === "-m") { if (message !== undefined || index + 1 >= rest.length) return failure("-mのmessageが不正です。"); message = rest[++index]; continue; }
      if (option(value)) return unsupportedOption("stash", value);
      return failure("stash pushの引数形が不正です。");
    }
    return parsed({ kind: "stashPush", includeUntracked, ...(message === undefined ? {} : { message }) });
  }
  if (action === "list") return rest.length ? failure("stash listに引数は指定できません。") : parsed({ kind: "stashList" });
  if (action === "apply" || action === "pop") {
    const bad = firstOption(rest); if (bad) return unsupportedOption("stash", bad);
    if (rest.length > 1) return failure("stash selectorは1つだけです。");
    const index = rest.length ? stashIndex(rest[0]) : undefined;
    if (rest.length && index === undefined) return failure("stash selectorが不正です。");
    return parsed(action === "apply" ? { kind: "stashApply", ...(index === undefined ? {} : { stashIndex: index }) } : { kind: "stashPop", ...(index === undefined ? {} : { stashIndex: index }) });
  }
  return option(action) ? unsupportedOption("stash", action) : failure("stash subcommandが不正です。");
}
function fetch(args: readonly string[]): GitCommandParseResult { const bad = firstOption(args); if (bad) return unsupportedOption("fetch", bad); return args.length === 0 ? parsed({ kind: "fetch" }) : args.length === 1 && operand(args[0]) ? parsed({ kind: "fetch", remote: args[0] }) : failure("fetchの引数形が不正です。"); }
function push(args: readonly string[]): GitCommandParseResult {
  const risk = forceOption(args); if (risk) return high("push", "force pushはhigh riskです。");
  const bad = firstOption(args.filter((value) => value !== "-u")); if (bad) return unsupportedOption("push", bad);
  if (!args.length) return parsed({ kind: "push", setUpstream: false });
  const setUpstream = args[0] === "-u"; const operands = setUpstream ? args.slice(1) : args;
  return operands.length === 2 && validOperands(operands) ? parsed({ kind: "push", remote: operands[0], branch: operands[1], setUpstream }) : failure("pushのremoteとbranchが必要です。");
}
function pull(args: readonly string[]): GitCommandParseResult {
  const bad = firstOption(args.filter((value) => value !== "--rebase")); if (bad) return unsupportedOption("pull", bad);
  const rebase = args[0] === "--rebase"; const operands = rebase ? args.slice(1) : args;
  if (args.filter((value) => value === "--rebase").length > 1) return failure("--rebaseを重複指定できません。");
  return operands.length === 0 ? parsed({ kind: "pull", rebase }) : operands.length === 2 && validOperands(operands) ? parsed({ kind: "pull", remote: operands[0], branch: operands[1], rebase }) : failure("pullのremoteとbranchが必要です。");
}
function oneOperand(commandName: "merge" | "rebase", args: readonly string[], create: (value: string) => GitCommand): GitCommandParseResult { const bad = firstOption(args); if (bad) return unsupportedOption(commandName, bad); return args.length === 1 && operand(args[0]) ? parsed(create(args[0])) : failure(`${commandName}の対象が必要です。`); }
function highRisk(command: string, args: readonly string[]): GitCommandParseResult | undefined { if (command === "reset" && args.includes("--hard")) return high(command, "hard resetはhigh riskです。"); if (command === "push" && forceOption(args)) return high(command, "force pushはhigh riskです。"); if (command === "clean" && args.some((value) => value === "--force" || /^-[a-z]*f[a-z]*$/.test(value))) return high(command, "clean --forceはhigh riskです。"); return undefined; }
function forceOption(args: readonly string[]): string | undefined { return args.find((value) => value === "-f" || value === "--force" || value === "--force-with-lease"); }
function stashIndex(value: string): number | undefined { const match = /^stash@\{(\d+)\}$/.exec(value); return match ? Number(match[1]) : undefined; }
function option(value: string | undefined): value is string { return value !== undefined && value.startsWith("-"); }
function firstOption(values: readonly string[]): string | undefined { return values.find(option); }
function operand(value: string | undefined): value is string { return value !== undefined && value !== "" && !option(value); }
function validOperands(values: readonly string[]): values is readonly string[] { return values.length > 0 && values.every(operand); }
function parsed(command: GitCommand): GitCommandParseResult { return { kind: "parsed", command }; }
function failure(reason: string): GitCommandParseResult { return { kind: "parseFailure", reason }; }
function unsupportedOption(commandName: string, optionName: string): GitCommandParseResult { return { kind: "unsupportedOption", commandName, option: optionName }; }
function high(commandName: string, reason: string): GitCommandParseResult { return { kind: "highRisk", commandName, reason }; }
