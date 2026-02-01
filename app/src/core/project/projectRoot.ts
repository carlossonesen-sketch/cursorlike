/**
 * Project root detection: walk upward from a path and find project root using heuristics.
 * Pure scoring logic is unit-testable; fs IO is delegated to Tauri invoke.
 */

import { invoke } from "@tauri-apps/api/core";

export type DetectedType =
  | "node"
  | "rust"
  | "python"
  | "go"
  | "php"
  | "unknown";

export interface ProjectRootResult {
  rootPath: string;
  detectedType: DetectedType;
  signalsFound: string[];
}

/**
 * Pure: infer detected type from signals. Unit-testable.
 */
export function inferDetectedType(signalsFound: string[]): DetectedType {
  const lower = signalsFound.map((s) => s.toLowerCase());
  if (lower.includes("cargo.toml")) return "rust";
  if (
    lower.includes("package.json") ||
    lower.includes("pnpm-lock.yaml") ||
    lower.includes("package-lock.json") ||
    lower.includes("yarn.lock")
  )
    return "node";
  if (lower.includes("pyproject.toml") || lower.includes("requirements.txt"))
    return "python";
  if (lower.includes("go.mod")) return "go";
  if (lower.includes("composer.json")) return "php";
  if (lower.includes(".git")) return "unknown";
  return "unknown";
}

/**
 * Call Tauri to detect project root. Walks upward from startPath.
 */
export async function detectProjectRoot(
  startPath?: string
): Promise<ProjectRootResult> {
  const result = await invoke<{ rootPath: string; signalsFound: string[] }>(
    "detect_project_root",
    { startPath: startPath ?? "" }
  );
  const detectedType = inferDetectedType(result.signalsFound);
  console.log("[projectRoot] detected:", {
    rootPath: result.rootPath,
    detectedType,
    signalsFound: result.signalsFound,
  });
  return {
    rootPath: result.rootPath,
    detectedType,
    signalsFound: result.signalsFound,
  };
}
