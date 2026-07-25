import { createDiscoveryIntake } from "./discoveryIntake";
import {
  applyDiscoveryIntakeDefaultsToBlueprint,
  attachFrontEndGenerationIntent,
  createProjectBlueprintFromDiscoveryIntake,
  getProjectBlueprintConfidence,
  isValidProjectBlueprint,
} from "./projectBlueprint";
import {
  createMemoryProjectBlueprintStorage,
  loadProjectBlueprint,
  saveProjectBlueprint,
} from "./projectBlueprintStore";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const intake = createDiscoveryIntake("Build me a budgeting app");
const blueprint = createProjectBlueprintFromDiscoveryIntake(intake, {
  id: "blueprint-budgeting-app",
  projectId: "budgeting-app",
  name: "Budgeting App",
  slug: "budgeting-app",
  now: "2026-06-27T00:00:00.000Z",
});

assert(isValidProjectBlueprint(blueprint), "Discovery Intake should create a valid Project Blueprint");
assert(blueprint.schemaVersion === 1, "Blueprint should use schema version 1");
assert(blueprint.identity.projectId === "budgeting-app", "Blueprint should keep project identity");
assert(blueprint.identity.source === "newProject", "Blueprint should support new projects");
assert(blueprint.discoveryIntake.data === intake, "Blueprint should keep Discovery Intake as a section");
assert(blueprint.projectClassification.status === "draft", "Blueprint should store project classification before Product Brief");
assert(
  blueprint.projectClassification.data?.primaryClassification === "Generic Software App",
  "Blueprint should carry primary project classification"
);
assert(
  blueprint.projectClassification.data?.requiredPlanner === "generalSoftwarePlanner",
  "Blueprint should carry required planner routing"
);
assert(blueprint.productBrief.data?.productType === "budgeting app", "Product Brief should live inside Blueprint");
assert(blueprint.productBrief.data?.platform === "web app", "Product Brief should preserve platform default");
assert(
  blueprint.productBrief.data?.mvpFeatures.join(", ") === "income, expenses, categories, dashboard",
  "Product Brief should preserve inferred MVP features"
);
assert(blueprint.currentProductInventory.status === "empty", "Existing-product inventory should have a future slot");
assert(blueprint.preservationRules.status === "empty", "Preservation rules should have a future slot");
assert(blueprint.gapAnalysis.status === "empty", "Gap Analysis should have a future slot");
assert(blueprint.phaseBuildPlan.status === "empty", "Phase Build Plan should have a future slot");
assert(blueprint.phaseExecutionState.status === "empty", "Phase Execution State should have a future slot");
assert(blueprint.qualityState.status === "empty", "Quality State should have a future slot");
assert(blueprint.frontEndGenerationIntent.status === "draft", "Front-end generation intent should be connected to Blueprint");
assert(
  blueprint.frontEndGenerationIntent.data?.appType === "budgeting app",
  "Front-end generation intent should preserve app type"
);
assert(
  blueprint.frontEndGenerationIntent.data?.targetPlatform === "web app",
  "Front-end generation intent should preserve target platform"
);
assert(
  blueprint.frontEndGenerationIntent.data?.pagesOrScreens.includes("Home") === true,
  "Front-end generation intent should include pages/screens"
);
assert(
  blueprint.frontEndGenerationIntent.data?.routes.some((route) => route.path === "/expenses") === true,
  "Front-end generation intent should include route/navigation intent"
);
assert(
  blueprint.frontEndGenerationIntent.data?.components.some((component) => component.name === "AppShell") === true,
  "Front-end generation intent should include component intent"
);
assert(
  blueprint.frontEndGenerationIntent.data?.layoutStylePreferences.some((item) => item.includes("Founder-first")) === true,
  "Front-end generation intent should include layout/style preferences"
);
assert(
  blueprint.frontEndGenerationIntent.data?.userFlows.some((flow) => flow.includes("income")) === true,
  "Front-end generation intent should include user flows"
);
assert(
  blueprint.frontEndGenerationIntent.data?.responsiveNeeds.some((need) => need.includes("responsive web app")) === true,
  "Front-end generation intent should include responsive needs"
);
assert(
  blueprint.frontEndGenerationIntent.data?.interactionStates.some((state) => state.states.includes("loading")) === true,
  "Front-end generation intent should include interaction states"
);
assert(
  blueprint.frontEndGenerationIntent.data?.validationNeeds.some((check) => check.id === "frontend-main-flow-navigable") === true,
  "Front-end generation intent should include validation needs"
);
assert(
  blueprint.frontEndGenerationIntent.data?.developerNotes.some((note) => note.includes("separate from backend")) === true,
  "Front-end generation intent should keep front-end separate from backend/business logic"
);
assert(blueprint.founderDecisions.data.length > 0, "Blueprint should carry later founder decisions");
assert(blueprint.assumptions.data.length > 0, "Blueprint should carry assumptions");
assert(getProjectBlueprintConfidence(blueprint) !== "low", "Blueprint confidence should not be low");
assert(blueprint.discoveryIntake.data?.userRequest === "Build me a budgeting app", "Blueprint should store user request");
assert(
  blueprint.discoveryIntake.data?.inferredAnswers.some((answer) => answer.key === "productType" && answer.source === "inferred") === true,
  "Blueprint should store inferred answers with source"
);
assert(
  blueprint.discoveryIntake.data?.recommendedDefaults.some((item) => item.key === "launchTarget") === true,
  "Blueprint should store recommended defaults"
);
assert(
  blueprint.discoveryIntake.data?.unansweredQuestions.some((question) => question.key === "audience" && !question.blocksBuild) === true,
  "Blueprint should store unanswered non-blocking questions for later confirmation"
);

