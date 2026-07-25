import { appendActionLogEntry } from "../memory/actionLogStore";
import type { ExecutionProgressRecorderDeps } from "./executionProgressRecorder";
import { createPhaseGateSummary } from "../control/founderPhaseGate";
import { developerModeControlPreferences } from "../control/controlLevel";
import { isPatchApprovalBlockerText } from "./changeApprovalNarration";
import { attachPhaseBuildPlan, attachPhaseExecutionState } from "../product/projectBlueprint";
import { writeWorkspaceProjectBlueprint } from "../product/projectBlueprintStore";
import type {
  ActionLogEntry,
  PhaseBuildPlan,
  PhaseExecutionState,
  ProjectBlueprint,
  QualityGate,
} from "../types";
import {
  createProductionPhasePatchProvider,
  assessPatchProviderAvailability,
  describePhaseExecutionResult,
  type StartFoundationExecutionInput,
} from "./phaseExecutionController";
import { runPhaseUntilGate, type PhaseRunResult } from "./executionPhaseRunner";
import { runApprovedBuildCheck } from "../project/buildCheck";
import { createPhaseExecutionState } from "./phaseExecutionState";
import { isChangeApprovalPending } from "./phaseExecutionState";

export type PhaseGateStatus = "ready" | "needsApproval" | "blocked" | "held" | "reviseRequested";

export type PhaseGateChatIntent =
  | "approve_phase"
  | "continue_next_phase"
  | "hold"
  | "show_gate"
  | "what_blocking"
  | null;

export interface PhaseGatePresentation {
  isPending: boolean;
  status: PhaseGateStatus;
  currentPhaseName: string;
  currentPhaseId: string;
  nextPhaseName: string | null;
  nextPhaseId: string | null;
  completed: string[];
  blockers: string[];
  qualityGates: QualityGate[];
  checks: string[];
  decisionPrompt: string;
  recommendedNextAction: string;
  canApprove: boolean;
  canApproveWithOverride: boolean;
  overrideWarning: string | null;
  founderSummary: string;
  developerDetails: string[];
}

export interface PhaseGateApprovalEvaluation {
  ok: boolean;
  reason: string;
  requiresOverride: boolean;
  blockers: string[];
}

export interface PhaseGateContinuationResult {
  blueprint: ProjectBlueprint;
  execution: PhaseRunResult;
  narration: ReturnType<typeof describePhaseExecutionResult>;
  approvedPhaseId: string;
  activatedPhaseId: string;
  overrideLogged: boolean;
}

function phaseById(plan: PhaseBuildPlan, phaseId: string) {
  return plan.phases.find((phase) => phase.id === phaseId);
}

function nextPhaseId(plan: PhaseBuildPlan, currentPhaseId: string): string | null {
  const index = plan.phases.findIndex((phase) => phase.id === currentPhaseId);
  if (index < 0 || index >= plan.phases.length - 1) return null;
  return plan.phases[index + 1]?.id ?? null;
}

function remainingTasksInPhase(plan: PhaseBuildPlan, state: PhaseExecutionState, phaseId: string): boolean {
  const phase = phaseById(plan, phaseId);
  if (!phase) return false;
  const unavailable = new Set([...state.completedTaskIds, ...state.skippedTaskIds, ...state.blockedTaskIds]);
  return phase.tasks.some((task) => !unavailable.has(task.id));
}

