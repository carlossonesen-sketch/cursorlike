import { invoke } from "@tauri-apps/api/core";
import type { FounderManifest } from "../types";

const FOUNDER_MANIFEST_PATH = "founder-manifest.json";

export function createDefaultFounderManifest(projectId = ""): FounderManifest {
  return {
    schemaVersion: 1,
    projectId,
    vision: "",
    mission: "",
    targetCustomer: "",
    problem: "",
    mvpDefinition: "",
    successMetric: "",
    notInV1: [],
    futureRoadmap: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function readFounderManifest(workspaceRoot: string, projectId = ""): Promise<FounderManifest> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: FOUNDER_MANIFEST_PATH,
    });
    return { ...createDefaultFounderManifest(projectId), ...(JSON.parse(raw) as Partial<FounderManifest>) };
  } catch {
    return createDefaultFounderManifest(projectId);
  }
}

export async function writeFounderManifest(workspaceRoot: string, manifest: FounderManifest): Promise<void> {
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: FOUNDER_MANIFEST_PATH,
    content: JSON.stringify({ ...manifest, schemaVersion: 1, updatedAt: new Date().toISOString() }, null, 2),
  });
}
