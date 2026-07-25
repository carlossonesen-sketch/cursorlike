import { PatchEngine } from "../patch/PatchEngine";
import { generatePlanAndPatch } from "../model/ModelGateway";
import type { Provider } from "../runtime/runtimeApi";
import type {
  ModelContext,
  PhaseBuildPlan,
  PhaseExecutionState,
  PlanAndPatch,
  ProjectBlueprint,
  ProjectMemory,
  ProjectSnapshot,
} from "../types";
import { attachPhaseExecutionState, attachPhaseBuildPlan } from "../product/projectBlueprint";
import { writeWorkspaceProjectBlueprint } from "../product/projectBlueprintStore";
import { runApprovedBuildCheck } from "../project/buildCheck";
import type { ExecutionPatchEngine } from "./executionPatchRunner";
import {
  runPhaseUntilGate,
  type PhasePatchProvider,
  type PhaseRunRequest,
  type PhaseRunResult,
} from "./executionPhaseRunner";
import {
  founderChangePrepared,
  founderRunningChecks,
  founderWaitingForChangeApproval,
  sanitizeFounderExecutionText,
} from "./changeApprovalNarration";
import { createPhaseExecutionState, isChangeApprovalPending } from "./phaseExecutionState";
import { finalizePhaseGateReachedState } from "./phaseGateController";
import { buildProjectDashboardModel } from "../project/projectDashboard";

const FOUNDATION_PHASE_ID = "foundation";
const PRE_APPROVED_PHASE_IDS = new Set(["discovery", "architecture-review"]);

export interface PatchProviderAvailability {
  ok: boolean;
  reason: string;
}

export interface PhaseExecutionNarration {
  status: PhaseRunResult["status"];
  founderSummary: string;
  developerDetails: string[];
}

export interface StartFoundationExecutionInput {
  workspaceRoot: string;
  projectBlueprint: ProjectBlueprint;
  projectMemory?: ProjectMemory | null;
  livingBuildPlan?: import("../types").LivingBuildPlan | null;
  projectSnapshot?: ProjectSnapshot | null;
  manifest?: import("../types").ProjectManifest | null;
  provider?: Provider;
  modelPath?: string;
  runtimePort?: number | null;
  maxTasks?: number;
  readFile: (path: string) => Promise<string>;
  patchProvider?: PhasePatchProvider;
  progressDeps?: import("./executionProgressRecorder").ExecutionProgressRecorderDeps;
  runBuildCheck?: (request: import("../project/buildCheck").BuildCheckRequest) => Promise<import("../project/buildCheck").BuildCheckResult>;
  runTestCommand?: (request: import("../project/buildCheck").BuildCheckRequest) => Promise<import("../project/buildCheck").BuildCheckResult>;
  persistBlueprint?: boolean;
  now?: string;
  executionPatchEngine?: ExecutionPatchEngine;
}

export function detectStartFoundationIntent(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return (
    /\b(start|begin|run)\b/.test(normalized) &&
    /\b(build(ing)?|foundation|phase execution|autonomous)\b/.test(normalized)
  ) || /\bstart foundation phase\b/.test(normalized) || /\bstart building\b/.test(normalized);
}

export function assessPatchProviderAvailability(input: {
  provider?: Provider;
  modelPath?: string;
  runtimePort?: number | null;
}): PatchProviderAvailability {
  const provider = input.provider ?? "openai";
  if (provider === "openai") {
    return { ok: true, reason: "OpenAI availability is validated by the backend when a request starts." };
  }
  if (provider === "local") {
    if (!input.modelPath?.trim()) {
      return {
        ok: false,
        reason: "Blocked because the local model provider is unavailable. Choose a GGUF model in Models settings.",
      };
    }
    if (!input.runtimePort) {
      return {
        ok: false,
        reason: "Blocked because the local runtime is not running. Start the local model runtime first.",
      };
    }
    return { ok: true, reason: "Local model provider ready." };
  }
  return { ok: true, reason: "Mock model provider available for development." };
}

