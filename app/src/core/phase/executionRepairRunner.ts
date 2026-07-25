import type { PlanAndPatch, PhaseBuildPlan, PhaseExecutionState, PhaseTask } from "../types";
import {
  createFullFileReplacementPatch,
  repairReferencedBuildFailure,
  storeBuildFailure,
} from "../project/buildRepair";
import { markPhaseTaskBlocked, recordRepairAttempt } from "./phaseExecutionState";

export type ExecutionRepairRunnerStatus = "repaired" | "needsApproval" | "blocked" | "failed" | "unavailable";

export interface ExecutionRepairApplyResult {
  ok: boolean;
  summary: string;
}

export interface ExecutionRepairRunnerResult {
  status: ExecutionRepairRunnerStatus;
  reason: string;
  patch?: PlanAndPatch;
  state: PhaseExecutionState;
}

export interface ExecutionRepairRunnerRequest {
  plan: PhaseBuildPlan;
  state: PhaseExecutionState;
  workspaceRoot: string;
  failureOutput?: string;
  maxAttempts?: number;
  now?: string;
  readFile: (path: string) => Promise<string>;
  applyRepair?: (patch: PlanAndPatch) => Promise<ExecutionRepairApplyResult>;
}

const APPROVAL_SENSITIVE_PATTERNS = [
  /\bcredential(s)?\b/i,
  /\bapi[\s_-]?key(s)?\b/i,
  /\baccount(s)?\b/i,
  /\bpaid\b/i,
  /\bpayment(s)?\b/i,
  /\bbilling\b/i,
  /\bdeployment\b/i,
  /\blegal\b/i,
  /\bprivacy\b/i,
  /\bscope change\b/i,
];

const DESTRUCTIVE_PATTERNS = [
  /\bdelete\b/i,
  /\bremove existing\b/i,
  /\bdrop\b/i,
  /\bdestroy\b/i,
  /\brewrite\b/i,
  /\bredesign\b/i,
  /\brestructure\b/i,
];

function phaseIsApproved(plan: PhaseBuildPlan, phaseId: string): boolean {
  const phase = plan.phases.find((item) => item.id === phaseId);
  return phase?.status === "approved" || phase?.status === "active";
}

function currentTask(plan: PhaseBuildPlan, state: PhaseExecutionState): PhaseTask | undefined {
  return plan.phases
    .find((phase) => phase.id === state.currentPhaseId)
    ?.tasks.find((task) => task.id === state.currentTaskId);
}

