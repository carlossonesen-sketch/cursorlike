import { developerModeControlPreferences, founderModeControlPreferences } from "../control/controlLevel";
import { shouldShowBuildControls } from "../control/developerModeTools";
import { runExecutionBuildCheck } from "../phase/executionBuildCheckRunner";
import { createPhaseBuildPlan } from "../phase/phaseBuildPlan";
import { createPhaseExecutionState } from "../phase/phaseExecutionState";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createProjectBlueprintFromDiscoveryIntake } from "../product/projectBlueprint";
import type { BuildCheckRequest, BuildCheckResult } from "./buildCheck";
import {
  detectBuildCheckIntent,
  detectBuildCommand,
  runApprovedBuildCheck,
  summarizeBuildCheck,
  validateBuildCheckWorkspace,
  workspacePathsMatch,
} from "./buildCheck";

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

function resultFor(request: BuildCheckRequest, exitCode: number, stdout = "", stderr = ""): BuildCheckResult {
  return {
    runId: request.runId,
    command: request.command,
    workingDirectory: request.workspaceRoot,
    startTimestamp: "2026-06-28T10:00:00.000Z",
    endTimestamp: "2026-06-28T10:00:03.000Z",
    durationMs: 3000,
    stdout,
    stderr,
    exitCode,
  };
}

function fakeInvokeFor(exitCode: number, stdout = "", stderr = ""): {
  invoke: typeof runApprovedBuildCheck extends (request: BuildCheckRequest, invokeCommand: infer I) => Promise<BuildCheckResult> ? NonNullable<I> : never;
  calls: Array<{ command: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  return {
    invoke: async <T>(command: string, args?: unknown): Promise<T> => {
      const invokeArgs = typeof args === "object" && args != null && !Array.isArray(args)
        ? args as Record<string, unknown>
        : {};
      calls.push({ command, args: invokeArgs });
      assert(command === "workspace_run_approved_command", "approved build check uses the existing Tauri command");
      const request: BuildCheckRequest = {
        runId: String(invokeArgs.runId),
        command: String(invokeArgs.command),
        workspaceRoot: String(invokeArgs.workspaceRoot),
        activeWorkspacePath: String(invokeArgs.workspaceRoot),
        cwdSource: "test invoke",
      };
      return resultFor(request, exitCode, stdout, stderr) as T;
    },
    calls,
  };
}

const workspaceRoot = "D:\\dev\\nf-projects\\build-check-preservation";
const request: BuildCheckRequest = {
  runId: "manual-build-check",
  command: "npm run build",
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
};

assert(detectBuildCheckIntent("run check"), "manual build-check command detection still supports run check");
assert(detectBuildCheckIntent("run build test"), "manual build-check command detection still supports run build test");
assert(detectBuildCheckIntent("check project"), "manual build-check command detection still supports check project");
assert(workspacePathsMatch(workspaceRoot, "D:/dev/nf-projects/build-check-preservation"), "workspace path guard normalizes slashes");
assert(validateBuildCheckWorkspace(request) === null, "workspace/path safety guard allows matching active workspace");

const manualSuccess = fakeInvokeFor(0, "built successfully", "");
const manualResult = await runApprovedBuildCheck(request, manualSuccess.invoke);
assert(manualResult.exitCode === 0, "manual approved build check still works");
assert(manualSuccess.calls.length === 1, "manual approved build check calls the command runner once");
assert(manualSuccess.calls[0]?.args.command === "npm run build", "manual approved build check passes command");
assert(manualSuccess.calls[0]?.args.workspaceRoot === workspaceRoot, "manual approved build check passes workspace root");
assert(summarizeBuildCheck(manualResult).includes("Build check passed."), "manual build summary reports pass");
assert(summarizeBuildCheck(manualResult).includes("stdout:\nbuilt successfully"), "manual build summary includes raw stdout");

let driftError = "";
try {
  await runApprovedBuildCheck(
    {
      ...request,
      workspaceRoot: "D:\\dev\\nf-projects\\other-project",
      activeWorkspacePath: workspaceRoot,
      cwdSource: "drift regression",
    },
    manualSuccess.invoke
  );
} catch (error) {
  driftError = error instanceof Error ? error.message : String(error);
}
assert(driftError.includes("active project path drift"), "manual approved build check keeps workspace/path safety guard");
assert(manualSuccess.calls.length === 1, "path drift is blocked before command execution");

const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-build-check-preservation",
  projectId: "build-check-preservation",
  now: "2026-06-28T09:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-28T09:10:00.000Z");
