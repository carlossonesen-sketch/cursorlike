import type {
  PhaseBuildPlan,
  PhaseBuildPlanPhase,
  PhaseExecutionState,
  PhaseTask,
} from "../types";
import { markPhaseTaskBlocked, markPhaseTaskComplete } from "./phaseExecutionState";

export type ExecutionStepClassification = "safe" | "needsApproval" | "blocked" | "phaseComplete";

export interface ExecutionLoopStep {
  classification: ExecutionStepClassification;
  phaseId: string;
  taskId?: string;
  title: string;
  reason: string;
  constraints: string[];
  nextRecommendedAction: string;
}

export interface SimulatedExecutionResult {
  taskId?: string;
  status: "completed" | "blocked";
  summary: string;
}

const APPROVAL_PATTERNS = [
  /\bcredential(s)?\b/i,
  /\bapi key(s)?\b/i,
  /\baccount(s)?\b/i,
  /\bpaid\b/i,
  /\bpayment(s)?\b/i,
  /\bbilling\b/i,
  /\bdeployment\b/i,
  /\blegal\b/i,
  /\bprivacy\b/i,
  /\bscope change\b/i,
];

const BLOCKED_PATTERNS = [
  /\bblocked clarification\b/i,
  /\bneed(s)? clarification\b/i,
  /\bdestructive\b/i,
  /\bdelete\b/i,
  /\bremove existing\b/i,
  /\brewrite\b/i,
  /\bredesign\b/i,
  /\brestructure\b/i,
];

function phaseById(plan: PhaseBuildPlan, phaseId: string): PhaseBuildPlanPhase | undefined {
  return plan.phases.find((phase) => phase.id === phaseId);
}

function taskText(task: PhaseTask): string {
  return [task.title, task.rationale, ...task.constraints].join(" ");
}

function classifyTask(task: PhaseTask): Pick<ExecutionLoopStep, "classification" | "reason"> {
  const text = taskText(task);
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      classification: "blocked",
      reason: "This task may be destructive, may rewrite existing work, or needs clarification before NF can proceed.",
    };
  }
  if (APPROVAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      classification: "needsApproval",
      reason: "This task touches credentials, accounts, paid services, deployment, legal/privacy, or scope decisions.",
    };
  }
  return {
    classification: "safe",
    reason: "This task appears non-destructive and can be planned for bounded execution.",
  };
}

function unavailableTaskIds(state: PhaseExecutionState): Set<string> {
  return new Set([...state.completedTaskIds, ...state.skippedTaskIds, ...state.blockedTaskIds]);
}

export function selectNextExecutableTask(
  plan: PhaseBuildPlan,
  state: PhaseExecutionState
): PhaseTask | null {
  const phase = phaseById(plan, state.currentPhaseId);
  if (!phase) return null;

  const unavailable = unavailableTaskIds(state);
  if (state.currentTaskId && !unavailable.has(state.currentTaskId)) {
    const currentTask = phase.tasks.find((task) => task.id === state.currentTaskId);
    if (currentTask) return currentTask;
  }

  return phase.tasks.find((task) => !unavailable.has(task.id)) ?? null;
}

export function planNextExecutionStep(plan: PhaseBuildPlan, state: PhaseExecutionState): ExecutionLoopStep {
  const phase = phaseById(plan, state.currentPhaseId);
  if (!phase) {
    return {
      classification: "blocked",
      phaseId: state.currentPhaseId,
      title: "Phase not found",
      reason: "The current phase id does not exist in the Phase Build Plan.",
      constraints: [],
      nextRecommendedAction: "Repair or regenerate the Phase Build Plan before continuing.",
    };
  }

  if (state.phaseStatus === "blocked" || state.blockedTaskIds.includes(state.currentTaskId ?? "")) {
    return {
      classification: "blocked",
      phaseId: phase.id,
      taskId: state.currentTaskId,
      title: "Task is blocked",
      reason: state.blockerReason ?? "The current task is blocked.",
      constraints: [],
      nextRecommendedAction: state.nextRecommendedAction,
    };
  }

  if (phase.status !== "approved" && phase.status !== "active") {
    return {
      classification: "needsApproval",
      phaseId: phase.id,
      title: `${phase.title} phase approval required`,
      reason: "ExecutionLoop v1 only selects tasks inside an approved or active phase.",
      constraints: [],
      nextRecommendedAction: phase.approvalGate.approvalQuestion,
    };
  }

  const task = selectNextExecutableTask(plan, state);
  if (!task) {
    return {
      classification: "phaseComplete",
      phaseId: phase.id,
      title: `${phase.title} complete`,
      reason: "No remaining uncompleted, unskipped, or unblocked tasks exist in this phase.",
      constraints: [],
      nextRecommendedAction: `Stop at ${phase.title} phase gate and ask whether to continue to the next phase.`,
    };
  }

  const classified = classifyTask(task);
  return {
    classification: classified.classification,
    phaseId: phase.id,
    taskId: task.id,
    title: task.title,
    reason: classified.reason,
    constraints: task.constraints,
    nextRecommendedAction:
      classified.classification === "safe"
        ? `Plan bounded execution for task: ${task.title}`
        : classified.reason,
  };
}

export function applySimulatedExecutionResult(
  state: PhaseExecutionState,
  plan: PhaseBuildPlan,
  result: SimulatedExecutionResult,
  now = new Date().toISOString()
): PhaseExecutionState {
  const taskId = result.taskId ?? state.currentTaskId;
  if (result.status === "completed") {
    return markPhaseTaskComplete(state, plan, taskId, now);
  }
  return markPhaseTaskBlocked(state, taskId, result.summary, now);
}
