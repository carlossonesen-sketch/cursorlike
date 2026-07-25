import type { LivingBuildPlan, ProjectMemory } from "../types";
import { defaultTasksForMilestone, inferProjectKind } from "../projectCreation/milestoneTasks";
import type { WorkspaceService } from "../workspace/WorkspaceService";
import { readActionLog } from "./actionLogStore";
import { writeLivingBuildPlan } from "./buildPlanStore";
import { writeProjectMemory } from "./projectMemoryStore";
import { persistReconciledBuildPlan, reconcileBuildPlanProgress } from "../project/scaffoldPhase";
import { repairImplementationMilestonesIfNeeded } from "../project/implementationMilestone";
import { reconcileBuildPlanWithDisk } from "../project/diskReconciliation";

const STALE_PLANNING_STEP = /\b(review and approve|preview the initial files|before anything is written|create project scaffold)\b/i;

async function starterFilesExist(workspace: WorkspaceService): Promise<boolean> {
  const hasPackage = await workspace.exists("package.json").catch(() => false);
  const hasIndex = await workspace.exists("index.html").catch(() => false);
  const hasEntry = await Promise.all([
    workspace.exists("src/main.ts").catch(() => false),
    workspace.exists("src/main.tsx").catch(() => false),
  ]);
  return hasPackage && (hasIndex || hasEntry.some(Boolean));
}

function findScaffoldTask(plan: LivingBuildPlan): {
  milestoneIndex: number;
  taskIndex: number;
} | null {
  for (let milestoneIndex = 0; milestoneIndex < plan.milestones.length; milestoneIndex += 1) {
    const milestone = plan.milestones[milestoneIndex];
    if (!milestone) continue;
    const taskIndex = milestone.tasks.findIndex((task) =>
      task.id === "m1-t1" || /scaffold/i.test(task.title)
    );
    if (taskIndex >= 0) return { milestoneIndex, taskIndex };
  }
  return null;
}

function findNextTask(plan: LivingBuildPlan, scaffoldTaskId: string): {
  milestoneId: string;
  taskId?: string;
  taskTitle: string;
} {
  for (const milestone of plan.milestones) {
    for (const task of milestone.tasks) {
      if (task.id !== scaffoldTaskId && (task.status === "next" || task.status === "doing" || task.status === "todo")) {
        return { milestoneId: milestone.id, taskId: task.id, taskTitle: task.title };
      }
    }
  }
  return {
    milestoneId: plan.currentMilestoneId || plan.milestones[0]?.id || "",
    taskTitle: "Run build check or continue the first working interaction.",
  };
}

function inferRepairKind(projectMemory: ProjectMemory, livingBuildPlan: LivingBuildPlan): "game" | "web" | "api" {
  const memoryText = [
    projectMemory.name,
    projectMemory.summary,
    projectMemory.fullIdea,
    livingBuildPlan.mvpDefinition,
  ].filter(Boolean).join(" ");
  return inferProjectKind(memoryText, projectMemory.techStack);
}

function repairEmptyMilestones(
  projectMemory: ProjectMemory,
  livingBuildPlan: LivingBuildPlan
): { livingBuildPlan: LivingBuildPlan; changed: boolean } {
  const projectKind = inferRepairKind(projectMemory, livingBuildPlan);
  let changed = false;
  const plan: LivingBuildPlan = {
    ...livingBuildPlan,
    milestones: livingBuildPlan.milestones.map((milestone) => {
      if (milestone.tasks.length >= 3) {
        return { ...milestone, tasks: milestone.tasks.map((task) => ({ ...task })) };
      }
      changed = true;
      return {
        ...milestone,
        tasks: defaultTasksForMilestone(milestone.id, milestone.name, projectKind),
      };
    }),
    completedSteps: [...livingBuildPlan.completedSteps],
  };
  const activeMilestone = plan.milestones.find((milestone) => milestone.id === plan.currentMilestoneId) ?? plan.milestones[0];
  if (activeMilestone && activeMilestone.tasks.length > 0 && !activeMilestone.tasks.some((task) => task.id === plan.currentTaskId)) {
    const firstTask = activeMilestone.tasks[0];
    if (firstTask) {
      firstTask.status = firstTask.status === "done" ? firstTask.status : "next";
      plan.currentMilestoneId = activeMilestone.id;
      plan.currentTaskId = firstTask.id;
      plan.nextRecommendedStep = firstTask.title;
      changed = true;
    }
  }
  if (activeMilestone && (!plan.nextRecommendedStep || /^Start\s+/i.test(plan.nextRecommendedStep))) {
    const nextTask = activeMilestone.tasks.find((task) => task.status === "next" || task.status === "doing" || task.status === "todo");
    if (nextTask) {
      nextTask.status = nextTask.status === "todo" ? "next" : nextTask.status;
      plan.currentTaskId = nextTask.id;
      plan.nextRecommendedStep = nextTask.title;
      changed = true;
    }
  }
  if (activeMilestone) {
    const completed = activeMilestone.tasks.filter((task) => task.status === "done").length;
    const progressSummary = `${activeMilestone.name}: ${completed} / ${activeMilestone.tasks.length} tasks complete.`;
    if (plan.progressSummary !== progressSummary) {
      plan.progressSummary = progressSummary;
      changed = true;
    }
  }
  return { livingBuildPlan: plan, changed };
}

