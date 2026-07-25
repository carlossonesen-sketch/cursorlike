import type { ApplyResult } from "../patch/PatchEngine";
import { pathsFromPatch } from "../patch/PatchEngine";
import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import type { ActionLogEntry, ProjectBlueprint } from "../types";
import { founderModeControlPreferences } from "../control/controlLevel";
import { buildProjectDashboardModel } from "../project/projectDashboard";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import {
  attachPhaseBuildPlan,
  attachControlPreferences,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import { createPhaseExecutionState, isChangeApprovalPending } from "./phaseExecutionState";
import { runBoundedPhaseCycle } from "./executionPhaseOrchestrator";
import type { ExecutionPatchEngine } from "./executionPatchRunner";
import type { ExecutionProgressRecorderDeps } from "./executionProgressRecorder";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

class FakePatchEngine implements ExecutionPatchEngine {
  public applied = false;

  constructor(
    private previewMap: Map<string, { old: string; new: string }>,
    private applyResult: ApplyResult = {
      applied: [...previewMap.keys()],
      failed: [],
      beforeSnapshots: [],
    }
  ) {}

  validatePatch(patch: string): { valid: boolean; paths: string[]; error?: string } {
    const paths = pathsFromPatch(patch);
    return paths.length > 0 ? { valid: true, paths } : { valid: false, paths, error: "No writable paths" };
  }

  async preview(): Promise<Map<string, { old: string; new: string }>> {
    return this.previewMap;
  }

  async apply(): Promise<ApplyResult> {
    this.applied = true;
    return this.applyResult;
  }
}

function approveCurrentPhase(plan: ReturnType<typeof createPhaseBuildPlan>): ReturnType<typeof createPhaseBuildPlan> {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === plan.currentPhaseId ? { ...phase, status: "approved" as const } : phase
    ),
  };
}

function useFoundationPhase(plan: ReturnType<typeof createPhaseBuildPlan>): ReturnType<typeof createPhaseBuildPlan> {
  return {
    ...plan,
    currentPhaseId: "foundation",
    recommendedNextPhaseId: "foundation",
    recommendedNextTaskId: "foundation-confirm-commands",
    phases: plan.phases.map((phase) =>
      phase.id === "foundation" ? { ...phase, status: "approved" as const } : phase
    ),
  };
}

function createWrites(): { blueprints: ProjectBlueprint[]; actions: ActionLogEntry[] } {
  return { blueprints: [], actions: [] };
}

function createProgressDeps(writes: ReturnType<typeof createWrites>): ExecutionProgressRecorderDeps {
  return {
    async writeProjectBlueprint(_workspaceRoot, blueprint) {
      writes.blueprints.push(blueprint);
    },
    async writeLivingBuildPlan() {
      /* no living build plan in this regression */
    },
    async writeProjectMemory() {
      /* no project memory in this regression */
    },
    async appendActionLogEntry(_workspaceRoot, entry) {
      writes.actions.push(entry);
    },
  };
}

function buildResult(request: BuildCheckRequest, exitCode: number, stderr = ""): BuildCheckResult {
  return {
    runId: request.runId,
    command: request.command,
    workingDirectory: request.workspaceRoot,
    startTimestamp: "2026-06-28T10:00:00.000Z",
    endTimestamp: "2026-06-28T10:00:01.000Z",
    durationMs: 1000,
    stdout: exitCode === 0 ? "ok" : "",
    stderr,
    exitCode,
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\bounded-phase";
const safePatch = [
  "--- a/src/main.tsx",
  "+++ b/src/main.tsx",
  "@@ -1,1 +1,1 @@",
  "-const message = 'old';",
  "+const message = 'new';",
].join("\n");

const blueprintBase = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-bounded-phase",
  projectId: "bounded-phase",
  now: "2026-06-28T09:00:00.000Z",
});
const guidedBlueprint = attachControlPreferences(
  blueprintBase,
  founderModeControlPreferences("guided"),
  "2026-06-28T09:01:00.000Z"
);
const gap = createGapAnalysis(guidedBlueprint, "2026-06-28T09:02:00.000Z");
const approvedPlan = useFoundationPhase(approveCurrentPhase(createPhaseBuildPlan(guidedBlueprint, gap, "2026-06-28T09:03:00.000Z")));
const guidedBlueprintWithPlan = attachPhaseBuildPlan(guidedBlueprint, approvedPlan, "2026-06-28T09:03:30.000Z");
const state = createPhaseExecutionState(approvedPlan, "2026-06-28T09:04:00.000Z");
const manualBlueprintWithPlan = attachPhaseBuildPlan(blueprintBase, approvedPlan, "2026-06-28T09:03:30.000Z");

