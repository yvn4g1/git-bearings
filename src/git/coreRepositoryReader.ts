import { access, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type {
  AvailabilityResult,
  CommitRef,
  ConflictKind,
  CoreRepositoryFacts,
  CurrentLocation,
  FileChange,
  HistoryCommit,
  LocalBranch,
  OperationState,
  WorkingTreeState,
} from "../domain/repositoryState";
import { GitExecutor, type GitExecutionResult } from "./gitExecutor";

const FILTER_CONFIG_ARGS = [
  "config",
  "--null",
  "--name-only",
  "--get-regexp",
  "^filter\\..*\\.(clean|process)$",
  ".+",
] as const;
const STATUS_ARGS = [
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "--untracked-files=all",
  "--no-ahead-behind",
  "--renames",
  "--ignore-submodules=all",
] as const;
const HISTORY_ARGS = [
  "log",
  "-z",
  "--max-count=50",
  "--topo-order",
  "--format=format:%H%x00%h%x00%P%x00%s",
  "--branches",
  "HEAD",
] as const;
const OPERATION_PATHS = [
  "rebase-merge",
  "rebase-apply",
  "rebase-apply/rebasing",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "sequencer/todo",
  "BISECT_START",
] as const;

export class CoreRepositoryReader {
  private supportedGitVersion = false;

  constructor(private readonly gitExecutor: GitExecutor) {}

  async read(repositoryPath: string): Promise<AvailabilityResult<CoreRepositoryFacts>> {
    try {
      if (!this.supportedGitVersion) {
        const version = await this.gitExecutor.checkVersion();
        if (version.kind !== "supported") {
          return unavailable("Git 2.23 or newer is required for Core repository reading.");
        }
        this.supportedGitVersion = true;
      }
      const repositoryRoot = await this.readRepositoryRoot(repositoryPath);
      const index = await this.execute(["ls-files", "--stage", "-z"], repositoryPath);
      const trackedPaths = parseIndexEntries(index.stdout);

      if (trackedPaths.hasGitlink) {
        return unavailable("Repository contains a submodule gitlink.");
      }

      const configuredDrivers = await this.readConfiguredFilterDrivers(repositoryPath);
      if (configuredDrivers.size > 0) {
        const attributes = await this.execute(
          ["check-attr", "--stdin", "-z", "filter"],
          repositoryPath,
          trackedPaths.paths.map((path) => path + "\0").join(""),
        );
        if (hasActiveExternalFilter(attributes.stdout, configuredDrivers)) {
          return unavailable("Repository has an active external content filter.");
        }
      }

      const statusResult = await this.execute(STATUS_ARGS, repositoryPath);
      const status = parsePorcelainV2(statusResult.stdout);
      const branchesResult = await this.execute(
        ["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads/"],
        repositoryPath,
      );
      const localBranches = parseLocalBranches(branchesResult.stdout);
      const history = status.headKind === "unborn"
        ? []
        : parseHistory((await this.execute(HISTORY_ARGS, repositoryPath)).stdout);
      const currentLocation = createCurrentLocation(status, history);
      assertSnapshotInvariant(status, currentLocation, localBranches, history);
      const operation = await this.detectOperation(repositoryPath);

      return {
        kind: "available",
        value: {
          repository: { rootPath: repositoryRoot },
          currentLocation,
          localBranches,
          workingTree: status.workingTree,
          history,
          operation,
        },
      };
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "Core repository read failed.");
    }
  }

  private async readRepositoryRoot(repositoryPath: string): Promise<string> {
    const result = await this.execute(["rev-parse", "--show-toplevel"], repositoryPath);
    const rootPath = result.stdout.trim();
    if (!rootPath) {
      throw new Error("Git did not return a repository root.");
    }
    if (await realpath(repositoryPath) !== await realpath(rootPath)) {
      throw new Error("Selected repository path does not match Git repository root.");
    }
    return rootPath;
  }

  private async readConfiguredFilterDrivers(repositoryPath: string): Promise<Set<string>> {
    const result = await this.gitExecutor.execute(FILTER_CONFIG_ARGS, repositoryPath);
    if (result.kind === "completed" && result.exitCode === 1) {
      return new Set();
    }
    const completed = requireSuccessfulResult(result);
    return parseConfiguredFilterDrivers(completed.stdout);
  }

  private async detectOperation(repositoryPath: string): Promise<OperationState> {
    const exists = new Map<string, boolean>();
    for (const operationPath of OPERATION_PATHS) {
      const result = await this.execute(["rev-parse", "--git-path", operationPath], repositoryPath);
      const gitPath = result.stdout.trim();
      if (!gitPath) {
        throw new Error("Git did not return an operation path.");
      }
      exists.set(operationPath, await pathExists(isAbsolute(gitPath) ? gitPath : resolve(repositoryPath, gitPath)));
    }

    if (exists.get("rebase-merge")) return { kind: "rebase" };
    if (exists.get("rebase-apply") && exists.get("rebase-apply/rebasing")) return { kind: "rebase" };
    if (exists.get("rebase-apply")) return { kind: "unsupported", operationName: "am" };
    if (exists.get("MERGE_HEAD")) return { kind: "merge" };
    if (exists.get("CHERRY_PICK_HEAD")) return { kind: "unsupported", operationName: "cherry-pick" };
    if (exists.get("REVERT_HEAD")) return { kind: "unsupported", operationName: "revert" };
    if (exists.get("sequencer/todo")) return { kind: "unsupported", operationName: "sequencer" };
    if (exists.get("BISECT_START")) return { kind: "unsupported", operationName: "bisect" };
    return { kind: "normal" };
  }

  private async execute(
    args: readonly string[],
    repositoryPath: string,
    stdin?: string,
  ): Promise<{ readonly stdout: string; readonly stderr: string }> {
    return requireSuccessfulResult(await this.gitExecutor.execute(args, repositoryPath, stdin));
  }
}

