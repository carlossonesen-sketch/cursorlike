import { createDiscoveryIntake } from "../discoveryIntake";
import { createGapAnalysis } from "../gapAnalysis";
import { createProjectBlueprintFromDiscoveryIntake } from "../projectBlueprint";
import { createPhaseBuildPlan } from "../../phase/phaseBuildPlan";
import {
  createWebsitePlatformPlannerOutput,
  isWebsitePlatformClassification,
} from "./websitePlatformPlanner";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const idea = [
  "Build the NF Web Platform, an internal website creation, hosting, analytics, and lead-generation platform owned by NF.",
  "It needs website projects, industry templates, layout templates, pages, sections, SEO, forms, leads, analytics, preview, publishing, hosting, domains, media library, and user settings.",
  "AI page generation, AI copywriting, AI SEO, AI image recommendations, AI chatbot, and advanced drag-and-drop editor come later.",
].join(" ");

const intake = createDiscoveryIntake(idea);
const blueprint = createProjectBlueprintFromDiscoveryIntake(intake, {
  id: "blueprint-nf-web-platform",
  projectId: "nf-web-platform",
  name: "NF Web Platform",
  slug: "nf-web-platform",
  now: "2026-06-28T14:00:00.000Z",
});
const classification = blueprint.projectClassification.data;
const plannerOutput = blueprint.specializedPlannerOutput.data;

assert(isWebsitePlatformClassification(classification), "Website Platform classification should be recognized by the planner");
assert(plannerOutput?.planner === "websitePlatformPlanner", "Website Platform planner output should be attached to Blueprint");
assert(blueprint.productBrief.data?.productType === "Website Platform / Website Builder", "Website Platform Product Brief should not be generic");
assert(
  blueprint.productBrief.data?.mvpFeatures.includes("website projects") === true &&
    blueprint.productBrief.data?.mvpFeatures.includes("industry templates") === true &&
    blueprint.productBrief.data?.mvpFeatures.includes("layout templates") === true &&
    blueprint.productBrief.data?.mvpFeatures.includes("forms") === true &&
    blueprint.productBrief.data?.mvpFeatures.includes("lead database") === true &&
    blueprint.productBrief.data?.mvpFeatures.includes("basic analytics") === true &&
    blueprint.productBrief.data?.mvpFeatures.includes("preview") === true &&
    blueprint.productBrief.data?.mvpFeatures.includes("publishing/export design") === true,
  "MVP should include Website Platform-specific features"
);
assert(plannerOutput?.deferredFeatures.includes("AI page generation") === true, "AI page generation should be deferred");
assert(plannerOutput?.deferredFeatures.includes("AI chatbot") === true, "AI chatbot should be deferred");
assert(plannerOutput?.deferredFeatures.includes("advanced drag-and-drop editor") === true, "Advanced editor should be deferred");
assert(
  plannerOutput?.templateSeparationRules?.some((rule) => rule.includes("Industry templates define required pages")) === true,
  "Industry template separation rule should be present"
);
assert(
  plannerOutput?.templateSeparationRules?.some((rule) => rule.includes("Layout templates define visual style")) === true,
  "Layout template separation rule should be present"
);
assert(
  plannerOutput?.templateSeparationRules?.some((rule) => rule.includes("Changing layout must preserve content")) === true,
  "Layout changes should preserve business data"
);

const milestoneTitles = plannerOutput?.milestones.map((milestone) => milestone.title) ?? [];
assert(milestoneTitles.includes("MVP Website Platform"), "Milestones should include MVP Website Platform");
assert(milestoneTitles.includes("AI Feature Integration"), "Milestones should include AI Feature Integration");
assert(milestoneTitles.includes("AI Chatbot"), "Milestones should include AI Chatbot");
assert(milestoneTitles.includes("Advanced Drag-and-Drop Editor"), "Milestones should include Advanced Drag-and-Drop Editor");

const mvpPhaseTasks = plannerOutput?.phaseTasks["mvp-features"] ?? [];
assert(mvpPhaseTasks.length >= 8, "Planner should generate buildable Website Platform MVP phase tasks");
assert(
  mvpPhaseTasks.some((task) => task.title.includes("industry template picker")) &&
    mvpPhaseTasks.some((task) => task.title.includes("layout template picker")) &&
    mvpPhaseTasks.some((task) => task.title.includes("forms and lead database")) &&
    mvpPhaseTasks.some((task) => task.title.includes("basic analytics")) &&
    mvpPhaseTasks.some((task) => task.title.includes("preview")),
  "Phase tasks should be Website Platform-specific"
);

const gates = plannerOutput?.qualityGates["mvp-features"] ?? [];
assert(gates.some((gate) => gate.title.includes("Preview")), "Quality gates should include preview validation");
assert(gates.some((gate) => gate.title.includes("Lead capture")), "Quality gates should include lead capture");
assert(gates.some((gate) => gate.title.includes("Analytics")), "Quality gates should include analytics");
assert(gates.some((gate) => gate.title.includes("Publishing/export")), "Quality gates should include export readiness");
assert(gates.some((gate) => gate.title.includes("Template separation")), "Quality gates should include template preservation");

