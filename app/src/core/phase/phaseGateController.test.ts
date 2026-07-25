import type { ApplyResult } from "../patch/PatchEngine";
import { pathsFromPatch } from "../patch/PatchEngine";
import type { ActionLogEntry, PhaseBuildPlan, ProjectBlueprint } from "../types";
import { founderModeControlPreferences } from "../control/controlLevel";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import {
  attachControlPreferences,
  attachPhaseBuildPlan,
  attachPhaseExecutionState,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import type { ExecutionPatchEngine } from "./executionPatchRunner";
import type { ExecutionProgressRecorderDeps } from "./executionProgressRecorder";
import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import { dashboardAfterExecution } from "./phaseExecutionController";
import type { PhasePatchProvider } from "./executionPhaseRunner";
import {
  approvePhaseAndContinue,
  createGatePendingBlueprint,
  detectPhaseGateChatIntent,
  evaluatePhaseGateApproval,
  getPhaseGatePresentation,
  isPhaseGatePending,
} from "./phaseGateController";

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

function buildResult(request: BuildCheckRequest, exitCode: number, stderr = ""): BuildCheckResult {
  return {
    runId: request.runId,
    command: request.command,
    workingDirectory: request.workspaceRoot,
    startTimestamp: "2026-06-29T12:00:00.000Z",
    endTimestamp: "2026-06-29T12:00:01.000Z",
    durationMs: 1000,
    stdout: exitCode === 0 ? "ok" : "",
    stderr,
    exitCode,
  };
}

function createMultiPhasePlan(blueprint: ProjectBlueprint): PhaseBuildPlan {
  return {
    schemaVersion: 1,
    blueprintId: blueprint.id,
    createdAt: "2026-06-29T12:00:00.000Z",
    updatedAt: "2026-06-29T12:00:00.000Z",
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
            status: "done",
          },
        ],
        definitionOfDone: ["Foundation task complete."],
        qualityGates: [
          {
            id: "foundation-build",
            title: "Build check",
            check: "Run the project build command.",
            required: true,
            status: "passed",
          },
        ],
        approvalGate: {
          id: "foundation-approval",
          title: "Continue after foundation",
          requiresApproval: true,
          approvalQuestion: "Continue to MVP Features?",
        },
      },
      {
        id: "mvp-features",
        title: "MVP Features",
        goal: "Implement the first product slice.",
        status: "planned",
        tasks: [
          {
            id: "mvp-first-feature",
            title: "Add first MVP feature",
            rationale: "First bounded MVP task.",
            sourceGapKeys: [],
            constraints: [],
            status: "todo",
          },
        ],
        definitionOfDone: ["MVP task complete."],
        qualityGates: [],
        approvalGate: {
          id: "mvp-approval",
          title: "Continue after MVP",
          requiresApproval: true,
          approvalQuestion: "Continue to Testing?",
        },
      },
    ],
    preservationSummary: "No preservation constraints in this regression.",
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\phase-gate";
const blueprintBase = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-phase-gate",
  projectId: "phase-gate",
  now: "2026-06-29T12:00:00.000Z",
});
const guidedBlueprint = attachControlPreferences(
  blueprintBase,
  founderModeControlPreferences("guided"),
  "2026-06-29T12:01:00.000Z"
);
const plan = createMultiPhasePlan(guidedBlueprint);
const blueprintWithPlan = attachPhaseBuildPlan(guidedBlueprint, plan, "2026-06-29T12:02:00.000Z");
const gatePendingBlueprint = createGatePendingBlueprint(blueprintWithPlan, "foundation", "2026-06-29T12:03:00.000Z");

assert(isPhaseGatePending(gatePendingBlueprint), "completed Foundation gate should be pending approval");

const presentation = getPhaseGatePresentation(gatePendingBlueprint, false);
assert(!!presentation, "completed Foundation gate should show approval presentation");
assert(presentation!.currentPhaseId === "foundation", "presentation should name foundation phase");
assert(presentation!.nextPhaseId === "mvp-features", "presentation should expose next phase");
assert(presentation!.canApprove, "clean gate should allow approve");

const blockedBlueprint = attachPhaseExecutionState(gatePendingBlueprint, {
  ...gatePendingBlueprint.phaseExecutionState.data!,
  blockedTaskIds: ["foundation-safe-file"],
  blockerReason: "Build failed",
  phaseStatus: "blocked",
}, "2026-06-29T12:03:30.000Z");
const blockedApproval = evaluatePhaseGateApproval(blockedBlueprint, false);
assert(!blockedApproval.ok, "blocked phase cannot continue silently");
assert(blockedApproval.requiresOverride, "blocked phase should require override");

