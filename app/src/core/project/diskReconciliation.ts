import type { LivingBuildPlan, ProjectMemory } from "../types";
import type { WorkspaceService } from "../workspace/WorkspaceService";
import { auditWebsitePlatformMvp, type MvpDiskAuditResult } from "./mvpDiskAudit";

type DiskReconcileWorkspace = Pick<WorkspaceService, "readFile" | "exists">;
import {
  generateMvpImplementationMilestone,
} from "./mvpImplementationPhase";
import { reconcileBuildPlanProgress } from "./scaffoldPhase";
import {
  isNonPlanningTaskKind,
  taskStepUsedPlanningOnly,
  withInferredTaskKind,
} from "./taskKind";
import { hasImplementationScaffold, resetImplementationMilestone } from "./implementationMilestone";

function assignTaskKinds(plan: LivingBuildPlan): { plan: LivingBuildPlan; changed: boolean } {
  let changed = false;
  const milestones = plan.milestones.map((milestone) => ({
    ...milestone,
    tasks: milestone.tasks.map((task) => {
      const withKind = withInferredTaskKind(milestone, task);
      if (withKind.kind !== task.kind) changed = true;
      return withKind;
    }),
  }));
  return { plan: { ...plan, milestones }, changed };
}

function repairFalselyCompletedTasks(plan: LivingBuildPlan): { plan: LivingBuildPlan; changed: boolean } {
  let changed = false;
  const milestones = plan.milestones.map((milestone) => {
    let milestoneChanged = false;
    const tasks = milestone.tasks.map((task) => {
      if (task.status !== "done" || !isNonPlanningTaskKind(milestone, task)) return { ...task };
      if (milestone.id === "mvp-website-platform") return { ...task };
      if (!taskStepUsedPlanningOnly(milestone.id, task.id, plan.completedSteps)) return { ...task };
      milestoneChanged = true;
      changed = true;
      return { ...task, status: "todo" as const, completedAt: undefined };
    });
    if (!milestoneChanged) return { ...milestone, tasks };
    const hasActive = tasks.some((task) => task.status !== "done");
    return {
      ...milestone,
      status: hasActive ? ("active" as const) : milestone.status,
      tasks,
    };
  });

  if (!changed) return { plan, changed: false };

  const firstActive = milestones
    .flatMap((milestone) => milestone.tasks.map((task) => ({ milestone, task })))
    .find(({ task }) => task.status === "next" || task.status === "doing" || task.status === "todo");

  return {
    plan: reconcileBuildPlanProgress({
      ...plan,
      milestones,
      currentMilestoneId: firstActive?.milestone.id ?? plan.currentMilestoneId,
      currentTaskId: firstActive?.task.id,
      nextRecommendedStep: firstActive?.task.title ?? plan.nextRecommendedStep,
    }),
    changed: true,
  };
}

async function repairPrematureMvpPlatformCompletion(
  workspace: Pick<WorkspaceService, "exists">,
  plan: LivingBuildPlan
): Promise<{ plan: LivingBuildPlan; changed: boolean }> {
  const hasScaffold = await hasImplementationScaffold(workspace);
  let changed = false;
  let nextPlan = plan;

  for (const milestoneId of ["founder-mvp-phase", "phase-2-implementation"] as const) {
    const milestone = nextPlan.milestones.find((item) => item.id === milestoneId);
    if (!milestone) continue;
    const allDone = milestone.tasks.every((task) => task.status === "done");
    const planningOnly =
      allDone &&
      milestone.tasks.some((task) => taskStepUsedPlanningOnly(milestone.id, task.id, nextPlan.completedSteps));
    if (planningOnly || (!hasScaffold && allDone)) {
      nextPlan = resetImplementationMilestone(nextPlan, milestoneId);
      changed = true;
    }
  }

  if (!changed) return { plan, changed: false };
  return { plan: reconcileBuildPlanProgress(nextPlan), changed: true };
}

export async function reconcileBuildPlanWithDisk(
  workspace: DiskReconcileWorkspace,
  plan: LivingBuildPlan,
  projectMemory: ProjectMemory | null
): Promise<{ plan: LivingBuildPlan; changed: boolean; audit: MvpDiskAuditResult | null }> {
  let nextPlan = plan;
  let changed = false;

  const kinds = assignTaskKinds(nextPlan);
  nextPlan = kinds.plan;
  changed = changed || kinds.changed;

  const falseCompletions = repairFalselyCompletedTasks(nextPlan);
  nextPlan = falseCompletions.plan;
  changed = changed || falseCompletions.changed;

  const premature = await repairPrematureMvpPlatformCompletion(workspace, nextPlan);
  nextPlan = premature.plan;
  changed = changed || premature.changed;

  const audit = await auditWebsitePlatformMvp(workspace, nextPlan, projectMemory);
  if (audit?.incompleteModules.length) {
    const generated = generateMvpImplementationMilestone(nextPlan, audit);
    nextPlan = generated.plan;
    changed = changed || generated.changed;
  }

  const reconciled = reconcileBuildPlanProgress(nextPlan);
  if (
    reconciled.nextRecommendedStep !== plan.nextRecommendedStep ||
    reconciled.currentTaskId !== plan.currentTaskId ||
    reconciled.currentMilestoneId !== plan.currentMilestoneId ||
    reconciled.progressSummary !== plan.progressSummary
  ) {
    changed = true;
  }

  return { plan: reconciled, changed, audit };
}

export async function ensureMvpImplementationQueue(
  workspace: DiskReconcileWorkspace,
  plan: LivingBuildPlan,
  projectMemory: ProjectMemory | null
): Promise<{ plan: LivingBuildPlan; changed: boolean; audit: MvpDiskAuditResult | null }> {
  const audit = await auditWebsitePlatformMvp(workspace, plan, projectMemory);
  if (!audit?.incompleteModules.length) {
    return { plan, changed: false, audit };
  }
  const generated = generateMvpImplementationMilestone(plan, audit);
  return { plan: generated.plan, changed: generated.changed, audit };
}
