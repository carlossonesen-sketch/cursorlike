/**
 * Runtime API: Tauri commands for local llama-server (start/status/stop/generate).
 * Uses toolRoot for automatic llama-server path; no UI picker.
 */

import { invoke } from "@tauri-apps/api/core";

export type Provider = "mock" | "local";

const DEFAULT_PORT = 11435;

export interface RuntimeStartParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  context_length?: number;
}

export interface LocalModelSettings {
  ggufPath: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  context_length: number;
}

export const DEFAULT_LOCAL_SETTINGS: LocalModelSettings = {
  ggufPath: "",
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 2048,
  context_length: 4096,
};

export interface RuntimeStartResult {
  port: number;
}

export interface RuntimeStatusResult {
  running: boolean;
  port: number | null;
}

export interface GenerateOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface ChatOptions {
  max_tokens?: number;
  temperature?: number;
}

/** Try /v1/chat/completions first; on failure try /completion. Returns assistant content or throws. */
export async function runtimeChat(
  systemPrompt: string,
  userPrompt: string,
  options?: ChatOptions
): Promise<string> {
  return invoke<string>("runtime_chat", {
    systemPrompt,
    userPrompt,
    options: options ?? undefined,
  });
}

/** Walk up from workspace_root (up to 8 levels). First dir with runtime/llama + models/ is toolRoot. */
export async function findToolRoot(workspaceRoot: string): Promise<string | null> {
  const result = await invoke<unknown>("find_tool_root", { workspaceRoot });
  return typeof result === "string" ? result : null;
}

/** Scan toolRoot/models for *.gguf. Returns toolRoot-relative path (e.g. models/foo.gguf) or null. */
export async function scanModelsForGGUF(toolRoot: string): Promise<string | null> {
  const result = await invoke<unknown>("scan_models_for_gguf", { toolRoot });
  return typeof result === "string" ? result : null;
}

/** Check that toolRoot/relPath exists. */
export async function toolRootExists(toolRoot: string, relPath: string): Promise<boolean> {
  return invoke<boolean>("tool_root_exists", { toolRoot, relPath });
}

/** Resolve tool root: UI path if valid, else global %LOCALAPPDATA%\\DevAssistantCursorLite\\tools. Throws if not found. */
export async function getResolvedToolRoot(toolRootFromUi: string | null): Promise<string> {
  return invoke<string>("resolve_tool_root_cmd", {
    toolRootFromUi: toolRootFromUi ?? undefined,
  });
}

/** Check if path exists as a file (e.g. GGUF path). */
export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path: path ?? "" });
}

/** GET http://127.0.0.1:port/health; true if 200. */
export async function runtimeHealthCheck(port: number): Promise<boolean> {
  return invoke<boolean>("runtime_health_check", { port });
}

export function resolveModelPath(toolRoot: string, relPath: string): string {
  const root = toolRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return root + "/" + rel;
}

export async function runtimeStart(
  ggufPath: string,
  toolRoot: string | null,
  params: RuntimeStartParams | null,
  portOverride?: number | null,
  logFilePath?: string | null
): Promise<RuntimeStartResult> {
  return invoke<RuntimeStartResult>("runtime_start", {
    ggufPath,
    toolRoot: toolRoot || undefined,
    params: params || undefined,
    portOverride: portOverride ?? undefined,
    logFilePath: logFilePath || undefined,
  });
}

export async function runtimeStatus(): Promise<RuntimeStatusResult> {
  return invoke<RuntimeStatusResult>("runtime_status");
}

const RUNTIME_LOG_REL = ".devassistant/logs/llama-server.log";
const RUNTIME_LOG_MAX_LINES = 200;

/** Read last N lines of runtime log file under workspace. Returns [] if file missing. */
export async function getRuntimeLogLines(
  workspaceRoot: string,
  maxLines: number = RUNTIME_LOG_MAX_LINES
): Promise<string[]> {
  const lines = await invoke<string[]>("workspace_read_file_tail", {
    workspaceRoot,
    path: RUNTIME_LOG_REL,
    maxLines,
  });
  return lines ?? [];
}

export async function runtimeStop(): Promise<void> {
  return invoke("runtime_stop");
}

export async function runtimeGenerate(
  prompt: string,
  stream: boolean,
  options?: GenerateOptions
): Promise<string> {
  return invoke<string>("runtime_generate", {
    prompt,
    stream,
    options: options || undefined,
  });
}

/** Ensure local runtime is running; start with toolRoot/model/port if not. Backend resolves tool root (global fallback). Throws if model missing or start fails. */
export async function ensureLocalRuntime(
  settings: LocalModelSettings,
  toolRoot: string | null,
  port?: number | null
): Promise<number> {
  const status = await runtimeStatus();
  const usePort = port ?? DEFAULT_PORT;
  if (status.running && status.port === usePort) {
    return usePort;
  }
  if (!settings.ggufPath?.trim()) {
    throw new Error("GGUF model path is required for local provider. Add a .gguf in Settings > Models.");
  }
  const result = await runtimeStart(settings.ggufPath, toolRoot, {
    temperature: settings.temperature,
    top_p: settings.top_p,
    max_tokens: settings.max_tokens,
    context_length: settings.context_length,
  }, usePort, null);
  return result.port;
}
