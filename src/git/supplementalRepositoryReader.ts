import type {
  AvailabilityResult,
  CoreRepositoryFacts,
  DataResult,
  Remote,
  RemoteTrackingRef,
  StashEntry,
  SupplementalRepositoryFacts,
  Upstream,
} from "../domain/repositoryState";
import { GitExecutor, type GitExecutionResult } from "./gitExecutor";

const REMOTE_FETCH_REFSPEC_ARGS = ["config", "--null", "--get-regexp", "^remote\\..*\\.fetch$"] as const;
const ALL_REFS_ARGS = ["for-each-ref", "--format=%(objectname)%00%(refname)%00%(symref)%00", "refs/"] as const;
const BRANCH_UPSTREAM_ARGS = ["for-each-ref", "--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)%00", "refs/heads/"] as const;
const UNBORN_UPSTREAM_CONFIG_ARGS = ["config", "--null", "--get-regexp", "^branch\\..*\\.(remote|merge)$"] as const;
const RELATION_ARGS = ["rev-list", "--left-right", "--count", "--stdin"] as const;
const STASH_ARGS = ["stash", "list", "--format=%gd%x00%H%x00%gs%x00"] as const;

interface RawRef { readonly commitId: string; readonly refName: string; readonly symref: string; }
interface Refspec { readonly source: Pattern; readonly destination?: Pattern; readonly negative: boolean; }
interface Pattern { readonly prefix: string; readonly suffix: string; readonly wildcard: boolean; }
interface BranchConfig { readonly remoteName: string; readonly mergeRef: string; readonly trackingRef?: string; }

export class SupplementalRepositoryReader {
  constructor(private readonly gitExecutor: GitExecutor) {}

  async read(repositoryPath: string, coreFacts: Pick<CoreRepositoryFacts, "currentLocation">): Promise<SupplementalRepositoryFacts> {
    const refs = this.readRefs(repositoryPath);
    const observedRefs = refs.catch(() => undefined);
    const [remotes, upstream, stash] = await Promise.all([
      this.readRemotes(repositoryPath, refs),
      this.readUpstream(repositoryPath, coreFacts, refs),
      this.readStash(repositoryPath),
    ]);
    await observedRefs;
    return { remotes, upstream, stash };
  }

  private async readRemotes(repositoryPath: string, refs: Promise<readonly RawRef[]>): Promise<DataResult<readonly Remote[]>> {
    try {
      const names = parseRemoteNames((await this.success(["remote"], repositoryPath)).stdout);
      if (names.length === 0) return available([]);
      const refspecResult = await this.gitExecutor.execute(REMOTE_FETCH_REFSPEC_ARGS, repositoryPath);
      const refspecs = refspecResult.kind === "completed" && refspecResult.exitCode === 1
        ? new Map<string, readonly Refspec[]>()
        : parseRemoteFetchRefspecs(requireSuccess(refspecResult).stdout);
      return available(mapRemotes(names, refspecs, await refs));
    } catch {
      return unavailable("Remote facts could not be read safely.");
    }
  }

  private async readUpstream(repositoryPath: string, coreFacts: Pick<CoreRepositoryFacts, "currentLocation">, refs: Promise<readonly RawRef[]>): Promise<DataResult<Upstream>> {
    const location = coreFacts.currentLocation;
    if (location.kind === "detached") return { kind: "notConfigured" };
    try {
      const config = location.kind === "unborn"
        ? await this.readUnbornConfig(repositoryPath, location.branchName)
        : await this.readBranchMetadata(repositoryPath, location.branchName);
      if (!config) return { kind: "notConfigured" };
      const upstream = await this.createUpstream(repositoryPath, config);
      if (location.kind === "unborn") return available({ ...upstream, relation: unavailable("An unborn branch has no local commit tip.") });
      const tracking = (await refs).find((ref) => ref.refName === upstream.trackingRef && ref.symref === "");
      if (!tracking) return available({ ...upstream, relation: unavailable("The upstream tracking ref is not available locally.") });
      const relation = await this.readRelation(repositoryPath, location.head.id, tracking.commitId);
      return available({ ...upstream, relation });
    } catch {
      return unavailable("Upstream configuration could not be read safely.");
    }
  }

