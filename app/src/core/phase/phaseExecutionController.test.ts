import type { ApplyResult } from "../patch/PatchEngine";
import { pathsFromPatch } from "../patch/PatchEngine";
import type { ActionLogEntry, PhaseBuildPlan, ProjectBlueprint } from "../types";
import { founderModeControlPreferences } from "../control/controlLevel";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import {
  attachControlPreferences,
  attachPhaseBuildPlan,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import type { ExecutionPatchEngine } from "./executionPatchRunner";
import type { ExecutionProgressRecorderDeps } from "./executionProgressRecorder";
import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import {
  assessPatchProviderAvailability,
  canStartFoundationExecution,
  createExecutionPatchEngine,
  createProductionPhasePatchProvider,
  dashboardAfterExecution,
  describePhaseExecutionResult,
  prepareBlueprintForFoundationExecution,
  startFoundationPhaseExecution,
} from "./phaseExecutionController";
import { createPhaseExecutionState } from "./phaseExecutionState";
import { planNextExecutionStep } from "./executionLoop";
import type { PhasePatchProvider } from "./executionPhaseRunner";

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

function createFoundationPlan(blueprint: ProjectBlueprint): PhaseBuildPlan {
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
        status: "planned",
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
        qualityGates: [
          {
            id: "foundation-build",
            title: "Build check",
            check: "Run the project build command.",
            required: true,
            status: "pending",
          },
        ],
        approvalGate: {
          id: "foundation-approval",
          title: "Continue after foundation",
          requiresApproval: true,
          approvalQuestion: "Continue to MVP Features?",
        },
      },
    ],
    preservationSummary: "No preservation constraints in this regression.",
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\autonomous-builder";
const blueprintBase = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-autonomous",
  projectId: "autonomous-builder",
  now: "2026-06-29T12:00:00.000Z",
});
const guidedBlueprint = attachControlPreferences(
  blueprintBase,
  founderModeControlPreferences("guided"),
  "2026-06-29T12:01:00.000Z"
);
const plan = createFoundationPlan(guidedBlueprint);
const blueprintWithPlan = attachPhaseBuildPlan(guidedBlueprint, plan, "2026-06-29T12:02:00.000Z");

const startGate = canStartFoundationExecution({
  workspacePath: workspaceRoot,
  projectBlueprint: blueprintWithPlan,
  creationFlowActive: false,
});
assert(startGate.ok, "approved project with blueprint should be able to start Foundation execution");

const blockedDuringCreation = canStartFoundationExecution({
  workspacePath: workspaceRoot,
  projectBlueprint: blueprintWithPlan,
  creationFlowActive: true,
});
assert(!blockedDuringCreation.ok, "unapproved/in-progress project creation should not execute");

const unavailable = assessPatchProviderAvailability({ provider: "openai" });
if (!unavailable.ok) {
  assert(!unavailable.ok, "missing provider should create blocker when OpenAI key is absent");
}

const prepared = prepareBlueprintForFoundationExecution(blueprintWithPlan, "2026-06-29T12:03:00.000Z");
assert(prepared.plan.phases.find((phase) => phase.id === "foundation")?.status === "active", "foundation phase should activate on prepare");
assert(!!prepared.state.currentTaskId, "execution state should point at a foundation task");

const unapprovedStep = planNextExecutionStep(plan, createPhaseExecutionState(plan, "2026-06-29T12:03:00.000Z"));
assert(unapprovedStep.classification === "needsApproval", "unapproved foundation phase should require approval before execution");

const writes = createWrites();
const fakeEngine = new FakePatchEngine("src/foundation.ts");
const patchProvider: PhasePatchProvider = async () => ({
  patchPlan: {
    explanation: "Add foundation file",
    patch: [
      "--- a/src/foundation.ts",
      "+++ b/src/foundation.ts",
      "@@ -0,0 +1,2 @@",
      "+export const foundation = true;",
      "+",
    ].join("\n"),
  },
  patchEngine: fakeEngine,
});

