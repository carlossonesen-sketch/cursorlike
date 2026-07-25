export const UNRESOLVED_PROJECT_NAME = "Untitled Project";

export function isUnresolvedProjectName(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return !trimmed || trimmed.toLowerCase() === UNRESOLVED_PROJECT_NAME.toLowerCase();
}

export function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower.length <= 2) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function inferProjectNameFromSavePath(savePath: string | undefined): string | null {
  if (!savePath?.trim()) return null;
  const segments = savePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const folder = segments[segments.length - 1]?.trim() ?? "";
  if (!folder || folder === "untitled-project" || folder === "nf-projects") return null;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(folder)) return null;
  const name = titleCaseFromSlug(folder);
  return name.length >= 2 && name.length <= 80 ? name : null;
}

export function buildClassificationPrompt(projectName: string, prompt: string): string {
  return isUnresolvedProjectName(projectName) ? prompt.trim() : `${projectName.trim()}\n${prompt.trim()}`;
}

export function projectNameRequestMessage(): string {
  return [
    "NF needs a project name before it can plan this project.",
    "Add a line like `Project Name: Your Project Name` to your idea, or tell NF what to call it in chat.",
    "If you already chose a save folder, include the project name so NF does not keep using a placeholder.",
  ].join(" ");
}

export class ProjectCreationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectCreationBlockedError";
  }
}

export function assertProjectIdentityReady(projectName: string): void {
  if (isUnresolvedProjectName(projectName)) {
    throw new ProjectCreationBlockedError(projectNameRequestMessage());
  }
}