export function finalizePhaseGateReachedState(
  state: PhaseExecutionState,
  plan: PhaseBuildPlan,
  now = new Date().toISOString()
): PhaseExecutionState {
  const phase = phaseById(plan, state.currentPhaseId);
  if (!phase || remainingTasksInPhase(plan, state, state.currentPhaseId)) {
    return state;
  }
  return {
    ...state,
    phaseStatus: "complete",
    currentTaskId: undefined,
    lastAction: "phase_gate_reached",
    nextRecommendedAction: phase.approvalGate.approvalQuestion,
    updatedAt: now,
    history: [
      ...state.history,
      {
        id: `${now}-phase_gate_reached-${phase.id}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
        timestamp: now,
        action: "phase_gate_reached",
        phaseId: phase.id,
        summary: `${phase.title} reached its phase gate.`,
      },
    ],
  };
}

export function isPhaseGatePending(blueprint: ProjectBlueprint): boolean {
  const plan = blueprint.phaseBuildPlan.data;
  const state = blueprint.phaseExecutionState.data;
  if (!plan || !state) return false;
  if (isChangeApprovalPending(state)) return false;
  if (state.lastAction === "phase_held" || state.lastAction === "phase_revise_requested") return true;
  if (state.phaseStatus === "complete") return true;
  if (state.lastAction === "phase_gate_reached") return true;
  if (!remainingTasksInPhase(plan, state, state.currentPhaseId)) {
    const phase = phaseById(plan, state.currentPhaseId);
    return phase?.status === "active" || phase?.status === "complete";
  }
  return false;
}

export function detectPhaseGateChatIntent(prompt: string): PhaseGateChatIntent {
  const normalized = prompt.trim().toLowerCase();
  if (/\bwhat is blocking\b|\bwhat'?s blocking\b|\bwhy (is|are) (we|this) blocked\b/.test(normalized)) {
    return "what_blocking";
  }
  if (/\bshow phase gate\b|\bphase gate status\b|\bcurrent phase gate\b/.test(normalized)) {
    return "show_gate";
  }
  if (/\bhold (here|phase)\b|\bpause (here|phase)\b|\bstop here\b/.test(normalized)) {
    return "hold";
  }
  if (/\bapprove phase\b|\bapprove (this|the) phase\b/.test(normalized)) {
    return "approve_phase";
  }
  if (/\bcontinue to next phase\b|\bcontinue (the )?next phase\b|\bgo to next phase\b/.test(normalized)) {
    return "continue_next_phase";
  }
  return null;
}

export function evaluatePhaseGateApproval(
  blueprint: ProjectBlueprint,
  overrideBlockers = false
): PhaseGateApprovalEvaluation {
  if (!isPhaseGatePending(blueprint)) {
    return { ok: false, reason: "No phase gate is waiting for founder approval.", requiresOverride: false, blockers: [] };
  }
  const plan = blueprint.phaseBuildPlan.data!;
  const state = blueprint.phaseExecutionState.data!;
  const summary = createPhaseGateSummary({ blueprint, phaseBuildPlan: plan, phaseExecutionState: state });
  const blockers = summary.blockers.filter((blocker) => !isPatchApprovalBlockerText(blocker));
  const nextId = nextPhaseId(plan, state.currentPhaseId);
  if (!nextId) {
    return { ok: false, reason: "There is no next phase to continue into.", requiresOverride: false, blockers };
  }
  if (blockers.length > 0 && !overrideBlockers) {
    return {
      ok: false,
      reason: `Resolve blockers before continuing: ${blockers.join("; ")}`,
      requiresOverride: true,
      blockers,
    };
  }
  return { ok: true, reason: "Phase gate can advance.", requiresOverride: false, blockers };
}

function gateStatusFor(blueprint: ProjectBlueprint, blockers: string[]): PhaseGateStatus {
  const state = blueprint.phaseExecutionState.data;
  if (!state) return "needsApproval";
  if (state.lastAction === "phase_held") return "held";
  if (state.lastAction === "phase_revise_requested") return "reviseRequested";
  if (blockers.length > 0) return "blocked";
  if (state.phaseStatus === "complete" || state.lastAction === "phase_gate_reached") return "needsApproval";
  return "ready";
}

export function getPhaseGatePresentation(
  blueprint: ProjectBlueprint,
  developerMode = false
): PhaseGatePresentation | null {
  const plan = blueprint.phaseBuildPlan.data;
  const state = blueprint.phaseExecutionState.data;
  if (!plan || !state || !isPhaseGatePending(blueprint)) return null;

  const summary = createPhaseGateSummary({
    blueprint,
    phaseBuildPlan: plan,
    phaseExecutionState: state,
    controlPreferences: developerMode ? developerModeControlPreferences("assisted") : undefined,
  });
  const phase = phaseById(plan, state.currentPhaseId);
  const nextId = nextPhaseId(plan, state.currentPhaseId);
  const nextPhase = nextId ? phaseById(plan, nextId) : undefined;
  const approval = evaluatePhaseGateApproval(blueprint, false);
  const status = gateStatusFor(blueprint, summary.blockers);
  const overrideWarning = summary.blockers.length
    ? `Warning: continuing will override unresolved blockers (${summary.blockers.join("; ")}).`
    : null;

  const developerDetails = developerMode && summary.mode === "developer"
    ? [
        `phaseId=${summary.developerDetails.phaseId}`,
        `phaseStatus=${summary.developerDetails.phaseStatus}`,
        `gateId=${phase?.approvalGate.id ?? "(none)"}`,
        `approvalState=${status}`,
        `blockedTaskIds=${summary.developerDetails.blockedTaskIds.join(", ") || "none"}`,
        `completedTaskIds=${summary.developerDetails.completedTaskIds.join(", ") || "none"}`,
        `nextPhaseId=${nextId ?? "none"}`,
      ]
    : developerMode
      ? [
          `phaseId=${state.currentPhaseId}`,
          `gateId=${phase?.approvalGate.id ?? "(none)"}`,
          `approvalState=${status}`,
          `nextPhaseId=${nextId ?? "none"}`,
        ]
      : [];

  return {
    isPending: true,
    status,
    currentPhaseName: phase?.title ?? state.currentPhaseId,
    currentPhaseId: state.currentPhaseId,
    nextPhaseName: nextPhase?.title ?? null,
    nextPhaseId: nextId,
    completed: summary.completed,
    blockers: summary.blockers,
    qualityGates: phase?.qualityGates ?? [],
    checks: summary.checks,
    decisionPrompt: summary.decisionPrompt,
    recommendedNextAction: summary.recommendedNextAction,
    canApprove: approval.ok,
    canApproveWithOverride: !approval.ok && approval.requiresOverride && !!nextId,
    overrideWarning,
    founderSummary: [
      `${phase?.title ?? "Current phase"} is at a phase gate.`,
      summary.blockers.length ? `Blockers: ${summary.blockers.join("; ")}` : "No blockers detected.",
      nextPhase ? `Next phase: ${nextPhase.title}.` : "No further phase is scheduled.",
      summary.decisionPrompt,
    ].join(" "),
    developerDetails,
  };
}

export function formatPhaseGateSummaryForChat(presentation: PhaseGatePresentation): string {
  return [
    "Phase Gate",
    `Current phase: ${presentation.currentPhaseName} (${presentation.status})`,
    `Completed: ${presentation.completed.join(", ")}`,
    presentation.checks.length ? `Checks: ${presentation.checks.join("; ")}` : "",
    presentation.qualityGates.length
      ? `Quality gates: ${presentation.qualityGates.map((gate) => `${gate.title}: ${gate.status}`).join("; ")}`
      : "",
    presentation.blockers.length ? `Blockers: ${presentation.blockers.join("; ")}` : "Blockers: none",
    presentation.nextPhaseName ? `Next phase: ${presentation.nextPhaseName}` : "Next phase: none",
    presentation.decisionPrompt,
    presentation.recommendedNextAction,
  ].filter(Boolean).join("\n");
}

function advancePhasePlan(
  plan: PhaseBuildPlan,
  completedPhaseId: string,
  nextId: string,
  now: string
): PhaseBuildPlan {
  const nextPhase = phaseById(plan, nextId);
  const firstTask = nextPhase?.tasks.find((task) => task.status !== "done")?.id;
  return {
    ...plan,
    updatedAt: now,
    currentPhaseId: nextId,
    recommendedNextPhaseId: nextId,
    recommendedNextTaskId: firstTask,
    phases: plan.phases.map((phase) => {
      if (phase.id === completedPhaseId) return { ...phase, status: "approved" };
      if (phase.id === nextId) return { ...phase, status: "active" };
      return phase;
    }),
  };
}

function advancePhaseExecutionState(
  state: PhaseExecutionState,
  plan: PhaseBuildPlan,
  completedPhaseId: string,
  nextId: string,
  now: string,
  overrideBlockers: boolean
): PhaseExecutionState {
  const nextPhase = phaseById(plan, nextId);
  const unavailable = overrideBlockers
    ? new Set([...state.completedTaskIds, ...state.skippedTaskIds])
    : new Set([...state.completedTaskIds, ...state.skippedTaskIds, ...state.blockedTaskIds]);
  const nextTask = nextPhase?.tasks.find((task) => !unavailable.has(task.id));
  const action = overrideBlockers ? "phase_gate_override_approved" : "phase_gate_approved";
  return {
    ...state,
    currentPhaseId: nextId,
    currentTaskId: nextTask?.id,
    phaseStatus: "active",
    blockedTaskIds: overrideBlockers ? [] : state.blockedTaskIds,
    blockerReason: undefined,
    lastAction: action,
    nextRecommendedAction: nextTask
      ? `Continue ${nextPhase?.title}: ${nextTask.title}`
      : `Continue ${nextPhase?.title ?? nextId}.`,
    buildStatus: { status: "notRun" },
    testStatus: { status: "notRun" },
    checkStatus: { status: "notRun" },
    updatedAt: now,
    history: [
      ...state.history,
      {
        id: `${now}-${action}-${nextId}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
        timestamp: now,
        action,
        phaseId: nextId,
        summary: overrideBlockers
          ? `Founder approved ${completedPhaseId} with blocker override and activated ${nextId}.`
          : `Founder approved ${completedPhaseId} and activated ${nextId}.`,
      },
    ],
  };
}

