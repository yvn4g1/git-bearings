import { strict as assert } from "node:assert";
import test from "node:test";
import { RepositoryStateSnapshotStore } from "../ui/repositoryStateSnapshot";
import { createSidebarPresentation } from "../ui/sidebarPresentation";
import { RepositoryStateRefreshController } from "./repositoryStateRefreshController";

const selectedRepository = { id: "repo", rootPath: "/repo" };

test("Core failure publication carries typed failure and reports technical detail", async () => {
  const store = new RepositoryStateSnapshotStore();
  const output: string[] = [];
  const controller = new RepositoryStateRefreshController({
    getSelectedRepository: () => selectedRepository,
    getSavedBase: () => undefined,
    read: async () => ({ kind: "unavailable", reason: "version gate technical detail" }),
    snapshotStore: store,
    getFailure: () => ({ kind: "unsupportedGitVersion", version: "2.22.9" }),
    onUnavailable: (reason) => output.push(reason),
  });

  await controller.refreshNow();

  assert.deepEqual(store.current, {
    kind: "unavailable",
    repositoryId: "repo",
    rootPath: "/repo",
    reason: "version gate technical detail",
    failure: { kind: "unsupportedGitVersion", version: "2.22.9" },
  });
  assert.deepEqual(output, ["version gate technical detail"]);
});

test("No Repository and Core failure remain different UI states", () => {
  const noRepository = createSidebarPresentation({ kind: "empty", reason: "noRepository" });
  assert.deepEqual(noRepository.map((item) => item.label), [
    "このworkspaceではGit Repositoryが見つかっていません",
    "Git Bearingsは既存Repositoryの状態を読み取るツールです。",
  ]);

  const failure = createSidebarPresentation({
    kind: "unavailable",
    repositoryId: "repo",
    rootPath: "/repo",
    reason: "core technical detail",
    failure: { kind: "coreReadFailure" },
  });
  assert.equal(failure[0].command?.command, "gitBearings.showOutput");
  assert.equal(failure[0].description, "Git Bearings Outputを開く");
  assert.equal(failure[1].label, "Git状態を安全に取得できません");
  assert.equal(failure[1].description, "再読み込み");
  assert.equal(failure[1].tooltip, "core technical detail");
  assert.equal(failure[1].command?.command, "gitBearings.refresh");
});

test("Unsupported Git version is explicit without parsing reason text", () => {
  const snapshot = {
    kind: "unavailable" as const,
    repositoryId: "repo",
    rootPath: "/repo",
    reason: "opaque technical detail",
    failure: { kind: "unsupportedGitVersion" as const, version: "2.22.9" },
  };

  const sidebar = createSidebarPresentation(snapshot);
  assert.equal(sidebar[1].label, "Git BearingsはGit 2.23以降を必要とします");
  assert.equal(sidebar[1].description, "現在: Git 2.22.9 · 再読み込み");
});
