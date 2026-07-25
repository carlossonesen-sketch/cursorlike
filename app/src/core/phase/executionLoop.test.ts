import type { PhaseBuildPlan, PhaseExecutionState, PhaseTask } from "../types";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createProjectBlueprintFromDiscoveryIntake } from "../product/projectBlueprint";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import { createPhaseExecutionState, markPhaseTaskBlocked, markPhaseTaskComplete } from "./phaseExecutionState";
import {
  applySimulatedExecutionResult,
  planNextExecutionStep,
  selectNextExecutableTask,
} from "./executionLoop";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function approveCurrentPhase(plan: PhaseBuildPlan): PhaseBuildPlan {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === plan.currentPhaseId ? { ...phase, status: "approved" as const } : phase
    ),
  };
}

function withFoundationPhase(plan: PhaseBuildPlan): PhaseBuildPlan {
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

function appendTask(plan: PhaseBuildPlan, phaseId: string, task: PhaseTask): PhaseBuildPlan {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === phaseId ? { ...phase, tasks: [...phase.tasks, task] } : phase
    ),
  };
}

function testTask(id: string, title: string, rationale: string, constraints: string[] = []): PhaseTask {
  return {
    id,
    title,
    rationale,
    constraints,
    sourceGapKeys: [],
    status: "todo",
  };
}

const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-execution-loop",
  projectId: "execution-loop",
  now: "2026-06-27T00:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-27T01:00:00.000Z");
const basePlan = createPhaseBuildPlan(blueprint, gap, "2026-06-27T02:00:00.000Z");
const approvedPlan = approveCurrentPhase(basePlan);
const initialState = createPhaseExecutionState(approvedPlan, "2026-06-27T03:00:00.000Z");

const firstTask = selectNextExecutableTask(approvedPlan, initialState);
assert(firstTask?.id === "discovery-confirm-blueprint", "selects next task in approved phase");

const firstStep = planNextExecutionStep(approvedPlan, initialState);
assert(firstStep.classification === "safe", "safe/non-destructive task is executable");
assert(firstStep.taskId === "discovery-confirm-blueprint", "planned step references selected task");

const completedDiscovery = applySimulatedExecutionResult(
  initialState,
  approvedPlan,
  {
    status: "completed",
    summary: "Confirmed Blueprint.",
  },
  "2026-06-27T04:00:00.000Z"
);

assert(
  completedDiscovery.completedTaskIds.includes("discovery-confirm-blueprint"),
  "simulated completion updates PhaseExecutionState"
);
assert(completedDiscovery.phaseStatus === "complete", "single-task phase completes after simulated result");

const completeStep = planNextExecutionStep(approvedPlan, completedDiscovery);
assert(completeStep.classification === "phaseComplete", "loop stops at phase completion");
assert(
  completeStep.nextRecommendedAction.includes("phase gate"),
  "phase completion recommends next phase gate"
);

const foundationPlan = withFoundationPhase(basePlan);
const foundationState = createPhaseExecutionState(foundationPlan, "2026-06-27T05:00:00.000Z");
const completedFirstFoundationTask = markPhaseTaskComplete(
  foundationState,
  foundationPlan,
  "foundation-confirm-commands",
  "2026-06-27T06:00:00.000Z"
);
const nextFoundationTask = selectNextExecutableTask(foundationPlan, completedFirstFoundationTask);

assert(
  nextFoundationTask?.id === "foundation-baseline-current-state",
  "loop skips completed tasks"
);

const blockedState = markPhaseTaskBlocked(
  foundationState,
  "foundation-confirm-commands",
  "Need founder clarification.",
  "2026-06-27T07:00:00.000Z"
);
const blockedStep = planNextExecutionStep(foundationPlan, blockedState);

assert(blockedStep.classification === "blocked", "loop stops on blocked task");
assert(blockedStep.reason === "Need founder clarification.", "blocked step exposes blocker reason");

const credentialPlan = appendTask(
  foundationPlan,
  "foundation",
  testTask("foundation-add-api-key", "Add API key setup", "Requires credentials for external service.")
);
const credentialState: PhaseExecutionState = {
  ...foundationState,
  currentTaskId: "foundation-add-api-key",
};
const credentialStep = planNextExecutionStep(credentialPlan, credentialState);

assert(credentialStep.classification === "needsApproval", "credential tasks require approval");

const deploymentPlan = appendTask(
  foundationPlan,
  "foundation",
  testTask("foundation-deploy-prod", "Deploy production app", "Choose deployment provider and production target.")
);
const deploymentStep = planNextExecutionStep(deploymentPlan, {
  ...foundationState,
  currentTaskId: "foundation-deploy-prod",
});

assert(deploymentStep.classification === "needsApproval", "deployment tasks require approval");

const legalPlan = appendTask(
  foundationPlan,
  "foundation",
  testTask("foundation-privacy-policy", "Add privacy policy", "Legal and privacy decision required.")
);
const legalStep = planNextExecutionStep(legalPlan, {
  ...foundationState,
  currentTaskId: "foundation-privacy-policy",
});

assert(legalStep.classification === "needsApproval", "legal/privacy tasks require approval");

const destructivePlan = appendTask(
  foundationPlan,
  "foundation",
  testTask("foundation-rewrite-ui", "Rewrite existing UI", "Destructive rewrite of current screens.")
);
const destructiveStep = planNextExecutionStep(destructivePlan, {
  ...foundationState,
  currentTaskId: "foundation-rewrite-ui",
});

assert(destructiveStep.classification === "blocked", "destructive rewrite tasks are blocked");

const blockedResult = applySimulatedExecutionResult(
  foundationState,
  foundationPlan,
  {
    status: "blocked",
    summary: "Founder must choose account provider.",
  },
  "2026-06-27T08:00:00.000Z"
);

assert(blockedResult.phaseStatus === "blocked", "simulated blocked result updates phase status");
assert(
  blockedResult.nextRecommendedAction.includes("Founder must choose account provider"),
  "simulated blocked result updates next recommended action"
);
assert(basePlan.phases.length === 7, "ExecutionLoop does not modify app source files or mutate the phase plan");

console.log("execution loop regression passed");