async function logPhaseGateOverride(
  workspaceRoot: string,
  projectId: string,
  phaseId: string,
  blockers: string[],
  now: string,
  progressDeps?: ExecutionProgressRecorderDeps
): Promise<ActionLogEntry> {
  const entry: ActionLogEntry = {
    ts: now,
    projectId,
    action: "update_memory",
    summary: `Founder overrode phase gate blockers for ${phaseId}: ${blockers.join("; ")}`,
    approved: true,
  };
  if (progressDeps) {
    await progressDeps.appendActionLogEntry(workspaceRoot, entry);
  } else {
    await appendActionLogEntry(workspaceRoot, entry);
  }
  return entry;
}

export function holdPhaseGate(blueprint: ProjectBlueprint, now = new Date().toISOString()): ProjectBlueprint {
  const plan = blueprint.phaseBuildPlan.data;
  const state = blueprint.phaseExecutionState.data;
  if (!plan || !state) return blueprint;
  const nextState: PhaseExecutionState = {
    ...state,
    lastAction: "phase_held",
    nextRecommendedAction: "Held at phase gate. Approve to continue or revise the plan.",
    updatedAt: now,
    history: [
      ...state.history,
      {
        id: `${now}-phase_held-${state.currentPhaseId}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
        timestamp: now,
        action: "phase_held",
        phaseId: state.currentPhaseId,
        summary: "Founder held at the current phase gate.",
      },
    ],
  };
  return attachPhaseExecutionState(blueprint, nextState, now);
}

export function revisePhaseGatePlan(blueprint: ProjectBlueprint, now = new Date().toISOString()): ProjectBlueprint {
  const plan = blueprint.phaseBuildPlan.data;
  const state = blueprint.phaseExecutionState.data;
  if (!plan || !state) return blueprint;
  const nextState: PhaseExecutionState = {
    ...state,
    lastAction: "phase_revise_requested",
    nextRecommendedAction: "Revise the plan, then approve the phase gate when ready.",
    updatedAt: now,
    history: [
      ...state.history,
      {
        id: `${now}-phase_revise_requested-${state.currentPhaseId}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
        timestamp: now,
        action: "phase_revise_requested",
        phaseId: state.currentPhaseId,
        summary: "Founder requested plan revision before continuing.",
      },
    ],
  };
  let nextBlueprint = attachPhaseExecutionState(blueprint, nextState, now);
  const revisedPlan: PhaseBuildPlan = {
    ...plan,
    updatedAt: now,
    phases: plan.phases.map((phase) =>
      phase.id === state.currentPhaseId ? { ...phase, status: "planned" } : phase
    ),
  };
  nextBlueprint = attachPhaseBuildPlan(nextBlueprint, revisedPlan, now);
  return nextBlueprint;
}

