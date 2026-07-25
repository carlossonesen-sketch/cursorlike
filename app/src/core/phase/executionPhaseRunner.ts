import type {
  PhaseBuildPlan,
  PhaseExecutionState,
  PlanAndPatch,
  ProjectBlueprint,
} from "../types";
import { planNextExecutionStep, type ExecutionLoopStep } from "./executionLoop";
import {
  runBoundedPhaseCycle,
  type BoundedPhaseRunRequest,
  type BoundedPhaseRunResult,
} from "./executionPhaseOrchestrator";
import type { ExecutionPatchEngine } from "./executionPatchRunner";

export type PhaseRunStatus =
  | "phaseGate"
  | "limitReached"
  | "blocked"
  | "needsApproval"
  | "needsChangeApproval"
  | "validationFailed"
  | "repairAttempted"
  | "skipped"
  | "completed";

export interface PhasePatchProviderResult {
  patchPlan: PlanAndPatch;
  patchEngine: ExecutionPatchEngine;
}

export interface PhasePatchProviderContext {
  blueprint: ProjectBlueprint;
  plan: PhaseBuildPlan;
  state: PhaseExecutionState;
  selectedStep: ExecutionLoopStep;
  cycleIndex: number;
}

export type PhasePatchProvider = (
  context: PhasePatchProviderContext
) => Promise<PhasePatchProviderResult | null>;

export interface PhaseRunRequest extends Omit<BoundedPhaseRunRequest, "patchPlan" | "patchEngine"> {
  patchProvider: PhasePatchProvider;
  maxTasks?: number;
}

export interface PhaseRunResult {
  status: PhaseRunStatus;
  cycles: BoundedPhaseRunResult[];
  state: PhaseExecutionState;
  blueprint: ProjectBlueprint;
  plan: PhaseBuildPlan;
  founderSummary: string;
  developerDetails: {
    cyclesAttempted: number;
    maxTasks: number;
    stopReason: string;
    selectedPhaseId?: string;
    selectedTaskId?: string;
    nextPhaseGate?: string;
    cycleStatuses: string[];
  };
}

function currentPlan(blueprint: ProjectBlueprint, fallback: PhaseBuildPlan): PhaseBuildPlan {
  return blueprint.phaseBuildPlan.data ?? fallback;
}

function currentState(blueprint: ProjectBlueprint, fallback: PhaseExecutionState): PhaseExecutionState {
  return blueprint.phaseExecutionState.data ?? fallback;
}

function phaseGateQuestion(plan: PhaseBuildPlan, phaseId: string): string | undefined {
  return plan.phases.find((phase) => phase.id === phaseId)?.approvalGate.approvalQuestion;
}

function buildRunResult(
  request: PhaseRunRequest,
  status: PhaseRunStatus,
  cycles: BoundedPhaseRunResult[],
  state: PhaseExecutionState,
  blueprint: ProjectBlueprint,
  plan: PhaseBuildPlan,
  stopReason: string,
  selectedStep?: ExecutionLoopStep
): PhaseRunResult {
  const nextPhaseGate = selectedStep?.classification === "phaseComplete"
    ? phaseGateQuestion(plan, selectedStep.phaseId)
    : undefined;
  return {
    status,
    cycles,
    state,
    blueprint,
    plan,
    founderSummary: [
      cycles.length
        ? `NF ran ${cycles.length} bounded task cycle${cycles.length === 1 ? "" : "s"}.`
        : "NF did not run a task cycle.",
      stopReason,
      state.nextRecommendedAction ? `Next: ${state.nextRecommendedAction}` : "",
    ].filter(Boolean).join(" "),
    developerDetails: {
      cyclesAttempted: cycles.length,
      maxTasks: request.maxTasks ?? 3,
      stopReason,
      selectedPhaseId: selectedStep?.phaseId,
      selectedTaskId: selectedStep?.taskId,
      nextPhaseGate,
      cycleStatuses: cycles.map((cycle) => cycle.status),
    },
  };
}

export async function runPhaseUntilGate(request: PhaseRunRequest): Promise<PhaseRunResult> {
  const maxTasks = Math.max(1, request.maxTasks ?? 3);
  const cycles: BoundedPhaseRunResult[] = [];
  let blueprint = request.blueprint;
  let plan = request.plan;
  let state = request.state;

  for (let index = 0; index < maxTasks; index += 1) {
    const selectedStep = planNextExecutionStep(plan, state);

    if (selectedStep.classification === "phaseComplete") {
      const result = await runBoundedPhaseCycle({
        ...request,
        blueprint,
        plan,
        state,
        patchPlan: null,
      });
      cycles.push(result);
      blueprint = result.progressResult?.blueprint ?? blueprint;
      plan = currentPlan(blueprint, plan);
      state = currentState(blueprint, result.state);
      return buildRunResult(
        request,
        "phaseGate",
        cycles,
        state,
        blueprint,
        plan,
        "Phase complete. Stop for next phase approval.",
        selectedStep
      );
    }

    const patch = await request.patchProvider({
      blueprint,
      plan,
      state,
      selectedStep,
      cycleIndex: index,
    });

    const result = await runBoundedPhaseCycle({
      ...request,
      blueprint,
      plan,
      state,
      patchPlan: patch?.patchPlan ?? null,
      patchEngine: patch?.patchEngine,
    });
    cycles.push(result);
    blueprint = result.progressResult?.blueprint ?? blueprint;
    plan = currentPlan(blueprint, plan);
    state = currentState(blueprint, result.state);

    if (result.status !== "completed") {
      return buildRunResult(
        request,
        result.status,
        cycles,
        state,
        blueprint,
        plan,
        result.founderSummary,
        result.selectedStep
      );
    }
  }

  return buildRunResult(
    request,
    "limitReached",
    cycles,
    state,
    blueprint,
    plan,
    `Task limit reached (${maxTasks}). Stop before continuing automatically.`
  );
}
