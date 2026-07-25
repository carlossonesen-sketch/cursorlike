import { developerModeControlPreferences, founderModeControlPreferences } from "../control/controlLevel";
import { shouldShowPatchControls } from "../control/developerModeTools";
import { runSafeExecutionPatch } from "../phase/executionPatchRunner";
import { createPhaseBuildPlan } from "../phase/phaseBuildPlan";
import { createPhaseExecutionState } from "../phase/phaseExecutionState";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createProjectBlueprintFromDiscoveryIntake } from "../product/projectBlueprint";
import { PatchEngine, pathsFromPatch, type FileSnapshot } from "./PatchEngine";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function safePatch(from = "old", to = "new"): string {
  return [
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    `-const message = '${from}';`,
    `+const message = '${to}';`,
  ].join("\n");
}

function createMemoryPatchEngine(initialFiles: Record<string, string>): {
  engine: PatchEngine;
  files: Map<string, string>;
  writes: string[];
} {
  const files = new Map(Object.entries(initialFiles));
  const writes: string[] = [];
  const workspaceRoot = "D:\\dev\\nf-projects\\patch-preservation";
  const engine = new PatchEngine(
    workspaceRoot,
    async (path) => {
      if (!files.has(path)) {
        throw new Error(`missing file: ${path}`);
      }
      return files.get(path)!;
    },
    async <T>(command: string, args?: unknown): Promise<T> => {
      if (command !== "workspace_write_file") {
        throw new Error(`unexpected command: ${command}`);
      }
      const invokeArgs = typeof args === "object" && args != null && !Array.isArray(args)
        ? args as Record<string, unknown>
        : {};
      const workspaceRootArg = String(invokeArgs.workspaceRoot ?? "");
      const path = String(invokeArgs.path ?? "");
      const content = String(invokeArgs.content ?? "");
      assert(workspaceRootArg === workspaceRoot, "manual patch writes stay inside the active workspace root");
      assert(!path.includes(".."), "manual patch write path should not escape workspace");
      files.set(path, content);
      writes.push(path);
      return undefined as T;
    }
  );
  return { engine, files, writes };
}

function approveCurrentPhase(plan: ReturnType<typeof createPhaseBuildPlan>): ReturnType<typeof createPhaseBuildPlan> {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === plan.currentPhaseId ? { ...phase, status: "approved" as const } : phase
    ),
  };
}

const patch = safePatch();
const manual = createMemoryPatchEngine({ "src/app.ts": "const message = 'old';" });

const validation = manual.engine.validatePatch(patch);
assert(validation.valid, "manual patch validation still works");
assert(validation.paths.includes("src/app.ts"), "manual patch validation returns target paths");
assert(pathsFromPatch(patch).includes("src/app.ts"), "manual patch path helper remains available");

const preview = await manual.engine.preview(patch);
assert(preview.has("src/app.ts"), "patch preview still works");
assert(preview.get("src/app.ts")?.old === "const message = 'old';", "patch preview includes old content");
assert(preview.get("src/app.ts")?.new === "const message = 'new';", "patch preview includes new content");
assert(manual.files.get("src/app.ts") === "const message = 'old';", "preview does not write files");

const applyResult = await manual.engine.apply(patch);
assert(applyResult.failed.length === 0, "manual patch apply still succeeds");
assert(applyResult.applied.includes("src/app.ts"), "manual patch apply reports applied file");
assert(manual.files.get("src/app.ts") === "const message = 'new';", "manual patch apply writes the file");
assert(manual.writes.includes("src/app.ts"), "manual patch apply uses the workspace write path");

const revertResult = await manual.engine.revert(applyResult.beforeSnapshots);
assert(revertResult.failed.length === 0, "manual patch revert still succeeds");
assert(revertResult.applied.includes("src/app.ts"), "manual patch revert reports reverted file");
assert(manual.files.get("src/app.ts") === "const message = 'old';", "manual patch revert restores the snapshot");

const jsonPatch = [
  "--- /dev/null",
  "+++ b/tsconfig.json",
  "@@ -0,0 +1,1 @@",
  "+not json",
].join("\n");
const invalidJson = createMemoryPatchEngine({});
const invalidJsonResult = await invalidJson.engine.apply(jsonPatch);
assert(invalidJsonResult.applied.length === 0, "invalid structured file patch is not applied");
assert(
  invalidJsonResult.failed.some((failure) => failure.path === "tsconfig.json" && failure.error.includes("invalid JSON")),
  "invalid structured file patch reports validation error"
);

const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-patch-preservation",
  projectId: "patch-preservation",
  now: "2026-06-27T00:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-27T01:00:00.000Z");
const plan = approveCurrentPhase(createPhaseBuildPlan(blueprint, gap, "2026-06-27T02:00:00.000Z"));
const state = createPhaseExecutionState(plan, "2026-06-27T03:00:00.000Z");

const autonomous = createMemoryPatchEngine({ "src/app.ts": "const message = 'old';" });
const autonomousResult = await runSafeExecutionPatch({
  blueprint,
  plan,
  state,
  patch,
  patchEngine: autonomous.engine,
  now: "2026-06-27T04:00:00.000Z",
});
assert(autonomousResult.status === "applied", "autonomous safe apply still uses the patch workflow");
assert(autonomous.files.get("src/app.ts") === "const message = 'new';", "autonomous safe apply writes through PatchEngine");
assert(autonomousResult.state.completedTaskIds.length === 1, "autonomous safe apply updates execution state");

const unsafe = createMemoryPatchEngine({ "src/app.ts": "const message = 'old';" });
const unsafeResult = await runSafeExecutionPatch({
  blueprint,
  plan,
  state,
  patch: [
    "--- a/src/app.ts",
    "+++ /dev/null",
    "@@ -1,1 +0,0 @@",
    "-const message = 'old';",
  ].join("\n"),
  patchEngine: unsafe.engine,
  now: "2026-06-27T05:00:00.000Z",
});
assert(unsafeResult.status === "blocked", "unsafe patches still block before auto-apply");
assert(unsafe.files.get("src/app.ts") === "const message = 'old';", "blocked unsafe patch does not write files");

const sensitive = createMemoryPatchEngine({ ".env.example": "API_KEY=" });
const sensitiveResult = await runSafeExecutionPatch({
  blueprint,
  plan,
  state,
  patch: [
    "--- a/.env.example",
    "+++ b/.env.example",
    "@@ -1,1 +1,1 @@",
    "-API_KEY=",
    "+API_KEY=replace-me",
  ].join("\n"),
  patchEngine: sensitive.engine,
  now: "2026-06-27T06:00:00.000Z",
});
assert(sensitiveResult.status === "needsApproval", "sensitive patches still require approval");
assert(sensitive.files.get(".env.example") === "API_KEY=", "approval-required patch does not write files");

const developer = developerModeControlPreferences("assisted");
const founder = founderModeControlPreferences("guided");
assert(shouldShowPatchControls({ preferences: developer }), "Developer Mode can still access patch controls");
assert(!shouldShowPatchControls({ preferences: founder }), "Founder Mode may hide patch controls by default");
assert(typeof PatchEngine === "function", "Founder Mode simplification does not delete PatchEngine");

const manualSnapshots: FileSnapshot[] = applyResult.beforeSnapshots;
assert(manualSnapshots.length === 1, "manual snapshots remain available for revert workflows");

console.log("patch workflow preservation regression passed");