const blockedPresentation = getPhaseGatePresentation(blockedBlueprint, false);
assert(!!blockedPresentation?.canApproveWithOverride, "blocked gate should expose override path");

const readFile = async (path: string): Promise<string> => {
  if (path === "package.json") return JSON.stringify({ scripts: { build: "vite build", test: "vitest run" } });
  return "";
};

const writes = createWrites();
const fakeEngine = new FakePatchEngine("src/mvp.ts");
const patchProvider: PhasePatchProvider = async () => ({
  patchPlan: {
    explanation: "Add MVP file",
    patch: [
      "--- a/src/mvp.ts",
      "+++ b/src/mvp.ts",
      "@@ -0,0 +1,2 @@",
      "+export const mvp = true;",
      "+",
    ].join("\n"),
  },
  patchEngine: fakeEngine,
});

const continuation = await approvePhaseAndContinue({
  workspaceRoot,
  projectBlueprint: gatePendingBlueprint,
  readFile,
  patchProvider,
  progressDeps: createProgressDeps(writes),
  persistBlueprint: false,
  maxTasks: 2,
  now: "2026-06-29T12:04:00.000Z",
  runBuildCheck: async (request) => buildResult(request, 0),
  runTestCommand: async (request) => buildResult(request, 0),
});

assert(continuation.approvedPhaseId === "foundation", "approve should record foundation as approved phase");
assert(continuation.activatedPhaseId === "mvp-features", "approve Foundation should activate next phase");
assert(
  continuation.blueprint.phaseBuildPlan.data?.phases.find((phase) => phase.id === "foundation")?.status === "approved",
  "foundation phase should be marked approved"
);
assert(
  continuation.blueprint.phaseBuildPlan.data?.phases.find((phase) => phase.id === "mvp-features")?.status === "active",
  "mvp phase should become active after approval"
);
assert(
  continuation.blueprint.phaseExecutionState.data?.currentPhaseId === "mvp-features",
  "execution state should move to next phase only after approval"
);

const beforeApprovalState = gatePendingBlueprint.phaseExecutionState.data!;
assert(beforeApprovalState.currentPhaseId === "foundation", "next phase execution should not start before approval");

const dashboard = dashboardAfterExecution({
  workspacePath: workspaceRoot,
  blueprint: continuation.blueprint,
});
assert(dashboard.currentPhase.phaseName.length > 0, "dashboard should update after phase continuation");

const overrideWrites = createWrites();
let overrideAttempted = false;
try {
  await approvePhaseAndContinue({
    workspaceRoot,
    projectBlueprint: blockedBlueprint,
    readFile,
    patchProvider,
    progressDeps: createProgressDeps(overrideWrites),
    persistBlueprint: false,
    maxTasks: 1,
    overrideBlockers: false,
  });
} catch {
  overrideAttempted = true;
}
assert(overrideAttempted, "blocked phase without override should throw");

const overrideContinuation = await approvePhaseAndContinue({
  workspaceRoot,
  projectBlueprint: blockedBlueprint,
  readFile,
  patchProvider,
  progressDeps: createProgressDeps(overrideWrites),
  persistBlueprint: false,
  maxTasks: 1,
  overrideBlockers: true,
  now: "2026-06-29T12:05:00.000Z",
  runBuildCheck: async (request) => buildResult(request, 0),
  runTestCommand: async (request) => buildResult(request, 0),
});
assert(overrideContinuation.overrideLogged, "founder override should be logged when allowed");
assert(
  overrideWrites.actions.some((entry) => entry.summary.includes("overrode phase gate blockers")),
  "override action log entry should be recorded"
);

assert(detectPhaseGateChatIntent("continue to next phase") === "continue_next_phase", "chat intent should detect continue");
assert(detectPhaseGateChatIntent("approve phase") === "approve_phase", "chat intent should detect approve");
assert(detectPhaseGateChatIntent("hold here") === "hold", "chat intent should detect hold");
assert(detectPhaseGateChatIntent("show phase gate") === "show_gate", "chat intent should detect show gate");
assert(
  detectPhaseGateChatIntent("what is blocking this phase?") === "what_blocking",
  "chat intent should detect blocker question"
);

assert(
  continuation.execution.cycles.length <= 2,
  "bounded continuation should not create an unbounded multi-phase loop in one approve action"
);

console.log("phase gate controller regression passed");