interface ParsedStatus {
  readonly headKind: "branch" | "detached" | "unborn";
  readonly branchName: string | null;
  readonly headId: string | null;
  readonly workingTree: MutableWorkingTree;
}

interface MutableWorkingTree {
  readonly staged: FileChange[];
  readonly unstaged: FileChange[];
  readonly untracked: string[];
  readonly conflicts: { path: string; kind: ConflictKind }[];
}

export function parsePorcelainV2(stdout: string): ParsedStatus {
  let branchName: string | undefined;
  let branchOid: string | undefined;
  const workingTree: MutableWorkingTree = { staged: [], unstaged: [], untracked: [], conflicts: [] };
  const fields = splitNul(stdout);

  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (record.startsWith("# ")) {
      if (record.startsWith("# branch.oid ")) branchOid = record.slice("# branch.oid ".length);
      if (record.startsWith("# branch.head ")) branchName = record.slice("# branch.head ".length);
      continue;
    }
    if (record.startsWith("1 ")) parseOrdinaryRecord(record, workingTree);
    else if (record.startsWith("2 ")) {
      const originalPath = fields[++index];
      if (originalPath === undefined) throw new Error("Rename record is missing its original path.");
      parseRenameRecord(record, originalPath, workingTree);
    } else if (record.startsWith("u ")) parseConflictRecord(record, workingTree);
    else if (record.startsWith("? ")) workingTree.untracked.push(record.slice(2));
    else throw new Error("Unknown porcelain v2 record.");
  }

  if (branchName === undefined || branchOid === undefined) throw new Error("Status is missing branch headers.");
  if (branchOid === "(initial)") {
    if (branchName === "(detached)") throw new Error("Unborn repository cannot have detached HEAD.");
    return { headKind: "unborn", branchName, headId: null, workingTree };
  }
  if (!isCommitId(branchOid)) throw new Error("Status contains an invalid HEAD commit id.");
  return branchName === "(detached)"
    ? { headKind: "detached", branchName: null, headId: branchOid, workingTree }
    : { headKind: "branch", branchName, headId: branchOid, workingTree };
}

