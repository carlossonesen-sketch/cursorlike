import { appendActionLogEntry } from "../memory/actionLogStore";
import { writeLivingBuildPlan } from "../memory/buildPlanStore";
import { writeProjectMemory } from "../memory/projectMemoryStore";
import { writeWorkspaceProjectBlueprint } from "../product/projectBlueprintStore";
import type {
  ActionLogEntry,
  BuildMilestone,
  BuildTask,
  CompletedStep,
  LivingBuildPlan,
  PhaseBuildPlan,
  PhaseExecutionState,
  ProjectBlueprint,
  ProjectMemory,
  WorkSummary,
} from "../types";

export type ExecutionProgressOutcome =
  | "patch_applied_pending_validation"
  | "safe_patch_applied"
  | "build_passed"
  | "build_failed"
  | "test_passed"
  | "test_failed"
  | "test_unavailable"
  | "repair_attempted"
  | "repair_succeeded"
  | "repair_failed"
  | "task_completed"
  | "task_blocked"
  | "needs_approval"
  | "change_approval_pending"
  | "change_approved"
  | "change_rejected"
  | "phase_completed";

export interface ExecutionProgressRecordRequest {
  workspaceRoot: string;
  blueprint: ProjectBlueprint;
  phaseExecutionState: PhaseExecutionState;
  livingBuildPlan?: LivingBuildPlan | null;
  projectMemory?: ProjectMemory | null;
  outcome: ExecutionProgressOutcome;
  summary: string;
  filesChanged?: string[];
  command?: string;
  runId?: string;
  exitCode?: number;
  durationMs?: number;
  now?: string;
  deps?: ExecutionProgressRecorderDeps;
}

export interface ExecutionProgressRecordResult {
  blueprint: ProjectBlueprint;
  livingBuildPlan?: LivingBuildPlan | null;
  projectMemory?: ProjectMemory | null;
  actionLogEntry: ActionLogEntry;
  nextRecommendedAction: string;
}

export interface ExecutionProgressRecorderDeps {
  writeProjectBlueprint: (workspaceRoot: string, blueprint: ProjectBlueprint) => Promise<void>;
  writeLivingBuildPlan: (workspaceRoot: string, plan: LivingBuildPlan) => Promise<void>;
  writeProjectMemory: (workspaceRoot: string, memory: ProjectMemory) => Promise<void>;
  appendActionLogEntry: (workspaceRoot: string, entry: ActionLogEntry) => Promise<void>;
}

const defaultDeps: ExecutionProgressRecorderDeps = {
  writeProjectBlueprint: writeWorkspaceProjectBlueprint,
  writeLivingBuildPlan,
  writeProjectMemory,
  appendActionLogEntry,
};

function phaseSectionStatus(state: PhaseExecutionState): ProjectBlueprint["phaseExecutionState"]["status"] {
  if (state.phaseStatus === "complete") return "ready";
  if (state.phaseStatus === "blocked") return "needsReview";
  return "draft";
}

function checkStatusToGateStatus(status: PhaseExecutionState["buildStatus"]["status"]): PhaseBuildPlan["phases"][number]["qualityGates"][number]["status"] {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "blocked") return "blocked";
  return "pending";
}

function qualityGateCheckKind(gate: PhaseBuildPlan["phases"][number]["qualityGates"][number]): "build" | "test" | "check" | null {
  const text = [gate.id, gate.title, gate.check].join(" ").toLowerCase();
  if (/\bbuild\b/.test(text)) return "build";
  if (/\btest(s|ing)?\b/.test(text)) return "test";
  if (/\bcheck(s)?\b|\bquality\b|\bvalidation\b/.test(text)) return "check";
  return null;
}