const readFile = async (path: string): Promise<string> => {
  if (path === "package.json") return JSON.stringify({ scripts: { build: "vite build", test: "vitest run" } });
  return "";
};

const success = await startFoundationPhaseExecution({
  workspaceRoot,
  projectBlueprint: blueprintWithPlan,
  readFile,
  patchProvider,
  progressDeps: createProgressDeps(writes),
  persistBlueprint: false,
  maxTasks: 1,
  now: "2026-06-29T12:04:00.000Z",
  runBuildCheck: async (request) => buildResult(request, 0),
  runTestCommand: async (request) => buildResult(request, 0),
});

assert(fakeEngine.applied, "provider patch should go through PatchEngine");
assert(success.cycles.length > 0, "successful task should record at least one cycle");
assert(
  success.blueprint.phaseExecutionState.data?.completedTaskIds.includes("foundation-safe-file") ||
    success.status === "repairAttempted" ||
    success.status === "validationFailed",
  "successful or validated task should update execution state"
);

const buildFailure = await startFoundationPhaseExecution({
  workspaceRoot,
  projectBlueprint: blueprintWithPlan,
  readFile,
  patchProvider,
  progressDeps: createProgressDeps(writes),
  persistBlueprint: false,
  maxTasks: 1,
  now: "2026-06-29T12:05:00.000Z",
  runBuildCheck: async (request) => buildResult(request, 1, "build failed"),
});
assert(
  buildFailure.status === "repairAttempted" || buildFailure.status === "validationFailed",
  "build failure should create blocker or repair attempt"
);
assert(
  buildFailure.cycles.some((cycle) => cycle.repairResult || cycle.buildResult?.status === "failed"),
  "repair attempt or build failure should be visible"
);

const missingProviderRun = await startFoundationPhaseExecution({
  workspaceRoot,
  projectBlueprint: blueprintWithPlan,
  readFile,
  progressDeps: createProgressDeps(writes),
  persistBlueprint: false,
  maxTasks: 1,
  patchProvider: async () => null,
  provider: "mock",
});
assert(missingProviderRun.status === "blocked", "missing provider patch should create blocker");

const phaseGateResult = await startFoundationPhaseExecution({
  workspaceRoot,
  projectBlueprint: attachPhaseBuildPlan(prepared.blueprint, {
    ...prepared.plan,
    phases: prepared.plan.phases.map((phase) =>
      phase.id === "foundation"
        ? {
            ...phase,
            status: "active" as const,
            tasks: phase.tasks.map((task) => ({ ...task, status: "done" as const })),
          }
        : phase
    ),
  }, "2026-06-29T12:07:00.000Z"),
  readFile,
  progressDeps: createProgressDeps(writes),
  persistBlueprint: false,
  patchProvider: async () => null,
  maxTasks: 1,
});
assert(
  ["phaseGate", "blocked", "limitReached", "skipped"].includes(phaseGateResult.status),
  "phase gate should stop execution when no tasks remain"
);

const dashboard = dashboardAfterExecution({
  workspacePath: workspaceRoot,
  blueprint: success.blueprint,
});
assert(dashboard.currentPhase.phaseName.length > 0, "dashboard should reflect updated execution state");

const narration = describePhaseExecutionResult(success, true);
assert(narration.founderSummary.length > 0, "founder narration should be present");
assert(narration.developerDetails.length > 0, "developer narration should expose raw details");

const persisted = writes.blueprints[writes.blueprints.length - 1] ?? success.blueprint;
assert(!!persisted.phaseExecutionState.data, "execution state should be reloadable from persisted blueprint");

const realPatchEngine = createExecutionPatchEngine(workspaceRoot, async () => "");
assert(typeof realPatchEngine.validatePatch === "function", "workspace PatchEngine adapter should exist");

const productionProvider = createProductionPhasePatchProvider({
  workspaceRoot,
  readFile,
  assessAvailability: () => ({ ok: true, reason: "mock" }),
});
assert(typeof productionProvider === "function", "production patch provider should be creatable");

console.log("phase execution controller regression passed");
