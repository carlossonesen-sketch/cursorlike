import type { ApplyResult } from "../patch/PatchEngine";
import { PatchEngine, pathsFromPatch } from "../patch/PatchEngine";
import type { PhaseBuildPlan, PhaseExecutionState, PhaseTask } from "../types";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { assessExistingProduct } from "../product/existingProductAssessment";
import { createGapAnalysis } from "../product/gapAnalysis";
import {
  attachExistingProductAssessment,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createPhaseBuildPlan } from "./phaseBuildPlan";
import { createPhaseExecutionState } from "./phaseExecutionState";
import { runSafeExecutionPatch, type ExecutionPatchEngine } from "./executionPatchRunner";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

class FakePatchEngine implements ExecutionPatchEngine {
  public applied = false;

  constructor(
    private previewMap: Map<string, { old: string; new: string }>,
    private applyResult: ApplyResult = {
      applied: [...previewMap.keys()],
      failed: [],
      beforeSnapshots: [],
    }
  ) {}

  validatePatch(patch: string): { valid: boolean; paths: string[]; error?: string } {
    const paths = pathsFromPatch(patch);
    return paths.length > 0 ? { valid: true, paths } : { valid: false, paths, error: "No paths" };
  }

  async preview(): Promise<Map<string, { old: string; new: string }>> {
    return this.previewMap;
  }

  async apply(): Promise<ApplyResult> {
    this.applied = true;
    return this.applyResult;
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

function appendTask(plan: PhaseBuildPlan, phaseId: string, task: PhaseTask): PhaseBuildPlan {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === phaseId ? { ...phase, tasks: [task, ...phase.tasks] } : phase
    ),
    recommendedNextTaskId: task.id,
  };
}

function task(id: string, title: string, rationale: string, constraints: string[] = []): PhaseTask {
  return {
    id,
    title,
    rationale,
    constraints,
    sourceGapKeys: [],
    status: "todo",
  };
}

const safePatch = [
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,1 +1,1 @@",
  "-const message = 'old';",
  "+const message = 'new';",
].join("\n");

const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-patch-runner",
  projectId: "patch-runner",
  now: "2026-06-27T00:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-27T01:00:00.000Z");
const approvedPlan = approveCurrentPhase(createPhaseBuildPlan(blueprint, gap, "2026-06-27T02:00:00.000Z"));
const state = createPhaseExecutionState(approvedPlan, "2026-06-27T03:00:00.000Z");

const safeEngine = new FakePatchEngine(new Map([["src/app.ts", { old: "const message = 'old';", new: "const message = 'new';" }]]));
const safeResult = await runSafeExecutionPatch({
  blueprint,
  plan: approvedPlan,
  state,
  patch: safePatch,
  patchEngine: safeEngine,
  now: "2026-06-27T04:00:00.000Z",
});

assert(safeResult.status === "applied", "safe non-destructive patch can be applied");
assert(safeEngine.applied, "safe patch should call patch engine apply");
assert(safeResult.appliedFiles.includes("src/app.ts"), "applied files should be reported");
assert(
  safeResult.state.completedTaskIds.includes("discovery-confirm-blueprint"),
  "successful patch updates execution state"
);

const destructivePatch = [
  "--- a/src/app.ts",
  "+++ /dev/null",
  "@@ -1,1 +0,0 @@",
  "-const message = 'old';",
].join("\n");
const destructiveEngine = new FakePatchEngine(new Map([["src/app.ts", { old: "const message = 'old';", new: "" }]]));
const destructiveResult = await runSafeExecutionPatch({
  blueprint,
  plan: approvedPlan,
  state,
  patch: destructivePatch,
  patchEngine: destructiveEngine,
  now: "2026-06-27T05:00:00.000Z",
});

assert(destructiveResult.status === "blocked", "unsafe/destructive patch is not auto-applied");
assert(!destructiveEngine.applied, "destructive patch should not call apply");