function synchronizePhaseBuildPlanQualityGates(
  plan: PhaseBuildPlan | null,
  state: PhaseExecutionState,
  outcome: ExecutionProgressOutcome,
  now: string
): PhaseBuildPlan | null {
  if (!plan) return plan;
  const isBlockedOutcome = outcome === "task_blocked" ||
    outcome === "needs_approval" ||
    outcome === "build_failed" ||
    outcome === "test_failed" ||
    outcome === "repair_failed";

  return {
    ...plan,
    updatedAt: now,
    phases: plan.phases.map((phase) => {
      if (phase.id !== state.currentPhaseId) return phase;
      return {
        ...phase,
        qualityGates: phase.qualityGates.map((gate) => {
          const kind = qualityGateCheckKind(gate);
          if (kind === "build") {
            return { ...gate, status: checkStatusToGateStatus(state.buildStatus.status) };
          }
          if (kind === "test") {
            return { ...gate, status: checkStatusToGateStatus(state.testStatus.status) };
          }
          if (kind === "check") {
            return { ...gate, status: checkStatusToGateStatus(state.checkStatus.status) };
          }
          if (isBlockedOutcome && gate.required) {
            return { ...gate, status: "blocked" as const };
          }
          return gate;
        }),
      };
    }),
  };
}

function cloneLivingBuildPlan(plan: LivingBuildPlan): LivingBuildPlan {
  return {
    ...plan,
    milestones: plan.milestones.map((milestone) => ({
      ...milestone,
      tasks: milestone.tasks.map((task) => ({ ...task })),
    })),
    completedSteps: plan.completedSteps.map((step) => ({ ...step })),
    pausedState: { ...plan.pausedState },
  };
}

function effectiveTaskId(state: PhaseExecutionState, outcome: ExecutionProgressOutcome): string | undefined {
  if (shouldCompleteTask(outcome)) {
    return state.completedTaskIds[state.completedTaskIds.length - 1] ?? state.currentTaskId;
  }
  return state.currentTaskId;
}

function findTask(plan: LivingBuildPlan, taskId: string | undefined): {
  milestone?: BuildMilestone;
  task?: BuildTask;
} {
  if (!taskId) return {};
  for (const milestone of plan.milestones) {
    const task = milestone.tasks.find((item) => item.id === taskId);
    if (task) return { milestone, task };
  }
  return {};
}

function countMilestoneTasks(milestone: BuildMilestone | undefined): { complete: number; total: number } {
  const tasks = milestone?.tasks ?? [];
  return {
    complete: tasks.filter((task) => task.status === "done").length,
    total: tasks.length,
  };
}

function shouldCompleteTask(outcome: ExecutionProgressOutcome): boolean {
  return outcome === "safe_patch_applied" || outcome === "task_completed";
}

function shouldBlockTask(outcome: ExecutionProgressOutcome): boolean {
  return outcome === "build_failed" || outcome === "test_failed" || outcome === "repair_failed" || outcome === "task_blocked";
}

function appendCompletedStep(
  plan: LivingBuildPlan,
  milestone: BuildMilestone,
  task: BuildTask,
  filesChanged: string[],
  nextRecommendedStep: string,
  now: string
): CompletedStep[] {
  if (plan.completedSteps.some((step) => step.taskId === task.id)) {
    return plan.completedSteps;
  }
  return [
    ...plan.completedSteps,
    {
      id: `phase-step-${now.replace(/[^a-zA-Z0-9]+/g, "-")}-${task.id}`,
      completedAt: now,
      milestoneId: milestone.id,
      taskId: task.id,
      completed: task.title,
      filesChanged,
      worksNow: filesChanged.length ? ["Autonomous phase action completed successfully."] : [],
      stillNeedsWork: [],
      nextRecommendedStep,
    },
  ];
}

