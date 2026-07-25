import type { ProjectBlueprint } from "../types";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import {
  attachPhaseBuildPlan,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createPhaseBuildPlan } from "../phase/phaseBuildPlan";
import { createArchitectureReviewReport, findCircularDependencies } from "./architectureReview";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function createWebsitePlatformBlueprint(): ProjectBlueprint {
  const intake = createDiscoveryIntake(
    "Build the NF Web Platform website builder with industry templates, layout templates, page/section builder, media library, forms, analytics, publishing, hosting, and lead generation."
  );
  const blueprint = createProjectBlueprintFromDiscoveryIntake(intake, {
    id: "blueprint-architecture-review",
    projectId: "nf-web-platform",
    name: "NF Web Platform",
    now: "2026-06-28T19:00:00.000Z",
  });
  const gap = createGapAnalysis(blueprint, "2026-06-28T19:01:00.000Z");
  return attachPhaseBuildPlan(blueprint, createPhaseBuildPlan(blueprint, gap, "2026-06-28T19:02:00.000Z"));
}

const blueprint = createWebsitePlatformBlueprint();
const review = createArchitectureReviewReport(blueprint, "2026-06-28T19:03:00.000Z");
assert(review.blueprintId === blueprint.id, "Architecture Review should be tied to the Blueprint");
assert(review.architectureScore > 0 && review.architectureScore <= 100, "Architecture score should be bounded");
assert(review.status !== "blocked", "Valid Website Platform planning architecture should not be blocked");
assert(review.findings.some((finding) => finding.id === "architecture-overall-shape"), "Architecture Review should include overall architecture finding");
assert(review.findings.some((finding) => finding.id === "reuse-existing-nf-engine"), "Architecture Review should recommend reusing existing NF modules");
assert(review.findings.some((finding) => finding.id === "future-ai-integration-deferred"), "Architecture Review should verify future AI is deferred");
assert(review.updatedDependencyGraph.length > 0, "Architecture Review should preserve an updated dependency graph");
assert(review.requiredFounderApprovals.length > 0, "Architecture Review should surface founder approvals for warnings/critical decisions");

const phases = blueprint.phaseBuildPlan.data?.phases.map((phase) => phase.id) ?? [];
assert(
  phases.indexOf("architecture-review") === phases.indexOf("discovery") + 1,
  "Architecture Review phase should be inserted between Discovery and Foundation"
);
assert(
  phases.indexOf("foundation") === phases.indexOf("architecture-review") + 1,
  "Foundation should come after Architecture Review"
);
const architecturePhase = blueprint.phaseBuildPlan.data?.phases.find((phase) => phase.id === "architecture-review");
assert(Boolean(architecturePhase), "Phase Build Plan should include Architecture Review phase");
assert(Boolean(architecturePhase?.qualityGates.some((gate) => gate.id === "architecture-review-no-critical-blockers")), "Architecture phase should include critical blocker quality gate");

const circular = findCircularDependencies([
  { id: "a", label: "A", dependsOn: ["b"], reason: "test" },
  { id: "b", label: "B", dependsOn: ["c"], reason: "test" },
  { id: "c", label: "C", dependsOn: ["a"], reason: "test" },
]);
assert(circular.length === 1, "Circular dependency detection should find a cycle");
assert(circular[0].join("->").includes("a"), "Circular dependency should include the involved nodes");

const brokenBlueprint: ProjectBlueprint = {
  ...blueprint,
  specializedPlannerOutput: {
    ...blueprint.specializedPlannerOutput,
    data: blueprint.specializedPlannerOutput.data
      ? {
          ...blueprint.specializedPlannerOutput.data,
          dependencyGraph: [
            { id: "website-project-model", label: "Website project model", dependsOn: ["page-section-schema"], reason: "bad cycle" },
            { id: "page-section-schema", label: "Page section schema", dependsOn: ["website-project-model"], reason: "bad cycle" },
          ],
        }
      : null,
  },
};
const blockedReview = createArchitectureReviewReport(brokenBlueprint, "2026-06-28T19:04:00.000Z");
assert(blockedReview.status === "blocked", "Critical circular dependencies should block Architecture Review");
assert(!blockedReview.shouldContinueToFoundation, "Foundation should not continue after critical architecture failure");
assert(
  blockedReview.findings.some((finding) => finding.id === "circular-dependency" && finding.severity === "critical"),
  "Circular dependency should be reported as a critical finding"
);

console.log("architecture review regression passed");
