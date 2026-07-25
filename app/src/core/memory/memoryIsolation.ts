import type { GlobalMemory, KnownProject, ProjectMemory } from "../types";

export function normalizeProjectPath(path: string | null | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function projectPathsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeProjectPath(a);
  const right = normalizeProjectPath(b);
  return left.length > 0 && left === right;
}

export function sanitizeKnownProject(project: KnownProject): KnownProject {
  return {
    id: project.id,
    name: project.name,
    aliases: Array.isArray(project.aliases) ? project.aliases : [],
    path: project.path,
    summary: typeof project.summary === "string" ? project.summary : "",
    lastOpenedAt: project.lastOpenedAt,
  };
}

export function sanitizeGlobalMemory(memory: GlobalMemory): GlobalMemory {
  return {
    schemaVersion: 1,
    updatedAt: memory.updatedAt,
    defaultProjectsFolder: memory.defaultProjectsFolder,
    projects: Array.isArray(memory.projects) ? memory.projects.map(sanitizeKnownProject) : [],
  };
}

export function isProjectRegistryListPrompt(prompt: string): boolean {
  return /\b(what\s+projects\s+do\s+we\s+have|list\s+projects|show\s+projects|known\s+projects|project\s+registry)\b/i.test(prompt);
}

export function formatProjectRegistry(memory: GlobalMemory): string {
  const projects = sanitizeGlobalMemory(memory).projects.filter((project) => !project.archived);
  if (!projects.length) return "No projects are registered in global memory yet.";
  return [
    "Known projects:",
    ...projects.map((project, index) => {
      const aliases = project.aliases.length ? ` (aliases: ${project.aliases.join(", ")})` : "";
      const summary = project.summary ? ` - ${project.summary}` : "";
      return `${index + 1}. ${project.name}${aliases}\n   Path: ${project.path}${summary}`;
    }),
  ].join("\n");
}

export function validateActiveProjectMemoryPath(activePath: string, projectMemory: ProjectMemory): string | null {
  if (projectPathsMatch(activePath, projectMemory.path)) return null;
  return [
    "Project memory isolation guard blocked this request.",
    `Active project path: ${activePath}`,
    `Loaded project memory path: ${projectMemory.path || "(none)"}`,
    "NF will not use project memory unless it belongs to the active workspace.",
  ].join("\n");
}
