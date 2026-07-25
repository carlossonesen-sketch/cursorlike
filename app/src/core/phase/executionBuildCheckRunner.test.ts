import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import { detectBuildCommand, validateBuildCheckWorkspace } from "../project/buildCheck";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createProjectBlueprintFromDiscoveryIntake } from "../product/projectBlueprint";
import type { PhaseBuildPlan, PhaseExecutionState } from "../types";
import { runExecutionBuildCheck } from "./executionBuildCheckRunner";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import { createPhaseExecutionState } from "./phaseExecutionState";

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

function buildResult(
  request: BuildCheckRequest,
  exitCode: number,
  stdout = "",
  stderr = ""
): BuildCheckResult {
  return {
    runId: request.runId,
    command: request.command,
    workingDirectory: request.workspaceRoot,
    startTimestamp: "2026-06-27T05:00:00.000Z",
    endTimestamp: "2026-06-27T05:00:02.000Z",
    durationMs: 2000,
    stdout,
    stderr,
    exitCode,
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\phase-build-check";
const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-build-check-runner",
  projectId: "build-check-runner",
  now: "2026-06-27T00:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-27T01:00:00.000Z");
const approvedPlan = approveCurrentPhase(createPhaseBuildPlan(blueprint, gap, "2026-06-27T02:00:00.000Z"));
const state = createPhaseExecutionState(approvedPlan, "2026-06-27T03:00:00.000Z");
const readPackageJson = async (path: string): Promise<string> => {
  if (path !== "package.json") throw new Error(`Unexpected read: ${path}`);
  return JSON.stringify({ scripts: { build: "vite build" } });
};

const successfulRequests: BuildCheckRequest[] = [];
const success = await runExecutionBuildCheck({
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: readPackageJson,
  runId: "success-run",
  runBuildCheck: async (request) => {
    successfulRequests.push(request);
    return buildResult(request, 0, "built successfully");
  },
});

assert(success.status === "passed", "successful build check records passing status");
assert(success.state.buildStatus.status === "passed", "build status should be passed");
assert(success.state.buildStatus.command === "npm run build", "detected build command should be recorded");
assert(successfulRequests[0]?.command === "npm run build", "runner should use detected build command");

const failure = await runExecutionBuildCheck({
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: readPackageJson,
  runId: "failed-run",
  runBuildCheck: async (request) =>
    buildResult(request, 2, "", "src/main.ts(1,1): error TS1005: ';' expected."),
});

assert(failure.status === "failed", "failed build check records failure");
assert(failure.state.buildStatus.status === "failed", "build status should be failed");
assert(failure.state.phaseStatus === "blocked", "failed build should block the current task");
assert(
  failure.state.nextRecommendedAction === "Repair build failure before continuing.",
  "failed build should recommend repair"
);

let unapprovedRan = false;
const unapproved = await runExecutionBuildCheck({
  plan: unapproveCurrentPhase(approvedPlan),
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: readPackageJson,
  runBuildCheck: async (request) => {
    unapprovedRan = true;
    return buildResult(request, 0);
  },
});

assert(unapproved.status === "needsApproval", "runner refuses to run when phase is not approved/active");
assert(!unapprovedRan, "unapproved phase should not run build check");

let driftRan = false;
const drift = await runExecutionBuildCheck({
  plan: approvedPlan,
  state,
  workspaceRoot: "D:\\dev\\nf-projects\\wrong-project",
  activeWorkspacePath: workspaceRoot,
  cwdSource: "test drift",
  readFile: readPackageJson,
  runBuildCheck: async (request) => {
    driftRan = true;
    return buildResult(request, 0);
  },
});

assert(drift.status === "blocked", "runner uses existing build-check path safety guard");
assert(drift.reason.includes("active project path drift"), "path drift should be reported");
assert(!driftRan, "path drift should not run build check");

const alreadyRunning: PhaseExecutionState = {
  ...state,
  buildStatus: { status: "running", command: "npm run build" },
};
const blockedRunning = await runExecutionBuildCheck({
  plan: approvedPlan,
  state: alreadyRunning,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: readPackageJson,
  runBuildCheck: async (request) => buildResult(request, 0),
});

assert(blockedRunning.status === "blocked", "runner avoids starting duplicate running build checks");

assert(typeof detectBuildCommand === "function", "manual build-check command detection remains importable");
assert(typeof validateBuildCheckWorkspace === "function", "manual build-check safety guard remains importable");

console.log("execution build check runner regression passed");