export function parseIndexEntries(stdout: string): { readonly paths: readonly string[]; readonly hasGitlink: boolean } {
  const paths = new Set<string>();
  let hasGitlink = false;
  for (const entry of splitNul(stdout)) {
    const tab = entry.indexOf("\t");
    if (tab < 0) throw new Error("Invalid index entry.");
    const metadata = entry.slice(0, tab).split(" ");
    if (metadata.length !== 3 || !/^[0-7]{6}$/.test(metadata[0])) throw new Error("Invalid index metadata.");
    if (metadata[0] === "160000") hasGitlink = true;
    paths.add(entry.slice(tab + 1));
  }
  return { paths: [...paths], hasGitlink };
}

export function parseConfiguredFilterDrivers(stdout: string): Set<string> {
  const drivers = new Set<string>();
  for (const key of splitNul(stdout)) {
    const match = /^filter\.(.+)\.(?:clean|process)$/.exec(key);
    if (!match || !match[1]) throw new Error("Invalid filter config key.");
    drivers.add(match[1]);
  }
  return drivers;
}

export function hasActiveExternalFilter(stdout: string, configuredDrivers: ReadonlySet<string>): boolean {
  const fields = splitNul(stdout);
  if (fields.length % 3 !== 0) throw new Error("Invalid filter attribute output.");
  for (let index = 0; index < fields.length; index += 3) {
    if (fields[index + 1] !== "filter") throw new Error("Unexpected filter attribute name.");
    if (configuredDrivers.has(fields[index + 2])) return true;
  }
  return false;
}

export function parseLocalBranches(stdout: string): readonly LocalBranch[] {
  return stdout.split("\n").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    const ref = line.slice(0, tab);
    const tipCommitId = line.slice(tab + 1);
    if (tab < 0 || !ref.startsWith("refs/heads/") || !isCommitId(tipCommitId)) throw new Error("Invalid local branch output.");
    return { name: ref.slice("refs/heads/".length), tipCommitId };
  });
}

export function parseHistory(stdout: string): readonly HistoryCommit[] {
  const fields = splitNul(stdout);
  if (fields.length % 4 !== 0) throw new Error("Invalid history output.");
  const history: HistoryCommit[] = [];
  for (let index = 0; index < fields.length; index += 4) {
    const [id, shortId, parents, subject] = fields.slice(index, index + 4);
    if (!isCommitId(id) || !shortId || parents === undefined || subject === undefined) throw new Error("Invalid history commit.");
    const parentIds = parents ? parents.split(" ") : [];
    if (!parentIds.every(isCommitId)) throw new Error("Invalid history parent id.");
    history.push({ commit: { id, shortId, subject }, parentIds });
  }
  return history;
}

function parseOrdinaryRecord(record: string, workingTree: MutableWorkingTree): void {
  const fields = splitFields(record, 8);
  const xy = fields[1];
  const submodule = fields[2];
  const path = fields[8];
  if (!xy || !path || submodule !== "N...") throw new Error("Invalid ordinary status record.");
  addFileChanges(xy, path, ordinaryChangeKind, workingTree);
}

function parseRenameRecord(record: string, originalPath: string, workingTree: MutableWorkingTree): void {
  const fields = splitFields(record, 9);
  const xy = fields[1];
  const submodule = fields[2];
  const score = fields[8];
  const path = fields[9];
  if (!xy || xy.length !== 2 || !path || !originalPath || submodule !== "N..." || !/^[RC]\d+$/.test(score)) throw new Error("Invalid rename status record.");
  const kind = score[0] === "R" ? "renamed" : "copied";
  if (xy[0] !== score[0]) throw new Error("Rename score and staged status do not match.");
  workingTree.staged.push({ path, originalPath, kind });
  if (xy[1] !== ".") {
    if (xy[1] === "R" || xy[1] === "C") {
      if (xy[1] !== score[0]) throw new Error("Rename score and unstaged status do not match.");
      workingTree.unstaged.push({ path, originalPath, kind });
    } else {
      workingTree.unstaged.push({ path, kind: ordinaryChangeKind(xy[1]) });
    }
  }
}

