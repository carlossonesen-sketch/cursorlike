import { invoke } from "@tauri-apps/api/core";

export interface DeveloperWorkspaceInfo {
  canonicalPath: string;
  branch: string;
  dirty: boolean;
  status: string;
  diff: string;
}

export interface RepositorySearchMatch {
  path: string;
  line?: number;
  preview?: string;
}

export interface DeveloperCommandRequest {
  runId: string;
  workspaceRoot: string;
  command: string;
  purpose: string;
  risk: string;
  timeoutMs: number;
  approved: boolean;
}

export interface DeveloperCommandResult {
  runId: string;
  command: string;
  workingDirectory: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
}

export async function inspectDeveloperWorkspace(workspaceRoot: string): Promise<DeveloperWorkspaceInfo> {
  return invoke<DeveloperWorkspaceInfo>("developer_inspect_workspace", { workspaceRoot });
}

export async function searchRepository(
  workspaceRoot: string,
  query: string,
  mode: "filename" | "text"
): Promise<RepositorySearchMatch[]> {
  return invoke<RepositorySearchMatch[]>("developer_search_repository", {
    workspaceRoot,
    query,
    mode,
  });
}

export async function runDeveloperCommand(request: DeveloperCommandRequest): Promise<DeveloperCommandResult> {
  return invoke<DeveloperCommandResult>("developer_run_approved_command", { request });
}

export async function cancelDeveloperCommand(runId: string): Promise<boolean> {
  return invoke<boolean>("developer_cancel_command", { runId });
}