function updateLivingPlan(
  plan: LivingBuildPlan | null | undefined,
  state: PhaseExecutionState,
  outcome: ExecutionProgressOutcome,
  summary: string,
  filesChanged: string[],
  now: string
): LivingBuildPlan | null | undefined {
  if (!plan) return plan;
  const next = cloneLivingBuildPlan(plan);
  const taskId = effectiveTaskId(state, outcome);
  const { milestone, task } = findTask(next, taskId);

  if (milestone && task && shouldCompleteTask(outcome)) {
    task.status = "done";
    task.completedAt = task.completedAt ?? now;
    const sameMilestoneNext = milestone.tasks.find((item) => item.status === "todo" || item.status === "next" || item.status === "doing");
    if (sameMilestoneNext) {
      sameMilestoneNext.status = sameMilestoneNext.status === "todo" ? "next" : sameMilestoneNext.status;
      next.currentMilestoneId = milestone.id;
      next.currentTaskId = sameMilestoneNext.id;
      next.nextRecommendedStep = sameMilestoneNext.title;
    } else {
      milestone.status = "done";
      const nextMilestone = next.milestones.find((item) => item.status === "planned" || item.status === "paused" || item.status === "active");
      const nextTask = nextMilestone?.tasks.find((item) => item.status === "todo" || item.status === "next" || item.status === "doing");
      if (nextMilestone && nextTask) {
        nextMilestone.status = "active";
        nextTask.status = nextTask.status === "todo" ? "next" : nextTask.status;
        next.currentMilestoneId = nextMilestone.id;
        next.currentTaskId = nextTask.id;
        next.nextRecommendedStep = nextTask.title;
      } else {
        next.currentTaskId = undefined;
        next.nextRecommendedStep = "Phase complete. Await approval for the next phase gate.";
      }
    }
    next.completedSteps = appendCompletedStep(next, milestone, task, filesChanged, next.nextRecommendedStep, now);
  }

  if (milestone && task && shouldBlockTask(outcome)) {
    task.status = "blocked";
    next.currentMilestoneId = milestone.id;
    next.currentTaskId = task.id;
    next.nextRecommendedStep = state.nextRecommendedAction || "Repair the blocker before continuing.";
  }

  if (outcome === "repair_succeeded") {
    next.nextRecommendedStep = "Rerun checks before continuing.";
  }

  if (outcome === "build_failed") {
    next.nextRecommendedStep = "Repair build failure before continuing.";
  }

  if (outcome === "test_failed") {
    next.nextRecommendedStep = "Repair test failure before continuing.";
  }

  if (outcome === "test_unavailable" || outcome === "build_passed" || outcome === "test_passed") {
    next.nextRecommendedStep = state.nextRecommendedAction || next.nextRecommendedStep || "Continue to the next task.";
  }

  if (outcome === "phase_completed") {
    next.nextRecommendedStep = "Phase complete. Await approval for the next phase gate.";
  }

  const activeMilestone = next.milestones.find((item) => item.id === next.currentMilestoneId) ?? milestone;
  const counts = countMilestoneTasks(activeMilestone);
  next.progressSummary = activeMilestone
    ? `${activeMilestone.name}: ${counts.complete} / ${counts.total} tasks complete.`
    : summary;
  next.pausedState = { isPaused: false };
  return next;
}

function createWorkSummary(
  now: string,
  outcome: ExecutionProgressOutcome,
  summary: string,
  filesChanged: string[],
  nextRecommendedAction: string
): WorkSummary {
  return {
    id: `phase-work-${now.replace(/[^a-zA-Z0-9]+/g, "-")}`,
    date: now,
    completed: summary,
    filesChanged,
    worksNow: outcome === "build_passed" || outcome === "test_passed" || outcome === "repair_succeeded"
      ? [summary]
      : [],
    stillNeedsWork: outcome === "build_failed" || outcome === "test_failed" || outcome === "repair_failed" || outcome === "task_blocked"
      ? [nextRecommendedAction]
      : [],
    nextRecommendedStep: nextRecommendedAction,
  };
}

