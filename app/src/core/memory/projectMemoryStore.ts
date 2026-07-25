import { invoke } from "@tauri-apps/api/core";
import type { ProjectMemory } from "../types";

const PROJECT_MEMORY_PATH = ".devassistant/project-memory.json";

export function createDefaultProjectMemory(workspaceRoot: string): ProjectMemory {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectId: "",
    name: "",
    aliases: [],
    path: workspaceRoot,
    createdAt: now,
    updatedAt: now,
    status: "planning",
    lifecycleStage: "idea",
    fullIdea: "",
    summary: "",
    techStack: [],
    architectureNotes: [],
    decisions: [],
    importantFiles: [],
    generatedFiles: [],
    commands: {},
    todos: [],
    knownIssues: [],
    recentWork: [],
    resumeState: { status: "active" },
  };
}

export async function readProjectMemory(workspaceRoot: string): Promise<ProjectMemory> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: PROJECT_MEMORY_PATH,
    });
    return { ...createDefaultProjectMemory(workspaceRoot), ...(JSON.parse(raw) as Partial<ProjectMemory>) };
  } catch {
    return createDefaultProjectMemory(workspaceRoot);
  }
}

export async function writeProjectMemory(workspaceRoot: string, memory: ProjectMemory): Promise<void> {
  await invoke("workspace_mkdir_all", { workspaceRoot, path: ".devassistant" });
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: PROJECT_MEMORY_PATH,
    content: JSON.stringify({ ...memory, schemaVersion: 1, updatedAt: new Date().toISOString() }, null, 2),
  });
}
