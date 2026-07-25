import type { BuildMilestone, BuildTask, LivingBuildPlan } from "../types";
import type { WorkspaceService } from "../workspace/WorkspaceService";
import { isPlanningOnlyFileChange } from "./taskKind";
export {
  isPlanningOnlyFileChange,
  hasSourceFileChange,
  inferTaskKind,
  canCompleteTaskWithFiles,
} from "./taskKind";

export const IMPLEMENTATION_MILESTONE_IDS = new Set([
  "founder-mvp-phase",
  "phase-2-implementation",
  "mvp-implementation-phase",
]);

export function isImplementationMilestone(milestoneId: string): boolean {
  return IMPLEMENTATION_MILESTONE_IDS.has(milestoneId);
}

export async function hasImplementationScaffold(workspace: {
  exists(path: string): Promise<boolean>;
}): Promise<boolean> {
  const hasPackage = await workspace.exists("package.json").catch(() => false);
  if (!hasPackage) return false;
  const hasEntry = await Promise.all([
    workspace.exists("src/main.tsx").catch(() => false),
    workspace.exists("src/main.ts").catch(() => false),
    workspace.exists("src/app").catch(() => false),
    workspace.exists("index.html").catch(() => false),
  ]);
  return hasEntry.some(Boolean);
}

export function milestoneCompletedWithPlanningOnlyPatches(
  milestone: BuildMilestone,
  completedSteps: LivingBuildPlan["completedSteps"]
): boolean {
  if (!isImplementationMilestone(milestone.id) && milestone.id !== "mvp-website-platform") return false;
  const taskSteps = completedSteps.filter(
    (step) => step.milestoneId === milestone.id && step.taskId && step.filesChanged.length > 0
  );
  if (!taskSteps.length) return false;
  return taskSteps.every((step) => isPlanningOnlyFileChange(step.filesChanged));
}

export function resetImplementationMilestone(plan: LivingBuildPlan, milestoneId: string): LivingBuildPlan {
  const milestones = plan.milestones.map((milestone) => {
    if (milestone.id !== milestoneId) {
      return { ...milestone, tasks: milestone.tasks.map((task) => ({ ...task })) };
    }
    const tasks = milestone.tasks.map((task, index) => ({
      ...task,
      status: (index === 0 ? "next" : "todo") as BuildTask["status"],
      completedAt: undefined,
    }));
    return { ...milestone, status: "active" as const, tasks };
  });
  const milestone = milestones.find((item) => item.id === milestoneId);
  return {
    ...plan,
    milestones,
    currentMilestoneId: milestoneId,
    currentTaskId: milestone?.tasks[0]?.id,
    nextRecommendedStep: milestone?.tasks[0]?.title ?? plan.nextRecommendedStep,
    progressSummary: milestone ? `${milestone.name}: 0 / ${milestone.tasks.length} tasks complete.` : plan.progressSummary,
  };
}

export async function repairImplementationMilestonesIfNeeded(
  workspace: WorkspaceService,
  plan: LivingBuildPlan
): Promise<{ plan: LivingBuildPlan; changed: boolean }> {
  const hasScaffold = await hasImplementationScaffold(workspace);
  let changed = false;
  let nextPlan = plan;
  for (const milestone of plan.milestones) {
    if (!isImplementationMilestone(milestone.id)) continue;
    const allDone = milestone.tasks.every((task) => task.status === "done");
    if (!allDone) continue;
    const falselyComplete =
      milestoneCompletedWithPlanningOnlyPatches(milestone, plan.completedSteps) ||
      (!hasScaffold && allDone);
    if (!falselyComplete) continue;
    nextPlan = resetImplementationMilestone(nextPlan, milestone.id);
    changed = true;
  }
  return { plan: nextPlan, changed };
}

export function isImplementationMilestoneFalselyComplete(
  milestone: BuildMilestone | undefined,
  plan: LivingBuildPlan | null,
  hasScaffold: boolean
): boolean {
  if (!milestone || !plan || !isImplementationMilestone(milestone.id)) return false;
  const allDone = milestone.tasks.every((task) => task.status === "done");
  if (!allDone) return false;
  return milestoneCompletedWithPlanningOnlyPatches(milestone, plan.completedSteps) || !hasScaffold;
}
