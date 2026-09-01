import type { CommitDetail } from "../domain/commitDetail";
import type { AvailabilityResult } from "../domain/repositoryState";
import { GitExecutor } from "./gitExecutor";

const FULL_OID = /^[0-9a-f]{40}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const METADATA_PREFIX = ["show", "-s", "--format=format:%H%x00%an%x00%aI%x00%P%x00", "--no-ext-diff", "--no-textconv"] as const;
const FILES_PREFIX = ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--no-ext-diff", "--no-textconv"] as const;

export class CommitDetailReader {
  constructor(private readonly executor: GitExecutor) {}

  async read(repositoryPath: string, requestedHash: string): Promise<AvailabilityResult<CommitDetail>> {
    if (!isFullOid(requestedHash)) return unavailable();
    const metadataResult = await this.executor.execute([...METADATA_PREFIX, requestedHash], repositoryPath);
    if (metadataResult.kind !== "completed" || metadataResult.exitCode !== 0) return unavailable();
    const metadata = parseMetadata(metadataResult.stdout, requestedHash);
    if (!metadata) return unavailable();
    const args = metadata.parents.length === 0
      ? [...FILES_PREFIX, "--root", requestedHash]
      : [...FILES_PREFIX, metadata.parents[0], requestedHash];
    const filesResult = await this.executor.execute(args, repositoryPath);
    if (filesResult.kind !== "completed" || filesResult.exitCode !== 0) return unavailable();
    const changedFiles = parseNulPaths(filesResult.stdout);
    if (!changedFiles) return unavailable();
    return { kind: "available", value: { ...metadata, changedFiles, changedFileCount: changedFiles.length } };
  }
}

export function parseCommitDetailMetadata(output: string, requestedHash: string): Omit<CommitDetail, "changedFiles" | "changedFileCount"> | undefined {
  return parseMetadata(output, requestedHash);
}

export function parseCommitDetailPaths(output: string): readonly string[] | undefined { return parseNulPaths(output); }

function parseMetadata(output: string, requestedHash: string): Omit<CommitDetail, "changedFiles" | "changedFileCount"> | undefined {
  if (!isFullOid(requestedHash)) return undefined;
  const fields = output.split("\0");
  if (fields.length !== 5 || fields[4] !== "") return undefined;
  const [fullHash, author, authoredAt, parentsField] = fields;
  if (fullHash !== requestedHash || !isFullOid(fullHash) || !ISO_8601.test(authoredAt)) return undefined;
  const parents = parentsField === "" ? [] : parentsField.split(" ");
  if (!parents.every(isFullOid)) return undefined;
  return { fullHash, author, authoredAt, parents };
}

function parseNulPaths(output: string): readonly string[] | undefined {
  if (output === "") return [];
  if (!output.endsWith("\0")) return undefined;
  return output.slice(0, -1).split("\0");
}

function isFullOid(value: string): boolean { return FULL_OID.test(value); }
function unavailable(): AvailabilityResult<CommitDetail> { return { kind: "unavailable", reason: "Commit detail is unavailable." }; }
