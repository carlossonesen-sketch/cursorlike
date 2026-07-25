import {
  createMemoryProjectBlueprintStorage,
  loadProjectBlueprint,
  saveProjectBlueprint,
} from "../product/projectBlueprintStore";
import {
  createMenuProjectCreationState,
  createProjectCreationState,
  updateProjectCreationStateFromPrompt,
} from "./projectCreationState";
import {
  createProjectCreationStateFromPrompt,
  routeNewProjectWorkflow,
} from "./newProjectIntent";
import { validateStarterFileGeneration, createPlannerLock, validatePlannerLock } from "./projectCreationWizard";
import {
  generateProjectCreationFilePreview,
  runProjectCreationPlanningPipeline,
} from "./projectCreationPipeline";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const nfWebDeveloperFullSpec = [
  "Project Name: NF Web Developer",
  "Save path: D:\\dev\\nf-projects\\nf-web-developer",
  "Project Type: Web development/website hosting platform",
  "Build an internal website creation, hosting, analytics, and lead-generation platform owned by NF.",
  "Connected to AWS. Domain connection, future domain buying, subdomains, and SSL/certificate status are required planning concerns.",
  "Multiple accounts/users, roles, and tenant/account boundaries are required.",
  "Internal use first, but product-launch/commercial ready.",
  "Required MVP: website projects, industry templates, layout templates, page/section builder, theme system, media library, forms, lead database, analytics, preview, publishing/export, user accounts/settings.",
  "AI Creator placeholder in MVP.",
  "Future AI page generation, future AI copywriting, future AI SEO, future AI image recommendations, future AI chatbot.",
  "Future advanced drag-and-drop editor.",
  "Full cloud deployment automation deferred.",
  "Fully automated domain purchasing deferred.",
  "Do not write code yet. Wait for founder approval before proposing file changes.",
].join("\n");

const menuState = createMenuProjectCreationState();
assert(menuState.projectName === "Untitled Project", "empty menu state may start untitled until founder prompt is provided");
assert(menuState.needsProjectName, "empty menu state should require a project name before planning");

const fromMenu = updateProjectCreationStateFromPrompt(menuState, nfWebDeveloperFullSpec);
assert(fromMenu.projectName === "NF Web Developer", "full NF Web Developer prompt should replace menu Untitled Project");
assert(fromMenu.savePath === "D:\\dev\\nf-projects\\nf-web-developer", "full NF Web Developer prompt should preserve save path");
assert(fromMenu.lockedPlanner === "websitePlatformPlanner", "full NF Web Developer prompt should lock Website Platform planner");

const fromChat = createProjectCreationStateFromPrompt(nfWebDeveloperFullSpec, "prompt");
assert(fromChat.projectName === "NF Web Developer", "chat-created state should extract project name");
assert(fromChat.classification.primaryClassification === "Website Platform / Website Builder", "chat-created state should classify Website Platform");

const storage = createMemoryProjectBlueprintStorage();
const pipeline = runProjectCreationPlanningPipeline(fromMenu, {
  applyDiscoveryDefaults: true,
  persistBlueprint: false,
  now: "2026-06-29T12:00:00.000Z",
});
assert(pipeline.blueprint.gapAnalysis.data !== null, "Blueprint should include Gap Analysis");
assert(pipeline.blueprint.architectureReview.data !== null, "Blueprint should include Architecture Review");
assert(pipeline.blueprint.phaseBuildPlan.data !== null, "Blueprint should include Phase Build Plan");
assert(
  !!pipeline.blueprint.phaseBuildPlan.data?.phases.some((phase) => phase.title === "Architecture Review"),
  "Phase Build Plan should include Architecture Review phase"
);
assert(pipeline.planPreview.mvpDefinition.toLowerCase().includes("website"), "plan preview should describe Website Platform MVP");

saveProjectBlueprint(pipeline.blueprint, storage);
const loaded = loadProjectBlueprint(storage);
assert(loaded?.architectureReview.data !== null, "Blueprint should be persisted for new projects");
assert(loaded?.phaseBuildPlan.data !== null, "persisted Blueprint should retain Phase Build Plan");

const filePreview = generateProjectCreationFilePreview(fromMenu, { ...pipeline.planPreview, status: "approved" }, pipeline.blueprint);
assert(filePreview.targetPath === "D:\\dev\\nf-projects\\nf-web-developer", "file preview should use canonical save path");
assert(
  filePreview.filesToCreate.some((file) => file.path === "docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md"),
  "Website Platform file preview should use specialized foundation plan"
);
assert(
  !filePreview.filesToCreate.some((file) => file.path === "package.json"),
  "Website Platform file preview should not use generic Vite package.json scaffold"
);

const starterValidation = validateStarterFileGeneration({
  state: fromMenu,
  plan: pipeline.planPreview,
  plannerLock: createPlannerLock(fromMenu.classification),
  blueprint: pipeline.blueprint,
});
assert(starterValidation.ok, "specialized Website Platform file plan should pass starter validation");
assert(
  !starterValidation.blockers.some((blocker) => blocker.includes("Generic Vite starter files")),
  "specialized file plan should replace generic Vite starter blockers"
);

const genericFallback = validatePlannerLock({
  lock: { lockedPlanner: "websitePlatformPlanner", classification: "Website Platform / Website Builder", founderApprovedFallback: false },
  downstreamPlanner: "generalSoftwarePlanner",
  downstreamText: "Untitled Project primary workflow generic Vite scaffold",
});
assert(!genericFallback.ok, "real generic fallback should still be rejected for Website Platform");

assert(
  routeNewProjectWorkflow("Create the full master build plan first. Do not write code yet.", fromMenu) === "project_creation",
  "planning prompt with active project creation state should stay in project creation"
);

const explicitNameState = createProjectCreationState({
  founderPrompt: "Project Name: NF Web Developer\nSave path: D:\\dev\\nf-projects\\nf-web-developer",
  source: "prompt",
});
assert(explicitNameState.projectName === "NF Web Developer", "explicit name should survive in canonical state");
assert(explicitNameState.savePath === "D:\\dev\\nf-projects\\nf-web-developer", "explicit save path should survive in canonical state");

console.log("project creation pipeline regression passed");