function updateProjectMemory(
  memory: ProjectMemory | null | undefined,
  state: PhaseExecutionState,
  outcome: ExecutionProgressOutcome,
  summary: string,
  filesChanged: string[],
  nextRecommendedAction: string,
  now: string
): ProjectMemory | null | undefined {
  if (!memory) return memory;
  const taskId = effectiveTaskId(state, outcome);
  return {
    ...memory,
    updatedAt: now,
    todos: memory.todos.map((todo) => {
      if (todo.id !== taskId) return todo;
      if (shouldCompleteTask(outcome)) return { ...todo, status: "done" };
      if (shouldBlockTask(outcome)) return { ...todo, status: "blocked" };
      return todo;
    }),
    recentWork: [
      createWorkSummary(now, outcome, summary, filesChanged, nextRecommendedAction),
      ...memory.recentWork,
    ].slice(0, 20),
    resumeState: {
      ...memory.resumeState,
      status: state.phaseStatus === "blocked" ? "paused" : "active",
      activeMilestoneId: state.currentPhaseId,
      activeTaskId: state.currentTaskId,
      lastWorkedAt: now,
      resumePrompt: nextRecommendedAction,
    },
  };
}

function actionForOutcome(outcome: ExecutionProgressOutcome): ActionLogEntry["action"] {
  if (outcome === "safe_patch_applied" || outcome === "patch_applied_pending_validation") return "apply_patch";
  if (outcome === "build_passed" || outcome === "build_failed" || outcome === "test_passed" || outcome === "test_failed" || outcome === "test_unavailable") {
    return "run_command";
  }
  return "update_memory";
}

export async function recordExecutionProgress(
  request: ExecutionProgressRecordRequest
): Promise<ExecutionProgressRecordResult> {
  const now = request.now ?? new Date().toISOString();
  const deps = request.deps ?? defaultDeps;
  const filesChanged = request.filesChanged ?? [];
  const nextRecommendedAction = request.phaseExecutionState.nextRecommendedAction || request.summary;
  const synchronizedPhasePlan = synchronizePhaseBuildPlanQualityGates(
    request.blueprint.phaseBuildPlan.data,
    request.phaseExecutionState,
    request.outcome,
    now
  );
  const blueprint: ProjectBlueprint = {
    ...request.blueprint,
    updatedAt: now,
    phaseBuildPlan: synchronizedPhasePlan
      ? {
          status: request.blueprint.phaseBuildPlan.status === "empty" ? "draft" : request.blueprint.phaseBuildPlan.status,
          updatedAt: now,
          data: synchronizedPhasePlan,
        }
      : request.blueprint.phaseBuildPlan,
    phaseExecutionState: {
      status: phaseSectionStatus(request.phaseExecutionState),
      updatedAt: now,
      data: request.phaseExecutionState,
    },
  };
  const livingBuildPlan = updateLivingPlan(
    request.livingBuildPlan,
    request.phaseExecutionState,
    request.outcome,
    request.summary,
    filesChanged,
    now
  );
  const projectMemory = updateProjectMemory(
    request.projectMemory,
    request.phaseExecutionState,
    request.outcome,
    request.summary,
    filesChanged,
    livingBuildPlan?.nextRecommendedStep || nextRecommendedAction,
    now
  );

  const actionLogEntry: ActionLogEntry = {
    ts: now,
    projectId: request.blueprint.identity.projectId || request.projectMemory?.projectId || request.livingBuildPlan?.projectId || "",
    action: actionForOutcome(request.outcome),
    summary: request.summary,
    files: filesChanged.length ? filesChanged : undefined,
    command: request.command,
    runId: request.runId,
    exitCode: request.exitCode,
    durationMs: request.durationMs,
    approved: true,
  };

  await deps.writeProjectBlueprint(request.workspaceRoot, blueprint);
  if (livingBuildPlan) {
    await deps.writeLivingBuildPlan(request.workspaceRoot, livingBuildPlan);
  }
  if (projectMemory) {
    await deps.writeProjectMemory(request.workspaceRoot, projectMemory);
  }
  await deps.appendActionLogEntry(request.workspaceRoot, actionLogEntry);

  return {
    blueprint,
    livingBuildPlan,
    projectMemory,
    actionLogEntry,
    nextRecommendedAction: livingBuildPlan?.nextRecommendedStep || nextRecommendedAction,
  };
}