function parseConflictRecord(record: string, workingTree: MutableWorkingTree): void {
  const fields = splitFields(record, 10);
  const xy = fields[1];
  const submodule = fields[2];
  const path = fields[10];
  if (!xy || !path || submodule !== "N...") throw new Error("Invalid conflict status record.");
  const kind = conflictKind(xy);
  workingTree.conflicts.push({ path, kind });
}

function addFileChanges(
  xy: string,
  path: string,
  changeKind: (status: string) => "added" | "modified" | "deleted" | "typeChanged",
  workingTree: MutableWorkingTree,
): void {
  if (xy.length !== 2) throw new Error("Invalid status XY field.");
  if (xy[0] !== ".") workingTree.staged.push({ path, kind: changeKind(xy[0]) });
  if (xy[1] !== ".") workingTree.unstaged.push({ path, kind: changeKind(xy[1]) });
}

function ordinaryChangeKind(status: string): "added" | "modified" | "deleted" | "typeChanged" {
  switch (status) {
    case "A": return "added";
    case "M": return "modified";
    case "D": return "deleted";
    case "T": return "typeChanged";
    default: throw new Error("Unsupported ordinary file status.");
  }
}

function conflictKind(xy: string): ConflictKind {
  const kinds: Record<string, ConflictKind> = {
    DD: "bothDeleted", AU: "addedByUs", UD: "deletedByThem", UA: "addedByThem",
    DU: "deletedByUs", AA: "bothAdded", UU: "bothModified",
  };
  if (!(xy in kinds)) throw new Error("Unsupported conflict status.");
  return kinds[xy];
}

function createCurrentLocation(status: ParsedStatus, history: readonly HistoryCommit[]): CurrentLocation {
  if (status.headKind === "unborn") return { kind: "unborn", branchName: status.branchName!, head: null, detached: false };
  const head = history.find((entry) => entry.commit.id === status.headId)?.commit;
  if (!head) throw new Error("HEAD commit is missing from history snapshot.");
  return status.headKind === "detached"
    ? { kind: "detached", branchName: null, head, detached: true }
    : { kind: "branch", branchName: status.branchName!, head, detached: false };
}

function assertSnapshotInvariant(
  status: ParsedStatus,
  location: CurrentLocation,
  localBranches: readonly LocalBranch[],
  history: readonly HistoryCommit[],
): void {
  if (status.headId !== null && !history.some((entry) => entry.commit.id === status.headId)) throw new Error("HEAD and history snapshot do not match.");
  if (location.kind === "branch") {
    const branch = localBranches.find((candidate) => candidate.name === location.branchName);
    if (!branch || branch.tipCommitId !== status.headId) throw new Error("Current branch snapshot does not match.");
  }
}

function splitNul(stdout: string): string[] {
  const fields = stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
}

function splitFields(record: string, separators: number): string[] {
  const fields: string[] = [];
  let remaining = record;
  for (let index = 0; index < separators; index += 1) {
    const separator = remaining.indexOf(" ");
    if (separator < 0) throw new Error("Invalid status record.");
    fields.push(remaining.slice(0, separator));
    remaining = remaining.slice(separator + 1);
  }
  fields.push(remaining);
  return fields;
}

function isCommitId(value: string): boolean { return /^[0-9a-f]{40}$/i.test(value); }

function requireSuccessfulResult(result: GitExecutionResult): { readonly stdout: string; readonly stderr: string } {
  if (result.kind !== "completed" || result.exitCode !== 0) throw new Error("Required Git command did not complete successfully.");
  return result;
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function unavailable(reason: string): AvailabilityResult<never> { return { kind: "unavailable", reason }; }
