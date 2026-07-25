import type { BuildCheckResult } from "../project/buildCheck";
import type {
  ControlPreferences,
  LivingBuildPlan,
  PhaseBuildPlan,
  PhaseExecutionState,
  PlanAndPatch,
  ProjectBlueprint,
  ProjectMemory,
  ProjectSnapshot,
} from "../types";
import { controlPreferencesFromBlueprint, evaluateControlPolicy } from "../control/controlLevel";
import { planNextExecutionStep, type ExecutionLoopStep } from "./executionLoop";
import {
  founderChangePrepared,
  founderWaitingForChangeApproval,
} from "./changeApprovalNarration";
import { pathsFromPatch } from "../patch/PatchEngine";
import { recordPendingChangeApproval } from "./phaseExecutionState";
import { runExecutionBuildCheck, type ExecutionBuildCheckRunnerResult } from "./executionBuildCheckRunner";
import { runExecutionRepair, type ExecutionRepairRunnerResult } from "./executionRepairRunner";
import { runExecutionTests, type ExecutionTestRunnerResult } from "./executionTestRunner";
import {
  runSafeExecutionPatch,
  type ExecutionPatchEngine,
  type ExecutionPatchRunnerResult,
} from "./executionPatchRunner";
import { markPhaseTaskBlocked, recordPhaseCheckStatus } from "./phaseExecutionState";
import {
  recordExecutionProgress,
  type ExecutionProgressOutcome,
  type ExecutionProgressRecordResult,
  type ExecutionProgressRecorderDeps,
} from "./executionProgressRecorder";

export type BoundedPhaseRunStatus =
  | "completed"
  | "blocked"
  | "needsApproval"
  | "needsChangeApproval"
  | "validationFailed"
  | "repairAttempted"
  | "skipped";

export interface BoundedPhaseRunResult {
  status: BoundedPhaseRunStatus;
  founderSummary: string;
  developerDetails: {
    phaseId: string;
    taskId?: string;
    controlDecision: string;
    patchSource: "provided" | "missing" | "notNeeded";
    validationResults: string[];
    repairResult: string;
    persistedStateKeys: string[];
  };
  selectedStep: ExecutionLoopStep;
  state: PhaseExecutionState;
  patchResult?: ExecutionPatchRunnerResult;
  buildResult?: ExecutionBuildCheckRunnerResult;
  testResult?: ExecutionTestRunnerResult;
  repairResult?: ExecutionRepairRunnerResult;
  progressResult?: ExecutionProgressRecordResult;
}

export interface BoundedPhaseRunRequest {
  blueprint: ProjectBlueprint;
  plan: PhaseBuildPlan;
  state: PhaseExecutionState;
  workspaceRoot: string;
  activeWorkspacePath: string;
  cwdSource: string;
  patchPlan?: PlanAndPatch | null;
  patchEngine?: ExecutionPatchEngine;
  projectMemory?: ProjectMemory | null;
  livingBuildPlan?: LivingBuildPlan | null;
  projectSnapshot?: ProjectSnapshot | null;
  now?: string;
  readFile: (path: string) => Promise<string>;
  runBuildCheck?: Parameters<typeof runExecutionBuildCheck>[0]["runBuildCheck"];
  runTestCommand?: Parameters<typeof runExecutionTests>[0]["runTestCommand"];
  applyRepair?: Parameters<typeof runExecutionRepair>[0]["applyRepair"];
  progressDeps?: ExecutionProgressRecorderDeps;
  runPatch?: typeof runSafeExecutionPatch;
  runBuild?: typeof runExecutionBuildCheck;
  runTests?: typeof runExecutionTests;
  runRepair?: typeof runExecutionRepair;
  founderApprovedChange?: boolean;
}

function statusLine(kind: string, result: { status: string; reason: string }): string {
  return `${kind}: ${result.status} - ${result.reason}`;
}

function resultSummary(result?: BuildCheckResult): Pick<BuildCheckResult, "command" | "runId" | "exitCode" | "durationMs"> | undefined {
  if (!result) return undefined;
  return {
    command: result.command,
    runId: result.runId,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  };
}

function blueprintWithCurrentPlan(request: BoundedPhaseRunRequest): ProjectBlueprint {
  return {
    ...request.blueprint,
    phaseBuildPlan: {
      status: request.blueprint.phaseBuildPlan.status === "empty" ? "draft" : request.blueprint.phaseBuildPlan.status,
      updatedAt: request.now,
      data: request.plan,
    },
  };
}

