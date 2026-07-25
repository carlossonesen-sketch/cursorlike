import type {
  ActionLogEntry,
  BuildMilestone,
  BuildProgressApplySummary,
  BuildTask,
  LivingBuildPlan,
  ProjectMemory,
  WorkSummary,
} from "../types";
import { appendActionLogEntry } from "./actionLogStore";
import { readLivingBuildPlan, writeLivingBuildPlan } from "./buildPlanStore";
import { readProjectMemory, writeProjectMemory } from "./projectMemoryStore";
import { reconcileBuildPlanProgress } from "../project/scaffoldPhase";
import { canCompleteTaskWithFiles, isPlanningOnlyFileChange } from "../project/taskKind";

function findCurrentMilestone(plan: LivingBuildPlan): BuildMilestone | undefined {
  return plan.milestones.find((milestone) => milestone.id === plan.currentMilestoneId) ?? plan.milestones[0];
}

function findCurrentTask(plan: LivingBuildPlan, milestone: BuildMilestone | undefined): BuildTask | undefined {
  if (!milestone) return undefined;
  return milestone.tasks.find((task) => task.id === plan.currentTaskId) ??
    milestone.tasks.find((task) => task.status === "next" || task.status === "doing") ??
    milestone.tasks.find((task) => task.status === "todo");
}

function countMilestoneTasks(milestone: BuildMilestone | undefined): { completed: number; total: number } {
  const tasks = milestone?.tasks ?? [];
  return {
    completed: tasks.filter((task) => task.status === "done").length,
    total: tasks.length,
  };
}

function updateTodos(memory: ProjectMemory, completedTaskId: string | undefined, nextTaskId: string | undefined): ProjectMemory {
  if (!memory.todos.length) return memory;
  return {
    ...memory,
    todos: memory.todos.map((todo) => {
      if (todo.id === completedTaskId) return { ...todo, status: "done" };
      if (todo.id === nextTaskId && todo.status === "todo") return { ...todo, status: "doing" };
      return todo;
    }),
  };
}

function createWorkSummary(
  now: string,
  completedTaskName: string | undefined,
  contributedToward: string | undefined,
  filesChanged: string[],
  nextRecommendedStep: string
): WorkSummary {
  return {
    id: `work-${Date.now()}`,
    date: now,
    completed: completedTaskName ? `Completed ${completedTaskName}` : `Contributed toward ${contributedToward ?? "the current build plan"}`,
    filesChanged,
    worksNow: filesChanged.length ? ["Patch applied successfully."] : [],
    stillNeedsWork: completedTaskName ? [] : ["Current task still needs follow-up work."],
    nextRecommendedStep,
  };
}

