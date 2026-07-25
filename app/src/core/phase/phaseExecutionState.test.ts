import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import {
  attachGapAnalysis,
  attachPhaseBuildPlan,
  attachPhaseExecutionState,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import {
  createPhaseExecutionState,
  markPhaseTaskBlocked,
  markPhaseTaskComplete,
  recordPhaseCheckStatus,
  recordRepairAttempt,
} from "./phaseExecutionState";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-execution-state",
  projectId: "execution-state",
  now: "2026-06-27T00:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-27T01:00:00.000Z");
const phasePlan = createPhaseBuildPlan(blueprint, gap, "2026-06-27T02:00:00.000Z");
const state = createPhaseExecutionState(phasePlan, "2026-06-27T03:00:00.000Z");

assert(state.currentPhaseId === "discovery", "initial state should use current phase from Phase Build Plan");
assert(state.currentTaskId === "discovery-confirm-blueprint", "initial state should select the first task");
assert(state.completedTaskIds.length === 0, "initial state should have no completed tasks");
assert(state.blockedTaskIds.length === 0, "initial state should have no blocked tasks");
assert(state.buildStatus.status === "notRun", "initial state should track build status");
assert(state.testStatus.status === "notRun", "initial state should track test status");
assert(state.checkStatus.status === "notRun", "initial state should track general check status");
assert(state.phaseStatus === "active", "initial phase status should be active");
assert(state.confidenceLevel !== "low", "initial state should have usable confidence");
assert(state.history.length === 1, "initial state should record history");

const completed = markPhaseTaskComplete(
  state,
  phasePlan,
  "discovery-confirm-blueprint",
  "2026-06-27T04:00:00.000Z"
);

assert(
  completed.completedTaskIds.includes("discovery-confirm-blueprint"),
  "completed task should be tracked"
);
assert(completed.currentTaskId === undefined, "single-task phase should stop after completion");
assert(completed.phaseStatus === "complete", "phase status should become complete when no tasks remain");
assert(
  completed.nextRecommendedAction.includes("Await approval"),
  "completed phase should stop at the phase gate"
);

const foundationState = {
  ...state,
  currentPhaseId: "foundation",
  currentTaskId: "foundation-confirm-commands",
  completedTaskIds: [],
  history: [],
};
const completedFoundationTask = markPhaseTaskComplete(
  foundationState,
  phasePlan,
  "foundation-confirm-commands",
  "2026-06-27T05:00:00.000Z"
);

assert(
  completedFoundationTask.currentTaskId === "foundation-baseline-current-state",
  "completing a task should advance to the next available task in the same phase"
);
assert(completedFoundationTask.phaseStatus === "active", "phase should remain active when more tasks exist");

const blocked = markPhaseTaskBlocked(
  foundationState,
  "foundation-confirm-commands",
  "Build command is unknown.",
  "2026-06-27T06:00:00.000Z"
);

assert(blocked.blockedTaskIds.includes("foundation-confirm-commands"), "blocked task should be tracked");
assert(blocked.currentTaskId === "foundation-confirm-commands", "blocked state should not advance task");
assert(blocked.phaseStatus === "blocked", "phase status should become blocked");
assert(blocked.blockerReason === "Build command is unknown.", "blocker reason should be stored");

const buildFailed = recordPhaseCheckStatus(
  foundationState,
  "build",
  "failed",
  {
    command: "npm run build",
    exitCode: 1,
    summary: "TypeScript compile failed.",
  },
  "2026-06-27T07:00:00.000Z"
);

assert(buildFailed.buildStatus.status === "failed", "build status should be recorded");
assert(buildFailed.buildStatus.command === "npm run build", "build command should be recorded");
assert(buildFailed.buildStatus.exitCode === 1, "build exit code should be recorded");
assert(
  buildFailed.nextRecommendedAction.includes("Repair build failure"),
  "failed build should recommend repair before continuing"
);

const testsPassed = recordPhaseCheckStatus(
  buildFailed,
  "test",
  "passed",
  {
    command: "npm test",
    exitCode: 0,
    summary: "Tests passed.",
  },
  "2026-06-27T08:00:00.000Z"
);

assert(testsPassed.testStatus.status === "passed", "test status should be recorded");
assert(testsPassed.testStatus.command === "npm test", "test command should be recorded");

const repaired = recordRepairAttempt(
  testsPassed,
  {
    taskId: "foundation-confirm-commands",
    summary: "Adjusted command metadata after failed check.",
    status: "succeeded",
  },
  "2026-06-27T09:00:00.000Z"
);

assert(repaired.repairAttempts.length === 1, "repair attempts should be recorded");
assert(repaired.repairAttempts[0].status === "succeeded", "repair status should be recorded");
assert(
  repaired.nextRecommendedAction === "Rerun checks before continuing.",
  "successful repair should recommend rerunning checks"
);

const blueprintWithPlan = attachPhaseBuildPlan(
  attachGapAnalysis(blueprint, gap, "2026-06-27T10:00:00.000Z"),
  phasePlan,
  "2026-06-27T11:00:00.000Z"
);
const blueprintWithState = attachPhaseExecutionState(
  blueprintWithPlan,
  repaired,
  "2026-06-27T12:00:00.000Z"
);

assert(
  blueprintWithState.phaseExecutionState.data?.currentPhaseId === "foundation",
  "Phase Execution State should attach to Blueprint"
);
assert(
  blueprintWithState.buildHistory.data.some((entry) => entry.source === "PhaseExecutionState"),
  "Blueprint history should record Phase Execution State attachment"
);
assert(phasePlan.phases.length === 7, "state transitions should not mutate app source files or phase plan");

console.log("phase execution state regression passed");
