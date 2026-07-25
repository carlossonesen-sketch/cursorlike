import { appendActionLogEntry } from "../memory/actionLogStore";
import { writeLivingBuildPlan } from "../memory/buildPlanStore";
import { writeProjectMemory } from "../memory/projectMemoryStore";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import {
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { writeWorkspaceProjectBlueprint } from "../product/projectBlueprintStore";
import type {
  ActionLogEntry,
  LivingBuildPlan,
  PhaseExecutionState,
  ProjectBlueprint,
  ProjectMemory,
} from "../types";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import {
  createPhaseExecutionState,
  markPhaseTaskBlocked,
  markPhaseTaskComplete,
  recordPhaseCheckStatus,
  recordRepairAttempt,
} from "./phaseExecutionState";
import {
  recordExecutionProgress,
  type ExecutionProgressRecorderDeps,
} from "./executionProgressRecorder";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
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

function createMemory(): ProjectMemory {
  return {
    schemaVersion: 1,
    projectId: "progress-recorder",
    name: "Progress Recorder",
    aliases: [],
    path: "D:\\dev\\nf-projects\\progress-recorder",
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    status: "active",
    lifecycleStage: "buildingMvp",
    fullIdea: "Build a budgeting app",
    summary: "Budgeting app",
    techStack: ["React"],
    architectureNotes: [],
    decisions: [],
    importantFiles: [],
    generatedFiles: [],
    commands: { build: "npm run build", test: "npm test" },
    todos: [{ id: "discovery-confirm-blueprint", text: "Confirm blueprint", status: "doing" }],
    knownIssues: [],
    recentWork: [],
    resumeState: { status: "active" },
  };
}

function createLivingPlan(): LivingBuildPlan {
  return {
    schemaVersion: 1,
    projectId: "progress-recorder",
    mvpDefinition: "Budgeting app MVP",
    milestones: [
      {
        id: "discovery",
        name: "Discovery",
        goal: "Confirm blueprint",
        status: "active",
        tasks: [
          { id: "discovery-confirm-blueprint", title: "Confirm blueprint", status: "doing" },
          { id: "discovery-second-task", title: "Review assumptions", status: "todo" },
        ],
      },
    ],
    currentMilestoneId: "discovery",
    currentTaskId: "discovery-confirm-blueprint",
    completedSteps: [],
    nextRecommendedStep: "Confirm blueprint",
    progressSummary: "Discovery: 0 / 2 tasks complete.",
    pausedState: { isPaused: false },
  };
}

function createRecorderDeps(writes: {
  blueprints: ProjectBlueprint[];
  plans: LivingBuildPlan[];
  memories: ProjectMemory[];
  actions: ActionLogEntry[];
}): ExecutionProgressRecorderDeps {
  return {
    async writeProjectBlueprint(_workspaceRoot, blueprint) {
      writes.blueprints.push(blueprint);
    },
    async writeLivingBuildPlan(_workspaceRoot, plan) {
      writes.plans.push(plan);
    },
    async writeProjectMemory(_workspaceRoot, memory) {
      writes.memories.push(memory);
    },
    async appendActionLogEntry(_workspaceRoot, entry) {
      writes.actions.push(entry);
    },
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\progress-recorder";
const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-progress-recorder",
  projectId: "progress-recorder",
  now: "2026-06-27T00:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-27T01:00:00.000Z");
const phasePlan = approveCurrentPhase(createPhaseBuildPlan(blueprint, gap, "2026-06-27T02:00:00.000Z"));
const state = createPhaseExecutionState(phasePlan, "2026-06-27T03:00:00.000Z");

const completedState = markPhaseTaskComplete(
  state,
  phasePlan,
  "discovery-confirm-blueprint",
  "2026-06-27T04:00:00.000Z"
);
const completionWrites = { blueprints: [], plans: [], memories: [], actions: [] } as {
  blueprints: ProjectBlueprint[];
  plans: LivingBuildPlan[];
  memories: ProjectMemory[];
  actions: ActionLogEntry[];
};
const completionResult = await recordExecutionProgress({
  workspaceRoot,
  blueprint,
  phaseExecutionState: completedState,
  livingBuildPlan: createLivingPlan(),
  projectMemory: createMemory(),
  outcome: "task_completed",
  summary: "Completed blueprint confirmation.",
  filesChanged: ["docs/blueprint.md"],
  now: "2026-06-27T05:00:00.000Z",
  deps: createRecorderDeps(completionWrites),
});

assert(completionWrites.blueprints.length === 1, "Blueprint execution state is saved");
assert(completionWrites.plans.length === 1, "living build plan is saved");
assert(completionWrites.memories.length === 1, "project memory is saved");
assert(completionWrites.actions.length === 1, "successful task completion records action log entry");
assert(
  completionResult.blueprint.phaseExecutionState.data?.completedTaskIds.includes("discovery-confirm-blueprint") === true,
  "saved Blueprint should include latest execution state"
);
assert(
  completionResult.livingBuildPlan?.milestones[0]?.tasks[0]?.status === "done",
  "existing build plan progress is updated where task ids match"
);
assert(
  completionResult.livingBuildPlan?.currentTaskId === "discovery-second-task",
  "living plan should advance to next matching task"
);
assert(
  completionResult.projectMemory?.todos[0]?.status === "done",
  "project memory todo should be marked complete when ids match"
);
assert(completionWrites.actions[0]?.action === "update_memory", "task completion should use update_memory action");

const failedBuildState = markPhaseTaskBlocked(
  recordPhaseCheckStatus(
    state,
    "build",
    "failed",
    { command: "npm run build", exitCode: 2, summary: "Build failed." },
    "2026-06-27T06:00:00.000Z"
  ),
  state.currentTaskId,
  "Build failed.",
  "2026-06-27T06:00:01.000Z"
);
const failureWrites = { blueprints: [], plans: [], memories: [], actions: [] } as {
  blueprints: ProjectBlueprint[];
  plans: LivingBuildPlan[];
  memories: ProjectMemory[];
  actions: ActionLogEntry[];
};
const failureResult = await recordExecutionProgress({
  workspaceRoot,
  blueprint,
  phaseExecutionState: failedBuildState,
  livingBuildPlan: createLivingPlan(),
  projectMemory: createMemory(),
  outcome: "build_failed",
  summary: "Build failed.",
  command: "npm run build",
  runId: "build-1",
  exitCode: 2,
  durationMs: 1200,
  now: "2026-06-27T06:00:02.000Z",
  deps: createRecorderDeps(failureWrites),
});

assert(failureWrites.actions[0]?.action === "run_command", "failed build/test records action log entry");
assert(failureWrites.actions[0]?.command === "npm run build", "failed build action should record command");
assert(failureResult.livingBuildPlan?.nextRecommendedStep === "Repair build failure before continuing.", "failed build recommends repair");
assert(failureResult.projectMemory?.resumeState.status === "paused", "blocked state should pause project memory resume state");

const repairState = recordRepairAttempt(
  failedBuildState,
  {
    taskId: state.currentTaskId ?? "task",
    summary: "Applied focused nullability repair.",
    status: "succeeded",
  },
  "2026-06-27T07:00:00.000Z"
);
const repairWrites = { blueprints: [], plans: [], memories: [], actions: [] } as {
  blueprints: ProjectBlueprint[];
  plans: LivingBuildPlan[];
  memories: ProjectMemory[];
  actions: ActionLogEntry[];
};
const repairResult = await recordExecutionProgress({
  workspaceRoot,
  blueprint,
  phaseExecutionState: repairState,
  livingBuildPlan: createLivingPlan(),
  projectMemory: createMemory(),
  outcome: "repair_succeeded",
  summary: "Applied focused nullability repair.",
  filesChanged: ["src/main.tsx"],
  now: "2026-06-27T07:00:01.000Z",
  deps: createRecorderDeps(repairWrites),
});

assert(repairWrites.actions[0]?.action === "update_memory", "repair attempt records action log entry");
assert(repairResult.livingBuildPlan?.nextRecommendedStep === "Rerun checks before continuing.", "repair recommends rerun checks");
assert(
  repairResult.projectMemory?.recentWork[0]?.nextRecommendedStep === "Rerun checks before continuing.",
  "repair records next recommended rerun in memory"
);

const phaseCompleteState: PhaseExecutionState = {
  ...completedState,
  phaseStatus: "complete",
  currentTaskId: undefined,
  nextRecommendedAction: "Stop at phase gate.",
};
const phaseWrites = { blueprints: [], plans: [], memories: [], actions: [] } as {
  blueprints: ProjectBlueprint[];
  plans: LivingBuildPlan[];
  memories: ProjectMemory[];
  actions: ActionLogEntry[];
};
const phaseResult = await recordExecutionProgress({
  workspaceRoot,
  blueprint,
  phaseExecutionState: phaseCompleteState,
  livingBuildPlan: createLivingPlan(),
  projectMemory: createMemory(),
  outcome: "phase_completed",
  summary: "Discovery phase complete.",
  now: "2026-06-27T08:00:00.000Z",
  deps: createRecorderDeps(phaseWrites),
});

assert(phaseResult.blueprint.phaseExecutionState.status === "ready", "phase completion updates Blueprint section status");
assert(phaseWrites.actions[0]?.summary === "Discovery phase complete.", "phase completion records phase summary");
assert(
  phaseResult.livingBuildPlan?.nextRecommendedStep === "Phase complete. Await approval for the next phase gate.",
  "phase completion should stop at phase gate"
);

assert(typeof writeWorkspaceProjectBlueprint === "function", "manual Blueprint store helper remains importable");
assert(typeof writeLivingBuildPlan === "function", "manual build-plan helper remains importable");
assert(typeof writeProjectMemory === "function", "manual project-memory helper remains importable");
assert(typeof appendActionLogEntry === "function", "manual action-log helper remains importable");
assert(completionWrites.actions.every((entry) => !(entry.files ?? []).includes("src/unrelated.ts")), "no unrelated project source files are modified");

console.log("execution progress recorder regression passed");
