import type { BuildMilestone, BuildTask, LivingBuildPlan, TaskKind } from "../types";

export const PLANNING_ONLY_PATH = /^docs\/foundation\//i;
const SOURCE_PATH = /^src\//i;
const SCAFFOLD_FILE_PATH = /^(package\.json|index\.html|vite\.config\.(ts|js)|tsconfig(\.\w+)?\.json)$/i;

export function isPlanningOnlyFileChange(files: string[]): boolean {
  if (!files.length) return false;
  return files.every((file) => PLANNING_ONLY_PATH.test(file.replace(/\\/g, "/")));
}

export function hasSourceFileChange(files: string[]): boolean {
  return files.some((file) => SOURCE_PATH.test(file.replace(/\\/g, "/")));
}

export function hasScaffoldFileChange(files: string[]): boolean {
  return files.some((file) => {
    const normalized = file.replace(/\\/g, "/");
    return SOURCE_PATH.test(normalized) || SCAFFOLD_FILE_PATH.test(normalized);
  });
}

export function inferTaskKind(milestone: BuildMilestone, task: BuildTask): TaskKind {
  if (task.kind) return task.kind;
  if (milestone.id === "mvp-implementation-phase") return "implementation";
  if (milestone.id === "founder-mvp-phase" || milestone.id === "phase-2-implementation") return "scaffold";
  if (milestone.id === "mvp-website-platform" || /website\s+platform/i.test(milestone.name)) {
    if (/shell|scaffold/i.test(task.title)) return "scaffold";
    if (/plan|define|defer|review|confirm|blueprint/i.test(task.title)) return "planning";
    if (/build|implement|add|verify/i.test(task.title)) return "implementation";
    return "planning";
  }
  if (/^(m1|mvp-scaffold)$/i.test(milestone.id) || /scaffold/i.test(milestone.name)) {
    if (/scaffold|verify local run/i.test(task.title)) return "scaffold";
  }
  if (/ai-|advanced-dnd|advanced-drag/i.test(milestone.id)) return "planning";
  if (/scaffold|shell/i.test(task.title)) return "scaffold";
  if (/plan|define/i.test(task.title)) return "planning";
  if (/build|implement|add|verify/i.test(task.title)) return "implementation";
  return "planning";
}

export function withInferredTaskKind(milestone: BuildMilestone, task: BuildTask): BuildTask {
  return task.kind ? task : { ...task, kind: inferTaskKind(milestone, task) };
}

export function canCompleteTaskWithFiles(
  milestone: BuildMilestone,
  task: BuildTask,
  filesChanged: string[]
): boolean {
  if (!filesChanged.length) return false;
  const kind = inferTaskKind(milestone, task);
  if (kind === "planning") return true;
  if (isPlanningOnlyFileChange(filesChanged)) return false;
  if (kind === "scaffold") return hasScaffoldFileChange(filesChanged);
  return hasSourceFileChange(filesChanged);
}

export function taskStepUsedPlanningOnly(
  milestoneId: string,
  taskId: string,
  completedSteps: LivingBuildPlan["completedSteps"]
): boolean {
  const steps = completedSteps.filter(
    (step) => step.milestoneId === milestoneId && step.taskId === taskId && step.filesChanged.length > 0
  );
  if (!steps.length) return false;
  return steps.every((step) => isPlanningOnlyFileChange(step.filesChanged));
}

export function isNonPlanningTaskKind(milestone: BuildMilestone, task: BuildTask): boolean {
  const kind = inferTaskKind(milestone, task);
  return kind === "scaffold" || kind === "implementation";
}
