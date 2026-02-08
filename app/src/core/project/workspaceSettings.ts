/**
 * Read/write workspace settings at .devassistant/settings.json
 */

import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceSettings } from "../types";

const SETTINGS_PATH = ".devassistant/settings.json";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  autoPacksEnabled: true,
  enabledPacks: [],
};

export async function readWorkspaceSettings(
  workspaceRoot: string
): Promise<WorkspaceSettings> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: SETTINGS_PATH,
    });
    const data = JSON.parse(raw) as Partial<WorkspaceSettings>;
    const modelRoles = data.modelRoles && typeof data.modelRoles === "object" ? {
      coder: typeof data.modelRoles.coder === "string" ? data.modelRoles.coder.trim() || undefined : undefined,
      general: typeof data.modelRoles.general === "string" ? data.modelRoles.general.trim() || undefined : undefined,
      reviewer: typeof data.modelRoles.reviewer === "string" ? data.modelRoles.reviewer.trim() || undefined : undefined,
      embeddings: typeof data.modelRoles.embeddings === "string" ? data.modelRoles.embeddings.trim() || undefined : undefined,
      reranker: typeof data.modelRoles.reranker === "string" ? data.modelRoles.reranker.trim() || undefined : undefined,
    } : undefined;
    return {
      autoPacksEnabled: data.autoPacksEnabled ?? DEFAULT_SETTINGS.autoPacksEnabled,
      enabledPacks: Array.isArray(data.enabledPacks) ? data.enabledPacks : DEFAULT_SETTINGS.enabledPacks,
      modelPath: typeof data.modelPath === "string" && data.modelPath.trim() ? data.modelPath.trim() : undefined,
      port: typeof data.port === "number" && data.port > 0 ? data.port : undefined,
      modelRoles,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeWorkspaceSettings(
  workspaceRoot: string,
  settings: WorkspaceSettings
): Promise<void> {
  await invoke("workspace_mkdir_all", {
    workspaceRoot,
    path: ".devassistant",
  });
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: SETTINGS_PATH,
    content: JSON.stringify(settings, null, 2),
  });
}