function approvalRequiredState(state: PhaseExecutionState, reason: string, now: string | undefined): PhaseExecutionState {
  return recordPhaseCheckStatus(
    state,
    "check",
    "blocked",
    { summary: `Approval required: ${reason}` },
    now
  );
}

function uniqueHistory(
  base: PhaseExecutionState["history"],
  validation: PhaseExecutionState["history"]
): PhaseExecutionState["history"] {
  const seen = new Set(base.map((entry) => entry.id));
  return [
    ...base,
    ...validation.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }),
  ];
}

function mergeValidationState(
  completedState: PhaseExecutionState,
  validationState: PhaseExecutionState
): PhaseExecutionState {
  return {
    ...completedState,
    buildStatus: validationState.buildStatus,
    testStatus: validationState.testStatus,
    checkStatus: validationState.checkStatus,
    repairAttempts: validationState.repairAttempts,
    lastAction: validationState.lastAction,
    updatedAt: validationState.updatedAt,
    history: uniqueHistory(completedState.history, validationState.history),
  };
}

async function persistProgress(
  request: BoundedPhaseRunRequest,
  state: PhaseExecutionState,
  outcome: ExecutionProgressOutcome,
  summary: string,
  options: {
    filesChanged?: string[];
    command?: string;
    runId?: string;
    exitCode?: number;
    durationMs?: number;
  } = {}
): Promise<ExecutionProgressRecordResult> {
  return recordExecutionProgress({
    workspaceRoot: request.workspaceRoot,
    blueprint: blueprintWithCurrentPlan(request),
    phaseExecutionState: state,
    livingBuildPlan: request.livingBuildPlan,
    projectMemory: request.projectMemory,
    outcome,
    summary,
    filesChanged: options.filesChanged,
    command: options.command,
    runId: options.runId,
    exitCode: options.exitCode,
    durationMs: options.durationMs,
    now: request.now,
    deps: request.progressDeps,
  });
}

function buildResult(
  request: BoundedPhaseRunRequest,
  selectedStep: ExecutionLoopStep,
  status: BoundedPhaseRunStatus,
  state: PhaseExecutionState,
  controlDecision: string,
  patchSource: BoundedPhaseRunResult["developerDetails"]["patchSource"],
  validationResults: string[],
  repairResult: string,
  founderSummary: string,
  extras: Partial<BoundedPhaseRunResult> = {}
): BoundedPhaseRunResult {
  return {
    status,
    founderSummary,
    developerDetails: {
      phaseId: selectedStep.phaseId,
      taskId: selectedStep.taskId,
      controlDecision,
      patchSource,
      validationResults,
      repairResult,
      persistedStateKeys: [
        "projectBlueprint.phaseExecutionState",
        request.livingBuildPlan ? "livingBuildPlan" : "",
        request.projectMemory ? "projectMemory" : "",
        request.progressDeps ? "actionLog" : "",
      ].filter(Boolean),
    },
    selectedStep,
    state,
    ...extras,
  };
}

function policyFor(
  preferences: ControlPreferences,
  action: "patchApply" | "buildCheck" | "testRun" | "repair",
  isSafe = true
): ReturnType<typeof evaluateControlPolicy> {
  return evaluateControlPolicy({
    preferences,
    action,
    isSafe,
  });
}