assert(
  plannerOutput?.successCriteria.some((criterion) => criterion.includes("Roofing website")) === true &&
    plannerOutput.successCriteria.some((criterion) => criterion.includes("HIEN website")) &&
    plannerOutput.successCriteria.some((criterion) => criterion.includes("NF website")),
  "MVP success criteria should include Roofing, HIEN, and NF template-created sites"
);
assert(
  plannerOutput?.founderSummary.includes("AI and advanced drag-and-drop come later") === true,
  "Founder Mode summary should be plain-language and mention deferred AI"
);
assert(
  plannerOutput?.developerDetails.some((detail) => detail.includes("industryTemplates=")) === true &&
    plannerOutput.developerDetails.some((detail) => detail.includes("layoutTemplates=")),
  "Developer Mode should expose raw planner details"
);

const directOutput = createWebsitePlatformPlannerOutput(intake, classification!);
assert(
  directOutput.dependencyGraph.some((dependency) => dependency.id === "industry-template-model" && dependency.dependsOn.includes("website-project-model")),
  "Dependency graph should include industry template dependency"
);
assert(
  directOutput.dependencyGraph.some((dependency) => dependency.id === "layout-template-model" && dependency.dependsOn.includes("website-project-model")),
  "Dependency graph should include layout template dependency"
);

const fullSpecIdea = [
  "Project Name: NF Web Developer",
  "Web development/website hosting platform connected to AWS.",
  "Can create, manage, preview, and prepare websites for hosting.",
  "Future domain buying, domain connection, subdomains, and SSL/certificate status are required planning concerns.",
  "Multiple accounts/users, roles, and tenant/account boundaries are required for commercial launch.",
  "MVP includes industry templates, layout templates, page/section builder, theme system, media library, forms, lead database, analytics, preview, publishing/export, and accounts/settings.",
  "AI Creator placeholder in MVP.",
  "Future AI page generation, AI copywriting, AI SEO, AI image recommendations, AI chatbot, and future advanced drag-and-drop editor.",
  "Full cloud deployment automation deferred. Fully automated domain purchasing deferred.",
].join("\n");
const fullSpecIntake = createDiscoveryIntake(fullSpecIdea);
const fullSpecBlueprint = createProjectBlueprintFromDiscoveryIntake(fullSpecIntake, {
  id: "blueprint-nf-web-developer",
  projectId: "nf-web-developer",
  name: "NF Web Developer",
  slug: "nf-web-developer",
  now: "2026-06-28T15:00:00.000Z",
});
const fullSpecOutput = fullSpecBlueprint.specializedPlannerOutput.data;
assert(fullSpecOutput?.planner === "websitePlatformPlanner", "full spec should use Website Platform planner");
if (!fullSpecOutput) throw new Error("full spec planner output should exist");
assert(fullSpecOutput.fullSpecExtraction?.projectName === "NF Web Developer", "full spec extraction should preserve the project name");
assert(fullSpecOutput.fullSpecExtraction?.awsDomainRequirements.includes("AWS integration") === true, "full spec planner should extract AWS integration");
assert(fullSpecOutput.fullSpecExtraction?.awsDomainRequirements.includes("domain connection") === true, "full spec planner should extract domain connection");
assert(fullSpecOutput.fullSpecExtraction?.awsDomainRequirements.includes("subdomains") === true, "full spec planner should extract subdomains");
assert(fullSpecOutput.fullSpecExtraction?.awsDomainRequirements.includes("SSL/certificate status") === true, "full spec planner should extract SSL/certificate status");
assert(fullSpecOutput.fullSpecExtraction?.aiPlaceholders.includes("AI Creator placeholder") === true, "full spec planner should extract AI Creator placeholder");
assert(fullSpecOutput.deferredFeatures.includes("AI chatbot"), "full spec planner should defer AI chatbot");
assert(fullSpecOutput.deferredFeatures.includes("advanced drag-and-drop editor"), "full spec planner should defer advanced editor");
assert(
  fullSpecOutput.architectureRecommendation.some((item) => item.includes("AWS integration")),
  "full spec planner should route AWS/domain requirements into architecture recommendation"
);
assert(
  fullSpecOutput.developerDetails.some((item) => item.includes("awsDomainRequirements=AWS integration")),
  "Developer Mode details should expose raw AWS/domain extraction"
);

const phasePlan = createPhaseBuildPlan(blueprint, createGapAnalysis(blueprint, "2026-06-28T14:01:00.000Z"));
const phaseMvpTasks = phasePlan.phases.find((phase) => phase.id === "mvp-features")?.tasks ?? [];
const phaseMvpGates = phasePlan.phases.find((phase) => phase.id === "mvp-features")?.qualityGates ?? [];
const testingTasks = phasePlan.phases.find((phase) => phase.id === "testing-stabilization")?.tasks ?? [];
assert(
  phaseMvpTasks.some((task) => task.title === "Build industry template picker") &&
    phaseMvpTasks.some((task) => task.title === "Build layout template picker"),
  "Phase plan should consume Website Platform-specific tasks"
);
assert(
  phaseMvpGates.some((gate) => gate.id === "website-platform-preview-renders") &&
    phaseMvpGates.some((gate) => gate.id === "website-platform-lead-capture") &&
    phaseMvpGates.some((gate) => gate.id === "website-platform-analytics-recorded") &&
    phaseMvpGates.some((gate) => gate.id === "website-platform-export-ready") &&
    phaseMvpGates.some((gate) => gate.id === "website-platform-template-preservation"),
  "Phase plan should consume Website Platform-specific quality gates"
);
assert(
  testingTasks.some((task) => task.title.includes("Roofing website")) &&
    testingTasks.some((task) => task.title.includes("HIEN website")) &&
    testingTasks.some((task) => task.title.includes("NF website")),
  "Testing/Stabilization phase should validate required template-created sites"
);

console.log("website platform planner regression passed");
