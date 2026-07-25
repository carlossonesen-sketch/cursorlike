import type { LivingBuildPlan, ProjectMemory } from "../types";
import { projectPathsMatch } from "../memory/memoryIsolation";

export interface ActiveProjectContext {
  workspacePath: string | null;
  projectMemory: ProjectMemory | null;
  livingBuildPlan: LivingBuildPlan | null;
}

export function isEstablishedProjectWorkspace(context: ActiveProjectContext): boolean {
  const workspacePath = context.workspacePath?.trim();
  if (!workspacePath) return false;
  if (context.projectMemory?.path && projectPathsMatch(workspacePath, context.projectMemory.path)) {
    return true;
  }
  if (context.projectMemory?.projectId?.trim()) return true;
  if ((context.livingBuildPlan?.milestones.length ?? 0) > 0) return true;
  return false;
}

export function isExplicitCreateNewProjectIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  if (!normalized) return false;
  if (/\*\*Save\s+Path:\*\*/i.test(normalized) || /(?:\*\*)?Save\s+Path(?:\*\*)?\s*:/i.test(normalized)) {
    return false;
  }
  if (normalized.length > 240) return false;
  return (
    /\b(create|start)\s+(?:a\s+)?new\s+(?:NF\s+)?project\b/i.test(normalized) ||
    /\bnew\s+project\s+setup\b/i.test(normalized) ||
    /^#?\s*create\s+a\s+new\s+NF\s+project\s*$/im.test(normalized) ||
    /\bthis\s+is\s+a\s+new\s+project\s+creation\b/i.test(normalized)
  );
}

export function shouldBlockNewProjectRouting(
  prompt: string,
  context: ActiveProjectContext,
  creationFlowActive: boolean
): boolean {
  if (creationFlowActive) return false;
  if (!isEstablishedProjectWorkspace(context)) return false;
  return !isExplicitCreateNewProjectIntent(prompt);
}

export function hasReadableProjectStatus(input: {
  projectMemory: ProjectMemory | null;
  livingBuildPlan: LivingBuildPlan | null;
}): boolean {
  return Boolean(input.projectMemory?.projectId || (input.livingBuildPlan?.milestones.length ?? 0) > 0);
}