export async function runBoundedPhaseCycle(request: BoundedPhaseRunRequest): Promise<BoundedPhaseRunResult> {
  const runPatch = request.runPatch ?? runSafeExecutionPatch;
  const runBuild = request.runBuild ?? runExecutionBuildCheck;
  const runTests = request.runTests ?? runExecutionTests;
  const runRepair = request.runRepair ?? runExecutionRepair;
  const selectedStep = planNextExecutionStep(request.plan, request.state);
  const preferences = controlPreferencesFromBlueprint(request.blueprint);

  if (selectedStep.classification === "phaseComplete") {
    const progressResult = await persistProgress(
      request,
      request.state,
      "phase_completed",
      selectedStep.reason
    );
    return buildResult(
      request,
      selectedStep,
      "skipped",
      progressResult.blueprint.phaseExecutionState.data ?? request.state,
      "Phase is complete; stop at phase gate.",
      "notNeeded",
      [],
      "No repair attempted.",
      `${selectedStep.title}. ${selectedStep.nextRecommendedAction}`,
      { progressResult }
    );
  }

  if (selectedStep.classification === "blocked") {
    const blockedState = markPhaseTaskBlocked(request.state, selectedStep.taskId, selectedStep.reason, request.now);
    const progressResult = await persistProgress(request, blockedState, "task_blocked", selectedStep.reason);
    return buildResult(
      request,
      selectedStep,
      "blocked",
      progressResult.blueprint.phaseExecutionState.data ?? blockedState,
      "Execution loop classified the task as blocked.",
      "notNeeded",
      [],
      "No repair attempted.",
      `Blocked: ${selectedStep.reason}`,
      { progressResult }
    );
  }

  if (selectedStep.classification === "needsApproval") {
    if (request.patchPlan?.patch && !request.founderApprovedChange) {
      const pendingState = recordPendingChangeApproval(request.state, {
        phaseId: selectedStep.phaseId,
        taskId: selectedStep.taskId ?? request.state.currentTaskId ?? "current-task",
        taskTitle: selectedStep.title,
        patch: request.patchPlan.patch,
        explanation: request.patchPlan.explanation,
        filePaths: pathsFromPatch(request.patchPlan.patch),
        controlReason: selectedStep.reason,
        now: request.now,
      });
      const progressResult = await persistProgress(
        request,
        pendingState,
        "change_approval_pending",
        `${founderChangePrepared()} ${founderWaitingForChangeApproval()}`
      );
      return buildResult(
        request,
        selectedStep,
        "needsChangeApproval",
        progressResult.blueprint.phaseExecutionState.data ?? pendingState,
        selectedStep.reason,
        "provided",
        [],
        "No repair attempted.",
        `${founderChangePrepared()} ${founderWaitingForChangeApproval()}`,
        { progressResult }
      );
    }
    const approvalState = approvalRequiredState(request.state, selectedStep.reason, request.now);
    const progressResult = await persistProgress(
      request,
      approvalState,
      "needs_approval",
      selectedStep.reason
    );
    return buildResult(
      request,
      selectedStep,
      "needsApproval",
      progressResult.blueprint.phaseExecutionState.data ?? approvalState,
      selectedStep.reason,
      "notNeeded",
      [],
      "No repair attempted.",
      `Needs approval: ${selectedStep.reason}`,
      { progressResult }
    );
  }

  const patchPolicy = policyFor(preferences, "patchApply", selectedStep.classification === "safe");
  if (!patchPolicy.allowed && !request.founderApprovedChange) {
    if (!request.patchPlan?.patch) {
      const reason = "No patch plan is available for the selected task; NF cannot fake implementation.";
      const blockedState = markPhaseTaskBlocked(request.state, selectedStep.taskId, reason, request.now);
      const progressResult = await persistProgress(request, blockedState, "task_blocked", reason);
      return buildResult(
        request,
        selectedStep,
        "blocked",
        progressResult.blueprint.phaseExecutionState.data ?? blockedState,
        patchPolicy.reason,
        "missing",
        [],
        "No repair attempted.",
        `Blocked: ${reason}`,
        { progressResult }
      );
    }
    const pendingState = recordPendingChangeApproval(request.state, {
      phaseId: selectedStep.phaseId,
      taskId: selectedStep.taskId ?? request.state.currentTaskId ?? "current-task",
      taskTitle: selectedStep.title,
      patch: request.patchPlan.patch,
      explanation: request.patchPlan.explanation,
      filePaths: pathsFromPatch(request.patchPlan.patch),
      controlReason: patchPolicy.reason,
      now: request.now,
    });
    const progressResult = await persistProgress(
      request,
      pendingState,
      "change_approval_pending",
      `${founderChangePrepared()} ${founderWaitingForChangeApproval()}`
    );
    return buildResult(
      request,
      selectedStep,
      "needsChangeApproval",
      progressResult.blueprint.phaseExecutionState.data ?? pendingState,
      patchPolicy.reason,
      "provided",
      [],
      "No repair attempted.",
      `${founderChangePrepared()} ${founderWaitingForChangeApproval()}`,
      { progressResult }
    );
  }

  if (!request.patchPlan?.patch || !request.patchEngine) {
    const reason = "No patch plan is available for the selected task; NF cannot fake implementation.";
    const blockedState = markPhaseTaskBlocked(request.state, selectedStep.taskId, reason, request.now);
    const progressResult = await persistProgress(request, blockedState, "task_blocked", reason);
    return buildResult(
      request,
      selectedStep,
      "blocked",
      progressResult.blueprint.phaseExecutionState.data ?? blockedState,
      patchPolicy.reason,
      "missing",
      [],
      "No repair attempted.",
      `Blocked: ${reason}`,
      { progressResult }
    );
  }

  const patchResult = await runPatch({
    blueprint: request.blueprint,
    plan: request.plan,
    state: request.state,
    patch: request.patchPlan.patch,
    patchEngine: request.patchEngine,
    now: request.now,
    founderApprovedChange: request.founderApprovedChange,
  });
  if (patchResult.status !== "applied") {
    if (
      patchResult.status === "needsApproval" &&
      request.patchPlan?.patch &&
      !request.founderApprovedChange
    ) {
      const pendingState = recordPendingChangeApproval(request.state, {
        phaseId: selectedStep.phaseId,
        taskId: selectedStep.taskId ?? request.state.currentTaskId ?? "current-task",
        taskTitle: selectedStep.title,
        patch: request.patchPlan.patch,
        explanation: request.patchPlan.explanation,
        filePaths: pathsFromPatch(request.patchPlan.patch),
        controlReason: patchResult.reason,
        now: request.now,
      });
      const progressResult = await persistProgress(
        request,
        pendingState,
        "change_approval_pending",
        `${founderChangePrepared()} ${founderWaitingForChangeApproval()}`
      );
      return buildResult(
        request,
        selectedStep,
        "needsChangeApproval",
        progressResult.blueprint.phaseExecutionState.data ?? pendingState,
        patchResult.reason,
        "provided",
        [statusLine("patch", patchResult)],
        "No repair attempted.",
        `${founderChangePrepared()} ${founderWaitingForChangeApproval()}`,
        { patchResult, progressResult }
      );
    }
    const status: BoundedPhaseRunStatus = patchResult.status === "needsApproval"
      ? "needsApproval"
      : patchResult.status === "failed"
        ? "validationFailed"
        : "blocked";
    const progressResult = await persistProgress(
      request,
      patchResult.state,
      status === "validationFailed" ? "task_blocked" : "task_blocked",
      patchResult.reason
    );
    return buildResult(
      request,
      selectedStep,
      status,
      progressResult.blueprint.phaseExecutionState.data ?? patchResult.state,
      patchPolicy.reason,
      "provided",
      [statusLine("patch", patchResult)],
      "No repair attempted.",
      `${patchResult.status === "needsApproval" ? "Needs approval" : "Blocked"}: ${patchResult.reason}`,
      { patchResult, progressResult }
    );
  }

  let state = patchResult.state;
  let completedState = patchResult.state;
  let validationState = request.state;
  let progressResult = await persistProgress(
    request,
    validationState,
    "patch_applied_pending_validation",
    patchResult.reason,
    { filesChanged: patchResult.appliedFiles }
  );
  validationState = progressResult.blueprint.phaseExecutionState.data ?? validationState;

  const validationResults = [statusLine("patch", patchResult)];
  const buildPolicy = policyFor(preferences, "buildCheck");
  if (buildPolicy.allowed) {
    const buildResultValue = await runBuild({
      plan: request.plan,
      state: validationState,
      workspaceRoot: request.workspaceRoot,
      activeWorkspacePath: request.activeWorkspacePath,
      cwdSource: request.cwdSource,
      projectMemory: request.projectMemory,
      projectSnapshot: request.projectSnapshot,
      readFile: request.readFile,
      runBuildCheck: request.runBuildCheck,
      now: request.now,
    });
    validationResults.push(statusLine("build", buildResultValue));
    const buildSummary = resultSummary(buildResultValue.result);
    progressResult = await persistProgress(
      request,
      buildResultValue.state,
      buildResultValue.status === "passed" ? "build_passed" : "build_failed",
      buildResultValue.reason,
      {
        command: buildSummary?.command,
        runId: buildSummary?.runId,
        exitCode: buildSummary?.exitCode,
        durationMs: buildSummary?.durationMs,
      }
    );

    if (buildResultValue.status === "failed") {
      state = progressResult.blueprint.phaseExecutionState.data ?? buildResultValue.state;
      const repairPolicy = policyFor(preferences, "repair");
      if (!repairPolicy.allowed) {
        return buildResult(
          request,
          selectedStep,
          "validationFailed",
          state,
          `patch=${patchPolicy.reason}; build=${buildPolicy.reason}; repair=${repairPolicy.reason}`,
          "provided",
          validationResults,
          "Repair requires approval or is disabled.",
          "Validation failed. Repair requires approval before NF can continue.",
          { patchResult, buildResult: buildResultValue, progressResult }
        );
      }

      const repairResultValue = await runRepair({
        plan: request.plan,
        state,
        workspaceRoot: request.workspaceRoot,
        failureOutput: buildResultValue.result?.stderr || buildResultValue.result?.stdout || buildResultValue.reason,
        readFile: request.readFile,
        applyRepair: request.applyRepair,
        now: request.now,
      });
      progressResult = await persistProgress(
        request,
        repairResultValue.state,
        repairResultValue.status === "repaired" ? "repair_succeeded" : "repair_attempted",
        repairResultValue.reason,
        { filesChanged: repairResultValue.patch ? [] : undefined }
      );
      return buildResult(
        request,
        selectedStep,
        "repairAttempted",
        progressResult.blueprint.phaseExecutionState.data ?? repairResultValue.state,
        `patch=${patchPolicy.reason}; build=${buildPolicy.reason}; repair=${repairPolicy.reason}`,
        "provided",
        validationResults,
        statusLine("repair", repairResultValue),
        `Validation failed and NF attempted bounded repair. Next: ${(progressResult.blueprint.phaseExecutionState.data ?? repairResultValue.state).nextRecommendedAction}`,
        { patchResult, buildResult: buildResultValue, repairResult: repairResultValue, progressResult }
      );
    }
    validationState = progressResult.blueprint.phaseExecutionState.data ?? buildResultValue.state;
    completedState = mergeValidationState(completedState, validationState);
  } else {
    validationResults.push(`build: skipped - ${buildPolicy.reason}`);
  }

  const testPolicy = policyFor(preferences, "testRun");
  if (testPolicy.allowed) {
    const testResultValue = await runTests({
      plan: request.plan,
      state: validationState,
      workspaceRoot: request.workspaceRoot,
      activeWorkspacePath: request.activeWorkspacePath,
      cwdSource: request.cwdSource,
      projectMemory: request.projectMemory,
      projectSnapshot: request.projectSnapshot,
      readFile: request.readFile,
      runTestCommand: request.runTestCommand,
      now: request.now,
    });
    validationResults.push(statusLine("test", testResultValue));
    const testSummary = resultSummary(testResultValue.result);
    const outcome: ExecutionProgressOutcome = testResultValue.status === "passed"
      ? "test_passed"
      : testResultValue.status === "notAvailable"
        ? "test_unavailable"
        : "test_failed";
    progressResult = await persistProgress(
      request,
      testResultValue.state,
      outcome,
      testResultValue.reason,
      {
        command: testSummary?.command,
        runId: testSummary?.runId,
        exitCode: testSummary?.exitCode,
        durationMs: testSummary?.durationMs,
      }
    );

    if (testResultValue.status === "failed") {
      state = progressResult.blueprint.phaseExecutionState.data ?? testResultValue.state;
      return buildResult(
        request,
        selectedStep,
        "validationFailed",
        state,
        `patch=${patchPolicy.reason}; build=${buildPolicy.reason}; test=${testPolicy.reason}`,
        "provided",
        validationResults,
        "No repair attempted after test failure in this bounded cycle.",
        "Validation failed. NF stopped before continuing to another task.",
        { patchResult, testResult: testResultValue, progressResult }
      );
    }
    validationState = progressResult.blueprint.phaseExecutionState.data ?? testResultValue.state;
    completedState = mergeValidationState(completedState, validationState);
  } else {
    validationResults.push(`test: skipped - ${testPolicy.reason}`);
  }

  progressResult = await persistProgress(
    request,
    completedState,
    "task_completed",
    `Completed bounded cycle for ${selectedStep.title}.`,
    { filesChanged: patchResult.appliedFiles }
  );
  state = progressResult.blueprint.phaseExecutionState.data ?? completedState;

  return buildResult(
    request,
    selectedStep,
    "completed",
    state,
    `patch=${patchPolicy.reason}; build=${buildPolicy.reason}; test=${testPolicy.reason}`,
    "provided",
    validationResults,
    "No repair needed.",
    `Completed bounded cycle for ${selectedStep.title}. Next: ${state.nextRecommendedAction}`,
    { patchResult, progressResult }
  );
}