const sensitivePatch = [
  "--- a/.env.example",
  "+++ b/.env.example",
  "@@ -1,1 +1,1 @@",
  "-API_KEY=",
  "+API_KEY=replace-me",
].join("\n");
const sensitiveEngine = new FakePatchEngine(new Map([[".env.example", { old: "API_KEY=", new: "API_KEY=replace-me" }]]));
const sensitiveResult = await runSafeExecutionPatch({
  blueprint,
  plan: approvedPlan,
  state,
  patch: sensitivePatch,
  patchEngine: sensitiveEngine,
  now: "2026-06-27T06:00:00.000Z",
});

assert(sensitiveResult.status === "needsApproval", "credential/API-key patch is not auto-applied");
assert(!sensitiveEngine.applied, "approval-sensitive patch should not call apply");

const paymentTaskPlan = approveCurrentPhase(
  appendTask(
    approvedPlan,
    "discovery",
    task("discovery-payment", "Configure payment provider", "Payment and billing decision required.")
  )
);
const paymentState: PhaseExecutionState = {
  ...state,
  currentTaskId: "discovery-payment",
};
const paymentEngine = new FakePatchEngine(new Map([["src/payments.ts", { old: "", new: "export {};" }]]));
const paymentResult = await runSafeExecutionPatch({
  blueprint,
  plan: paymentTaskPlan,
  state: paymentState,
  patch: [
    "--- /dev/null",
    "+++ b/src/payments.ts",
    "@@ -0,0 +1,1 @@",
    "+export {};",
  ].join("\n"),
  patchEngine: paymentEngine,
  now: "2026-06-27T07:00:00.000Z",
});

assert(paymentResult.status === "needsApproval", "payment task requires approval");
assert(!paymentEngine.applied, "payment task should not auto-apply");

const existingAssessment = assessExistingProduct({
  projectPath: "D:\\dev\\nf-projects\\existing",
  files: [
    {
      path: "package.json",
      content: JSON.stringify({ dependencies: { react: "^19.0.0" }, devDependencies: { vite: "^7.0.0" } }),
    },
    { path: "src/main.tsx", content: "import { createRoot } from 'react-dom/client';" },
    { path: "src/App.tsx", content: "export function App() { return null; }" },
  ],
});
const existingBlueprint = attachExistingProductAssessment(blueprint, existingAssessment, "2026-06-27T08:00:00.000Z");
const preservationPlan = approveCurrentPhase(
  appendTask(
    approvedPlan,
    "discovery",
    task("discovery-touch-ui", "Touch existing UI", "Small UI update.", [
      "This work may touch existing UI, routes, screens, widgets, or workflows. Preserve current behavior and extend rather than rewrite unless the founder approves a larger change.",
    ])
  )
);
const preservationEngine = new FakePatchEngine(new Map([["src/App.tsx", { old: "old", new: "new" }]]));
const preservationResult = await runSafeExecutionPatch({
  blueprint: existingBlueprint,
  plan: preservationPlan,
  state: { ...state, currentTaskId: "discovery-touch-ui" },
  patch: [
    "--- a/src/App.tsx",
    "+++ b/src/App.tsx",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
  ].join("\n"),
  patchEngine: preservationEngine,
  now: "2026-06-27T09:00:00.000Z",
});

assert(preservationResult.status === "needsApproval", "preservation warning requires approval");
assert(!preservationEngine.applied, "preservation warning should not auto-apply");

const failingEngine = new FakePatchEngine(
  new Map([["src/app.ts", { old: "old", new: "new" }]]),
  {
    applied: [],
    failed: [{ path: "src/app.ts", error: "disk verification failed" }],
    beforeSnapshots: [],
  }
);
const failingResult = await runSafeExecutionPatch({
  blueprint,
  plan: approvedPlan,
  state,
  patch: safePatch,
  patchEngine: failingEngine,
  now: "2026-06-27T10:00:00.000Z",
});

assert(failingResult.status === "failed", "failed patch records failure");
assert(failingResult.state.checkStatus.status === "failed", "failed patch updates execution check status");

assert(typeof PatchEngine === "function", "manual PatchEngine remains importable");
assert(pathsFromPatch(safePatch).includes("src/app.ts"), "manual patch helper remains importable");
assert(safePatch.includes("src/app.ts"), "runner test does not modify unrelated files");

console.log("execution patch runner regression passed");
