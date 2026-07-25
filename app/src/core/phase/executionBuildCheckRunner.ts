import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import {
  detectBuildCommand,
  runApprovedBuildCheck,
  validateBuildCheckWorkspace,
} from "../project/buildCheck";
import type {
  PhaseBuildPlan,
  PhaseExecutionState,
  ProjectMemory,
  ProjectSnapshot,
} from "../types";
import { planNextExecutionStep } from "./executionLoop";
import {
  markPhaseTaskBlocked,
  recordPhaseCheckStatus,
} from "./phaseExecutionState";

export type ExecutionBuildCheckRunnerStatus = "passed" | "failed" | "needsApproval" | "blocked";

export interface ExecutionBuildCheckRunnerResult {
  status: ExecutionBuildCheckRunnerStatus;
  reason: string;
  result?: BuildCheckResult;
  state: PhaseExecutionState;
}

export interface ExecutionBuildCheckRunnerRequest {
  plan: PhaseBuildPlan;
  state: PhaseExecutionState;
  workspaceRoot: string;
  activeWorkspacePath: string;
  cwdSource: string;
  projectMemory?: ProjectMemory | null;
  projectSnapshot?: ProjectSnapshot | null;
  command?: string;
  runId?: string;
  now?: string;
  readFile: (path: string) => Promise<string>;
  runBuildCheck?: (request: BuildCheckRequest) => Promise<BuildCheckResult>;
}

function phaseIsApproved(plan: PhaseBuildPlan, phaseId: string): boolean {
  const phase = plan.phases.find((item) => item.id === phaseId);
  return phase?.status === "approved" || phase?.status === "active";
}

function blockedState(
  state: PhaseExecutionState,
  reason: string,
  now: string
): PhaseExecutionState {
  return markPhaseTaskBlocked(state, state.currentTaskId, reason, now);
}

function recordBuildFailure(
  state: PhaseExecutionState,
  result: Pick<BuildCheckResult, "command" | "exitCode" | "stderr" | "stdout">,
  now: string
): PhaseExecutionState {
  return recordPhaseCheckStatus(
    state,
    "build",
    "failed",
    {
      command: result.command,
      exitCode: result.exitCode,
      summary: [
        "Build check failed.",
        result.stderr.trim() || result.stdout.trim() || "No build output was captured.",
      ].join(" "),
    },
    now
  );
}

function recordBuildPass(
  state: PhaseExecutionState,
  result: Pick<BuildCheckResult, "command" | "exitCode">,
  now: string
): PhaseExecutionState {
  return recordPhaseCheckStatus(
    state,
    "build",
    "passed",
    {
      command: result.command,
      exitCode: result.exitCode,
      summary: "Build check passed.",
    },
    now
  );
}

export async function runExecutionBuildCheck(
  request: ExecutionBuildCheckRunnerRequest
): Promise<ExecutionBuildCheckRunnerResult> {
  const now = request.now ?? new Date().toISOString();
  const step = planNextExecutionStep(request.plan, request.state);

  if (!phaseIsApproved(request.plan, request.state.currentPhaseId)) {
    const reason = "Current phase is not approved for automatic build checks.";
    return {
      status: "needsApproval",
      reason,
      state: recordPhaseCheckStatus(request.state, "build", "blocked", { summary: reason }, now),
    };
  }

  if (request.state.buildStatus.status === "running") {
    const reason = "A build check is already marked as running; NF will not start another check.";
    return {
      status: "blocked",
      reason,
      state: blockedState(request.state, reason, now),
    };
  }

  if (step.classification === "blocked") {
    return {
      status: "blocked",
      reason: step.reason,
      state: blockedState(request.state, step.reason, now),
    };
  }

  if (step.classification === "needsApproval") {
    return {
      status: "needsApproval",
      reason: step.reason,
      state: recordPhaseCheckStatus(request.state, "build", "blocked", { summary: step.reason }, now),
    };
  }

  const command = request.command ??
    await detectBuildCommand(
      request.workspaceRoot,
      request.projectMemory ?? null,
      request.projectSnapshot ?? null,
      request.readFile
    );

  const buildRequest: BuildCheckRequest = {
    runId: request.runId ?? `phase-build-${Date.now()}`,
    command,
    workspaceRoot: request.workspaceRoot,
    activeWorkspacePath: request.activeWorkspacePath,
    cwdSource: request.cwdSource,
  };

  const validationError = validateBuildCheckWorkspace(buildRequest);
  if (validationError) {
    return {
      status: "blocked",
      reason: validationError,
      state: recordPhaseCheckStatus(request.state, "build", "blocked", { command, summary: validationError }, now),
    };
  }

  const runner = request.runBuildCheck ?? runApprovedBuildCheck;
  const result = await runner(buildRequest);

  if (result.exitCode === 0) {
    return {
      status: "passed",
      reason: "Build check passed.",
      result,
      state: recordBuildPass(request.state, result, result.endTimestamp || now),
    };
  }

  const failedState = recordBuildFailure(request.state, result, result.endTimestamp || now);
  const blocked = markPhaseTaskBlocked(
    failedState,
    request.state.currentTaskId,
    "Build check failed; repair before continuing.",
    result.endTimestamp || now
  );

  return {
    status: "failed",
    reason: "Build check failed; repair before continuing.",
    result,
    state: {
      ...blocked,
      nextRecommendedAction: "Repair build failure before continuing.",
    },
  };
}
