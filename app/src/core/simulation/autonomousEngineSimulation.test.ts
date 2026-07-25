import {
  buildAutonomousEngineGapMarkdown,
  buildChaosSimulationMarkdown,
  createAutonomousEngineGapReport,
  createWebsitePlatformChaosScenarios,
  runWebsitePlatformChaosSimulation,
} from "./autonomousEngineSimulation";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const requiredScenarioIds = [
  "project-misclassification",
  "specialized-planner-unavailable",
  "generic-planner-fallback",
  "missing-api-key",
  "database-unavailable",
  "hosting-unavailable",
  "patch-provider-unavailable",
  "patch-generation-fails",
  "patchengine-rejects-patch",
  "build-fails",
  "tests-fail",
  "validation-check-fails",
  "quality-gate-fails",
  "repair-fails",
  "repair-loop-limit",
  "circular-task-dependency",
  "missing-founder-approval",
  "scope-change-mid-phase",
  "dashboard-sync-fails",
  "progress-persistence-fails",
  "next-task-cannot-be-selected",
  "phase-gate-cannot-pass",
  "ai-provider-timeout",
  "corrupted-project-memory",
  "conflicting-files",
  "disk-write-failure",
  "deployment-export-failure",
];

const scenarios = createWebsitePlatformChaosScenarios();
for (const id of requiredScenarioIds) {
  assert(scenarios.some((scenario) => scenario.id === id), `Missing chaos scenario ${id}`);
}

assert(
  scenarios.every((scenario) => scenario.result === "pass"),
  "All chaos scenarios should safely pass by stopping, blocking, retrying, repairing, or asking the founder"
);
assert(
  scenarios.every((scenario) => scenario.safeStopCondition.length > 0),
  "Every scenario should document a safe-stop condition"
);
assert(
  scenarios.every((scenario) => scenario.dashboardVisibleResult.length > 0),
  "Every scenario should describe dashboard-visible state"
);
assert(
  scenarios.every((scenario) => scenario.founderModeExplanation.length > 0),
  "Every scenario should include Founder Mode wording"
);
assert(
  scenarios.every((scenario) => scenario.developerModeRawDetails.length > 0),
  "Every scenario should include Developer Mode raw details"
);

const chaosReport = runWebsitePlatformChaosSimulation({
  projectName: "NF Web Platform",
  simulatedAt: "2026-06-28",
});
assert(chaosReport.result === "pass", "NF Web Platform chaos simulation should pass the safe-stop gate");
assert(chaosReport.safeToBeginPlanning, "Passing chaos simulation should allow real planning to begin");
assert(chaosReport.confidenceScore >= 80, "Chaos simulation confidence should be high enough for planning");
assert(
  chaosReport.missingCapabilities.includes("Dependency graph cycle detector before phase execution"),
  "Chaos simulation should identify missing dependency-cycle capability"
);

const requiredGapAreas = [
  "project-classification",
  "specialized-planners",
  "blueprint-generation",
  "build-plan-generation",
  "task-dependency-graph",
  "patch-generation-provider-boundary",
  "patchengine",
  "validation-adapters",
  "repair-loop",
  "memory-persistence",
  "dashboard-sync",
  "quality-gates",
  "founder-approval-gates",
  "multi-phase-execution",
  "real-project-smoke-tests",
  "deployment-export-automation",
  "external-service-setup",
  "rollback-versioning",
  "security-review",
  "cost-controls",
  "provider-failure-handling",
  "long-running-run-recovery",
];

const gapReport = createAutonomousEngineGapReport("2026-06-28");
for (const id of requiredGapAreas) {
  assert(gapReport.areas.some((area) => area.id === id), `Missing gap report area ${id}`);
}

assert(gapReport.safeToBeginPlanning, "NF should be safe to begin planning runs");
assert(!gapReport.safeForFullAutonomousBuild, "NF should not be marked safe for full autonomous builds yet");
assert(gapReport.readinessScore > 0 && gapReport.readinessScore < 100, "Readiness score should be bounded");
assert(
  gapReport.topMissingCapabilities.some((item) => item.includes("Patch generation provider boundary")),
  "Gap report should call out patch generation provider boundary"
);
assert(
  gapReport.topMissingCapabilities.some((item) => item.includes("Long-running run recovery")),
  "Gap report should call out long-running run recovery"
);

const chaosMarkdown = buildChaosSimulationMarkdown(chaosReport);
assert(chaosMarkdown.includes("Simulation result: PASS"), "Chaos markdown should include pass/fail result");
assert(chaosMarkdown.includes("Patch provider unavailable"), "Chaos markdown should include scenario details");
assert(chaosMarkdown.includes("Founder Mode explanation"), "Chaos markdown should include Founder Mode wording");
assert(chaosMarkdown.includes("Developer Mode raw details"), "Chaos markdown should include Developer Mode details");

const gapMarkdown = buildAutonomousEngineGapMarkdown(gapReport);
assert(gapMarkdown.includes("Autonomous engine readiness score"), "Gap markdown should include readiness score");
assert(gapMarkdown.includes("Patch generation provider boundary"), "Gap markdown should include patch provider gap");
assert(gapMarkdown.includes("Safe for full autonomous builds: No"), "Gap markdown should avoid overstating autonomy");

console.log("autonomous engine simulation regression passed");
