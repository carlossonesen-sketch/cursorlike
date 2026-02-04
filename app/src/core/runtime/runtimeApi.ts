/**
 * Runtime API: Tauri commands for local llama-server (start/status/stop/generate).
 * Uses toolRoot for automatic llama-server path; no UI picker.
 */

import { invoke } from "@tauri-apps/api/core";

export type Provider = "mock" | "local";

/** Default port for llama-server (override with env LLAMA_PORT on backend). */
const DEFAULT_PORT = 8080;

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
  max_tokens: 128,
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

/** Cancel an in-flight run (e.g. after timeout or user Stop). No-op if run_id not registered. */
export function runtimeCancelRun(runId: string): void {
  invoke("runtime_cancel_run", { runId }).catch(() => {
    /* ignore */
  });
}

/** Try /v1/chat/completions first; on failure try /completion. Returns assistant content or throws. If runId provided, backend can abort via runtime_cancel_run. */
export async function runtimeChat(
  systemPrompt: string,
  userPrompt: string,
  options?: ChatOptions,
  runId?: string
): Promise<string> {
  return invoke<string>("runtime_chat", {
    systemPrompt,
    userPrompt,
    options: options ?? undefined,
    runId: runId ?? undefined,
  });
}

/** Relative path to llama-server.exe under toolRoot. */
export const LLAMA_SERVER_REL = "runtime/llama/llama-server.exe";

/** Walk up from workspace_root (up to 8 levels). First dir with runtime/llama + models/ is toolRoot. */
/** Effective toolRoot = local (if has llama-server) ?? global. Returns global path even when llama-server is missing (for Initialize Tools). */
export async function findToolRoot(workspaceRoot: string): Promise<string | null> {
  try {
    const local = await invoke<unknown>("find_tool_root", { workspaceRoot });
    if (typeof local === "string" && local) {
      const hasLlama = await toolRootExists(local, LLAMA_SERVER_REL);
      if (hasLlama) return local;
    }
  } catch {
    /* local discovery failed (e.g. invalid path, permission); fall through to global */
  }

  try {
    const globalRoot = await invoke<string>("get_global_tool_root");
    if (globalRoot?.trim()) return globalRoot;
  } catch {
    /* fall through */
  }
  return null;
}

/** Global tool root: %LOCALAPPDATA%\\DevAssistantCursorLite\\tools. */
export async function getGlobalToolRoot(): Promise<string> {
  return invoke<string>("get_global_tool_root");
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

/** GET http://127.0.0.1:port/health; true if 200. */
export async function runtimeHealthCheck(port: number): Promise<boolean> {
  return invoke<boolean>("runtime_health_check", { port });
}

/** GET http://127.0.0.1:port/health; returns status code or throws with error string. */
export async function runtimeHealthCheckStatus(port: number): Promise<number> {
  return invoke<number>("runtime_health_check_status", { port });
}

/** Last ~200 lines of llama-server stdout/stderr. */
export async function getRuntimeLog(): Promise<string[]> {
  return invoke<string[]>("get_runtime_log");
}

/** Scan %LOCALAPPDATA%\\DevAssistantCursorLite\\tools\\models for .gguf; prefer q4_k_m else largest. Returns absolute path or null. */
export async function scanGlobalModelsGGUF(): Promise<string | null> {
  const result = await invoke<unknown>("scan_global_models_gguf");
  return typeof result === "string" ? result : null;
}

export interface AppConfig {
  patch_timeout_seconds: number;
}

/** App config (e.g. PATCH_TIMEOUT_SECONDS from env, default 240). */
export async function getAppConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_app_config");
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

export async function runtimeStop(): Promise<void> {
  return invoke("runtime_stop");
}

/** Generate completion. If runId provided, backend can abort via runtime_cancel_run. */
export async function runtimeGenerate(
  prompt: string,
  stream: boolean,
  options?: GenerateOptions,
  runId?: string
): Promise<string> {
  return invoke<string>("runtime_generate", {
    prompt,
    stream,
    options: options || undefined,
    runId: runId ?? undefined,
  });
}

/** Ensure local runtime is running; start with toolRoot/model/port if not. Throws if toolRoot or model missing. */
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
  if (!toolRoot?.trim()) {
    throw new Error("Could not find runtime/llama/llama-server.exe. Expected under toolRoot/runtime/llama.");
  }
  if (!settings.ggufPath?.trim()) {
    throw new Error("GGUF model path is required for local provider. Add a .gguf to toolRoot/models.");
  }
  const result = await runtimeStart(settings.ggufPath, toolRoot, {
    temperature: settings.temperature,
    top_p: settings.top_p,
    max_tokens: settings.max_tokens,
    context_length: settings.context_length,
  }, usePort, null);
  return result.port;
}