  private async readStash(repositoryPath: string): Promise<AvailabilityResult<readonly StashEntry[]>> {
    try { return available(parseStash((await this.success(STASH_ARGS, repositoryPath)).stdout)); }
    catch { return unavailable("Stash facts could not be read."); }
  }

  private async readRefs(repositoryPath: string): Promise<readonly RawRef[]> {
    return parseRefs((await this.success(ALL_REFS_ARGS, repositoryPath)).stdout);
  }

  private async readBranchMetadata(repositoryPath: string, branchName: string): Promise<BranchConfig | undefined> {
    const refName = `refs/heads/${branchName}`;
    const entries = parseBranchMetadata((await this.success(BRANCH_UPSTREAM_ARGS, repositoryPath)).stdout, refName);
    if (!entries.has(refName)) throw new Error("Current branch is absent from the local ref snapshot.");
    return entries.get(refName);
  }

  private async readUnbornConfig(repositoryPath: string, branchName: string): Promise<BranchConfig | undefined> {
    const result = await this.gitExecutor.execute(UNBORN_UPSTREAM_CONFIG_ARGS, repositoryPath);
    if (result.kind === "completed" && result.exitCode === 1) return undefined;
    return parseUnbornBranchConfig(requireSuccess(result).stdout, branchName);
  }

  private async createUpstream(repositoryPath: string, config: BranchConfig): Promise<Upstream> {
    const branchName = config.mergeRef.slice("refs/heads/".length);
    if (!branchName) throw new Error("Invalid upstream branch.");
    const trackingRef = config.trackingRef ?? (config.remoteName === "."
      ? config.mergeRef
      : mapSourceToDestination(config.mergeRef, (await this.readFetchRefspecs(repositoryPath)).get(config.remoteName) ?? []));
    if (!trackingRef) throw new Error("The upstream tracking ref cannot be resolved safely.");
    return { remoteName: config.remoteName, branchName, trackingRef, relation: unavailable("Relation has not been read.") };
  }

  private async readFetchRefspecs(repositoryPath: string): Promise<Map<string, readonly Refspec[]>> {
    const result = await this.gitExecutor.execute(REMOTE_FETCH_REFSPEC_ARGS, repositoryPath);
    if (result.kind === "completed" && result.exitCode === 1) return new Map();
    return parseRemoteFetchRefspecs(requireSuccess(result).stdout);
  }

  private async readRelation(repositoryPath: string, localCommitId: string, upstreamCommitId: string): Promise<AvailabilityResult<{ readonly ahead: number; readonly behind: number }>> {
    if (!isCommitId(localCommitId) || !isCommitId(upstreamCommitId)) return unavailable("The relation commit ids are invalid.");
    try {
      const result = await this.success(RELATION_ARGS, repositoryPath, `${localCommitId}...${upstreamCommitId}\n`);
      return available(parseAheadBehind(result.stdout));
    } catch { return unavailable("The upstream tracking relation could not be read."); }
  }

  private async success(args: readonly string[], repositoryPath: string, stdin?: string): Promise<{ readonly stdout: string; readonly stderr: string }> {
    return requireSuccess(await this.gitExecutor.execute(args, repositoryPath, stdin));
  }
}

export function parseRemoteFetchRefspecs(stdout: string): Map<string, readonly Refspec[]> {
  const result = new Map<string, Refspec[]>();
  for (const record of splitNul(stdout)) {
    const separator = record.indexOf("\n");
    if (separator < 1) throw new Error("Invalid remote fetch config output.");
    const key = record.slice(0, separator); const value = record.slice(separator + 1);
    const match = /^remote\.(.+)\.fetch$/.exec(key);
    if (!match || !value) throw new Error("Invalid remote fetch config entry.");
    const entries = result.get(match[1]) ?? []; entries.push(parseRefspec(value)); result.set(match[1], entries);
  }
  return result;
}

