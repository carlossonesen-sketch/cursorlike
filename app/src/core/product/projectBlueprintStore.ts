import { invoke } from "@tauri-apps/api/core";
import type { ProjectBlueprint } from "../types";

export interface ProjectBlueprintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const PROJECT_BLUEPRINT_STORAGE_KEY = "nf.projectBlueprint.v1";
export const PROJECT_BLUEPRINT_FILE_PATH = ".devassistant/project-blueprint.json";

export function createMemoryProjectBlueprintStorage(): ProjectBlueprintStorage {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

function getDefaultStorage(): ProjectBlueprintStorage | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }

  const storage = globalThis.localStorage;
  if (!storage) {
    return null;
  }

  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  };
}

export function saveProjectBlueprint(
  blueprint: ProjectBlueprint,
  storage: ProjectBlueprintStorage | null = getDefaultStorage()
): ProjectBlueprint {
  if (!storage) {
    return blueprint;
  }

  storage.setItem(PROJECT_BLUEPRINT_STORAGE_KEY, JSON.stringify(blueprint));
  return blueprint;
}

export function loadProjectBlueprint(
  storage: ProjectBlueprintStorage | null = getDefaultStorage()
): ProjectBlueprint | null {
  if (!storage) {
    return null;
  }

  const value = storage.getItem(PROJECT_BLUEPRINT_STORAGE_KEY);
  if (!value) {
    return null;
  }

  return JSON.parse(value) as ProjectBlueprint;
}

export function clearProjectBlueprint(storage: ProjectBlueprintStorage | null = getDefaultStorage()): void {
  storage?.removeItem(PROJECT_BLUEPRINT_STORAGE_KEY);
}

export async function readWorkspaceProjectBlueprint(workspaceRoot: string): Promise<ProjectBlueprint | null> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: PROJECT_BLUEPRINT_FILE_PATH,
    });
    return JSON.parse(raw) as ProjectBlueprint;
  } catch {
    return null;
  }
}

export async function writeWorkspaceProjectBlueprint(
  workspaceRoot: string,
  blueprint: ProjectBlueprint
): Promise<void> {
  await invoke("workspace_mkdir_all", { workspaceRoot, path: ".devassistant" });
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: PROJECT_BLUEPRINT_FILE_PATH,
    content: JSON.stringify({ ...blueprint, schemaVersion: 1, updatedAt: new Date().toISOString() }, null, 2),
  });
}
