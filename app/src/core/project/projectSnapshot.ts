/**
 * Read/write project snapshot at .devassistant/project_snapshot.json
 */

import { invoke } from "@tauri-apps/api/core";
import type { ProjectSnapshot } from "../types";

const SNAPSHOT_PATH = ".devassistant/project_snapshot.json";

export async function readProjectSnapshot(
  workspaceRoot: string
): Promise<ProjectSnapshot | null> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: SNAPSHOT_PATH,
    });
    const data = JSON.parse(raw) as ProjectSnapshot & { updatedAt?: string };
    if (!Array.isArray(data.detectedTypes) || !Array.isArray(data.recommendedPacks)) {
      return null;
    }
    return {
      detectedTypes: data.detectedTypes ?? [],
      recommendedPacks: data.recommendedPacks ?? [],
      enabledPacks: data.enabledPacks ?? [],
      importantFiles: data.importantFiles ?? [],
      detectedCommands: data.detectedCommands ?? {},
      generatedAt: data.generatedAt ?? data.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function writeProjectSnapshot(
  workspaceRoot: string,
  snapshot: ProjectSnapshot
): Promise<void> {
  await invoke("workspace_mkdir_all", {
    workspaceRoot,
    path: ".devassistant",
  });
  const withTimestamp = {
    ...snapshot,
    generatedAt: new Date().toISOString(),
  };
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: SNAPSHOT_PATH,
    content: JSON.stringify(withTimestamp, null, 2),
  });
}