const readFile = async (path: string): Promise<string> => {
  if (path === "package.json") return JSON.stringify({ scripts: { build: "vite build", test: "vitest run" } });
  if (path === "src/main.tsx") return "const requestSummary: HTMLElement | null = null;\nrequestSummary.innerHTML = 'x';";
  throw new Error(`Unexpected read: ${path}`);
};

const successWrites = createWrites();
const successEngine = new FakePatchEngine(new Map([["src/main.tsx", { old: "old", new: "new" }]]));
const success = await runBoundedPhaseCycle({
  blueprint: guidedBlueprintWithPlan,
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  patchPlan: { explanation: "Update main screen.", patch: safePatch },
  patchEngine: successEngine,
  readFile,
  progressDeps: createProgressDeps(successWrites),
  runBuildCheck: async (request) => buildResult(request, 0),
  runTestCommand: async (request) => buildResult(request, 0),
  now: "2026-06-28T09:05:00.000Z",
});

assert(success.status === "completed", "successful bounded run with existing patch completes");
assert(successEngine.applied, "successful bounded run applies through PatchEngine");
assert(success.developerDetails.patchSource === "provided", "developer details record provided patch source");
assert(success.developerDetails.validationResults.some((line) => line.startsWith("build: passed")), "build validation runs");
assert(success.developerDetails.validationResults.some((line) => line.startsWith("test: passed")), "test validation runs");
assert(successWrites.actions.some((entry) => entry.action === "apply_patch"), "successful run records patch progress");
assert(success.progressResult?.blueprint.phaseExecutionState.data?.testStatus.status === "passed", "persisted state is dashboard-readable");
assert(success.state.completedTaskIds.includes(success.selectedStep.taskId ?? ""), "successful validation completes the selected task");
assert(success.state.currentTaskId !== success.selectedStep.taskId, "successful validation advances away from the completed task");
assert(
  success.progressResult?.blueprint.phaseBuildPlan.data?.phases.find((phase) => phase.id === "foundation")?.qualityGates.every((gate) => gate.status === "passed") === true,
  "successful run synchronizes build/test quality gates as passed"
);

const successDashboard = buildProjectDashboardModel({
  workspacePath: workspaceRoot,
  projectBlueprint: success.progressResult?.blueprint,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
  developerMode: true,
});
assert(successDashboard.currentPhase.phaseName === "Foundation", "dashboard can read persisted phase state");
assert(successDashboard.qualityGateStatus.status === "Passed", "successful run updates dashboard-readable quality gate status");
assert(successDashboard.blockers.count === 0, "successful run does not create blockers");
assert(successDashboard.modeState.rawDetail.includes("controlLevel=guided"), "dashboard can read persisted control preference state");

const noPatchWrites = createWrites();
const noPatch = await runBoundedPhaseCycle({
  blueprint: guidedBlueprintWithPlan,
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  patchPlan: null,
  readFile,
  progressDeps: createProgressDeps(noPatchWrites),
  now: "2026-06-28T09:10:00.000Z",
});