const plan = approveCurrentPhase(createPhaseBuildPlan(blueprint, gap, "2026-06-28T09:20:00.000Z"));
const state = createPhaseExecutionState(plan, "2026-06-28T09:30:00.000Z");
const readFile = async (path: string): Promise<string> => {
  if (path !== "package.json") {
    throw new Error(`unexpected read: ${path}`);
  }
  return JSON.stringify({ scripts: { build: "vite build" } });
};

const detectedCommand = await detectBuildCommand(workspaceRoot, null, null, readFile);
assert(detectedCommand === "npm run build", "manual build command detection still prefers package build script");

const autonomousSuccessInvoke = fakeInvokeFor(0, "phase build passed", "");
const autonomousSuccess = await runExecutionBuildCheck({
  plan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile,
  runId: "autonomous-build-check",
  runBuildCheck: (buildRequest) => runApprovedBuildCheck(buildRequest, autonomousSuccessInvoke.invoke),
});
assert(autonomousSuccess.status === "passed", "autonomous build-check runner can reuse manual approved build check");
assert(autonomousSuccess.state.buildStatus.status === "passed", "autonomous build-check pass records phase state");

const rawFailure = "src/main.ts(4,10): error TS2304: Cannot find name 'missing'.";
const autonomousFailureInvoke = fakeInvokeFor(2, "", rawFailure);
const autonomousFailure = await runExecutionBuildCheck({
  plan,
  state,
  workspaceRoot,
  activeWorkspacePath: workspaceRoot,
  cwdSource: "active workspace path",
  readFile,
  runId: "autonomous-build-failure",
  runBuildCheck: (buildRequest) => runApprovedBuildCheck(buildRequest, autonomousFailureInvoke.invoke),
});
assert(autonomousFailure.status === "failed", "failed autonomous build check records failed status");
assert(autonomousFailure.result?.stderr === rawFailure, "failed checks keep raw stderr available");
assert(
  autonomousFailure.state.buildStatus.summary?.includes(rawFailure) === true,
  "failed checks record raw error details in execution state for Developer Mode"
);
assert(
  summarizeBuildCheck(autonomousFailure.result!).includes(rawFailure),
  "failed build summary does not hide raw errors"
);

let autonomousDriftRan = false;
const autonomousDrift = await runExecutionBuildCheck({
  plan,
  state,
  workspaceRoot: "D:\\dev\\nf-projects\\wrong-project",
  activeWorkspacePath: workspaceRoot,
  cwdSource: "drift regression",
  readFile,
  runBuildCheck: async (buildRequest) => {
    autonomousDriftRan = true;
    return resultFor(buildRequest, 0);
  },
});
assert(autonomousDrift.status === "blocked", "autonomous build-check runner reuses workspace/path safety guard");
assert(!autonomousDriftRan, "autonomous path drift is blocked before command execution");

const developer = developerModeControlPreferences("assisted");
const founder = founderModeControlPreferences("guided");
assert(shouldShowBuildControls({ preferences: developer }), "Developer Mode can still access build controls");
assert(!shouldShowBuildControls({ preferences: founder }), "Founder Mode may hide build controls by default");
assert(typeof runApprovedBuildCheck === "function", "Founder Mode simplification does not delete build command runner");
assert(typeof summarizeBuildCheck === "function", "Founder Mode simplification does not delete raw build summary helper");

console.log("build check preservation regression passed");