export async function updateBuildProgressAfterPatch(
  workspaceRoot: string,
  filesChanged: string[]
): Promise<BuildProgressApplySummary | null> {
  const [currentPlan, currentMemory] = await Promise.all([
    readLivingBuildPlan(workspaceRoot),
    readProjectMemory(workspaceRoot),
  ]);
  if (!currentPlan.milestones.length) return null;

  const now = new Date().toISOString();
  let plan: LivingBuildPlan = {
    ...currentPlan,
    milestones: currentPlan.milestones.map((milestone) => ({
      ...milestone,
      tasks: milestone.tasks.map((task) => ({ ...task })),
    })),
  };
  const milestone = findCurrentMilestone(plan);
  const currentTask = findCurrentTask(plan, milestone);
  const shouldCompleteTask =
    filesChanged.length > 0 &&
    currentTask != null &&
    currentTask.status !== "done" &&
    canCompleteTaskWithFiles(milestone!, currentTask, filesChanged);
  let completedTaskName: string | undefined;
  let contributedToward: string | undefined;

  if (milestone && currentTask && shouldCompleteTask) {
    currentTask.status = "done";
    currentTask.completedAt = now;
    completedTaskName = currentTask.title;
    plan.completedSteps = [
      ...plan.completedSteps,
      {
        id: `step-${Date.now()}`,
        completedAt: now,
        milestoneId: milestone.id,
        taskId: currentTask.id,
        completed: currentTask.title,
        filesChanged,
        worksNow: ["Patch applied successfully."],
        stillNeedsWork: [],
        nextRecommendedStep: "",
      },
    ];

    const sameMilestoneNext = milestone.tasks.find((task) => task.status === "todo");
    if (sameMilestoneNext) {
      sameMilestoneNext.status = "next";
      plan.currentMilestoneId = milestone.id;
      plan.currentTaskId = sameMilestoneNext.id;
      plan.nextRecommendedStep = sameMilestoneNext.title;
    } else {
      milestone.status = "done";
      const nextMilestone = plan.milestones.find((item) => item.status === "planned" || item.status === "paused");
      const nextTask = nextMilestone?.tasks.find((task) => task.status === "todo");
      if (nextMilestone) {
        nextMilestone.status = "active";
        if (nextTask) nextTask.status = "next";
        plan.currentMilestoneId = nextMilestone.id;
        plan.currentTaskId = nextTask?.id;
        plan.nextRecommendedStep = nextTask?.title ?? `Start ${nextMilestone.name}`;
      } else {
        plan.currentTaskId = undefined;
        plan.nextRecommendedStep = "Review the build plan and choose the next milestone.";
      }
    }
    plan.completedSteps[plan.completedSteps.length - 1].nextRecommendedStep = plan.nextRecommendedStep;
  } else {
    contributedToward = currentTask?.title ?? milestone?.name ?? "the current build plan";
    if (
      milestone &&
      currentTask &&
      !canCompleteTaskWithFiles(milestone, currentTask, filesChanged) &&
      isPlanningOnlyFileChange(filesChanged)
    ) {
      const kind = currentTask.kind ?? "implementation";
      plan.nextRecommendedStep = `${currentTask.title} (needs real ${kind === "scaffold" ? "scaffold" : "application"} files, not foundation docs only)`;
    } else {
      plan.nextRecommendedStep = currentTask?.title ?? plan.nextRecommendedStep;
    }
  }

  const activeMilestone = findCurrentMilestone(plan);
  const counts = countMilestoneTasks(activeMilestone);
  const reconciled = reconcileBuildPlanProgress({
    ...plan,
    progressSummary: `${activeMilestone?.name ?? "Current milestone"}: ${counts.completed} / ${counts.total} tasks complete.`,
    pausedState: { isPaused: false },
  });
  plan = reconciled;

  let memory = updateTodos(currentMemory, shouldCompleteTask ? currentTask?.id : undefined, plan.currentTaskId);
  memory = {
    ...memory,
    updatedAt: now,
    recentWork: [
      createWorkSummary(now, completedTaskName, contributedToward, filesChanged, plan.nextRecommendedStep),
      ...memory.recentWork,
    ].slice(0, 20),
    resumeState: {
      ...memory.resumeState,
      status: "active",
      activeMilestoneId: plan.currentMilestoneId,
      activeTaskId: plan.currentTaskId,
      lastWorkedAt: now,
      resumePrompt: plan.nextRecommendedStep,
    },
  };

  const actionEntry: ActionLogEntry = {
    ts: now,
    projectId: plan.projectId || memory.projectId,
    action: "update_memory",
    summary: completedTaskName
      ? `Completed build-plan task: ${completedTaskName}`
      : `Patch contributes toward: ${contributedToward ?? "current build plan"}`,
    files: filesChanged,
    approved: true,
  };

  await writeLivingBuildPlan(workspaceRoot, plan);
  await writeProjectMemory(workspaceRoot, memory);
  await appendActionLogEntry(workspaceRoot, actionEntry);

  return {
    completedTaskName,
    contributedToward,
    filesChanged,
    milestoneName: activeMilestone?.name ?? plan.currentMilestoneId,
    completedTasks: counts.completed,
    totalTasks: counts.total,
    nextRecommendedStep: plan.nextRecommendedStep,
  };
}
