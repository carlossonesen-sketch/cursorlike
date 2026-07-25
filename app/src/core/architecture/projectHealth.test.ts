import { createDiscoveryIntake } from "../product/discoveryIntake";
import {
  attachArchitectureReview,
  attachPhaseBuildPlan,
  attachPhaseExecutionState,
  attachProjectHealthReport,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createPhaseBuildPlan } from "../phase/phaseBuildPlan";
import { createPhaseExecutionState, markPhaseTaskBlocked, recordPhaseCheckStatus, recordRepairAttempt } from "../phase/phaseExecutionState";
import { createArchitectureReviewReport } from "./architectureReview";
import { createProjectHealthReport } from "./projectHealth";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const intake = createDiscoveryIntake(
  "Build the NF Web Platform website builder with industry templates, layout templates, page/section builder, media library, forms, analytics, publishing, hosting, and lead generation."
);
const blueprint = createProjectBlueprintFromDiscoveryIntake(intake, {
  id: "blueprint-project-health",
  projectId: "nf-web-platform",
  name: "NF Web Platform",
  now: "2026-06-28T20:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-28T20:01:00.000Z");
const plan = createPhaseBuildPlan(blueprint, gap, "2026-06-28T20:02:00.000Z");
const state = createPhaseExecutionState(plan, "2026-06-28T20:03:00.000Z");
const blueprintWithState = attachPhaseExecutionState(
  attachPhaseBuildPlan(blueprint, plan, "2026-06-28T20:04:00.000Z"),
  state,
  "2026-06-28T20:05:00.000Z"
);
const architectureReview = createArchitectureReviewReport(blueprintWithState, "2026-06-28T20:06:00.000Z");
const blueprintWithReview = attachArchitectureReview(blueprintWithState, architectureReview, "2026-06-28T20:07:00.000Z");
const health = createProjectHealthReport({
  blueprint: blueprintWithReview,
  architectureReview,
  now: "2026-06-28T20:08:00.000Z",
});

assert(health.blueprintId === blueprint.id, "Project Health should be tied to the Blueprint");
assert(health.overallScore > 0 && health.overallScore <= 100, "Overall health score should be bounded");
assert(health.categories.some((item) => item.category === "Planning"), "Health should include Planning category");
assert(health.categories.some((item) => item.category === "Architecture"), "Health should include Architecture category");
assert(health.categories.some((item) => item.category === "Dependencies"), "Health should include Dependencies category");
assert(health.categories.some((item) => item.category === "Testing"), "Health should include Testing category");
assert(health.categories.some((item) => item.category === "Security"), "Health should include Security category");
assert(health.categories.some((item) => item.category === "Autonomy Readiness"), "Health should include Autonomy Readiness category");
assert(health.categories.some((item) => item.category === "Overall Project Health"), "Health should include Overall Project Health category");
assert(health.topRisks.length > 0, "Health should provide top risks");
assert(health.topStrengths.length > 0, "Health should provide top strengths");
assert(health.nextRecommendation.length > 0, "Health should provide next recommendation");
assert(health.history.length === 1, "Health should record history");

const passedState = recordPhaseCheckStatus(
  recordPhaseCheckStatus(
    recordPhaseCheckStatus(state, "build", "passed", { summary: "Build passed." }),
    "test",
    "passed",
    { summary: "Tests passed." }
  ),
  "check",
  "passed",
  { summary: "Quality checks passed." }
);
const passedHealth = createProjectHealthReport({
  blueprint: attachArchitectureReview(
    attachPhaseExecutionState(attachPhaseBuildPlan(blueprint, plan), passedState),
    architectureReview
  ),
  architectureReview,
  previousHealth: health,
  now: "2026-06-28T20:09:00.000Z",
});
const passedTesting = passedHealth.categories.find((item) => item.category === "Testing");
assert(passedTesting?.score !== undefined && passedTesting.score >= 70, "Passing checks should improve Testing health");
assert(passedHealth.history.length === 2, "Health update should append history");

const blockedState = markPhaseTaskBlocked(
  recordRepairAttempt(
    recordPhaseCheckStatus(state, "build", "failed", { summary: "Build failed." }),
    {
      taskId: state.currentTaskId ?? "unknown",
      summary: "Repair failed.",
      status: "failed",
    }
  ),
  state.currentTaskId,
  "Architecture blocker"
);
const blockedHealth = createProjectHealthReport({
  blueprint: attachArchitectureReview(
    attachPhaseExecutionState(attachPhaseBuildPlan(blueprint, plan), blockedState),
    architectureReview
  ),
  architectureReview,
  previousHealth: passedHealth,
  now: "2026-06-28T20:10:00.000Z",
});
const risk = blockedHealth.categories.find((item) => item.category === "Risk");
const testing = blockedHealth.categories.find((item) => item.category === "Testing");
assert(risk?.status === "Critical", "Blocked task should make Risk critical");
assert(testing?.status === "Critical" || testing?.status === "Needs Attention", "Failed checks should lower Testing health");
assert(blockedHealth.topRisks.some((item) => item.includes("Risk")), "Blocked health should surface risk");
assert(
  blockedHealth.categories.find((item) => item.category === "Overall Project Health")?.trend === "declining",
  "Health trend should decline after blockers/failures"
);

const blueprintWithHealth = attachProjectHealthReport(blueprintWithReview, health, "2026-06-28T20:11:00.000Z");
assert(blueprintWithHealth.projectHealth.data?.overallScore === health.overallScore, "Project Health should attach to Blueprint");
assert(blueprintWithHealth.buildHistory.data.some((entry) => entry.source === "ProjectHealth"), "Project Health attach should update build history");

console.log("project health regression passed");