export function canStartFoundationExecution(input: {
  workspacePath: string | null;
  projectBlueprint: ProjectBlueprint | null;
  creationFlowActive: boolean;
}): PatchProviderAvailability {
  if (input.creationFlowActive) {
    return { ok: false, reason: "Finish project creation and approve files before starting autonomous building." };
  }
  if (!input.workspacePath?.trim()) {
    return { ok: false, reason: "Open the project workspace before starting autonomous building." };
  }
  if (!input.projectBlueprint?.phaseBuildPlan.data) {
    return { ok: false, reason: "This project does not have a Phase Build Plan yet. Create and approve the project plan first." };
  }
  return { ok: true, reason: "Ready to start Foundation phase execution." };
}

export function createExecutionPatchEngine(
  workspaceRoot: string,
  readFile: (path: string) => Promise<string>
): ExecutionPatchEngine {
  const engine = new PatchEngine(workspaceRoot, readFile);
  return {
    validatePatch: (patch) => engine.validatePatch(patch),
    preview: (patch) => engine.preview(patch),
    apply: (patch) => engine.apply(patch),
  };
}

function contextFiles(
  readFile: (path: string) => Promise<string>,
  paths: string[]
): Promise<{ path: string; content: string }[]> {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(path).catch(() => ""),
    }))
  );
}