assert(noPatch.status === "blocked", "bounded run blocks when no patch is available");
assert(noPatch.founderSummary.includes("cannot fake implementation"), "no-patch state is explicit");
assert(noPatch.state.phaseStatus === "blocked", "no-patch state blocks the current task");
const noPatchDashboard = buildProjectDashboardModel({
  workspacePath: workspaceRoot,
  projectBlueprint: noPatch.progressResult?.blueprint,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
  developerMode: true,
});
assert(noPatchDashboard.blockers.count > 0, "no-patch blocked state appears as a dashboard blocker");
assert(noPatchDashboard.qualityGateStatus.status === "Blocked", "no-patch blocked state blocks quality gate status");

const manualWrites = createWrites();
const manual = await runBoundedPhaseCycle({
  blueprint: manualBlueprintWithPlan,
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  patchPlan: { explanation: "Update main screen.", patch: safePatch },
  patchEngine: new FakePatchEngine(new Map([["src/main.tsx", { old: "old", new: "new" }]])),
  readFile,
  progressDeps: createProgressDeps(manualWrites),
  now: "2026-06-28T09:15:00.000Z",
});

assert(manual.status === "needsChangeApproval", "assisted/default control preferences require change approval");
assert(manual.developerDetails.controlDecision.includes("requires approval"), "control decision explains approval requirement");
assert(isChangeApprovalPending(manual.state), "pending change approval is stored separately");
assert(!manual.founderSummary.toLowerCase().includes("patch"), "founder summary avoids patch terminology");
assert(manualWrites.actions.length === 1, "change-approval state is persisted for dashboard visibility");
const manualDashboard = buildProjectDashboardModel({
  workspacePath: workspaceRoot,
  projectBlueprint: manual.progressResult?.blueprint,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
  developerMode: true,
});
assert(manualDashboard.qualityGateStatus.status !== "Passed", "change-approval state is visible and not marked passed");
assert(
  !manualDashboard.qualityGateStatus.detail.includes("Patch application"),
  "change approval does not appear as patch blocker on dashboard"
);

const repairWrites = createWrites();
const repair = await runBoundedPhaseCycle({
  blueprint: guidedBlueprintWithPlan,
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  patchPlan: { explanation: "Update main screen.", patch: safePatch },
  patchEngine: new FakePatchEngine(new Map([["src/main.tsx", { old: "old", new: "new" }]])),
  readFile,
  progressDeps: createProgressDeps(repairWrites),
  runBuildCheck: async (request) =>
    buildResult(request, 2, "src/main.tsx(2,1): error TS18047: 'requestSummary' is possibly 'null'."),
  applyRepair: async (patch) => ({
    ok: patch.patch.includes("if (requestSummary == null) return;"),
    summary: "Applied focused nullability repair.",
  }),
  now: "2026-06-28T09:20:00.000Z",
});

assert(repair.status === "repairAttempted", "validation failure triggers repair path");
assert(repair.buildResult?.status === "failed", "build failure is exposed");
assert(repair.repairResult?.status === "repaired", "repair result is exposed");
assert(repair.developerDetails.repairResult.includes("repaired"), "developer details expose repair result");
assert(repair.buildResult?.state.currentTaskId === repair.selectedStep.taskId, "build failure remains attached to the task that received the patch");
assert(repair.buildResult?.state.blockedTaskIds.includes(repair.selectedStep.taskId ?? "") === true, "build failure blocks the patched task");
assert(!repair.buildResult?.state.completedTaskIds.includes(repair.selectedStep.taskId ?? ""), "failed validation does not complete the patched task");
assert(repairWrites.actions.some((entry) => entry.summary.includes("Applied focused nullability repair")), "repair progress is persisted");
const repairDashboard = buildProjectDashboardModel({
  workspacePath: workspaceRoot,
  projectBlueprint: repair.progressResult?.blueprint,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
  developerMode: true,
});
assert(repairDashboard.blockers.items.some((item) => item.checkKind === "build"), "validation failure appears as dashboard blocker");
assert(repairDashboard.qualityGateStatus.detail.includes("repair-1:succeeded"), "repair attempt appears in dashboard-readable state");
assert(repairDashboard.qualityGateStatus.status === "Needs Attention", "repair path keeps quality gate needing attention until checks are rerun");

console.log("execution phase orchestrator regression passed");
