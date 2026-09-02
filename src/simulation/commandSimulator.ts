import type { GitCommand } from "../domain/gitCommand";
import type { RepositoryState } from "../domain/repositoryState";
import type { SimulationResult } from "../domain/simulation";
import { simulateBasicGitCommand } from "./basicCommandSimulator";
import { simulateStashRemoteCommand } from "./stashRemoteCommandSimulator";

export function simulateGitCommand(state: RepositoryState, command: GitCommand): SimulationResult {
  switch (command.kind) {
    case "stashPush": case "stashList": case "stashApply": case "stashPop": case "fetch": case "push": return simulateStashRemoteCommand(state, command);
    default: return simulateBasicGitCommand(state, command);
  }
}