function textLooksSensitive(text: string): boolean {
  return APPROVAL_SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function textLooksDestructive(text: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function taskText(task: PhaseTask | undefined, state: PhaseExecutionState, failureOutput: string): string {
  return [
    task?.title,
    task?.rationale,
    ...(task?.constraints ?? []),
    state.blockerReason,
    failureOutput,
  ].filter(Boolean).join(" ");
}

function failedCheckKind(state: PhaseExecutionState): "build" | "test" | "check" | null {
  if (state.buildStatus.status === "failed") return "build";
  if (state.testStatus.status === "failed") return "test";
  if (state.checkStatus.status === "failed") return "check";
  return null;
}

function failureCommand(state: PhaseExecutionState, kind: "build" | "test" | "check"): string {
  const check = kind === "build" ? state.buildStatus : kind === "test" ? state.testStatus : state.checkStatus;
  return check.command ?? kind;
}

function failureExitCode(state: PhaseExecutionState, kind: "build" | "test" | "check"): number {
  const check = kind === "build" ? state.buildStatus : kind === "test" ? state.testStatus : state.checkStatus;
  return check.exitCode ?? 1;
}

function repairAttemptsForTask(state: PhaseExecutionState): number {
  return state.repairAttempts.filter((attempt) => attempt.taskId === state.currentTaskId).length;
}

function repairSucceededState(state: PhaseExecutionState, now: string, summary: string): PhaseExecutionState {
  const repaired = recordRepairAttempt(
    state,
    {
      taskId: state.currentTaskId ?? state.currentPhaseId,
      summary,
      status: "succeeded",
    },
    now
  );
  return {
    ...repaired,
    blockedTaskIds: repaired.blockedTaskIds.filter((taskId) => taskId !== state.currentTaskId),
    blockerReason: undefined,
    phaseStatus: "active",
    nextRecommendedAction: "Rerun checks before continuing.",
  };
}

function repairFailedState(state: PhaseExecutionState, now: string, summary: string): PhaseExecutionState {
  const repaired = recordRepairAttempt(
    state,
    {
      taskId: state.currentTaskId ?? state.currentPhaseId,
      summary,
      status: "failed",
    },
    now
  );
  return markPhaseTaskBlocked(repaired, state.currentTaskId, summary, now);
}

async function createSafeRepairPatch(
  request: ExecutionRepairRunnerRequest,
  output: string,
  kind: "build" | "test" | "check"
): Promise<PlanAndPatch | null> {
  const failure = storeBuildFailure(
    failureCommand(request.state, kind),
    request.workspaceRoot,
    failureExitCode(request.state, kind),
    output
  );

  for (const path of failure.filesReferenced) {
    const refs = failure.refs.filter((ref) => ref.path === path);
    if (refs.length === 0) continue;
    const oldContent = await request.readFile(path);
    const repaired = repairReferencedBuildFailure(path, oldContent, refs);
    if (!repaired || repaired === oldContent) continue;
    return createFullFileReplacementPatch(path, oldContent, repaired);
  }

  return null;
}

export async function runExecutionRepair(
  request: ExecutionRepairRunnerRequest
): Promise<ExecutionRepairRunnerResult> {
  const now = request.now ?? new Date().toISOString();
  const maxAttempts = request.maxAttempts ?? 2;
  const kind = failedCheckKind(request.state);
  const output = request.failureOutput?.trim() ||
    request.state.buildStatus.summary ||
    request.state.testStatus.summary ||
    request.state.checkStatus.summary ||
    "";
  const task = currentTask(request.plan, request.state);
  const riskText = taskText(task, request.state, output);

  if (!phaseIsApproved(request.plan, request.state.currentPhaseId)) {
    return {
      status: "needsApproval",
      reason: "Current phase is not approved for automatic repair.",
      state: request.state,
    };
  }

  if (!kind) {
    return {
      status: "unavailable",
      reason: "No failed build, test, or check result is available for repair.",
      state: request.state,
    };
  }

  if (textLooksSensitive(riskText)) {
    return {
      status: "needsApproval",
      reason: "Repair touches credentials, accounts, payments, deployment, legal/privacy, or scope-sensitive work.",
      state: markPhaseTaskBlocked(request.state, request.state.currentTaskId, "Manual approval is required before repairing sensitive work.", now),
    };
  }

  if (textLooksDestructive(riskText)) {
    return {
      status: "blocked",
      reason: "Repair appears destructive or rewrite-oriented; automatic repair is blocked.",
      state: markPhaseTaskBlocked(request.state, request.state.currentTaskId, "Automatic repair blocked for destructive or rewrite-oriented work.", now),
    };
  }

  if (repairAttemptsForTask(request.state) >= maxAttempts) {
    const reason = `Maximum repair attempts reached (${maxAttempts}). Manual review is required.`;
    return {
      status: "blocked",
      reason,
      state: markPhaseTaskBlocked(request.state, request.state.currentTaskId, reason, now),
    };
  }

  if (!output) {
    return {
      status: "unavailable",
      reason: "No failure output is available for repair.",
      state: request.state,
    };
  }

  let patch: PlanAndPatch | null = null;
  try {
    patch = await createSafeRepairPatch(request, output, kind);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Repair context could not be read.";
    return {
      status: "failed",
      reason,
      state: repairFailedState(request.state, now, reason),
    };
  }

  if (!patch) {
    const reason = "No safe automatic repair is available for the recorded failure.";
    return {
      status: "unavailable",
      reason,
      state: recordRepairAttempt(
        request.state,
        {
          taskId: request.state.currentTaskId ?? request.state.currentPhaseId,
          summary: reason,
          status: "blocked",
        },
        now
      ),
    };
  }

  if (!request.applyRepair) {
    return {
      status: "needsApproval",
      reason: "A repair patch was generated, but no safe repair applier is available.",
      patch,
      state: recordRepairAttempt(
        request.state,
        {
          taskId: request.state.currentTaskId ?? request.state.currentPhaseId,
          summary: "Repair patch generated; waiting for safe application.",
          status: "attempted",
        },
        now
      ),
    };
  }

  const applied = await request.applyRepair(patch);
  if (!applied.ok) {
    return {
      status: "failed",
      reason: applied.summary,
      patch,
      state: repairFailedState(request.state, now, applied.summary),
    };
  }

  return {
    status: "repaired",
    reason: applied.summary,
    patch,
    state: repairSucceededState(request.state, now, applied.summary),
  };
}
