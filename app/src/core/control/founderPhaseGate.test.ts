import { PatchEngine } from "../patch/PatchEngine";
import { detectBuildCheckIntent } from "../project/buildCheck";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import {
  attachControlPreferences,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createPhaseBuildPlan } from "../phase/phaseBuildPlan";
import {
  createPhaseExecutionState,
  markPhaseTaskBlocked,
  markPhaseTaskComplete,
  recordPhaseCheckStatus,
  recordRepairAttempt,
} from "../phase/phaseExecutionState";
import type { PhaseBuildPlan } from "../types";
import {
  createControlPreferences,
  developerModeControlPreferences,
  founderModeControlPreferences,
} from "./controlLevel";
import { createPhaseGateSummary } from "./founderPhaseGate";

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

const blueprintBase = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-founder-gate",
  projectId: "founder-gate",
  now: "2026-06-28T00:00:00.000Z",
});
const founderBlueprint = attachControlPreferences(
  blueprintBase,
  founderModeControlPreferences("guided"),
  "2026-06-28T00:30:00.000Z"
);
const gap = createGapAnalysis(founderBlueprint, "2026-06-28T01:00:00.000Z");
const plan = approveCurrentPhase(createPhaseBuildPlan(founderBlueprint, gap, "2026-06-28T02:00:00.000Z"));
const state = createPhaseExecutionState(plan, "2026-06-28T03:00:00.000Z");
const completed = markPhaseTaskComplete(
  recordRepairAttempt(
    recordPhaseCheckStatus(
      recordPhaseCheckStatus(state, "build", "passed", { command: "npm run build", exitCode: 0, summary: "Build passed." }, "2026-06-28T04:00:00.000Z"),
      "test",
      "passed",
      { command: "npm test", exitCode: 0, summary: "Tests passed." },
      "2026-06-28T04:05:00.000Z"
    ),
    {
      taskId: "discovery-confirm-blueprint",
      summary: "No repair needed.",
      status: "attempted",
    },
    "2026-06-28T04:10:00.000Z"
  ),
  plan,
  "discovery-confirm-blueprint",
  "2026-06-28T04:15:00.000Z"
);

const founderSummary = createPhaseGateSummary({
  blueprint: founderBlueprint,
  phaseBuildPlan: plan,
  phaseExecutionState: completed,
});

assert(founderSummary.mode === "founder", "Founder Mode gate summary is founder-facing");
assert(founderSummary.currentPhaseName === "Discovery", "Founder Mode gate summary is phase-focused");
assert(founderSummary.completed.includes("Confirm Project Blueprint"), "completed phase summary includes completed task");
assert(founderSummary.checks.some((item) => item === "Build: passed"), "completed summary includes build status");
assert(founderSummary.checks.some((item) => item === "Tests: passed"), "completed summary includes test status");
assert(founderSummary.showDeveloperDetails === false, "Founder Mode hides developer details by default");
assert(!("developerDetails" in founderSummary), "Founder Mode should not expose raw task ids/details");
assert(
  founderSummary.decisionPrompt.includes("Continue to the next phase") ||
    founderSummary.decisionPrompt.includes("Continue the Discovery phase"),
  "Founder Mode asks for phase-level approval, not micro-task approval"
);
assert(!founderSummary.decisionPrompt.includes("discovery-confirm-blueprint"), "Founder prompt should not ask for task-id approval");

const developerBlueprint = attachControlPreferences(
  blueprintBase,
  developerModeControlPreferences("assisted"),
  "2026-06-28T05:00:00.000Z"
);
const developerSummary = createPhaseGateSummary({
  blueprint: developerBlueprint,
  phaseBuildPlan: plan,
  phaseExecutionState: completed,
});

assert(developerSummary.mode === "developer", "Developer Mode can receive detailed gate data");
assert(developerSummary.showDeveloperDetails === true, "Developer Mode exposes detailed/manual controls data");
if (developerSummary.mode !== "developer") {
  throw new Error("Developer summary should be narrowed to developer mode");
}
assert(developerSummary.developerDetails.taskIds.includes("discovery-confirm-blueprint"), "Developer details include task ids");
assert(developerSummary.developerDetails.qualityGates.length > 0, "Developer details include quality gates");

const sensitivePlan: PhaseBuildPlan = {
  ...plan,
  phases: plan.phases.map((phase) =>
    phase.id === plan.currentPhaseId
      ? {
          ...phase,
          tasks: [
            ...phase.tasks,
            {
              id: "discovery-api-key",
              title: "Configure API keys",
              rationale: "Credentials are needed before external integration.",
              sourceGapKeys: [],
              constraints: ["Requires API key and paid account decision."],
              status: "todo",
            },
          ],
        }
      : phase
  ),
};
const sensitiveSummary = createPhaseGateSummary({
  blueprint: founderBlueprint,
  phaseBuildPlan: sensitivePlan,
  phaseExecutionState: completed,
});

assert(sensitiveSummary.sensitiveDecisions.includes("Configure API keys"), "sensitive decisions are still surfaced");

const blocked = markPhaseTaskBlocked(
  state,
  "discovery-confirm-blueprint",
  "Deployment choice is blocked until founder approval.",
  "2026-06-28T06:00:00.000Z"
);
const blockedSummary = createPhaseGateSummary({
  blueprint: founderBlueprint,
  phaseBuildPlan: plan,
  phaseExecutionState: blocked,
});

assert(blockedSummary.blockers.length > 0, "blockers are surfaced in Founder Mode");
assert(blockedSummary.decisionPrompt.includes("Resolve the blocker"), "blocking decisions should not be hidden");

const manualSummary = createPhaseGateSummary({
  blueprint: attachControlPreferences(blueprintBase, createControlPreferences("manual", "developer")),
  phaseBuildPlan: plan,
  phaseExecutionState: completed,
});
assert(manualSummary.mode === "developer", "control level affects gate output");

assert(typeof PatchEngine === "function", "developer patch tools remain importable/available");
assert(typeof detectBuildCheckIntent === "function", "developer build-check tools remain importable/available");

console.log("founder phase gate regression passed");
