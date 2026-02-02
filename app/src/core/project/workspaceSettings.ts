/**
 * Read/write workspace settings at .devassistant/settings.json
 */

import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceSettings } from "../types";

const SETTINGS_PATH = ".devassistant/settings.json";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  autoPacksEnabled: true,
  enabledPacks: [],
  devMode: "fast",
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
    return {
      autoPacksEnabled: data.autoPacksEnabled ?? DEFAULT_SETTINGS.autoPacksEnabled,
      enabledPacks: Array.isArray(data.enabledPacks) ? data.enabledPacks : DEFAULT_SETTINGS.enabledPacks,
      devMode: data.devMode === "safe" || data.devMode === "fast" ? data.devMode : "fast",
      modelPath: typeof data.modelPath === "string" && data.modelPath.trim() ? data.modelPath.trim() : undefined,
      port: typeof data.port === "number" && data.port > 0 ? data.port : undefined,
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
