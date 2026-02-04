/**
 * Runtime config: .devassistant/runtime_config.json (not committed).
 * Auto-detect llama-server + GGUF, persist config, startLocalModel entry.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  findToolRoot,
  resolveModelPath,
  toolRootExists,
  runtimeStart,
  runtimeHealthCheck,
} from "./runtimeApi";

const CONFIG_PATH = ".devassistant/runtime_config.json";
const LOG_REL = ".devassistant/logs/llama-server.log";
const DEFAULT_PORT = 8080;
const DEFAULT_CTX = 4096;
const LLAMA_REL = "runtime/llama/llama-server.exe";

export interface RuntimeConfig {
  llamaServerPath: string;
  modelPath: string;
  host: string;
  port: number;
  ctx: number;
  threads?: number;
  gpuLayers: number;
  createdAt: string;
}

export type StartLocalModelStatus =
  | "started"
  | "already_running"
  | "missing_model"
  | "missing_runtime"
  | "error";

export interface StartLocalModelResult {
  status: StartLocalModelStatus;
  details?: string;
}

export async function readRuntimeConfig(
  workspaceRoot: string
): Promise<RuntimeConfig | null> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: CONFIG_PATH,
    });
    return JSON.parse(raw) as RuntimeConfig;
  } catch {
    return null;
  }
}

export async function writeRuntimeConfig(
  workspaceRoot: string,
  config: RuntimeConfig
): Promise<void> {
  await invoke("workspace_mkdir_all", {
    workspaceRoot,
    path: ".devassistant",
  });
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: CONFIG_PATH,
    content: JSON.stringify(config, null, 2),
  });
}

export async function scanModelsByMtime(
  projectRoot: string
): Promise<{ path: string; hadMultiple: boolean } | null> {
  const result = await invoke<{ path: string; had_multiple: boolean } | null>(
    "scan_models_for_gguf_by_mtime",
    { toolRoot: projectRoot }
  );
  if (!result) return null;
  return { path: result.path, hadMultiple: result.had_multiple };
}

export type EnsureLogDirResult =
  | { ok: true; logFilePath: string }
  | { ok: false; error: string; workspaceRoot: string };

/**
 * Create <workspaceRoot>/.devassistant/logs if missing.
 * Return { ok, logFilePath } or { ok: false, error, workspaceRoot }. Do NOT swallow errors.
 * workspaceRoot must be the log root (repo / app workspace root); use deterministic root, not cwd.
 */
export async function ensureLogDir(workspaceRoot: string): Promise<EnsureLogDirResult> {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  try {
    const logFilePath = await invoke<string>("workspace_ensure_log_dir", { workspaceRoot: root });
    return { ok: true, logFilePath };
  } catch (e) {
    return { ok: false, error: String(e), workspaceRoot: root };
  }
}

function appendRuntimeLogMarker(logRoot: string, line: string): Promise<void> {
  return invoke("workspace_append_file", {
    workspaceRoot: logRoot,
    path: LOG_REL,
    content: line,
  });
}

export interface DetectRuntimeStatusResult {
  runtimeFound: boolean;
  modelFound: boolean;
  /** Absolute workspace root (folder user opened, resolved). */
  workspaceRoot: string;
  /** Absolute tool root (first dir with runtime/llama + models/), or null. */
  toolRoot: string | null;
  /** Absolute path we intend to write for llama-server.log. */
  logFilePath: string;
  /** Absolute path for runtime_config.json. */
  runtimeConfigPath: string;
}

export async function detectRuntimeStatus(
  workspaceRoot: string
): Promise<DetectRuntimeStatusResult> {
  const raw = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const empty = {
    runtimeFound: false,
    modelFound: false,
    workspaceRoot: "",
    toolRoot: null,
    logFilePath: "",
    runtimeConfigPath: "",
  };
  if (!raw) return empty;

  const workspaceRootAbs = await resolveWorkspaceRoot(raw);
  const root = workspaceRootAbs || raw;
  const toolRoot = await findToolRoot(root);
  const projectRoot = toolRoot ?? root;
  /* Log/config under workspace root (same as sessions.json / settings.json). */
  let logFilePath = "";
  let runtimeConfigPath = "";
  try {
    logFilePath = await invoke<string>("workspace_resolve_path", {
      workspaceRoot: root,
      path: LOG_REL,
    });
    runtimeConfigPath = await invoke<string>("workspace_resolve_path", {
      workspaceRoot: root,
      path: CONFIG_PATH,
    });
  } catch {
    /* leave empty if resolve fails */
  }

  const runtimeFound = await toolRootExists(projectRoot, LLAMA_REL);
  const scan = await scanModelsByMtime(projectRoot);

  return {
    runtimeFound,
    modelFound: !!scan,
    workspaceRoot: root,
    toolRoot,
    logFilePath,
    runtimeConfigPath,
  };
}

