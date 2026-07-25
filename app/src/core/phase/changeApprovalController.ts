import { attachPhaseExecutionState } from "../product/projectBlueprint";
import { writeWorkspaceProjectBlueprint } from "../product/projectBlueprintStore";
import type { PhaseExecutionState, ProjectBlueprint } from "../types";
import {
  founderChangeApprovedApplying,
  founderHeadlineForChangeApproval,
  founderRunningChecks,
  founderSummaryFromPending,
  founderWaitingForChangeApproval,
  sanitizeFounderExecutionText,
} from "./changeApprovalNarration";
import { runBoundedPhaseCycle } from "./executionPhaseOrchestrator";
import { runPhaseUntilGate, type PhaseRunResult } from "./executionPhaseRunner";
import {
  clearPendingChangeApproval,
  isChangeApprovalPending,
  rejectPendingChangeApproval,
} from "./phaseExecutionState";
import {
  createProductionPhasePatchProvider,
  assessPatchProviderAvailability,
  createExecutionPatchEngine,
  describePhaseExecutionResult,
  dashboardAfterExecution,
  type PhaseExecutionNarration,
  type StartFoundationExecutionInput,
} from "./phaseExecutionController";
import { finalizePhaseGateReachedState } from "./phaseGateController";
import { runApprovedBuildCheck } from "../project/buildCheck";

export type ChangeApprovalChatIntent =
  | "approve_change"
  | "reject_change"
  | "explain_change"
  | "continue_building"
  | null;

export interface ChangeApprovalPresentation {
  isPending: boolean;
  headline: string;
  whatWillChange: string;
  taskTitle: string;
  filePaths: string[];
  explanation: string;
  founderNarration: string;
  developerDetails: string[];
}

export function detectChangeApprovalChatIntent(prompt: string): ChangeApprovalChatIntent {
  const normalized = prompt.trim().toLowerCase();
  if (/\bexplain (the )?change\b|\bwhat (will|would) (this )?change\b/.test(normalized)) {
    return "explain_change";
  }
  if (/\breject (the )?change\b|\bdo not (make|apply) (this )?change\b/.test(normalized)) {
    return "reject_change";
  }
  if (/\bapprove (the )?change\b|\bapprove change\b/.test(normalized)) {
    return "approve_change";
  }
  if (/\bcontinue building\b|\bkeep building\b|\bresume building\b/.test(normalized)) {
    return "continue_building";
  }
  return null;
}

export function getChangeApprovalPresentation(
  blueprint: ProjectBlueprint,
  developerMode = false
): ChangeApprovalPresentation | null {
  const pending = blueprint.phaseExecutionState.data?.pendingChangeApproval;
  if (!pending || pending.status !== "pending") return null;

  const whatWillChange = founderSummaryFromPending({
    taskTitle: pending.taskTitle,
    filePaths: pending.filePaths,
    explanation: pending.explanation,
  });

  return {
    isPending: true,
    headline: founderHeadlineForChangeApproval(),
    whatWillChange,
    taskTitle: pending.taskTitle,
    filePaths: pending.filePaths,
    explanation: pending.explanation,
    founderNarration: [
      founderHeadlineForChangeApproval(),
      whatWillChange,
      founderWaitingForChangeApproval(),
    ].join(" "),
    developerDetails: developerMode
      ? [
          `taskId=${pending.taskId}`,
          `phaseId=${pending.phaseId}`,
          `files=${pending.filePaths.join(", ") || "none"}`,
          `patchBytes=${pending.patch.length}`,
          `controlReason=${pending.controlReason}`,
        ]
      : [],
  };
}

export function explainPendingChange(blueprint: ProjectBlueprint): string {
  const presentation = getChangeApprovalPresentation(blueprint, false);
  if (!presentation) return "No file change is waiting for approval right now.";
  return [
    presentation.headline,
    presentation.whatWillChange,
    presentation.explanation,
    founderWaitingForChangeApproval(),
  ].join("\n");
}