export function mapRemotes(names: readonly string[], refspecs: ReadonlyMap<string, readonly Refspec[]>, refs: readonly RawRef[]): readonly Remote[] {
  const tracking = new Map<string, RemoteTrackingRef[]>();
  for (const name of names) tracking.set(name, []);
  for (const ref of refs) {
    if (ref.symref) continue;
    const mappings: { readonly remoteName: string; readonly source: string }[] = [];
    for (const name of names) {
      const source = mapDestinationToSource(ref.refName, refspecs.get(name) ?? []);
      if (source) mappings.push({ remoteName: name, source });
    }
    if (mappings.length > 1) throw new Error("A tracking ref belongs to multiple remotes.");
    const mapping = mappings[0];
    if (!mapping) continue;
    if (!mapping.source.startsWith("refs/heads/") || mapping.source.length === "refs/heads/".length || !isCommitId(ref.commitId)) throw new Error("A fetch refspec cannot be represented as a remote branch.");
    tracking.get(mapping.remoteName)!.push({ branchName: mapping.source.slice("refs/heads/".length), trackingRef: ref.refName, commitId: ref.commitId });
  }
  return names.map((name) => {
    const refsForRemote = tracking.get(name)!;
    const head = refs.find((ref) => ref.refName === `refs/remotes/${name}/HEAD` && ref.symref !== "");
    const target = head ? refsForRemote.find((ref) => ref.trackingRef === head.symref) : undefined;
    return { name, trackingRefs: refsForRemote, locallyKnownDefaultBranch: target ? { branchName: target.branchName, trackingRef: target.trackingRef } : null };
  });
}

export function parseRefs(stdout: string): readonly RawRef[] {
  const fields = splitNul(stdout); if (fields.length % 3 !== 0) throw new Error("Invalid ref output.");
  const refs: RawRef[] = [];
  for (let index = 0; index < fields.length; index += 3) {
    const commitId = fields[index].replace(/^\n/, ""); const refName = fields[index + 1]; const symref = fields[index + 2];
    if (!isCommitId(commitId) || !refName?.startsWith("refs/") || symref === undefined) throw new Error("Invalid ref entry.");
    refs.push({ commitId, refName, symref });
  }
  return refs;
}

export function parseStash(stdout: string): readonly StashEntry[] {
  const fields = splitNul(stdout); if (fields.length % 3 !== 0) throw new Error("Invalid stash output.");
  return fields.reduce<StashEntry[]>((entries, _, index) => {
    if (index % 3 !== 0) return entries;
    const selector = fields[index].replace(/^\n/, ""); const commitId = fields[index + 1]; const message = fields[index + 2];
    const match = /^stash@\{(\d+)\}$/.exec(selector);
    if (!match || !isCommitId(commitId) || message === undefined) throw new Error("Invalid stash entry.");
    entries.push({ index: Number.parseInt(match[1], 10), commitId, message }); return entries;
  }, []);
}
export function parseAheadBehind(stdout: string): { readonly ahead: number; readonly behind: number } {
  const match = /^(\d+)\t(\d+)\n?$/.exec(stdout);
  if (!match) throw new Error("Invalid upstream relation output.");
  return { ahead: Number.parseInt(match[1], 10), behind: Number.parseInt(match[2], 10) };
}

