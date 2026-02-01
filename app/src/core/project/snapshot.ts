/**
 * Project snapshot generation: produce project_snapshot.json with file listing,
 * counts, and metadata. Written to .devassistant/ (app data dir not yet implemented).
 */

import { invoke } from "@tauri-apps/api/core";
import type { DetectedType } from "./projectRoot";
import type { DetectedCommands } from "../types";

const SNAPSHOT_IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  ".turbo",
  ".cache",
  "coverage",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".DS_Store",
]);

/**
 * Pure: check if a path segment should be ignored. Unit-testable.
 */
export function shouldIgnorePathSegment(segment: string): boolean {
  return SNAPSHOT_IGNORED.has(segment) || SNAPSHOT_IGNORED.has(segment.toLowerCase());
}

export interface SnapshotFileEntry {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface ProjectSnapshotJson {
  snapshotVersion: number;
  generatedAt: string;
  rootPath: string;
  detectedType: DetectedType;
  signalsFound: string[];
  counts: { totalFiles: number; totalDirs: number };
  files: SnapshotFileEntry[];
  topLevel: string[];
  /** UI backward compat */
  detectedTypes?: string[];
  recommendedPacks?: string[];
  enabledPacks?: string[];
  importantFiles?: string[];
  detectedCommands?: DetectedCommands;
}

const SNAPSHOT_VERSION = 1;

/**
 * Generate snapshot data by calling Tauri workspace_walk_snapshot.
 */
export async function generateSnapshotData(
  rootPath: string,
  detectedType: DetectedType,
  signalsFound: string[],
  uiOverrides?: {
    detectedTypes: string[];
    recommendedPacks: string[];
    enabledPacks: string[];
    importantFiles: string[];
    detectedCommands: DetectedCommands;
  }
): Promise<ProjectSnapshotJson> {
  const raw = await invoke<{
    totalFiles: number;
    totalDirs: number;
    files: SnapshotFileEntry[];
    topLevel: string[];
  }>("workspace_walk_snapshot", {
    workspaceRoot: rootPath,
  });

  const base: ProjectSnapshotJson = {
    snapshotVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    rootPath,
    detectedType,
    signalsFound,
    counts: {
      totalFiles: raw.totalFiles,
      totalDirs: raw.totalDirs,
    },
    files: raw.files,
    topLevel: raw.topLevel,
  };
  if (uiOverrides) {
    base.detectedTypes = uiOverrides.detectedTypes;
    base.recommendedPacks = uiOverrides.recommendedPacks;
    base.enabledPacks = uiOverrides.enabledPacks;
    base.importantFiles = uiOverrides.importantFiles;
    base.detectedCommands = uiOverrides.detectedCommands;
  }
  return base;
}

/**
 * Resolve output path: .devassistant/project_snapshot.json under project root.
 * (App data dir not implemented - use project root.)
 */
export function getSnapshotOutputPath(projectRoot: string): string {
  return ".devassistant/project_snapshot.json";
}

/**
 * Write project snapshot to disk. Creates .devassistant dir if needed.
 */
export async function writeProjectSnapshotFile(
  workspaceRoot: string,
  snapshot: ProjectSnapshotJson
): Promise<string> {
  const outPath = getSnapshotOutputPath(workspaceRoot);
  await invoke("workspace_mkdir_all", {
    workspaceRoot,
    path: ".devassistant",
  });
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: outPath,
    content: JSON.stringify(snapshot, null, 2),
  });
  console.log("[snapshot] wrote", outPath, "counts:", snapshot.counts);
  return outPath;
}
