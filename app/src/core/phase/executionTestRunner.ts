import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import {
  detectTestCommand,
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

export type ExecutionTestRunnerStatus = "passed" | "failed" | "needsApproval" | "blocked" | "notAvailable";

export interface ExecutionTestRunnerResult {
  status: ExecutionTestRunnerStatus;
  reason: string;
  result?: BuildCheckResult;
  state: PhaseExecutionState;
}

export interface ExecutionTestRunnerRequest {
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
  runTestCommand?: (request: BuildCheckRequest) => Promise<BuildCheckResult>;
}

function phaseIsApproved(plan: PhaseBuildPlan, phaseId: string): boolean {
  const phase = plan.phases.find((item) => item.id === phaseId);
  return phase?.status === "approved" || phase?.status === "active";
}

function recordTestPass(
  state: PhaseExecutionState,
  result: Pick<BuildCheckResult, "command" | "exitCode">,
  now: string
): PhaseExecutionState {
  const recorded = recordPhaseCheckStatus(
    state,
    "test",
    "passed",
    {
      command: result.command,
      exitCode: result.exitCode,
      summary: "Test check passed.",
    },
    now
  );
  return {
    ...recorded,
    nextRecommendedAction: "Continue to the next task.",
  };
}

function recordTestFailure(
  state: PhaseExecutionState,
  result: Pick<BuildCheckResult, "command" | "exitCode" | "stderr" | "stdout">,
  now: string
): PhaseExecutionState {
  return recordPhaseCheckStatus(
    state,
    "test",
    "failed",
    {
      command: result.command,
      exitCode: result.exitCode,
      summary: [
        "Test check failed.",
        result.stderr.trim() || result.stdout.trim() || "No test output was captured.",
      ].join(" "),
    },
    now
  );
}

function recordTestsUnavailable(state: PhaseExecutionState, now: string): PhaseExecutionState {
  const recorded = recordPhaseCheckStatus(
    state,
    "test",
    "notRun",
    {
      summary: "No automated test command was detected for this project.",
    },
    now
  );
  return {
    ...recorded,
    nextRecommendedAction: "Continue; no automated test command is available yet.",
  };
}

export async function runExecutionTests(
  request: ExecutionTestRunnerRequest
): Promise<ExecutionTestRunnerResult> {
  const now = request.now ?? new Date().toISOString();
  const step = planNextExecutionStep(request.plan, request.state);

  if (!phaseIsApproved(request.plan, request.state.currentPhaseId)) {
    const reason = "Current phase is not approved for automatic test execution.";
    return {
      status: "needsApproval",
      reason,
      state: recordPhaseCheckStatus(request.state, "test", "blocked", { summary: reason }, now),
    };
  }

  if (request.state.testStatus.status === "running") {
    const reason = "A test check is already marked as running; NF will not start another check.";
    return {
      status: "blocked",
      reason,
      state: markPhaseTaskBlocked(request.state, request.state.currentTaskId, reason, now),
    };
  }

  if (step.classification === "blocked") {
    return {
      status: "blocked",
      reason: step.reason,
      state: markPhaseTaskBlocked(request.state, request.state.currentTaskId, step.reason, now),
    };
  }

  if (step.classification === "needsApproval") {
    return {
      status: "needsApproval",
      reason: step.reason,
      state: recordPhaseCheckStatus(request.state, "test", "blocked", { summary: step.reason }, now),
    };
  }

  const command = request.command ??
    await detectTestCommand(
      request.workspaceRoot,
      request.projectMemory ?? null,
      request.projectSnapshot ?? null,
      request.readFile
    );

  if (!command) {
    return {
      status: "notAvailable",
      reason: "No automated test command was detected for this project.",
      state: recordTestsUnavailable(request.state, now),
    };
  }

  const testRequest: BuildCheckRequest = {
    runId: request.runId ?? `phase-test-${Date.now()}`,
    command,
    workspaceRoot: request.workspaceRoot,
    activeWorkspacePath: request.activeWorkspacePath,
    cwdSource: request.cwdSource,
  };

  const validationError = validateBuildCheckWorkspace(testRequest);
  if (validationError) {
    return {
      status: "blocked",
      reason: validationError,
      state: recordPhaseCheckStatus(request.state, "test", "blocked", { command, summary: validationError }, now),
    };
  }

  const runner = request.runTestCommand ?? runApprovedBuildCheck;
  const result = await runner(testRequest);

  if (result.exitCode === 0) {
    return {
      status: "passed",
      reason: "Test check passed.",
      result,
      state: recordTestPass(request.state, result, result.endTimestamp || now),
    };
  }

  const failedState = recordTestFailure(request.state, result, result.endTimestamp || now);
  const blocked = markPhaseTaskBlocked(
    failedState,
    request.state.currentTaskId,
    "Test check failed; repair before continuing.",
    result.endTimestamp || now
  );

  return {
    status: "failed",
    reason: "Test check failed; repair before continuing.",
    result,
    state: {
      ...blocked,
      nextRecommendedAction: "Repair test failure before continuing.",
    },
  };
}