function parseRemoteNames(stdout: string): readonly string[] {
  const names = stdout.split("\n").filter(Boolean); if (new Set(names).size !== names.length) throw new Error("Duplicate remote name."); return names;
}
function parseBranchMetadata(stdout: string, currentRef: string): Map<string, BranchConfig | undefined> {
  const fields = splitNul(stdout); if (fields.length % 4 !== 0) throw new Error("Invalid upstream metadata output."); const result = new Map<string, BranchConfig | undefined>();
  for (let index = 0; index < fields.length; index += 4) {
    const ref = fields[index].replace(/^\n/, ""); const remoteName = fields[index + 1]; const remoteRef = fields[index + 2]; const trackingRef = fields[index + 3];
    if (!ref.startsWith("refs/heads/")) throw new Error("Invalid local branch ref.");
    if (ref !== currentRef) continue;
    if (!remoteName && !remoteRef && !trackingRef) result.set(ref, undefined);
    else {
      if (!remoteName || !remoteRef?.startsWith("refs/heads/") || (trackingRef && !trackingRef.startsWith("refs/"))) throw new Error("Incomplete upstream metadata.");
      result.set(ref, { remoteName, mergeRef: remoteRef, trackingRef: trackingRef || undefined });
    }
  }
  return result;
}
function parseUnbornBranchConfig(stdout: string, branchName: string): BranchConfig | undefined {
  const values = new Map<string, string>();
  for (const record of splitNul(stdout)) {
    const separator = record.indexOf("\n"); if (separator < 1) throw new Error("Invalid branch config output.");
    const key = record.slice(0, separator); const value = record.slice(separator + 1); const match = /^branch\.(.+)\.(remote|merge)$/.exec(key);
    if (!match || !value) throw new Error("Invalid branch config entry.");
    if (match[1] !== branchName) continue;
    if (values.has(match[2])) throw new Error("Invalid branch config entry."); values.set(match[2], value);
  }
  if (values.size === 0) return undefined;
  const remoteName = values.get("remote"); const mergeRef = values.get("merge"); if (!remoteName || !mergeRef?.startsWith("refs/heads/")) throw new Error("Incomplete unborn branch upstream config.");
  return { remoteName, mergeRef };
}
function parseRefspec(value: string): Refspec {
  let refspec = value; let negative = false; const forced = refspec.startsWith("+"); if (forced) refspec = refspec.slice(1); if (refspec.startsWith("^")) { if (forced) throw new Error("Unsupported forced negative refspec."); negative = true; refspec = refspec.slice(1); }
  const parts = refspec.split(":"); if (!refspec || parts.length > 2 || (negative && parts.length !== 1) || (!negative && parts.length !== 2)) throw new Error("Unsupported fetch refspec.");
  const source = parsePattern(parts[0]); const destination = negative ? undefined : parsePattern(parts[1]); if (destination && source.wildcard !== destination.wildcard) throw new Error("Unsupported fetch refspec wildcard.");
  return { source, destination, negative };
}
function parsePattern(value: string): Pattern { if (!value || !value.startsWith("refs/") || (value.match(/\*/g)?.length ?? 0) > 1) throw new Error("Invalid refspec pattern."); const wildcardAt = value.indexOf("*"); return wildcardAt < 0 ? { prefix: value, suffix: "", wildcard: false } : { prefix: value.slice(0, wildcardAt), suffix: value.slice(wildcardAt + 1), wildcard: true }; }
function mapDestinationToSource(destination: string, refspecs: readonly Refspec[]): string | undefined {
  const matches: string[] = [];
  for (const refspec of refspecs) {
    if (refspec.negative || !refspec.destination) continue; const wildcard = matchPattern(refspec.destination, destination); if (wildcard === undefined) continue; const source = refspec.source.wildcard ? refspec.source.prefix + wildcard + refspec.source.suffix : refspec.source.prefix;
    if (!refspecs.some((negative) => negative.negative && matchPattern(negative.source, source) !== undefined)) matches.push(source);
  }
  if (new Set(matches).size > 1) throw new Error("A tracking ref maps to multiple source refs."); return matches[0];
}
function mapSourceToDestination(source: string, refspecs: readonly Refspec[]): string | undefined {
  const matches: string[] = [];
  for (const refspec of refspecs) {
    if (refspec.negative || !refspec.destination) continue; const wildcard = matchPattern(refspec.source, source); if (wildcard === undefined) continue;
    if (!refspecs.some((negative) => negative.negative && matchPattern(negative.source, source) !== undefined)) matches.push(refspec.destination.wildcard ? refspec.destination.prefix + wildcard + refspec.destination.suffix : refspec.destination.prefix);
  }
  if (new Set(matches).size > 1) throw new Error("An upstream maps to multiple tracking refs."); return matches[0];
}
function matchPattern(pattern: Pattern, value: string): string | undefined { if (!value.startsWith(pattern.prefix) || !value.endsWith(pattern.suffix)) return undefined; const middle = value.slice(pattern.prefix.length, value.length - pattern.suffix.length); return pattern.wildcard ? middle : middle === "" ? "" : undefined; }
function splitNul(stdout: string): string[] { const fields = stdout.split("\0"); if (fields.at(-1) === "" || fields.at(-1) === "\n") fields.pop(); return fields; }
function isCommitId(value: string | undefined): value is string { return !!value && /^[0-9a-f]{40}$/i.test(value); }
function requireSuccess(result: GitExecutionResult): { readonly stdout: string; readonly stderr: string } { if (result.kind !== "completed" || result.exitCode !== 0) throw new Error("Git command failed."); return result; }
function available<T>(value: T): { readonly kind: "available"; readonly value: T } { return { kind: "available", value }; }
function unavailable(reason: string): { readonly kind: "unavailable"; readonly reason: string } { return { kind: "unavailable", reason }; }