export function createProductionPhasePatchProvider(input: {
  workspaceRoot: string;
  readFile: (path: string) => Promise<string>;
  manifestSummary?: string;
  projectMemorySummary?: string;
  assessAvailability?: () => PatchProviderAvailability;
}): PhasePatchProvider {
  const patchEngine = createExecutionPatchEngine(input.workspaceRoot, input.readFile);
  return async ({ blueprint, selectedStep }) => {
    const availability = input.assessAvailability?.() ?? { ok: true, reason: "Provider check skipped." };
    if (!availability.ok) {
      return null;
    }

    const candidatePaths = [
      "package.json",
      "README.md",
      "src/main.tsx",
      "src/main.ts",
      "index.html",
    ];
    const selectedFiles = (await contextFiles(input.readFile, candidatePaths)).filter((file) => file.content);
    const prompt = [
      "NF autonomous phase task",
      `Phase: ${selectedStep.phaseId}`,
      `Task: ${selectedStep.title}`,
      `Goal: ${selectedStep.reason}`,
      blueprint.productBrief.data?.summary ?? "",
      "Return a safe unified diff patch for this task only. Do not delete unrelated files.",
    ].filter(Boolean).join("\n");

    const ctx: ModelContext = {
      prompt,
      selectedFiles,
      manifestSummary: input.manifestSummary,
      projectMemorySummary: input.projectMemorySummary,
      plan: selectedStep.title,
      targetFiles: selectedFiles.map((file) => file.path),
    };

    let patchPlan: PlanAndPatch;
    try {
      patchPlan = await generatePlanAndPatch(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Blocked because model provider is unavailable: ${message}`);
    }

    if (!patchPlan.patch?.trim()) {
      return null;
    }

    return { patchPlan, patchEngine };
  };
}

export function prepareBlueprintForFoundationExecution(
  blueprint: ProjectBlueprint,
  now = new Date().toISOString()
): { blueprint: ProjectBlueprint; plan: PhaseBuildPlan; state: PhaseExecutionState } {
  const sourcePlan = blueprint.phaseBuildPlan.data;
  if (!sourcePlan) {
    throw new Error("Phase Build Plan is missing from Project Blueprint.");
  }

  const plan: PhaseBuildPlan = {
    ...sourcePlan,
    updatedAt: now,
    currentPhaseId: FOUNDATION_PHASE_ID,
    recommendedNextPhaseId: FOUNDATION_PHASE_ID,
    phases: sourcePlan.phases.map((phase) => {
      if (PRE_APPROVED_PHASE_IDS.has(phase.id)) {
        return { ...phase, status: "approved" };
      }
      if (phase.id === FOUNDATION_PHASE_ID) {
        return { ...phase, status: "active" };
      }
      return phase;
    }),
  };

  const foundationPhase = plan.phases.find((phase) => phase.id === FOUNDATION_PHASE_ID);
  const recommendedTaskId = foundationPhase?.tasks.find((task) => task.status !== "done")?.id ?? plan.recommendedNextTaskId;
  const planWithTask = {
    ...plan,
    recommendedNextTaskId: recommendedTaskId,
  };

  const existingState = blueprint.phaseExecutionState.data;
  const state = existingState
    ? {
        ...existingState,
        currentPhaseId: FOUNDATION_PHASE_ID,
        currentTaskId: recommendedTaskId,
        updatedAt: now,
        lastAction: "foundation_execution_prepared",
        nextRecommendedAction: "Start Foundation phase tasks.",
      }
    : createPhaseExecutionState(planWithTask, now);

  let nextBlueprint = attachPhaseBuildPlan(blueprint, planWithTask, now);
  nextBlueprint = attachPhaseExecutionState(nextBlueprint, state, now);
  return { blueprint: nextBlueprint, plan: planWithTask, state };
}

export function describePhaseExecutionResult(result: PhaseRunResult, developerMode = false): PhaseExecutionNarration {
  const narrationByStatus: Record<PhaseRunResult["status"], string> = {
    phaseGate: "Foundation phase is complete. Review the phase gate to continue.",
    limitReached: "Stopped after the safe task limit for this run.",
    blocked: "Blocked before continuing.",
    needsApproval: "This step needs your approval before NF can continue.",
    needsChangeApproval: `${founderChangePrepared()} ${founderWaitingForChangeApproval()}`,
    validationFailed: "Running checks found a problem.",
    repairAttempted: "Repair needed.",
    skipped: "No task ran in this cycle.",
    completed: "Completed the bounded build run.",
  };
  const cycle = result.cycles[result.cycles.length - 1];
  const taskTitle = cycle?.selectedStep.title ?? result.developerDetails.selectedTaskId ?? "current task";
  const founderSummary = sanitizeFounderExecutionText(
    [
      result.status === "completed" ? `Building task ${taskTitle}.` : narrationByStatus[result.status],
      result.status === "validationFailed" || result.status === "repairAttempted" ? founderRunningChecks() : "",
      result.status === "needsChangeApproval" ? "" : sanitizeFounderExecutionText(result.founderSummary),
    ].filter(Boolean).join(" ")
  );

  const developerDetails = developerMode
    ? [
        `phaseId=${result.developerDetails.selectedPhaseId ?? "(none)"}`,
        `taskId=${result.developerDetails.selectedTaskId ?? "(none)"}`,
        `status=${result.status}`,
        `cycles=${result.developerDetails.cycleStatuses.join(", ") || "none"}`,
        result.developerDetails.stopReason,
      ]
    : [];

  return {
    status: result.status,
    founderSummary,
    developerDetails,
  };
}

export async function startFoundationPhaseExecution(
  input: StartFoundationExecutionInput
): Promise<PhaseRunResult> {
  const now = input.now ?? new Date().toISOString();
  const prepared = prepareBlueprintForFoundationExecution(input.projectBlueprint, now);
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

  const request: PhaseRunRequest = {
    blueprint: prepared.blueprint,
    plan: prepared.plan,
    state: prepared.state,
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
  };

  const result = await runPhaseUntilGate(request);
  let blueprint = result.blueprint;
  let state = result.state;
  if (result.status === "phaseGate") {
    state = finalizePhaseGateReachedState(state, result.plan, now);
    blueprint = attachPhaseExecutionState(blueprint, state, now);
  }
  if (isChangeApprovalPending(state)) {
    blueprint = attachPhaseExecutionState(blueprint, state, now);
  }
  if (input.persistBlueprint !== false) {
    if (input.progressDeps) {
      await input.progressDeps.writeProjectBlueprint(input.workspaceRoot, blueprint);
    } else {
      await writeWorkspaceProjectBlueprint(input.workspaceRoot, blueprint);
    }
  }
  return { ...result, blueprint, state };
}

export function dashboardAfterExecution(input: {
  workspacePath: string;
  blueprint: ProjectBlueprint;
  projectMemory?: ProjectMemory | null;
  livingBuildPlan?: import("../types").LivingBuildPlan | null;
  manifest?: import("../types").ProjectManifest | null;
  developerMode?: boolean;
}) {
  return buildProjectDashboardModel({
    workspacePath: input.workspacePath,
    projectBlueprint: input.blueprint,
    projectMemory: input.projectMemory ?? null,
    livingBuildPlan: input.livingBuildPlan ?? null,
    founderManifest: null,
    manifest: input.manifest ?? null,
    developerMode: input.developerMode ?? false,
  });
}
