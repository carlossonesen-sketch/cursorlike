import type { ApplyResult } from "../patch/PatchEngine";
import { pathsFromPatch } from "../patch/PatchEngine";
import type { ActionLogEntry, ProjectBlueprint } from "../types";
import { founderModeControlPreferences } from "../control/controlLevel";
import { buildProjectDashboardModel } from "../project/projectDashboard";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import {
  attachControlPreferences,
  attachPhaseBuildPlan,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createPhaseExecutionState } from "./phaseExecutionState";
import { runPhaseUntilGate } from "./executionPhaseRunner";
import type { ExecutionPatchEngine } from "./executionPatchRunner";
import type { ExecutionProgressRecorderDeps } from "./executionProgressRecorder";
import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import type { PhaseBuildPlan } from "../types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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
    return {
      applied: [this.filePath],
      failed: [],
      beforeSnapshots: [],
    };
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
    startTimestamp: "2026-06-28T11:00:00.000Z",
    endTimestamp: "2026-06-28T11:00:01.000Z",
    durationMs: 1000,
    stdout: exitCode === 0 ? "ok" : "",
    stderr,
    exitCode,
  };
}

function createTwoTaskPlan(blueprint: ProjectBlueprint): PhaseBuildPlan {
  return {
    schemaVersion: 1,
    blueprintId: blueprint.id,
    createdAt: "2026-06-28T10:00:00.000Z",
    updatedAt: "2026-06-28T10:00:00.000Z",
    currentPhaseId: "foundation",
    recommendedNextPhaseId: "foundation",
    recommendedNextTaskId: "task-one",
    phases: [
      {
        id: "foundation",
        title: "Foundation",
        goal: "Create the foundation without leaving the phase gate.",
        status: "approved",
        tasks: [
          {
            id: "task-one",
            title: "Create first safe file",
            rationale: "First bounded task.",
            sourceGapKeys: [],
            constraints: [],
            status: "todo",
          },
          {
            id: "task-two",
            title: "Create second safe file",
            rationale: "Second bounded task.",
            sourceGapKeys: [],
            constraints: [],
            status: "todo",
          },
        ],
        definitionOfDone: ["Both safe tasks are complete."],
        qualityGates: [
          {
            id: "foundation-build",
            title: "Build check",
            check: "Run the project build command.",
            required: true,
            status: "pending",
          },
          {
            id: "foundation-test",
            title: "Test check",
            check: "Run available project tests.",
            required: false,
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
    preservationSummary: "No existing product preservation constraints in this regression.",
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\phase-runner";
const blueprintBase = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-phase-runner",
  projectId: "phase-runner",
  now: "2026-06-28T10:00:00.000Z",
});
const guidedBlueprint = attachControlPreferences(
  blueprintBase,
  founderModeControlPreferences("guided"),
  "2026-06-28T10:01:00.000Z"
);
const plan = createTwoTaskPlan(guidedBlueprint);
const blueprintWithPlan = attachPhaseBuildPlan(guidedBlueprint, plan, "2026-06-28T10:02:00.000Z");
const initialState = createPhaseExecutionState(plan, "2026-06-28T10:03:00.000Z");

const readFile = async (path: string): Promise<string> => {
  if (path === "package.json") return JSON.stringify({ scripts: { build: "vite build", test: "vitest run" } });
  return `// ${path}`;
};

const writes = createWrites();
const successfulRun = await runPhaseUntilGate({
  blueprint: blueprintWithPlan,
  plan,
  state: initialState,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  maxTasks: 3,
  readFile,
  progressDeps: createProgressDeps(writes),
  runBuildCheck: async (request) => buildResult(request, 0),
  runTestCommand: async (request) => buildResult(request, 0),
  patchProvider: async ({ selectedStep }) => {
    const filePath = selectedStep.taskId === "task-one" ? "src/one.ts" : "src/two.ts";
    return {
      patchPlan: {
        explanation: `Apply ${selectedStep.title}.`,
        patch: [
          `--- a/${filePath}`,
          `+++ b/${filePath}`,
          "@@ -1,1 +1,1 @@",
          "-old",
          "+new",
        ].join("\n"),
      },
      patchEngine: new FakePatchEngine(filePath),
    };
  },
  now: "2026-06-28T10:04:00.000Z",
});

assert(successfulRun.status === "phaseGate", "multi-task runner stops at the phase gate");
assert(successfulRun.cycles.length === 3, "runner records two task cycles and one phase-gate cycle");
assert(successfulRun.cycles[0]?.status === "completed", "first task completes");
assert(successfulRun.cycles[1]?.status === "completed", "second task completes");
assert(successfulRun.cycles[2]?.status === "skipped", "phase completion is recorded without advancing");
assert(successfulRun.state.completedTaskIds.includes("task-one"), "first task completion is persisted");
assert(successfulRun.state.completedTaskIds.includes("task-two"), "second task completion is persisted");
assert(successfulRun.state.phaseStatus === "complete", "phase remains complete at the approval gate");
assert(successfulRun.developerDetails.nextPhaseGate === "Continue to MVP Features?", "next phase approval gate is exposed");
assert(writes.actions.filter((entry) => entry.action === "apply_patch").length === 2, "runner applies two patches through the bounded cycle");

const successDashboard = buildProjectDashboardModel({
  workspacePath: workspaceRoot,
  projectBlueprint: successfulRun.blueprint,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
  developerMode: true,
});
assert(successDashboard.qualityGateStatus.status === "Passed", "successful multi-task run is dashboard-readable");
assert(successDashboard.blockers.count === 0, "successful multi-task run has no blockers");

const blockedWrites = createWrites();
const blockedRun = await runPhaseUntilGate({
  blueprint: blueprintWithPlan,
  plan,
  state: initialState,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  maxTasks: 2,
  readFile,
  progressDeps: createProgressDeps(blockedWrites),
  patchProvider: async () => null,
  now: "2026-06-28T10:10:00.000Z",
});

assert(blockedRun.status === "blocked", "runner blocks when no patch provider output exists");
assert(blockedRun.cycles.length === 1, "blocked no-patch run stops after one bounded cycle");
const blockedDashboard = buildProjectDashboardModel({
  workspacePath: workspaceRoot,
  projectBlueprint: blockedRun.blueprint,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
  developerMode: true,
});
assert(blockedDashboard.blockers.count > 0, "no-patch runner block is dashboard-readable");
assert(blockedDashboard.qualityGateStatus.status === "Blocked", "no-patch runner block affects quality gate status");

const validationWrites = createWrites();
const validationRun = await runPhaseUntilGate({
  blueprint: blueprintWithPlan,
  plan,
  state: initialState,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  maxTasks: 2,
  readFile,
  progressDeps: createProgressDeps(validationWrites),
  runBuildCheck: async (request) => buildResult(request, 2, "src/one.ts(1,1): error TS1005: ';' expected."),
  applyRepair: async () => ({ ok: false, summary: "Repair failed during integration test." }),
  patchProvider: async () => ({
    patchPlan: {
      explanation: "Apply broken change.",
      patch: ["--- a/src/one.ts", "+++ b/src/one.ts", "@@ -1,1 +1,1 @@", "-old", "+broken"].join("\n"),
    },
    patchEngine: new FakePatchEngine("src/one.ts"),
  }),
  now: "2026-06-28T10:20:00.000Z",
});

assert(validationRun.status === "repairAttempted", "validation failure triggers bounded repair path");
assert(validationRun.cycles.length === 1, "runner stops after repair attempt");
const validationDashboard = buildProjectDashboardModel({
  workspacePath: workspaceRoot,
  projectBlueprint: validationRun.blueprint,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
  developerMode: true,
});
assert(validationDashboard.blockers.count > 0, "validation failure is dashboard-readable");
assert(validationDashboard.qualityGateStatus.status !== "Passed", "failed validation is not marked passed");

console.log("execution phase runner regression passed");
