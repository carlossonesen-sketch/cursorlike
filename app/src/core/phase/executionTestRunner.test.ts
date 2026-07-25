import type { BuildCheckRequest, BuildCheckResult } from "../project/buildCheck";
import { detectTestCommand, runApprovedBuildCheck, validateBuildCheckWorkspace } from "../project/buildCheck";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createProjectBlueprintFromDiscoveryIntake } from "../product/projectBlueprint";
import type { PhaseBuildPlan, PhaseExecutionState, ProjectSnapshot } from "../types";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import { createPhaseExecutionState } from "./phaseExecutionState";
import { runExecutionTests } from "./executionTestRunner";

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

function commandResult(
  request: BuildCheckRequest,
  exitCode: number,
  stdout = "",
  stderr = ""
): BuildCheckResult {
  return {
    runId: request.runId,
    command: request.command,
    workingDirectory: request.workspaceRoot,
    startTimestamp: "2026-06-27T06:00:00.000Z",
    endTimestamp: "2026-06-27T06:00:02.000Z",
    durationMs: 2000,
    stdout,
    stderr,
    exitCode,
  };
}

function reader(files: Record<string, string>): (path: string) => Promise<string> {
  return async (path: string): Promise<string> => {
    const value = files[path];
    if (value == null) throw new Error(`Missing file: ${path}`);
    return value;
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\phase-test-runner";
const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-test-runner",
  projectId: "test-runner",
  now: "2026-06-27T00:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-27T01:00:00.000Z");
const approvedPlan = approveCurrentPhase(createPhaseBuildPlan(blueprint, gap, "2026-06-27T02:00:00.000Z"));
const state = createPhaseExecutionState(approvedPlan, "2026-06-27T03:00:00.000Z");

const packageTestReader = reader({
  "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
});
const detectedNpmTest = await detectTestCommand(workspaceRoot, null, null, packageTestReader);
assert(detectedNpmTest === "npm test", "detects npm test from package script");

const flutterTestReader = reader({
  "pubspec.yaml": "name: sample\nflutter:\n  uses-material-design: true\n",
});
const detectedFlutterTest = await detectTestCommand(workspaceRoot, null, null, flutterTestReader);
assert(detectedFlutterTest === "flutter test", "detects Flutter test command");

const snapshot: ProjectSnapshot = {
  detectedTypes: ["Node/TS"],
  recommendedPacks: [],
  enabledPacks: [],
  importantFiles: [],
  detectedCommands: { test: "npm run test" },
};
const detectedSnapshotTest = await detectTestCommand(workspaceRoot, null, snapshot, reader({}));
assert(detectedSnapshotTest === "npm test", "detects test command from project snapshot");

const successRequests: BuildCheckRequest[] = [];
const success = await runExecutionTests({
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: packageTestReader,
  runId: "test-success",
  runTestCommand: async (request) => {
    successRequests.push(request);
    return commandResult(request, 0, "tests passed");
  },
});

assert(success.status === "passed", "successful test run records passing status");
assert(success.state.testStatus.status === "passed", "test status should be passed");
assert(success.state.testStatus.command === "npm test", "test command should be recorded");
assert(success.state.nextRecommendedAction === "Continue to the next task.", "passed tests should recommend continue");
assert(successRequests[0]?.command === "npm test", "runner should execute detected test command");

const failure = await runExecutionTests({
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: packageTestReader,
  runId: "test-failure",
  runTestCommand: async (request) =>
    commandResult(request, 1, "", "src/app.test.ts: expected true to equal false"),
});

assert(failure.status === "failed", "failed test run records failure");
assert(failure.state.testStatus.status === "failed", "test status should be failed");
assert(failure.state.phaseStatus === "blocked", "failed tests should block the current task");
assert(failure.state.nextRecommendedAction === "Repair test failure before continuing.", "failed tests should recommend repair");

let unapprovedRan = false;
const unapproved = await runExecutionTests({
  plan: unapproveCurrentPhase(approvedPlan),
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: packageTestReader,
  runTestCommand: async (request) => {
    unapprovedRan = true;
    return commandResult(request, 0);
  },
});

assert(unapproved.status === "needsApproval", "runner refuses to run when phase is not approved/active");
assert(!unapprovedRan, "unapproved phase should not run tests");

const noTests = await runExecutionTests({
  plan: approvedPlan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: reader({
    "package.json": JSON.stringify({ scripts: { test: "echo \"Error: no test specified\" && exit 1" } }),
  }),
  runTestCommand: async (request) => commandResult(request, 0),
});

assert(noTests.status === "notAvailable", "no test command should be recorded as unavailable");
assert(noTests.state.testStatus.status === "notRun", "unavailable tests should not fail the phase");
assert(noTests.state.phaseStatus === "active", "unavailable tests should not block the phase");

let driftRan = false;
const drift = await runExecutionTests({
  plan: approvedPlan,
  state,
  workspaceRoot: "D:\\dev\\nf-projects\\wrong-project",
  activeWorkspacePath: workspaceRoot,
  cwdSource: "test drift",
  readFile: packageTestReader,
  runTestCommand: async (request) => {
    driftRan = true;
    return commandResult(request, 0);
  },
});

assert(drift.status === "blocked", "runner uses existing command path safety guard");
assert(drift.reason.includes("active project path drift"), "path drift should be reported");
assert(!driftRan, "path drift should not run tests");

const alreadyRunning: PhaseExecutionState = {
  ...state,
  testStatus: { status: "running", command: "npm test" },
};
const blockedRunning = await runExecutionTests({
  plan: approvedPlan,
  state: alreadyRunning,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile: packageTestReader,
  runTestCommand: async (request) => commandResult(request, 0),
});

assert(blockedRunning.status === "blocked", "runner avoids duplicate running test loops");
assert(typeof runApprovedBuildCheck === "function", "manual command runner remains importable");
assert(typeof validateBuildCheckWorkspace === "function", "manual path guard remains importable");

console.log("execution test runner regression passed");
