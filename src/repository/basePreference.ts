import type { SavedBase } from "./baseResolver";

export const BASE_PREFERENCE_KEY = "gitBearings.baseByRepository.v1";

export interface BasePreferenceStorage {
  read(): unknown;
  write(value: Readonly<Record<string, SavedBase>>): PromiseLike<void> | void;
}

export class BasePreferenceController {
  constructor(private readonly storage: BasePreferenceStorage) {}

  get(repositoryId: string): SavedBase | undefined {
    return parsePreferences(this.storage.read())[repositoryId];
  }

  async save(repositoryId: string, base: SavedBase): Promise<void> {
    const current = parsePreferences(this.storage.read());
    await this.storage.write({ ...current, [repositoryId]: base });
  }
}

export function parsePreferences(value: unknown): Readonly<Record<string, SavedBase>> {
  if (!isRecord(value)) return {};
  const result: Record<string, SavedBase> = {};
  for (const [repositoryId, candidate] of Object.entries(value)) {
    const parsed = parseSavedBase(candidate);
    if (repositoryId && parsed) result[repositoryId] = parsed;
  }
  return result;
}

function parseSavedBase(value: unknown): SavedBase | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.kind === "local" &&
    typeof value.branchName === "string" && value.branchName.length > 0 &&
    value.ref === `refs/heads/${value.branchName}` &&
    Object.keys(value).every((key) => ["kind", "branchName", "ref"].includes(key))
  ) {
    return { kind: "local", branchName: value.branchName, ref: value.ref };
  }
  if (
    value.kind === "remoteTracking" &&
    typeof value.remoteName === "string" && value.remoteName.length > 0 &&
    typeof value.branchName === "string" && value.branchName.length > 0 &&
    typeof value.trackingRef === "string" && value.trackingRef.startsWith("refs/") &&
    Object.keys(value).every((key) => ["kind", "remoteName", "branchName", "trackingRef"].includes(key))
  ) {
    return {
      kind: "remoteTracking",
      remoteName: value.remoteName,
      branchName: value.branchName,
      trackingRef: value.trackingRef,
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