export async function repairScaffoldCompletionIfNeeded(
  workspaceRoot: string,
  workspace: WorkspaceService,
  projectMemory: ProjectMemory,
  livingBuildPlan: LivingBuildPlan
): Promise<{ projectMemory: ProjectMemory; livingBuildPlan: LivingBuildPlan }> {
  const emptyMilestoneRepair = repairEmptyMilestones(projectMemory, livingBuildPlan);
  if (emptyMilestoneRepair.changed) {
    const now = new Date().toISOString();
    const activeMilestone = emptyMilestoneRepair.livingBuildPlan.milestones.find((item) => item.id === emptyMilestoneRepair.livingBuildPlan.currentMilestoneId);
    const activeTask = activeMilestone?.tasks.find((task) => task.id === emptyMilestoneRepair.livingBuildPlan.currentTaskId);
    const memory: ProjectMemory = {
      ...projectMemory,
      updatedAt: now,
      todos: emptyMilestoneRepair.livingBuildPlan.milestones.flatMap((milestone) =>
        milestone.tasks.map((task) => ({
          id: task.id,
          text: task.title,
          status: task.status === "done" ? "done" : task.status === "blocked" ? "blocked" : task.id === activeTask?.id ? "doing" : "todo",
        }))
      ),
      resumeState: {
        ...projectMemory.resumeState,
        status: "active",
        activeMilestoneId: emptyMilestoneRepair.livingBuildPlan.currentMilestoneId,
        activeTaskId: emptyMilestoneRepair.livingBuildPlan.currentTaskId,
        lastWorkedAt: now,
        resumePrompt: emptyMilestoneRepair.livingBuildPlan.nextRecommendedStep,
      },
    };
    await writeLivingBuildPlan(workspaceRoot, emptyMilestoneRepair.livingBuildPlan);
    await writeProjectMemory(workspaceRoot, memory);
    projectMemory = memory;
    livingBuildPlan = emptyMilestoneRepair.livingBuildPlan;
  }

  const implementationRepair = await repairImplementationMilestonesIfNeeded(workspace, livingBuildPlan);
  if (implementationRepair.changed) {
    const repairedPlan = reconcileBuildPlanProgress(implementationRepair.plan);
    const now = new Date().toISOString();
    const activeMilestone = repairedPlan.milestones.find(
      (item) => item.id === repairedPlan.currentMilestoneId
    );
    const activeTask = activeMilestone?.tasks.find((task) => task.id === repairedPlan.currentTaskId);
    const memory: ProjectMemory = {
      ...projectMemory,
      updatedAt: now,
      todos: repairedPlan.milestones.flatMap((milestone) =>
        milestone.tasks.map((task) => ({
          id: task.id,
          text: task.title,
          status:
            task.status === "done"
              ? "done"
              : task.status === "blocked"
                ? "blocked"
                : task.id === activeTask?.id
                  ? "doing"
                  : "todo",
        }))
      ),
      resumeState: {
        ...projectMemory.resumeState,
        status: "active",
        activeMilestoneId: repairedPlan.currentMilestoneId,
        activeTaskId: repairedPlan.currentTaskId,
        lastWorkedAt: now,
        resumePrompt: repairedPlan.nextRecommendedStep,
      },
    };
    await writeLivingBuildPlan(workspaceRoot, repairedPlan);
    await writeProjectMemory(workspaceRoot, memory);
    projectMemory = memory;
    livingBuildPlan = repairedPlan;
  }

  const diskReconciled = await reconcileBuildPlanWithDisk(workspace, livingBuildPlan, projectMemory);
  if (diskReconciled.changed) {
    const now = new Date().toISOString();
    const repairedPlan = diskReconciled.plan;
    const activeMilestone = repairedPlan.milestones.find((item) => item.id === repairedPlan.currentMilestoneId);
    const activeTask = activeMilestone?.tasks.find((task) => task.id === repairedPlan.currentTaskId);
    const memory: ProjectMemory = {
      ...projectMemory,
      updatedAt: now,
      todos: repairedPlan.milestones.flatMap((milestone) =>
        milestone.tasks.map((task) => ({
          id: task.id,
          text: task.title,
          status:
            task.status === "done"
              ? "done"
              : task.status === "blocked"
                ? "blocked"
                : task.id === activeTask?.id
                  ? "doing"
                  : "todo",
        }))
      ),
      resumeState: {
        ...projectMemory.resumeState,
        status: "active",
        activeMilestoneId: repairedPlan.currentMilestoneId,
        activeTaskId: repairedPlan.currentTaskId,
        lastWorkedAt: now,
        resumePrompt: repairedPlan.nextRecommendedStep,
      },
    };
    await writeLivingBuildPlan(workspaceRoot, repairedPlan);
    await writeProjectMemory(workspaceRoot, memory);
    projectMemory = memory;
    livingBuildPlan = repairedPlan;
  }

  const actionLog = await readActionLog(workspaceRoot).catch(() => []);
  const actionLogShowsCreation = actionLog.some((entry) =>
    (entry.action === "create_project" || entry.action === "write_file") &&
    entry.files?.some((file) => /^(package\.json|index\.html|src\/main\.tsx?|src\/styles\.css)$/i.test(file))
  );
  if (!livingBuildPlan.milestones.length || (!(await starterFilesExist(workspace)) && !actionLogShowsCreation)) {
    return persistReconciledBuildPlan(workspaceRoot, projectMemory, livingBuildPlan);
  }

  const scaffoldLocation = findScaffoldTask(livingBuildPlan);
  if (!scaffoldLocation) return persistReconciledBuildPlan(workspaceRoot, projectMemory, livingBuildPlan);

  const plan: LivingBuildPlan = {
    ...livingBuildPlan,
    milestones: livingBuildPlan.milestones.map((milestone) => ({
      ...milestone,
      tasks: milestone.tasks.map((task) => ({ ...task })),
    })),
    completedSteps: [...livingBuildPlan.completedSteps],
  };
  const milestone = plan.milestones[scaffoldLocation.milestoneIndex];
  const scaffoldTask = milestone?.tasks[scaffoldLocation.taskIndex];
  if (!milestone || !scaffoldTask) return persistReconciledBuildPlan(workspaceRoot, projectMemory, livingBuildPlan);

  const isStale =
    scaffoldTask.status !== "done" ||
    plan.currentTaskId === scaffoldTask.id ||
    STALE_PLANNING_STEP.test(plan.nextRecommendedStep || projectMemory.resumeState.resumePrompt || "");
  if (!isStale) return persistReconciledBuildPlan(workspaceRoot, projectMemory, livingBuildPlan);

  const now = new Date().toISOString();
  scaffoldTask.status = "done";
  scaffoldTask.completedAt = scaffoldTask.completedAt ?? now;
  const next = findNextTask(plan, scaffoldTask.id);
  const nextTask = plan.milestones
    .flatMap((item) => item.tasks)
    .find((task) => task.id === next.taskId);
  if (nextTask && nextTask.status === "todo") nextTask.status = "next";
  plan.currentMilestoneId = next.milestoneId;
  plan.currentTaskId = next.taskId;
  plan.nextRecommendedStep = next.taskTitle;
  const activeMilestone = plan.milestones.find((item) => item.id === plan.currentMilestoneId) ?? milestone;
  const completed = activeMilestone.tasks.filter((task) => task.status === "done").length;
  plan.progressSummary = `${activeMilestone.name}: ${completed} / ${activeMilestone.tasks.length} tasks complete.`;
  if (!plan.completedSteps.some((step) => step.taskId === scaffoldTask.id)) {
    plan.completedSteps.push({
      id: `step-${Date.now()}`,
      completedAt: scaffoldTask.completedAt,
      milestoneId: milestone.id,
      taskId: scaffoldTask.id,
      completed: scaffoldTask.title,
      filesChanged: projectMemory.generatedFiles.map((file) => file.path),
      worksNow: ["Initial project scaffold exists on disk."],
      stillNeedsWork: [],
      nextRecommendedStep: plan.nextRecommendedStep,
    });
  }

  const memory: ProjectMemory = {
    ...projectMemory,
    updatedAt: now,
    todos: projectMemory.todos.map((todo) => {
      if (todo.id === scaffoldTask.id) return { ...todo, status: "done" };
      if (todo.id === next.taskId && todo.status === "todo") return { ...todo, status: "doing" };
      return todo;
    }),
    recentWork: projectMemory.recentWork.length
      ? projectMemory.recentWork
      : [
          {
            id: `work-${Date.now()}`,
            date: now,
            completed: "Created initial project scaffold.",
            filesChanged: projectMemory.generatedFiles.map((file) => file.path),
            worksNow: ["Initial project scaffold exists on disk."],
            stillNeedsWork: [],
            nextRecommendedStep: plan.nextRecommendedStep,
          },
        ],
    resumeState: {
      ...projectMemory.resumeState,
      status: "active",
      activeMilestoneId: plan.currentMilestoneId,
      activeTaskId: plan.currentTaskId,
      lastWorkedAt: now,
      resumePrompt: plan.nextRecommendedStep,
    },
  };

  await writeLivingBuildPlan(workspaceRoot, plan);
  await writeProjectMemory(workspaceRoot, memory);
  const reconciled = await persistReconciledBuildPlan(workspaceRoot, memory, plan);
  return reconciled;
}