export function rejectPendingChange(
  blueprint: ProjectBlueprint,
  now = new Date().toISOString()
): ProjectBlueprint {
  const state = blueprint.phaseExecutionState.data;
  if (!state || !isChangeApprovalPending(state)) return blueprint;
  const nextState = rejectPendingChangeApproval(state, undefined, now);
  return attachPhaseExecutionState(blueprint, nextState, now);
}

function buildPhaseRunResultFromCycle(
  input: StartFoundationExecutionInput,
  cycles: import("./executionPhaseOrchestrator").BoundedPhaseRunResult[],
  state: PhaseExecutionState,
  blueprint: ProjectBlueprint,
  plan: import("../types").PhaseBuildPlan,
  status: PhaseRunResult["status"],
  stopReason: string,
  selectedStep?: import("./executionLoop").ExecutionLoopStep
): PhaseRunResult {
  const maxTasks = input.maxTasks ?? 3;
  const nextPhaseGate = selectedStep?.classification === "phaseComplete"
    ? plan.phases.find((phase) => phase.id === selectedStep.phaseId)?.approvalGate.approvalQuestion
    : undefined;
  return {
    status,
    cycles,
    state,
    blueprint,
    plan,
    founderSummary: sanitizeFounderExecutionText(
      [
        cycles.length
          ? `NF ran ${cycles.length} bounded task cycle${cycles.length === 1 ? "" : "s"}.`
          : "NF did not run a task cycle.",
        stopReason,
        state.nextRecommendedAction ? `Next: ${state.nextRecommendedAction}` : "",
      ].filter(Boolean).join(" ")
    ),
    developerDetails: {
      cyclesAttempted: cycles.length,
      maxTasks,
      stopReason,
      selectedPhaseId: selectedStep?.phaseId,
      selectedTaskId: selectedStep?.taskId,
      nextPhaseGate,
      cycleStatuses: cycles.map((cycle) => cycle.status),
    },
  };
}

