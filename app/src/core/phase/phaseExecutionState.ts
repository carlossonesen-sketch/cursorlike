import type {
  IntakeConfidenceLevel,
  PendingChangeApproval,
  PhaseBuildPlan,
  PhaseBuildPlanPhase,
  PhaseExecutionCheckState,
  PhaseExecutionCheckStatus,
  PhaseExecutionHistoryEntry,
  PhaseExecutionState,
  PhaseRepairAttempt,
  PhaseStatus,
  PhaseTask,
} from "../types";

function defaultCheckState(): PhaseExecutionCheckState {
  return { status: "notRun" };
}

function history(
  action: string,
  phaseId: string,
  taskId: string | undefined,
  summary: string,
  timestamp: string
): PhaseExecutionHistoryEntry {
  return {
    id: `${timestamp}-${action}-${taskId ?? phaseId}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
    timestamp,
    action,
    phaseId,
    taskId,
    summary,
  };
}

function phaseById(plan: PhaseBuildPlan, phaseId: string): PhaseBuildPlanPhase | undefined {
  return plan.phases.find((phase) => phase.id === phaseId);
}

function allTasks(plan: PhaseBuildPlan): PhaseTask[] {
  return plan.phases.flatMap((phase) => phase.tasks);
}

function taskExists(plan: PhaseBuildPlan, taskId: string): boolean {
  return allTasks(plan).some((task) => task.id === taskId);
}

function firstAvailableTaskInPhase(
  phase: PhaseBuildPlanPhase | undefined,
  completedTaskIds: string[],
  skippedTaskIds: string[],
  blockedTaskIds: string[]
): PhaseTask | undefined {
  if (!phase) return undefined;
  const unavailable = new Set([...completedTaskIds, ...skippedTaskIds, ...blockedTaskIds]);
  return phase.tasks.find((task) => !unavailable.has(task.id));
}

function nextRecommendedAction(phase: PhaseBuildPlanPhase | undefined, task: PhaseTask | undefined): string {
  if (!phase) {
    return "No active phase is available.";
  }
  if (!task) {
    return `Phase ${phase.title} is complete. Await approval for the next phase gate.`;
  }
  return `Continue ${phase.title}: ${task.title}`;
}

function confidenceFor(plan: PhaseBuildPlan): IntakeConfidenceLevel {
  if (plan.phases.length >= 6 && plan.phases.every((phase) => phase.tasks.length > 0)) {
    return "high";
  }
  if (plan.phases.length > 0) {
    return "medium";
  }
  return "low";
}

export function createPhaseExecutionState(
  plan: PhaseBuildPlan,
  now = new Date().toISOString()
): PhaseExecutionState {
  const currentPhaseId = plan.currentPhaseId || plan.recommendedNextPhaseId || plan.phases[0]?.id || "";
  const currentPhase = phaseById(plan, currentPhaseId);
  const currentTask = plan.recommendedNextTaskId && taskExists(plan, plan.recommendedNextTaskId)
    ? allTasks(plan).find((task) => task.id === plan.recommendedNextTaskId)
    : firstAvailableTaskInPhase(currentPhase, [], [], []);

  return {
    schemaVersion: 1,
    blueprintId: plan.blueprintId,
    phaseBuildPlanId: `${plan.blueprintId}-phase-build-plan`,
    currentPhaseId,
    currentTaskId: currentTask?.id,
    completedTaskIds: [],
    skippedTaskIds: [],
    blockedTaskIds: [],
    lastAction: "initialized",
    nextRecommendedAction: nextRecommendedAction(currentPhase, currentTask),
    buildStatus: defaultCheckState(),
    testStatus: defaultCheckState(),
    checkStatus: defaultCheckState(),
    repairAttempts: [],
    phaseStatus: "active",
    confidenceLevel: confidenceFor(plan),
    createdAt: now,
    updatedAt: now,
    history: [
      history(
        "initialized",
        currentPhaseId,
        currentTask?.id,
        "Phase execution state initialized from Phase Build Plan.",
        now
      ),
    ],
  };
}

export function markPhaseTaskComplete(
  state: PhaseExecutionState,
  plan: PhaseBuildPlan,
  taskId = state.currentTaskId,
  now = new Date().toISOString()
): PhaseExecutionState {
  if (!taskId) {
    return state;
  }

  const completedTaskIds = Array.from(new Set([...state.completedTaskIds, taskId]));
  const blockedTaskIds = state.blockedTaskIds.filter((id) => id !== taskId);
  const currentPhase = phaseById(plan, state.currentPhaseId);
  const nextTask = firstAvailableTaskInPhase(currentPhase, completedTaskIds, state.skippedTaskIds, blockedTaskIds);
  const phaseStatus: PhaseStatus = nextTask ? "active" : "complete";

  return {
    ...state,
    currentTaskId: nextTask?.id,
    completedTaskIds,
    blockedTaskIds,
    blockerReason: blockedTaskIds.length ? state.blockerReason : undefined,
    lastAction: "task_completed",
    nextRecommendedAction: nextRecommendedAction(currentPhase, nextTask),
    phaseStatus,
    updatedAt: now,
    history: [
      ...state.history,
      history("task_completed", state.currentPhaseId, taskId, `Completed task ${taskId}.`, now),
    ],
  };
}

export function markPhaseTaskBlocked(
  state: PhaseExecutionState,
  taskId = state.currentTaskId,
  reason: string,
  now = new Date().toISOString()
): PhaseExecutionState {
  if (!taskId) {
    return state;
  }

  const blockedTaskIds = Array.from(new Set([...state.blockedTaskIds, taskId]));
  return {
    ...state,
    currentTaskId: taskId,
    blockedTaskIds,
    blockerReason: reason,
    lastAction: "task_blocked",
    nextRecommendedAction: `Resolve blocker for ${taskId}: ${reason}`,
    phaseStatus: "blocked",
    updatedAt: now,
    history: [
      ...state.history,
      history("task_blocked", state.currentPhaseId, taskId, reason, now),
    ],
  };
}

export function recordPhaseCheckStatus(
  state: PhaseExecutionState,
  kind: "build" | "test" | "check",
  status: PhaseExecutionCheckStatus,
  options: Omit<PhaseExecutionCheckState, "status" | "updatedAt"> = {},
  now = new Date().toISOString()
): PhaseExecutionState {
  const nextCheck: PhaseExecutionCheckState = {
    ...options,
    status,
    updatedAt: now,
  };
  const key = kind === "build" ? "buildStatus" : kind === "test" ? "testStatus" : "checkStatus";

  return {
    ...state,
    [key]: nextCheck,
    lastAction: `${kind}_status_recorded`,
    nextRecommendedAction: status === "failed"
      ? `Repair ${kind} failure before continuing.`
      : state.nextRecommendedAction,
    updatedAt: now,
    history: [
      ...state.history,
      history(`${kind}_status_recorded`, state.currentPhaseId, state.currentTaskId, options.summary ?? `${kind} status: ${status}`, now),
    ],
  };
}

export function recordRepairAttempt(
  state: PhaseExecutionState,
  attempt: Omit<PhaseRepairAttempt, "id" | "attemptedAt"> & { id?: string; attemptedAt?: string },
  now = new Date().toISOString()
): PhaseExecutionState {
  const repairAttempt: PhaseRepairAttempt = {
    id: attempt.id ?? `repair-${state.repairAttempts.length + 1}`,
    taskId: attempt.taskId,
    attemptedAt: attempt.attemptedAt ?? now,
    summary: attempt.summary,
    status: attempt.status,
  };

  return {
    ...state,
    repairAttempts: [...state.repairAttempts, repairAttempt],
    lastAction: "repair_attempt_recorded",
    nextRecommendedAction: attempt.status === "succeeded"
      ? "Rerun checks before continuing."
      : "Review repair result before continuing.",
    updatedAt: now,
    history: [
      ...state.history,
      history("repair_attempt_recorded", state.currentPhaseId, attempt.taskId, attempt.summary, now),
    ],
  };
}

export function isChangeApprovalPending(state: PhaseExecutionState | null | undefined): boolean {
  return state?.pendingChangeApproval?.status === "pending";
}

export function recordPendingChangeApproval(
  state: PhaseExecutionState,
  input: {
    phaseId: string;
    taskId: string;
    taskTitle: string;
    patch: string;
    explanation: string;
    filePaths: string[];
    controlReason: string;
    now?: string;
  }
): PhaseExecutionState {
  const now = input.now ?? new Date().toISOString();
  const pending: PendingChangeApproval = {
    id: `${now}-change-${input.taskId}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
    phaseId: input.phaseId,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    summary: input.filePaths.length
      ? `Update ${input.filePaths.join(", ")} for "${input.taskTitle}".`
      : `Update project files for "${input.taskTitle}".`,
    explanation: input.explanation.trim() || `NF prepared changes for "${input.taskTitle}".`,
    filePaths: input.filePaths,
    patch: input.patch,
    controlReason: input.controlReason,
    status: "pending",
    requestedAt: now,
  };
  return {
    ...state,
    pendingChangeApproval: pending,
    lastAction: "change_approval_pending",
    nextRecommendedAction: "Approve the proposed file change to continue building.",
    updatedAt: now,
    history: [
      ...state.history,
      history("change_approval_pending", input.phaseId, input.taskId, pending.summary, now),
    ],
  };
}

export function clearPendingChangeApproval(
  state: PhaseExecutionState,
  resolution: "approved" | "rejected",
  now = new Date().toISOString()
): PhaseExecutionState {
  const pending = state.pendingChangeApproval;
  if (!pending) return state;
  return {
    ...state,
    pendingChangeApproval: resolution === "approved"
      ? { ...pending, status: "approved", resolvedAt: now }
      : null,
    lastAction: resolution === "approved" ? "change_approved" : "change_rejected",
    updatedAt: now,
    history: [
      ...state.history,
      history(
        resolution === "approved" ? "change_approved" : "change_rejected",
        pending.phaseId,
        pending.taskId,
        resolution === "approved"
          ? "Founder approved the proposed file change."
          : "Founder rejected the proposed file change.",
        now
      ),
    ],
  };
}

export function rejectPendingChangeApproval(
  state: PhaseExecutionState,
  reason = "Founder rejected the proposed file change.",
  now = new Date().toISOString()
): PhaseExecutionState {
  const pending = state.pendingChangeApproval;
  if (!pending) return state;
  let next = clearPendingChangeApproval(state, "rejected", now);
  next = markPhaseTaskBlocked(next, pending.taskId, reason, now);
  return { ...next, pendingChangeApproval: null };
}
