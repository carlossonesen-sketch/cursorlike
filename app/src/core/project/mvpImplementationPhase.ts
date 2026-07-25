import type { BuildMilestone, BuildTask, LivingBuildPlan } from "../types";
import type { MvpDiskAuditResult, MvpModuleAudit } from "./mvpDiskAudit";
import { WEBSITE_MVP_MODULES } from "./mvpDiskAudit";
import { reconcileBuildPlanProgress } from "./scaffoldPhase";

export const MVP_IMPLEMENTATION_MILESTONE_ID = "mvp-implementation-phase";

function taskFromModule(module: MvpModuleAudit, status: BuildTask["status"]): BuildTask {
  return {
    id: `mvp-impl-${module.id}`,
    title: module.title,
    description: module.detail,
    kind: "implementation",
    status,
  };
}

export function mvpImplementationTasksFromAudit(incompleteModules: MvpModuleAudit[]): BuildTask[] {
  return incompleteModules.map((module, index) =>
    taskFromModule(module, index === 0 ? "next" : "todo")
  );
}

function syncExistingMvpImplementationTasks(
  milestone: BuildMilestone,
  audit: MvpDiskAuditResult
): { milestone: BuildMilestone; changed: boolean } {
  const incompleteIds = new Set(audit.incompleteModules.map((module) => module.id));
  const moduleById = new Map(WEBSITE_MVP_MODULES.map((module) => [module.id, module]));
  let changed = false;
  const knownTaskIds = new Set(milestone.tasks.map((task) => task.id));

  const tasks = milestone.tasks.map((task) => {
    const moduleId = task.id.replace(/^mvp-impl-/, "");
    if (!moduleId || !moduleById.has(moduleId)) return { ...task };
    if (!incompleteIds.has(moduleId) && task.status !== "done") {
      changed = true;
      return { ...task, status: "done" as const, completedAt: task.completedAt ?? new Date().toISOString() };
    }
    if (incompleteIds.has(moduleId) && task.status === "done") {
      changed = true;
      return { ...task, status: "todo" as const, completedAt: undefined };
    }
    return { ...task };
  });

  for (const module of audit.incompleteModules) {
    const taskId = `mvp-impl-${module.id}`;
    if (!knownTaskIds.has(taskId)) {
      tasks.push(taskFromModule(module, "todo"));
      changed = true;
    }
  }

  const firstIncompleteIndex = tasks.findIndex(
    (task) => task.status === "todo" || task.status === "next" || task.status === "doing"
  );
  const normalizedTasks = tasks.map((task, index) => {
    if (task.status === "done" || task.status === "blocked") return task;
    const nextStatus: BuildTask["status"] = index === firstIncompleteIndex ? "next" : "todo";
    if (task.status !== nextStatus) changed = true;
    return { ...task, status: nextStatus };
  });

  const allDone = normalizedTasks.length > 0 && normalizedTasks.every((task) => task.status === "done");
  const milestoneStatus: BuildMilestone["status"] = allDone ? "done" : "active";
  if (milestone.status !== milestoneStatus) changed = true;

  return {
    milestone: { ...milestone, status: milestoneStatus, tasks: normalizedTasks },
    changed,
  };
}

export function generateMvpImplementationMilestone(
  plan: LivingBuildPlan,
  audit: MvpDiskAuditResult
): { plan: LivingBuildPlan; changed: boolean } {
  if (!audit.incompleteModules.length) {
    const existing = plan.milestones.find((milestone) => milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID);
    if (!existing) return { plan, changed: false };
    const synced = syncExistingMvpImplementationTasks(existing, audit);
    if (!synced.changed) return { plan, changed: false };
    const milestones = plan.milestones.map((milestone) =>
      milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID ? synced.milestone : milestone
    );
    return {
      plan: reconcileBuildPlanProgress({ ...plan, milestones }),
      changed: true,
    };
  }

  const existing = plan.milestones.find((milestone) => milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID);
  if (existing) {
    const synced = syncExistingMvpImplementationTasks(existing, audit);
    if (!synced.changed) {
      const nextTask = synced.milestone.tasks.find(
        (task) => task.status === "next" || task.status === "doing" || task.status === "todo"
      );
      if (!nextTask) return { plan, changed: false };
      return {
        plan: reconcileBuildPlanProgress({
          ...plan,
          currentMilestoneId: synced.milestone.id,
          currentTaskId: nextTask.id,
          nextRecommendedStep: nextTask.title,
        }),
        changed: true,
      };
    }
    const milestones = plan.milestones.map((milestone) =>
      milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID ? synced.milestone : milestone
    );
    const nextTask = synced.milestone.tasks.find(
      (task) => task.status === "next" || task.status === "doing" || task.status === "todo"
    );
    return {
      plan: reconcileBuildPlanProgress({
        ...plan,
        milestones,
        currentMilestoneId: synced.milestone.id,
        currentTaskId: nextTask?.id,
        nextRecommendedStep: nextTask?.title ?? plan.nextRecommendedStep,
        progressSummary: `MVP Implementation: ${
          synced.milestone.tasks.filter((task) => task.status === "done").length
        } / ${synced.milestone.tasks.length} tasks complete.`,
      }),
      changed: true,
    };
  }

  const tasks = mvpImplementationTasksFromAudit(audit.incompleteModules);
  const milestone: BuildMilestone = {
    id: MVP_IMPLEMENTATION_MILESTONE_ID,
    name: "MVP Implementation",
    goal: "Implement the remaining founder MVP modules verified missing or placeholder on disk.",
    status: "active",
    tasks,
  };

  return {
    plan: reconcileBuildPlanProgress({
      ...plan,
      milestones: [...plan.milestones, milestone],
      currentMilestoneId: milestone.id,
      currentTaskId: tasks[0]?.id,
      nextRecommendedStep: tasks[0]?.title ?? "Start MVP Implementation",
      progressSummary: `MVP Implementation: 0 / ${tasks.length} tasks complete.`,
    }),
    changed: true,
  };
}

export function shouldCreateMvpImplementationQueue(
  plan: LivingBuildPlan | null,
  audit: MvpDiskAuditResult | null
): boolean {
  return Boolean(plan && audit?.incompleteModules.length);
}
