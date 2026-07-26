import { invoke } from "@tauri-apps/api/core";

export interface DeveloperWorkspaceInfo {
  canonicalPath: string;
  repositoryName: string;
  branch: string;
  head: string;
  dirty: boolean;
  status: string;
  diff: string;
  profile: DeveloperWorkspaceProfile;
}

export interface DeveloperSuggestedCommand {
  label: string;
  command: string;
  permitted: boolean;
}

export interface DeveloperWorkspaceProfile {
  projectType: string;
  projectName?: string;
  flutterSdkAvailable: boolean;
  dartSdkAvailable: boolean;
  suggestedCommands: DeveloperSuggestedCommand[];
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

export interface RecentWorkspace {
  canonicalPath: string;
  repositoryName: string;
  branch: string;
  dirty: boolean;
  lastOpenedAt: string;
}

export interface ProviderSettings {
  provider: "local" | "openai" | "mock";
  openaiModel: string;
  localModelPath: string;
}

export interface ProviderDiagnostics {
  provider: string;
  state: "available" | "unavailable" | "error" | "mock";
  model: string;
  configured: boolean;
  credentialAvailable: boolean;
  localModelAvailable: boolean;
  real: boolean;
  message: string;
}

export interface OpenAiConnectivityResult {
  state: "available" | "unavailable" | "error";
  backendCredentialAvailable: boolean;
  model: string;
  diagnostic: string;
}

export interface FrictionEntry {
  id: string;
  timestamp: string;
  repositoryCanonicalPath: string;
  repositoryName: string;
  branch: string;
  area: "Workspace" | "File browser" | "Editor" | "AI context" | "Provider" | "Patch review" | "Commands" | "Tests" | "Session persistence" | "Performance" | "Other";
  description: string;
  severity: "Minor" | "Moderate" | "Blocking";
  status: "Open" | "Resolved" | "Deferred";
  notes?: string;
}

export type DeveloperAgentMode = "ask" | "agent" | "auto";

export interface AgentAuditEntry {
  timestamp: string;
  kind: string;
  message: string;
  status: string;
}

export interface AgentValidationResult {
  command: string;
  status: string;
  exitCode: number | null;
  output: string;
}

export interface AgentRunState {
  runId: string;
  workspace: string;
  mode: DeveloperAgentMode;
  status: string;
  plan: string[];
  response: string;
  pendingPatch: string | null;
  changedFiles: string[];
  validationCommands: string[];
  validationResults: AgentValidationResult[];
  approvalReason: string | null;
  risk: string;
  audit: AgentAuditEntry[];
  tools: string[];
  maxFiles: number;
  maxChangedLines: number;
  changes: {
    taskId: string;
    patchId: string;
    path: string;
    hunkCount: number;
    status: "pending" | "applied" | "rejected" | "reverted";
  }[];
}

export interface AgentStartRequest {
  runId: string;
  workspaceRoot: string;
  mode: DeveloperAgentMode;
  prompt: string;
  scope?: string;
  openFile?: string;
  selectedCode?: { path: string; startLine: number; endLine: number; content: string };
  trustedChanges: boolean;
  maxFiles?: number;
  maxChangedLines?: number;
}

export const startDeveloperAgent = (request: AgentStartRequest) =>
  invoke<AgentRunState>("developer_agent_start", { request });

export const approveDeveloperAgent = (runId: string) =>
  invoke<AgentRunState>("developer_agent_approve", { runId });

export const rejectDeveloperAgent = (runId: string) =>
  invoke<AgentRunState>("developer_agent_reject", { runId });

export const stopDeveloperAgent = (runId: string) =>
  invoke<AgentRunState>("developer_agent_stop", { runId });

export const revertDeveloperAgent = (runId: string, approved: boolean) =>
  invoke<AgentRunState>("developer_agent_revert", { runId, approved });

export interface DeveloperChangeHunk {
  hunkId: string;
  patchId: string;
  filePath: string;
  originalRange: string;
  replacementRange: string;
  preview: string;
  selected: boolean;
  status: string;
}

export interface DeveloperChangeRecord {
  changeId: string;
  patchId: string;
  taskId: string | null;
  source: "manual" | "agent" | "auto" | "external";
  workspace: string;
  filePath: string;
  operation: "modify" | "create" | "delete" | "rename";
  originalHash: string;
  currentHash: string;
  baseSnapshotReference: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  hunks: DeveloperChangeHunk[];
}

export const proposeDeveloperChange = (
  workspaceRoot: string, source: DeveloperChangeRecord["source"],
  taskId: string | null, patchId: string, patch: string
) => invoke<DeveloperChangeRecord[]>("developer_changes_propose", {
  workspaceRoot, source, taskId, patchId, patch,
});

export const applyDeveloperChange = (
  patchId: string, approved: boolean, selectedPatch?: string
) => invoke<DeveloperChangeRecord[]>("developer_changes_apply", {
  patchId, approved, selectedPatch,
});

export const rejectDeveloperChange = (patchId: string) =>
  invoke<DeveloperChangeRecord[]>("developer_changes_reject", { patchId });

export const revertDeveloperChange = (patchId: string, approved: boolean) =>
  invoke<DeveloperChangeRecord[]>("developer_changes_revert", { patchId, approved });

export const listDeveloperChanges = (workspaceRoot: string) =>
  invoke<DeveloperChangeRecord[]>("developer_changes_list", { workspaceRoot });

export function groupDeveloperChanges(records: DeveloperChangeRecord[]) {
  const groups = new Map<string, DeveloperChangeRecord[]>();
  for (const record of records) {
    const current = groups.get(record.filePath) ?? [];
    current.push(record);
    groups.set(record.filePath, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, groupedRecords]) => ({
      filePath,
      records: groupedRecords.sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.changeId.localeCompare(right.changeId)
      ),
    }));
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

export const listRecentWorkspaces = () =>
  invoke<RecentWorkspace[]>("developer_recent_workspaces");

export const recordRecentWorkspace = (workspace: RecentWorkspace) =>
  invoke<RecentWorkspace[]>("developer_record_recent_workspace", { workspace });

export const removeRecentWorkspace = (canonicalPath: string) =>
  invoke<RecentWorkspace[]>("developer_remove_recent_workspace", { canonicalPath });

export const getProviderSettings = () =>
  invoke<ProviderSettings>("developer_get_provider_settings");

export const setProviderSettings = (settings: ProviderSettings) =>
  invoke<void>("developer_set_provider_settings", { settings });

export const getProviderDiagnostics = () =>
  invoke<ProviderDiagnostics>("developer_provider_diagnostics");

export const testOpenAiConnectivity = (model: string) =>
  invoke<OpenAiConnectivityResult>("openai_test_connectivity", { model });

export const listFrictionEntries = () =>
  invoke<FrictionEntry[]>("developer_list_friction");

export const saveFrictionEntry = (entry: FrictionEntry) =>
  invoke<FrictionEntry[]>("developer_save_friction", { entry });

export const removeFrictionEntry = (id: string) =>
  invoke<FrictionEntry[]>("developer_remove_friction", { id });