export async function approvePhaseAndContinue(
  input: StartFoundationExecutionInput & { overrideBlockers?: boolean }
): Promise<PhaseGateContinuationResult> {
  const now = input.now ?? new Date().toISOString();
  const evaluation = evaluatePhaseGateApproval(input.projectBlueprint, input.overrideBlockers ?? false);
  if (!evaluation.ok) {
    throw new Error(evaluation.reason);
  }

  const plan = input.projectBlueprint.phaseBuildPlan.data!;
  const state = input.projectBlueprint.phaseExecutionState.data!;
  const completedPhaseId = state.currentPhaseId;
  const activatedPhaseId = nextPhaseId(plan, completedPhaseId);
  if (!activatedPhaseId) {
    throw new Error("No next phase is available.");
  }

  const updatedPlan = advancePhasePlan(plan, completedPhaseId, activatedPhaseId, now);
  const updatedState = advancePhaseExecutionState(
    state,
    updatedPlan,
    completedPhaseId,
    activatedPhaseId,
    now,
    Boolean(input.overrideBlockers && evaluation.blockers.length)
  );

  let blueprint = attachPhaseBuildPlan(input.projectBlueprint, updatedPlan, now);
  blueprint = attachPhaseExecutionState(blueprint, updatedState, now);

  let overrideLogged = false;
  if (input.overrideBlockers && evaluation.blockers.length) {
    await logPhaseGateOverride(
      input.workspaceRoot,
      blueprint.identity.projectId,
      completedPhaseId,
      evaluation.blockers,
      now,
      input.progressDeps
    );
    overrideLogged = true;
  }

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

  const execution = await runPhaseUntilGate({
    blueprint,
    plan: updatedPlan,
    state: updatedState,
    workspaceRoot: input.workspaceRoot,
    activeWorkspacePath: input.workspaceRoot,
    cwdSource: "active workspace path",
    projectMemory: input.projectMemory,
    livingBuildPlan: input.livingBuildPlan,
    projectSnapshot: input.projectSnapshot,
    maxTasks: input.maxTasks ?? 3,
    readFile: input.readFile,
    patchProvider,
    progressDeps: input.progressDeps,
    runBuildCheck: input.runBuildCheck ?? ((buildRequest) => runApprovedBuildCheck(buildRequest)),
    runTestCommand: input.runTestCommand,
  });

  let finalState = execution.blueprint.phaseExecutionState.data ?? execution.state;
  if (execution.status === "phaseGate") {
    finalState = finalizePhaseGateReachedState(finalState, execution.plan, now);
  }
  blueprint = attachPhaseExecutionState(execution.blueprint, finalState, now);
  blueprint = attachPhaseBuildPlan(blueprint, execution.plan, now);

  if (input.persistBlueprint !== false) {
    if (input.progressDeps) {
      await input.progressDeps.writeProjectBlueprint(input.workspaceRoot, blueprint);
    } else {
      await writeWorkspaceProjectBlueprint(input.workspaceRoot, blueprint);
    }
  }

  const narration = describePhaseExecutionResult({ ...execution, blueprint, state: finalState }, false);
  return {
    blueprint,
    execution: { ...execution, blueprint, state: finalState },
    narration,
    approvedPhaseId: completedPhaseId,
    activatedPhaseId,
    overrideLogged,
  };
}

