/**
 * Knowledge pack auto-enable: compute default enabled pack IDs from project info.
 * Only used when no saved enabled pack list exists (first run).
 */

import type { DetectedType } from "../project/projectRoot";

export interface ProjectInfo {
  rootPath: string;
  detectedType: DetectedType;
  signalsFound: string[];
}

/**
 * Get default pack IDs to enable based on project type and available packs.
 * Rules:
 * - Always include "powershell" if available
 * - node => typescript, javascript
 * - rust => rust
 * - python => python
 * - go => go
 */
export function getDefaultEnabledPackIds(
  projectInfo: ProjectInfo,
  availablePacks: string[]
): string[] {
  const avail = new Set(availablePacks.map((p) => p.toLowerCase()));
  const result = new Set<string>();

  const add = (id: string) => {
    const lower = id.toLowerCase();
    if (avail.has(lower)) result.add(id);
  };

  add("powershell");

  const { detectedType, signalsFound } = projectInfo;
  const signalsLower = signalsFound.map((s) => s.toLowerCase());

  switch (detectedType) {
    case "node":
      add("typescript");
      add("javascript");
      add("node");
      break;
    case "rust":
      add("rust");
      break;
    case "python":
      add("python");
      break;
    case "go":
      add("go");
      break;
    case "php":
      add("php");
      break;
    case "unknown":
      if (
        signalsLower.includes("package.json") ||
        signalsLower.includes("package-lock.json") ||
        signalsLower.includes("yarn.lock") ||
        signalsLower.includes("pnpm-lock.yaml")
      ) {
        add("typescript");
        add("javascript");
        add("node");
      }
      break;
  }

  return [...result];
}