/**
 * Resolve workspace root to a deterministic absolute path.
 * Use app workspace root (folder user opened). Do NOT rely on cwd.
 */
async function resolveWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const n = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!n) return n;
  try {
    return await invoke<string>("workspace_resolve_path", {
      workspaceRoot: n,
      path: ".",
    });
  } catch {
    return n;
  }
}

/** baseDir: same folder as .devassistant/sessions.json and .devassistant/settings.json (workspace root). */
function baseDirFromWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const raw = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!raw) return Promise.resolve("");
  return resolveWorkspaceRoot(raw).then((r) => r || raw);
}

function stubConfig(port: number): RuntimeConfig {
  const iso = new Date().toISOString();
  return {
    llamaServerPath: "",
    modelPath: "",
    host: "127.0.0.1",
    port,
    ctx: DEFAULT_CTX,
    gpuLayers: 0,
    createdAt: iso,
  };
}

/**
 * Single entry: auto-detect runtime + model, persist config, start llama-server.
 * baseDir = workspace root (same as sessions.json / settings.json). Always writes
 * .devassistant/runtime_config.json and appends marker to .devassistant/logs/llama-server.log.
 */
export async function startLocalModel(
  workspaceRoot: string
): Promise<StartLocalModelResult> {
  const raw = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!raw) {
    return { status: "error", details: "No workspace root." };
  }

  const baseDir = await baseDirFromWorkspaceRoot(raw);
  const port = DEFAULT_PORT;
  const iso = new Date().toISOString();

  const ensured = await ensureLogDir(baseDir);
  if (!ensured.ok) {
    await writeRuntimeConfig(baseDir, stubConfig(port)).catch(() => {});
    return {
      status: "error",
      details: `ensureLogDir failed: ${ensured.error}. workspaceRoot=${ensured.workspaceRoot}.`,
    };
  }
  const logPath = ensured.logFilePath;

  const toolRoot = await findToolRoot(baseDir || raw);
  const projectRoot = toolRoot ?? baseDir ?? raw;

  const runtimeOk = await toolRootExists(projectRoot, LLAMA_REL);
  if (!runtimeOk) {
    const stub = stubConfig(port);
    await writeRuntimeConfig(baseDir, stub).catch(() => {});
    const marker = `[runtime] startLocalModel ${iso} status=missing_runtime model=none port=${port}`;
    await appendRuntimeLogMarker(baseDir, marker).catch(() => {});
    return { status: "missing_runtime", details: "runtime/llama/llama-server.exe not found." };
  }

  const scan = await scanModelsByMtime(projectRoot);
  if (!scan) {
    const stub = stubConfig(port);
    await writeRuntimeConfig(baseDir, stub).catch(() => {});
    const marker = `[runtime] startLocalModel ${iso} status=missing_model model=none port=${port}`;
    await appendRuntimeLogMarker(baseDir, marker).catch(() => {});
    return { status: "missing_model", details: "No .gguf in models/." };
  }

  if (scan.hadMultiple) {
    console.warn("[startLocalModel] Multiple .gguf in models/; using most recently modified.");
  }

  const modelAbs = resolveModelPath(projectRoot, scan.path);
  const llamaAbs = resolveModelPath(projectRoot, LLAMA_REL);

  let healthy = false;
  try {
    healthy = await runtimeHealthCheck(port);
  } catch {
    healthy = false;
  }

  if (healthy) {
    const cfg: RuntimeConfig = {
      llamaServerPath: llamaAbs,
      modelPath: modelAbs,
      host: "127.0.0.1",
      port,
      ctx: DEFAULT_CTX,
      gpuLayers: 0,
      createdAt: iso,
    };
    await writeRuntimeConfig(baseDir, cfg).catch(() => {});
    const marker = `[runtime] startLocalModel ${iso} status=already_running model=${modelAbs} port=${port}`;
    await appendRuntimeLogMarker(baseDir, marker).catch(() => {});
    return { status: "already_running", details: `Port ${port} in use (health OK).` };
  }

  const marker = `[runtime] startLocalModel ${iso} status=starting model=${modelAbs} port=${port}`;
  await appendRuntimeLogMarker(baseDir, marker).catch(() => {});

  const cfg: RuntimeConfig = {
    llamaServerPath: llamaAbs,
    modelPath: modelAbs,
    host: "127.0.0.1",
    port,
    ctx: DEFAULT_CTX,
    gpuLayers: 0,
    createdAt: iso,
  };
  await writeRuntimeConfig(baseDir, cfg).catch(() => {});

  try {
    await runtimeStart(modelAbs, toolRoot ?? projectRoot, {
      context_length: DEFAULT_CTX,
    }, port, logPath);
    return { status: "started" };
  } catch (e) {
    return { status: "error", details: String(e) };
  }
}