export function createGatePendingBlueprint(
  blueprint: ProjectBlueprint,
  completedPhaseId: string,
  now = new Date().toISOString()
): ProjectBlueprint {
  const plan = blueprint.phaseBuildPlan.data;
  if (!plan) return blueprint;
  const phase = phaseById(plan, completedPhaseId);
  if (!phase) return blueprint;
  const completedTaskIds = phase.tasks.map((task) => task.id);
  const baseState = blueprint.phaseExecutionState.data ?? createPhaseExecutionState(plan, now);
  const state = finalizePhaseGateReachedState(
    {
      ...baseState,
      currentPhaseId: completedPhaseId,
      completedTaskIds: Array.from(new Set([...baseState.completedTaskIds, ...completedTaskIds])),
      phaseStatus: "complete",
      currentTaskId: undefined,
      lastAction: "phase_gate_reached",
    },
    { ...plan, currentPhaseId: completedPhaseId },
    now
  );
  const gatedPlan: PhaseBuildPlan = {
    ...plan,
    currentPhaseId: completedPhaseId,
    phases: plan.phases.map((item) =>
      item.id === completedPhaseId ? { ...item, status: "active" } : item
    ),
  };
  let next = attachPhaseBuildPlan(blueprint, gatedPlan, now);
  next = attachPhaseExecutionState(next, state, now);
  return next;
}
