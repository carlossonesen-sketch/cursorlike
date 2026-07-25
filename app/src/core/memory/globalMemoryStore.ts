import type { GlobalMemory } from "../types";
import { sanitizeGlobalMemory } from "./memoryIsolation";

const GLOBAL_MEMORY_KEY = "nf.globalMemory.v1";
const DEFAULT_PROJECTS_FOLDER = "D:\\dev\\nf-projects";

export function createDefaultGlobalMemory(): GlobalMemory {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    defaultProjectsFolder: DEFAULT_PROJECTS_FOLDER,
    projects: [],
  };
}

export function readGlobalMemory(): GlobalMemory {
  if (typeof localStorage === "undefined") return createDefaultGlobalMemory();
  try {
    const raw = localStorage.getItem(GLOBAL_MEMORY_KEY);
    if (!raw) return createDefaultGlobalMemory();
    const data = JSON.parse(raw) as Partial<GlobalMemory>;
    return sanitizeGlobalMemory({
      schemaVersion: 1,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
      defaultProjectsFolder:
        typeof data.defaultProjectsFolder === "string" && data.defaultProjectsFolder.trim()
          ? data.defaultProjectsFolder.trim()
          : DEFAULT_PROJECTS_FOLDER,
      projects: Array.isArray(data.projects) ? data.projects : [],
    });
  } catch {
    return createDefaultGlobalMemory();
  }
}

export function writeGlobalMemory(memory: GlobalMemory): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    GLOBAL_MEMORY_KEY,
      JSON.stringify(sanitizeGlobalMemory({ ...memory, schemaVersion: 1, updatedAt: new Date().toISOString() }), null, 2)
  );
}
