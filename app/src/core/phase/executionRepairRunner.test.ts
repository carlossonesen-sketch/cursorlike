import { repairReferencedBuildFailure, storeBuildFailure } from "../project/buildRepair";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createProjectBlueprintFromDiscoveryIntake } from "../product/projectBlueprint";
import type { PhaseBuildPlan, PhaseExecutionState } from "../types";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import {
  createPhaseExecutionState,
  recordPhaseCheckStatus,
  recordRepairAttempt,
} from "./phaseExecutionState";
import { runExecutionRepair } from "./executionRepairRunner";

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

function unapproveCurrentPhase(plan: PhaseBuildPlan): PhaseBuildPlan {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === plan.currentPhaseId ? { ...phase, status: "planned" as const } : phase
    ),
  };
}

function withFailedBuild(state: PhaseExecutionState, output: string): PhaseExecutionState {
  return {
    ...recordPhaseCheckStatus(
      state,
      "build",
      "failed",
      {
        command: "npm run build",
        exitCode: 2,
        summary: output,
      },
      "2026-06-27T04:00:00.000Z"
    ),
    phaseStatus: "blocked",
    blockerReason: "Build check failed; repair before continuing.",
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\phase-repair-runner";
const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-repair-runner",
  projectId: "repair-runner",
  now: "2026-06-27T00:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-27T01:00:00.000Z");
const approvedPlan = approveCurrentPhase(createPhaseBuildPlan(blueprint, gap, "2026-06-27T02:00:00.000Z"));
const baseState = createPhaseExecutionState(approvedPlan, "2026-06-27T03:00:00.000Z");
const output = "src/main.tsx(146,3): error TS18047: 'requestSummary' is possibly 'null'.";
const lines = Array.from({ length: 160 }, (_, index) => `const filler${index + 1} = ${index + 1};`);
lines[145] = "  requestSummary.textContent = summary;";
const mainTsx = lines.join("\n");
const readFile = async (path: string): Promise<string> => {
  if (path !== "src/main.tsx") throw new Error(`Unexpected read: ${path}`);
  return mainTsx;
};

const unapproved = await runExecutionRepair({
  plan: unapproveCurrentPhase(approvedPlan),
  state: withFailedBuild(baseState, output),
  workspaceRoot,
  failureOutput: output,
  readFile,
  applyRepair: async () => ({ ok: true, summary: "applied" }),
});

assert(unapproved.status === "needsApproval", "repair runner refuses when phase is not approved/active");

const noFailure = await runExecutionRepair({
  plan: approvedPlan,
  state: baseState,
  workspaceRoot,
  failureOutput: output,
  readFile,
  applyRepair: async () => ({ ok: true, summary: "applied" }),
});

assert(noFailure.status === "unavailable", "repair runner refuses without failed build/test/check result");
assert(noFailure.state.repairAttempts.length === 0, "no failed check should not record a repair attempt");

let appliedPatch = "";
const repaired = await runExecutionRepair({
  plan: approvedPlan,
  state: withFailedBuild(baseState, output),
  workspaceRoot,
  failureOutput: output,
  readFile,
  applyRepair: async (patch) => {
    appliedPatch = patch.patch;
    return { ok: true, summary: "Applied safe nullability repair." };
  },
  now: "2026-06-27T05:00:00.000Z",
});

assert(repaired.status === "repaired", "safe repair should be applied");
assert(repaired.state.repairAttempts.length === 1, "safe repair increments repair attempts");
assert(repaired.state.repairAttempts[0]?.status === "succeeded", "successful repair status should be recorded");
assert(repaired.state.nextRecommendedAction === "Rerun checks before continuing.", "safe repair should recommend rerun checks");
assert(repaired.state.phaseStatus === "active", "successful repair should reopen phase for verification");
assert(appliedPatch.includes("if (requestSummary == null) return;"), "repair patch should contain the safe null guard");

const failedRepair = await runExecutionRepair({
  plan: approvedPlan,
  state: withFailedBuild(baseState, output),
  workspaceRoot,
  failureOutput: output,
  readFile,
  applyRepair: async () => ({ ok: false, summary: "Patch validation failed." }),
  now: "2026-06-27T06:00:00.000Z",
});

assert(failedRepair.status === "failed", "failed repair should report failure");
assert(failedRepair.state.repairAttempts[0]?.status === "failed", "failed repair attempt should be recorded");
assert(failedRepair.state.phaseStatus === "blocked", "failed repair should block for review");

const onceRepaired = recordRepairAttempt(
  withFailedBuild(baseState, output),
  {
    taskId: baseState.currentTaskId ?? "task",
    summary: "First attempt failed.",
    status: "failed",
  },
  "2026-06-27T07:00:00.000Z"
);
const exhausted = await runExecutionRepair({
  plan: approvedPlan,
  state: onceRepaired,
  workspaceRoot,
  failureOutput: output,
  maxAttempts: 1,
  readFile,
  applyRepair: async () => ({ ok: true, summary: "should not run" }),
});

assert(exhausted.status === "blocked", "max repair attempts are enforced");
assert(exhausted.reason.includes("Maximum repair attempts"), "max attempt reason should be explicit");

const sensitivePlan: PhaseBuildPlan = {
  ...approvedPlan,
  phases: approvedPlan.phases.map((phase) =>
    phase.id === approvedPlan.currentPhaseId
      ? {
          ...phase,
          tasks: phase.tasks.map((task, index) =>
            index === 0 ? { ...task, title: "Repair API key configuration" } : task
          ),
        }
      : phase
  ),
};
const sensitive = await runExecutionRepair({
  plan: sensitivePlan,
  state: withFailedBuild(baseState, "src/main.tsx(1,1): error TS1005: API_KEY is missing."),
  workspaceRoot,
  failureOutput: "src/main.tsx(1,1): error TS1005: API_KEY is missing.",
  readFile,
  applyRepair: async () => ({ ok: true, summary: "should not run" }),
});

assert(sensitive.status === "needsApproval", "credential/payment/legal/deployment/scope blockers are not repaired automatically");
assert(sensitive.state.phaseStatus === "blocked", "sensitive repair should stay blocked");

const unknown = await runExecutionRepair({
  plan: approvedPlan,
  state: withFailedBuild(baseState, "Unknown build failure without file references."),
  workspaceRoot,
  failureOutput: "Unknown build failure without file references.",
  readFile,
  applyRepair: async () => ({ ok: true, summary: "should not run" }),
});

assert(unknown.status === "unavailable", "unknown failures without safe helper are unavailable");
assert(unknown.state.repairAttempts[0]?.status === "blocked", "unsupported repair should be recorded as blocked");

const stored = storeBuildFailure("npm run build", workspaceRoot, 2, output);
const repairedFile = repairReferencedBuildFailure("src/main.tsx", mainTsx, stored.refs);
assert(
  repairedFile != null && repairedFile.includes("if (requestSummary == null) return;"),
  "manual repair helper remains importable"
);

console.log("execution repair runner regression passed");