export async function approvePendingChangeAndContinue(
  input: StartFoundationExecutionInput
): Promise<{ result: PhaseRunResult; narration: PhaseExecutionNarration; blueprint: ProjectBlueprint }> {
  const now = input.now ?? new Date().toISOString();
  const plan = input.projectBlueprint.phaseBuildPlan.data;
  const state = input.projectBlueprint.phaseExecutionState.data;
  const pending = state?.pendingChangeApproval;
  if (!plan || !state || !pending || pending.status !== "pending") {
    throw new Error("No file change is waiting for approval.");
  }

  const patchEngine = input.executionPatchEngine ?? createExecutionPatchEngine(input.workspaceRoot, input.readFile);
  let workingState = clearPendingChangeApproval(state, "approved", now);
  let blueprint = attachPhaseExecutionState(input.projectBlueprint, workingState, now);

  const approvedCycle = await runBoundedPhaseCycle({
    blueprint,
    plan,
    state: workingState,
    workspaceRoot: input.workspaceRoot,
    activeWorkspacePath: input.workspaceRoot,
    cwdSource: "active workspace path",
    projectMemory: input.projectMemory,
    livingBuildPlan: input.livingBuildPlan,
    projectSnapshot: input.projectSnapshot,
    patchPlan: { explanation: pending.explanation, patch: pending.patch },
    patchEngine,
    founderApprovedChange: true,
    readFile: input.readFile,
    progressDeps: input.progressDeps,
    runBuildCheck: input.runBuildCheck ?? ((buildRequest) => runApprovedBuildCheck(buildRequest)),
    runTestCommand: input.runTestCommand,
    now,
  });

  blueprint = approvedCycle.progressResult?.blueprint ?? blueprint;
  workingState = blueprint.phaseExecutionState.data ?? approvedCycle.state;
  const activePlan = blueprint.phaseBuildPlan.data ?? plan;

  const cycles = [approvedCycle];
  let result: PhaseRunResult;

  if (approvedCycle.status === "completed") {
    const remainingTasks = Math.max(0, (input.maxTasks ?? 3) - 1);
    if (remainingTasks > 0) {
      const patchProvider = input.patchProvider ?? createProductionPhasePatchProvider({
        workspaceRoot: input.workspaceRoot,
        readFile: input.readFile,
        projectMemorySummary: input.projectMemory?.summary,
        assessAvailability: () => assessPatchProviderAvailability({
          provider: input.provider,
          modelPath: input.modelPath,
          runtimePort: input.runtimePort,
        }),
      });
      const continuation = await runPhaseUntilGate({
        blueprint,
        plan: activePlan,
        state: workingState,
        workspaceRoot: input.workspaceRoot,
        activeWorkspacePath: input.workspaceRoot,
        cwdSource: "active workspace path",
        projectMemory: input.projectMemory,
        livingBuildPlan: input.livingBuildPlan,
        projectSnapshot: input.projectSnapshot,
        maxTasks: remainingTasks,
        readFile: input.readFile,
        patchProvider,
        progressDeps: input.progressDeps,
        runBuildCheck: input.runBuildCheck ?? ((buildRequest) => runApprovedBuildCheck(buildRequest)),
        runTestCommand: input.runTestCommand,
      });
      result = {
        ...continuation,
        cycles: [...cycles, ...continuation.cycles],
        founderSummary: sanitizeFounderExecutionText(
          [
            founderChangeApprovedApplying(),
            founderRunningChecks(),
            continuation.founderSummary,
          ].join(" ")
        ),
      };
    } else {
      result = buildPhaseRunResultFromCycle(
        input,
        cycles,
        workingState,
        blueprint,
        blueprint.phaseBuildPlan.data ?? plan,
        "limitReached",
        `${founderChangeApprovedApplying()} ${founderRunningChecks()} Task limit reached for this run.`,
        approvedCycle.selectedStep
      );
    }
  } else {
    result = buildPhaseRunResultFromCycle(
      input,
      cycles,
      workingState,
      blueprint,
      blueprint.phaseBuildPlan.data ?? plan,
      approvedCycle.status === "needsChangeApproval" ? "needsChangeApproval" : approvedCycle.status,
      `${founderChangeApprovedApplying()} ${approvedCycle.founderSummary}`,
      approvedCycle.selectedStep
    );
  }

  let finalState = result.state;
  if (result.status === "phaseGate") {
    finalState = finalizePhaseGateReachedState(finalState, result.plan, now);
    blueprint = attachPhaseExecutionState(result.blueprint, finalState, now);
    result = { ...result, blueprint, state: finalState };
  } else {
    blueprint = result.blueprint;
  }

  if (input.persistBlueprint !== false) {
    if (input.progressDeps) {
      await input.progressDeps.writeProjectBlueprint(input.workspaceRoot, blueprint);
    } else {
      await writeWorkspaceProjectBlueprint(input.workspaceRoot, blueprint);
    }
  }

  const narration = describePhaseExecutionResult(result, false);
  narration.founderSummary = sanitizeFounderExecutionText(
    [founderChangeApprovedApplying(), narration.founderSummary].filter(Boolean).join(" ")
  );
  return { result, narration, blueprint };
}

export async function continueBuildingAfterChangeApproval(
  input: StartFoundationExecutionInput
): Promise<{ result: PhaseRunResult; narration: PhaseExecutionNarration; blueprint: ProjectBlueprint } | null> {
  const state = input.projectBlueprint.phaseExecutionState.data;
  if (isChangeApprovalPending(state)) {
    return approvePendingChangeAndContinue(input);
  }
  return null;
}

export function dashboardAfterChangeApproval(input: {
  workspacePath: string;
  blueprint: ProjectBlueprint;
  projectMemory?: import("../types").ProjectMemory | null;
  livingBuildPlan?: import("../types").LivingBuildPlan | null;
  developerMode?: boolean;
}) {
  return dashboardAfterExecution(input);
}
