/**
 * Read/write project snapshot at .devassistant/project_snapshot.json
 * Supports both legacy format and new extended format (snapshotVersion 1).
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
    const data = JSON.parse(raw) as ProjectSnapshot & {
      updatedAt?: string;
      snapshotVersion?: number;
      detectedType?: string;
    };
    const detectedTypes = Array.isArray(data.detectedTypes)
      ? data.detectedTypes
      : data.detectedType
        ? [data.detectedType]
        : [];
    const recommendedPacks = Array.isArray(data.recommendedPacks)
      ? data.recommendedPacks
      : [];
    if (detectedTypes.length === 0 && recommendedPacks.length === 0) {
      return null;
    }
    return {
      detectedTypes,
      recommendedPacks,
      enabledPacks: Array.isArray(data.enabledPacks) ? data.enabledPacks : [],
      importantFiles: Array.isArray(data.importantFiles) ? data.importantFiles : [],
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
