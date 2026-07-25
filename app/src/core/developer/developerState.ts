import type { FileSnapshot } from "../patch/PatchEngine";
import type { PlanAndPatch } from "../types";

export type PrimaryRoute = "developer" | "builder" | "settings";
export type DeveloperSection =
  | "workspace"
  | "files"
  | "assistant"
  | "changes"
  | "terminal"
  | "build-tests"
  | "git"
  | "memory";

export interface DeveloperGitState {
  branch: string;
  dirty: boolean;
  status: string;
  diff: string;
}

export interface DeveloperCommandState {
  runId: string;
  command: string;
  cwd: string;
  purpose: string;
  risk: string;
  status: "awaitingApproval" | "running" | "passed" | "failed" | "timedOut" | "cancelled";
  output: string;
  exitCode?: number;
  truncated?: boolean;
}

export interface DeveloperSessionState {
  schemaVersion: 1;
  workspacePath: string | null;
  selectedContextPaths: string[];
  openFilePath: string | null;
  pendingPatch: PlanAndPatch | null;
  pendingSelectedPaths: string[];
  lastAppliedSnapshots: FileSnapshot[];
  lastPrompt: string;
  activeSection: DeveloperSection;
  updatedAt: string;
}

export function createDeveloperSessionState(now = new Date().toISOString()): DeveloperSessionState {
  return {
    schemaVersion: 1,
    workspacePath: null,
    selectedContextPaths: [],
    openFilePath: null,
    pendingPatch: null,
    pendingSelectedPaths: [],
    lastAppliedSnapshots: [],
    lastPrompt: "",
    activeSection: "workspace",
    updatedAt: now,
  };
}

export function assertDeveloperPatchApproval(approved: boolean, patch: PlanAndPatch | null): void {
  if (!approved) throw new Error("Developer Mode requires explicit patch approval.");
  if (!patch?.patch.trim()) throw new Error("No patch proposal is awaiting approval.");
}

export function assertDeveloperCommandApproval(approved: boolean, command: string): void {
  if (!approved) throw new Error("Developer Mode requires explicit command approval.");
  if (!command.trim()) throw new Error("Command is required.");
}

export function isolateDeveloperSession(
  previous: DeveloperSessionState,
  workspacePath: string,
  now = new Date().toISOString()
): DeveloperSessionState {
  if (previous.workspacePath === workspacePath) return { ...previous, updatedAt: now };
  return { ...createDeveloperSessionState(now), workspacePath };
}
