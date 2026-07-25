import type { ApplyResult } from "../patch/PatchEngine";
import { pathsFromPatch } from "../patch/PatchEngine";
import type { ActionLogEntry, PhaseBuildPlan, ProjectBlueprint } from "../types";
import { createControlPreferences } from "../control/controlLevel";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import {
  attachControlPreferences,
  attachPhaseBuildPlan,
  attachPhaseExecutionState,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import { createGapAnalysis } from "../product/gapAnalysis";
import type { ExecutionProgressRecorderDeps } from "./executionProgressRecorder";
import type { ExecutionPatchEngine } from "./executionPatchRunner";
import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import { runBoundedPhaseCycle } from "./executionPhaseOrchestrator";
import { buildProjectDashboardModel } from "../project/projectDashboard";
import { createPhaseExecutionState, isChangeApprovalPending } from "./phaseExecutionState";
import { describePhaseExecutionResult } from "./phaseExecutionController";
import {
  approvePendingChangeAndContinue,
  detectChangeApprovalChatIntent,
  getChangeApprovalPresentation,
  rejectPendingChange,
} from "./changeApprovalController";
import { isPhaseGatePending, createGatePendingBlueprint } from "./phaseGateController";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

class FakePatchEngine implements ExecutionPatchEngine {
  public applied = false;

  constructor(private readonly filePath: string) {}

  validatePatch(patch: string): { valid: boolean; paths: string[]; error?: string } {
    const paths = pathsFromPatch(patch);
    return paths.length > 0 ? { valid: true, paths } : { valid: false, paths, error: "No writable paths" };
  }

  async preview(): Promise<Map<string, { old: string; new: string }>> {
    return new Map([[this.filePath, { old: "old", new: "new" }]]);
  }

  async apply(): Promise<ApplyResult> {
    this.applied = true;
    return { applied: [this.filePath], failed: [], beforeSnapshots: [] };
  }
}

function createWrites(): { blueprints: ProjectBlueprint[]; actions: ActionLogEntry[] } {
  return { blueprints: [], actions: [] };
}

function createProgressDeps(writes: ReturnType<typeof createWrites>): ExecutionProgressRecorderDeps {
  return {
    async writeProjectBlueprint(_workspaceRoot, blueprint) {
      writes.blueprints.push(blueprint);
    },
    async writeLivingBuildPlan() {},
    async writeProjectMemory() {},
    async appendActionLogEntry(_workspaceRoot, entry) {
      writes.actions.push(entry);
    },
  };
}

function buildResult(request: BuildCheckRequest, exitCode: number): BuildCheckResult {
  return {
    runId: request.runId,
    command: request.command,
    workingDirectory: request.workspaceRoot,
    startTimestamp: "2026-06-29T12:00:00.000Z",
    endTimestamp: "2026-06-29T12:00:01.000Z",
    durationMs: 1000,
    stdout: exitCode === 0 ? "ok" : "",
    stderr: "",
    exitCode,
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\change-approval";
const blueprintBase = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-change-approval",
  projectId: "change-approval",
  now: "2026-06-29T12:00:00.000Z",
});
const assistedBlueprint = attachControlPreferences(
  blueprintBase,
  { ...createControlPreferences("assisted"), preferredMode: "founder" },
  "2026-06-29T12:01:00.000Z"
);
const gap = createGapAnalysis(assistedBlueprint, "2026-06-29T12:02:00.000Z");
const fullPlan = createPhaseBuildPlan(assistedBlueprint, gap, "2026-06-29T12:02:30.000Z");
const activePlan: PhaseBuildPlan = {
  ...fullPlan,
  currentPhaseId: "foundation",
  recommendedNextPhaseId: "foundation",
  recommendedNextTaskId: "foundation-safe-file",
  phases: [
    {
      id: "foundation",
      title: "Foundation",
      goal: "Prepare the project for safe implementation.",
      status: "active",
      tasks: [
        {
          id: "foundation-safe-file",
          title: "Create first safe file",
          rationale: "First bounded foundation task.",
          sourceGapKeys: [],
          constraints: [],
          status: "todo",
        },
      ],
      definitionOfDone: ["Foundation task complete."],
      qualityGates: [],
      approvalGate: {
        id: "foundation-approval",
        title: "Continue after foundation",
        requiresApproval: true,
        approvalQuestion: "Continue to MVP Features?",
      },
    },
    ...fullPlan.phases.filter((phase) => phase.id !== "foundation"),
  ],
};
const blueprintWithPlan = attachPhaseBuildPlan(assistedBlueprint, activePlan, "2026-06-29T12:03:00.000Z");
const state = createPhaseExecutionState(activePlan, "2026-06-29T12:03:30.000Z");
const blueprintWithState = attachPhaseExecutionState(blueprintWithPlan, state, "2026-06-29T12:03:30.000Z");

const safePatch = [
  "--- a/src/main.tsx",
  "+++ b/src/main.tsx",
  "@@ -1,1 +1,1 @@",
  "-old",
  "+new",
].join("\n");

const writes = createWrites();
const fakeEngine = new FakePatchEngine("src/main.tsx");
const pending = await runBoundedPhaseCycle({
  blueprint: blueprintWithState,
  plan: activePlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  patchPlan: { explanation: "Update the main screen.", patch: safePatch },
  patchEngine: fakeEngine,
  readFile: async () => "",
  progressDeps: createProgressDeps(writes),
  now: "2026-06-29T12:04:00.000Z",
});

assert(pending.status === "needsChangeApproval", "assisted mode stops for change approval");
assert(!fakeEngine.applied, "change is not applied before founder approval");
assert(isChangeApprovalPending(pending.state), "pending change approval is recorded");
assert(
  !pending.state.checkStatus.summary?.includes("Patch application"),
  "patch approval does not pollute check status as generic blocker"
);

const presentation = getChangeApprovalPresentation(pending.progressResult?.blueprint ?? blueprintWithState, false);
assert(!!presentation?.isPending, "founder change approval card data is available");
assert(presentation!.headline.includes("file change"), "founder headline uses change language");
assert(!presentation!.founderNarration.toLowerCase().includes("patch"), "founder narration avoids patch term");

const devPresentation = getChangeApprovalPresentation(pending.progressResult?.blueprint ?? blueprintWithState, true);
assert(devPresentation!.developerDetails.some((line) => line.includes("patchBytes=")), "developer mode exposes patch details");

const narration = describePhaseExecutionResult(
  {
    status: "needsChangeApproval",
    cycles: [pending],
    state: pending.state,
    blueprint: pending.progressResult?.blueprint ?? blueprintWithState,
    plan: activePlan,
    founderSummary: pending.founderSummary,
    developerDetails: {
      cyclesAttempted: 1,
      maxTasks: 3,
      stopReason: pending.founderSummary,
      cycleStatuses: [pending.status],
    },
  },
  false
);
assert(narration.founderSummary.toLowerCase().includes("change"), "founder execution narration uses change wording");
assert(!narration.founderSummary.toLowerCase().includes("control level"), "founder narration hides control level");

assert(detectChangeApprovalChatIntent("approve change") === "approve_change", "chat detects approve change");
assert(detectChangeApprovalChatIntent("continue building") === "continue_building", "chat detects continue building");

const rejected = rejectPendingChange(pending.progressResult?.blueprint ?? blueprintWithState, "2026-06-29T12:04:30.000Z");
assert(rejected.phaseExecutionState.data?.phaseStatus === "blocked", "reject change records blocker and stops safely");
assert(!isChangeApprovalPending(rejected.phaseExecutionState.data), "reject clears pending change");

const approveWrites = createWrites();
const approveEngine = new FakePatchEngine("src/main.tsx");
const gateReadyBlueprint = attachPhaseExecutionState(
  pending.progressResult?.blueprint ?? blueprintWithState,
  pending.state,
  "2026-06-29T12:05:00.000Z"
);

const approved = await approvePendingChangeAndContinue({
  workspaceRoot,
  projectBlueprint: gateReadyBlueprint,
  readFile: async () => "",
  executionPatchEngine: approveEngine,
  progressDeps: createProgressDeps(approveWrites),
  persistBlueprint: false,
  maxTasks: 2,
  now: "2026-06-29T12:05:00.000Z",
  runBuildCheck: async (request) => buildResult(request, 0),
  runTestCommand: async (request) => buildResult(request, 0),
  patchProvider: async () => ({
    patchPlan: { explanation: "Next task", patch: safePatch },
    patchEngine: approveEngine,
  }),
});

assert(approveEngine.applied, "Approve Change applies through PatchEngine");
assert(!isChangeApprovalPending(approved.blueprint.phaseExecutionState.data), "pending change clears after approval");

const dashboard = buildProjectDashboardModel({
  workspacePath: workspaceRoot,
  projectBlueprint: approved.blueprint,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
  developerMode: false,
});
assert(dashboard.currentPhase.phaseName.length > 0, "dashboard updates after change approval");

const completedFoundation = createGatePendingBlueprint(approved.blueprint, "foundation", "2026-06-29T12:06:00.000Z");
assert(isPhaseGatePending(completedFoundation), "phase gate appears after foundation completion");
assert(!isChangeApprovalPending(completedFoundation.phaseExecutionState.data), "phase gate is not blocked by stale change approval");

const staleCheckBlueprint = attachPhaseExecutionState(completedFoundation, {
  ...completedFoundation.phaseExecutionState.data!,
  checkStatus: {
    status: "blocked",
    summary: "Approval required: Patch application requires approval at this control level.",
    updatedAt: "2026-06-29T12:06:00.000Z",
  },
}, "2026-06-29T12:06:30.000Z");
assert(isPhaseGatePending(staleCheckBlueprint), "stale patch check text does not hide phase gate");

console.log("change approval controller regression passed");