const confirmedBlueprint = applyDiscoveryIntakeDefaultsToBlueprint(blueprint, intake, "2026-06-27T01:00:00.000Z");
const confirmedAnswers = confirmedBlueprint.discoveryIntake.data?.userConfirmedAnswers ?? [];
const founderDecisions = confirmedBlueprint.founderDecisions.data;

assert(
  confirmedAnswers.some((answer) => answer.key === "productType" && answer.value === "budgeting app" && answer.source === "inferred"),
  "Continuing with defaults should preserve inferred answer source"
);
assert(
  confirmedAnswers.some((answer) => answer.key === "platform" && answer.value === "web app" && answer.source === "default"),
  "Continuing with defaults should preserve default answer source"
);
assert(
  confirmedAnswers.some((answer) => answer.key === "sync" && answer.value === "later" && answer.source === "default"),
  "Continuing with defaults should convert skipped defaults into confirmed/defaulted answers"
);
assert(
  founderDecisions.some(
    (decision) =>
      decision.id === "intake-answer-sync" &&
      decision.status === "approved" &&
      decision.source === "default" &&
      decision.value === "later"
  ),
  "Blueprint decisions should include approved defaulted intake answers"
);
assert(
  founderDecisions.some(
    (decision) =>
      decision.id === "intake-answer-productType" &&
      decision.status === "approved" &&
      decision.source === "inferred" &&
      decision.value === "budgeting app"
  ),
  "Blueprint decisions should include approved inferred intake answers"
);
assert(
  founderDecisions.some((decision) => decision.status === "pending" && decision.text.includes("sync across devices")),
  "Unanswered non-blocking questions should remain available for later confirmation"
);
assert(
  confirmedBlueprint.discoveryIntake.data?.unansweredQuestions.some((question) => question.key === "accountsTiming") === true,
  "Confirmed Blueprint should keep unanswered questions in Discovery Intake"
);
assert(
  confirmedBlueprint.buildHistory.data.some((entry) => entry.summary.includes("answers and defaults confirmed")),
  "Confirmed Blueprint should record the intake continuation in build history"
);

const customFrontEndIntent = {
  ...blueprint.frontEndGenerationIntent.data!,
  founderSummary: "Founder Mode summary of the planned front end.",
  pagesOrScreens: ["Dashboard", "Settings"],
  developerNotes: ["Developer Mode can inspect raw route, component, and validation intent."],
};
const blueprintWithFrontEndIntent = attachFrontEndGenerationIntent(
  blueprint,
  customFrontEndIntent,
  "2026-06-27T02:00:00.000Z"
);

assert(
  blueprintWithFrontEndIntent.frontEndGenerationIntent.data?.founderSummary === "Founder Mode summary of the planned front end.",
  "Attached front-end intent should support Founder Mode summaries"
);
assert(
  blueprintWithFrontEndIntent.frontEndGenerationIntent.data?.developerNotes[0]?.includes("raw route") === true,
  "Attached front-end intent should support Developer Mode raw details"
);
assert(
  blueprintWithFrontEndIntent.buildHistory.data.some((entry) => entry.source === "FrontEndGenerationIntent"),
  "Attaching front-end intent should record Blueprint build history"
);

const importedBlueprint = createProjectBlueprintFromDiscoveryIntake(intake, {
  id: "blueprint-imported-budgeting-app",
  projectId: "imported-budgeting-app",
  source: "existingProject",
  path: "D:\\dev\\nf-projects\\budgeting-app",
  now: "2026-06-27T00:00:00.000Z",
});

assert(importedBlueprint.identity.source === "existingProject", "Blueprint should support existing projects");
assert(
  importedBlueprint.identity.path === "D:\\dev\\nf-projects\\budgeting-app",
  "Blueprint should preserve existing project path when provided"
);

const storage = createMemoryProjectBlueprintStorage();
saveProjectBlueprint(blueprint, storage);
const loaded = loadProjectBlueprint(storage);

assert(loaded?.id === blueprint.id, "Blueprint store should load the saved Blueprint");
assert(
  loaded?.productBrief.data?.productType === "budgeting app",
  "Blueprint store should preserve Product Brief data"
);

const websitePlatformBlueprint = createProjectBlueprintFromDiscoveryIntake(
  createDiscoveryIntake("Build a website platform that creates industry templates, layout templates, pages, sections, SEO, analytics, publishing, hosting, domains, and a media library."),
  {
    id: "blueprint-website-platform",
    projectId: "website-platform",
    now: "2026-06-27T03:00:00.000Z",
  }
);
assert(
  websitePlatformBlueprint.projectClassification.data?.primaryClassification === "Website Platform / Website Builder",
  "Website Platform Blueprint should not be treated as a generic software app"
);
assert(
  websitePlatformBlueprint.projectClassification.data?.requiredPlanner === "websitePlatformPlanner",
  "Website Platform Blueprint should route to the specialized planner"
);
assert(
  websitePlatformBlueprint.productBrief.data?.productType === "Website Platform / Website Builder",
  "Product Brief should use classification when intake product type is generic"
);
assert(
  websitePlatformBlueprint.projectClassification.data?.plannerProfile.understands.includes("media library") === true,
  "Website Platform planner profile should travel with the Blueprint"
);

console.log("project blueprint regression passed");
