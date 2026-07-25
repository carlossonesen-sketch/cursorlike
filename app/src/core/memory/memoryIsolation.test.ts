import type { GlobalMemory, ProjectMemory } from "../types";
import {
  formatProjectRegistry,
  projectPathsMatch,
  sanitizeGlobalMemory,
  validateActiveProjectMemoryPath,
} from "./memoryIsolation";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const globalMemoryWithLegacyDetails = {
  schemaVersion: 1,
  updatedAt: "2026-06-25T00:00:00.000Z",
  defaultProjectsFolder: "D:\\dev\\nf-projects",
  projects: [
    {
      id: "foundry",
      name: "Foundry",
      aliases: ["startup os"],
      path: "D:\\dev\\nf-projects\\foundry",
      summary: "AI-native startup operating system",
      techStack: ["React", "Tauri"],
      currentMilestone: "Core Experience",
      lifecycleStage: "buildingMvp",
      recentWork: ["should not be here"],
      commands: { build: "npm run build" },
      lastOpenedAt: "2026-06-25T01:00:00.000Z",
    },
    {
      id: "fence",
      name: "Get Off My Fence",
      aliases: [],
      path: "D:\\dev\\nf-projects\\get-off-my-fence",
      summary: "Small game",
      lastOpenedAt: "2026-06-25T02:00:00.000Z",
    },
  ],
} as unknown as GlobalMemory;

const sanitized = sanitizeGlobalMemory(globalMemoryWithLegacyDetails);
const foundry = sanitized.projects[0] as unknown as Record<string, unknown>;
assert(foundry.name === "Foundry", "registry should keep project name");
assert(foundry.path === "D:\\dev\\nf-projects\\foundry", "registry should keep project path");
assert(!("techStack" in foundry), "registry must not keep tech stack");
assert(!("currentMilestone" in foundry), "registry must not keep milestone");
assert(!("commands" in foundry), "registry must not keep commands");
assert(!("recentWork" in foundry), "registry must not keep project work");

const registryList = formatProjectRegistry(globalMemoryWithLegacyDetails);
assert(registryList.includes("Foundry"), "project listing should show registry names");
assert(registryList.includes("D:\\dev\\nf-projects\\get-off-my-fence"), "project listing should show paths");
assert(!registryList.includes("Core Experience"), "project listing must not expose milestone details");
assert(!registryList.includes("npm run build"), "project listing must not expose commands");

assert(
  projectPathsMatch("D:\\dev\\nf-projects\\get-off-my-fence", "D:/dev/nf-projects/get-off-my-fence"),
  "active path guard should normalize slashes"
);

const projectMemory = {
  path: "D:\\dev\\nf-projects\\foundry",
} as ProjectMemory;
assert(
  validateActiveProjectMemoryPath("D:\\dev\\nf-projects\\get-off-my-fence", projectMemory)?.includes("blocked") === true,
  "active project chat must reject another project's memory"
);

console.log("memory isolation regression passed");
