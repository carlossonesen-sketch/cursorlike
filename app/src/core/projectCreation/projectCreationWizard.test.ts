import { createDiscoveryIntake } from "../product/discoveryIntake";
import { extractFullProjectSpec } from "../product/fullSpecExtraction";
import { classifyProjectRequest } from "../product/projectClassification";
import {
  createNewProjectDraftFromPrompt,
  generateFounderSpecificationPlan,
  generateProjectCreationErrorResponse,
  routeNewProjectWorkflow,
  updateNewProjectDraftFromPrompt,
} from "./newProjectIntent";
import {
  createDefaultProjectPath,
  createPlannerLock,
  createProjectCreationWizardState,
  evaluateProjectWorkspaceTarget,
  generateProjectCreationPlanPreview,
  inferCommercialProductSettings,
  validatePlannerLock,
  validateStarterFileGeneration,
} from "./projectCreationWizard";
import { createProjectCreationState } from "./projectCreationState";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const engineRepoPath = "D:\\dev\\dev\\DevAssistantCursorLite";
const nfWebDeveloperText = [
  "Project Name: NF Web Developer",
  "Build a website creation platform for a product launch.",
  "It needs website projects, industry templates, layout templates, media library, forms, leads, analytics, preview, publishing, hosting, and domains.",
  "This is for multiple users, customers, clients, and accounts now.",
].join("\n");

const nfWebDeveloperFullSpec = [
  "Project Name: NF Web Developer",
  "Project Type: Web development/website hosting platform",
  "Purpose: Build an internal website creation, hosting, analytics, and lead-generation platform owned by NF.",
  "It must be connected to AWS and can create, manage, preview, and prepare websites for hosting.",
  "Future domain buying is needed later. Domain connection, subdomains, and SSL/certificate status should be planned.",
  "The product needs multiple accounts/users, roles, and tenant/account boundaries.",
  "It should be easy enough for non-technical users.",
  "Internal use first, but product-launch/commercial ready.",
  "Required MVP: industry templates, layout templates, page/section builder, theme system, media library, forms, lead database, analytics, preview, publishing/export, user accounts/settings.",
  "AI Creator placeholder only in MVP.",
  "Future AI page generation, future AI copywriting, future AI SEO, future AI image recommendations, future AI chatbot.",
  "Future advanced drag-and-drop editor.",
  "Full cloud deployment automation deferred.",
  "Fully automated domain purchasing deferred.",
].join("\n");

const bulletedIdentitySpec = [
  "- Project name: NF Web Developer",
  "- Save path: D:\\dev\\nf-projects\\nf-web-developer",
  "Project Type: Web development/website hosting platform",
  "Create the full master build plan first. Do not write code yet.",
  "Industry templates, layout templates, forms, leads, analytics, preview, publishing/export, AWS, domains, and multiple users are required.",
].join("\n");

const dashSeparatedIdentitySpec = [
  "Project name - NF Web Developer",
  "Save path - D:\\dev\\nf-projects\\nf-web-developer",
  "Website platform with industry templates, layout templates, AWS, domains, accounts, leads, analytics, and publishing/export.",
].join("\n");

assert(
  createDefaultProjectPath("NF Web Developer") === "D:\\dev\\nf-projects\\nf-web-developer",
  "NF Web Developer should slug to the safe default project path"
);

const readyWizard = createProjectCreationWizardState({
  projectName: "NF Web Developer",
  founderText: nfWebDeveloperText,
  engineRepoPath,
  existingEntries: [],
});
assert(readyWizard.safeSavePath === "D:\\dev\\nf-projects\\nf-web-developer", "wizard should use slugged default path");
assert(readyWizard.workspace.canCreateFiles, "empty target should be ready for creation");
assert(readyWizard.classification.primaryClassification === "Website Platform / Website Builder", "wizard should classify Website Platform");
assert(readyWizard.plannerLock.lockedPlanner === "websitePlatformPlanner", "wizard should lock Website Platform planner");
assert(readyWizard.launchType === "commercialSaas" || readyWizard.launchType === "productLaunch", "commercial launch should be detected");
assert(readyWizard.users === "multiUser", "commercial multi-user project should infer multi-user users");
assert(readyWizard.accountsTiming === "now", "commercial product should require accounts now");
assert(readyWizard.commercialInference.inferredFeatures.includes("roles/permissions"), "roles/permissions should be inferred");
assert(
  readyWizard.commercialInference.inferredFeatures.includes("tenant/account boundaries"),
  "tenant/account boundaries should be inferred"
);

const bulletedDraft = createNewProjectDraftFromPrompt(bulletedIdentitySpec, "prompt");
assert(bulletedDraft.projectName === "NF Web Developer", "bulleted project name should be extracted");
assert(
  bulletedDraft.defaultPath === "D:\\dev\\nf-projects\\nf-web-developer",
  "bulleted save path should be extracted and preserved"
);

const dashDraft = createNewProjectDraftFromPrompt(dashSeparatedIdentitySpec, "prompt");
assert(dashDraft.projectName === "NF Web Developer", "dash-separated project name should be extracted");
assert(
  dashDraft.defaultPath === "D:\\dev\\nf-projects\\nf-web-developer",
  "dash-separated save path should be extracted and preserved"
);

const menuDraft = createNewProjectDraftFromPrompt("", "menu");
assert(menuDraft.projectName === "Untitled Project", "menu draft starts as Untitled Project");
assert(menuDraft.defaultPath === "D:\\dev\\nf-projects\\untitled-project", "menu draft starts with default untitled path");
const mergedDraft = updateNewProjectDraftFromPrompt(menuDraft, bulletedIdentitySpec);
assert(mergedDraft.projectName === "NF Web Developer", "full spec identity should replace menu-created Untitled Project");
assert(
  mergedDraft.defaultPath === "D:\\dev\\nf-projects\\nf-web-developer",
  "full spec save path should replace menu-created untitled path"
);

const mergedPlanningResponse = generateFounderSpecificationPlan(mergedDraft, bulletedIdentitySpec);
assert(mergedPlanningResponse.includes("Planning Mode: Website Platform Planner"), "founder-spec route should use extracted identity before planner lock");
assert(mergedPlanningResponse.includes("NF Web Developer is a Website Platform"), "planning response should use extracted project name");
assert(!mergedPlanningResponse.includes("Untitled Project"), "planning response should not retain stale Untitled Project state");
assert(mergedPlanningResponse.includes("savePath=D:\\dev\\nf-projects\\nf-web-developer"), "planning response should use extracted save path");

const blockedExisting = evaluateProjectWorkspaceTarget({
  projectName: "NF Web Developer",
  engineRepoPath,
  existingEntries: ["package.json"],
});
assert(!blockedExisting.canCreateFiles, "existing package.json should block creation");
assert(blockedExisting.conflictStatus === "blockedExistingFiles", "existing files should produce conflict state");
assert(blockedExisting.founderOptions.includes("import the existing project"), "founder should be offered import path");

const blockedEngineRepo = evaluateProjectWorkspaceTarget({
  projectName: "NF Web Developer",
  targetPath: "D:\\dev\\dev\\DevAssistantCursorLite\\nf-web-developer",
  engineRepoPath,
  existingEntries: [],
});
assert(!blockedEngineRepo.canCreateFiles, "new project should not scaffold inside NF engine repo");
assert(blockedEngineRepo.conflictStatus === "blockedEngineRepo", "engine repo target should be blocked");

const invalidWorkspace = evaluateProjectWorkspaceTarget({
  projectName: "NF Web Developer",
  targetPath: "",
  engineRepoPath,
  existingEntries: [],
});
assert(
  invalidWorkspace.targetPath === "D:\\dev\\nf-projects\\nf-web-developer" && invalidWorkspace.canCreateFiles,
  "missing target path should resolve to safe default before file creation"
);

const classification = classifyProjectRequest(createDiscoveryIntake(nfWebDeveloperText));
const lock = createPlannerLock(classification);
const genericFallback = validatePlannerLock({
  lock,
  downstreamPlanner: "generalSoftwarePlanner",
  downstreamText: "Untitled Project primary workflow simple dashboard basic settings smallest working version generic Vite scaffold",
});
assert(!genericFallback.ok, "Website Platform planner lock should prevent generic fallback");
assert(
  genericFallback.blockers.some((blocker) => blocker.includes("generic placeholders")),
  "generic placeholder blocker should be reported"
);

const plan = generateProjectCreationPlanPreview({
  projectName: "NF Web Developer",
  ideaText: nfWebDeveloperText,
  slug: "nf-web-developer",
  defaultPath: "D:\\dev\\nf-projects\\nf-web-developer",
  createdFrom: "prompt",
});
assert(plan.mvpDefinition.includes("website project"), "locked Website Platform plan should not be generic");
assert(plan.inferredStack.includes("Website Platform"), "locked plan should keep Website Platform stack");
assert(
  plan.milestones.some((milestone) => milestone.name === "MVP Website Platform"),
  "locked plan should use Website Platform milestones"
);

const chatPlanningResponse = generateFounderSpecificationPlan(
  {
    projectName: "NF Web Developer",
    ideaText: nfWebDeveloperText,
    slug: "nf-web-developer",
    defaultPath: "D:\\dev\\nf-projects\\nf-web-developer",
    createdFrom: "prompt",
  },
  [
    "Full founder vision",
    "Create the full master build plan first. Do not write code yet.",
    "This must support website projects, industry templates, layout templates, leads, analytics, preview, publishing, hosting, domains, and media library.",
  ].join("\n")
);
assert(chatPlanningResponse.includes("Planning Mode: Website Platform Planner"), "chat Planning Mode should use Website Platform planner");
assert(chatPlanningResponse.includes("lockedPlanner=websitePlatformPlanner"), "chat Planning Mode should expose locked planner details");
assert(chatPlanningResponse.includes("industry templates"), "chat Planning Mode should include Website Platform MVP content");
assert(chatPlanningResponse.includes("layout templates"), "chat Planning Mode should include layout template content");
assert(!chatPlanningResponse.includes("Founder-first software product"), "chat Planning Mode should not use generic Founder Specification fallback");
assert(!chatPlanningResponse.includes("Turn the founder vision into a focused MVP"), "chat Planning Mode should not use generic purpose fallback");
assert(!chatPlanningResponse.includes("smallest working founder workflow"), "chat Planning Mode should not use generic workflow fallback");

const largeFounderPrompt = [
  "Full founder vision",
  "Create the full master build plan first. Do not write code yet.",
  "Website projects, industry templates, layout templates, forms, leads, analytics, preview, publishing, hosting, domains, and media library are required.",
  "Detailed workflow notes: ".repeat(1) + "Users create sites, customize sections, manage leads, review analytics, preview output, and prepare export. ".repeat(250),
].join("\n");
const largePlanningResponse = generateFounderSpecificationPlan(
  {
    projectName: "NF Web Developer",
    ideaText: `${nfWebDeveloperText}\n${largeFounderPrompt}`,
    slug: "nf-web-developer",
    defaultPath: "D:\\dev\\nf-projects\\nf-web-developer",
    createdFrom: "prompt",
  },
  largeFounderPrompt
);
assert(largePlanningResponse.includes("Planning Mode: Website Platform Planner"), "large Website Platform prompts should stay on the locked planner");
assert(!largePlanningResponse.includes("Founder-first software product"), "large Website Platform prompts should not fall back to generic planning");

const fullSpecWizard = createProjectCreationWizardState({
  projectName: "NF Web Developer",
  founderText: nfWebDeveloperFullSpec,
  engineRepoPath,
  existingEntries: [],
});
assert(fullSpecWizard.classification.primaryClassification === "Website Platform / Website Builder", "full NF Web Developer spec should classify as Website Platform");
assert(fullSpecWizard.plannerLock.lockedPlanner === "websitePlatformPlanner", "full spec should lock websitePlatformPlanner");
assert(fullSpecWizard.hostingTarget === "aws", "full spec should infer AWS hosting target");
assert(fullSpecWizard.accountsTiming === "now", "full commercial spec should infer accounts now");
assert(fullSpecWizard.users === "multiTenant", "tenant/account boundary language should infer multi-tenant user scope");

const fullSpecExtraction = extractFullProjectSpec({
  text: nfWebDeveloperFullSpec,
  projectName: "NF Web Developer",
  savePath: "D:\\dev\\nf-projects\\nf-web-developer",
  classification: fullSpecWizard.classification.primaryClassification,
  requiredPlanner: fullSpecWizard.plannerLock.lockedPlanner,
});
assert(fullSpecExtraction.projectName === "NF Web Developer", "full spec extraction should preserve project name");
assert(fullSpecExtraction.awsDomainRequirements.includes("AWS integration"), "full spec extraction should include AWS integration");
assert(fullSpecExtraction.awsDomainRequirements.includes("domain connection"), "full spec extraction should include domain connection");
assert(fullSpecExtraction.awsDomainRequirements.includes("subdomains"), "full spec extraction should include subdomains");
assert(fullSpecExtraction.awsDomainRequirements.includes("SSL/certificate status"), "full spec extraction should include SSL/certificate status");
assert(fullSpecExtraction.aiPlaceholders.includes("AI Creator placeholder"), "full spec extraction should include AI Creator placeholder");
assert(fullSpecExtraction.postMvpFeatures.includes("AI chatbot"), "full spec extraction should defer AI chatbot");
assert(fullSpecExtraction.postMvpFeatures.includes("advanced drag-and-drop editor"), "full spec extraction should defer advanced editor");
assert(fullSpecExtraction.nonGoals.includes("Full cloud deployment automation deferred from MVP"), "full cloud automation should be a non-goal");
assert(fullSpecExtraction.nonGoals.includes("Fully automated domain purchasing deferred from MVP"), "domain purchasing automation should be a non-goal");

const fullSpecPlan = generateProjectCreationPlanPreview({
  projectName: "NF Web Developer",
  ideaText: nfWebDeveloperFullSpec,
  slug: "nf-web-developer",
  defaultPath: "D:\\dev\\nf-projects\\nf-web-developer",
  createdFrom: "prompt",
});
assert(fullSpecPlan.fullSpecSummary?.awsDomainRequirements.includes("AWS integration") === true, "plan preview should carry AWS/domain extraction");
assert(fullSpecPlan.fullSpecSummary?.aiPlaceholders.includes("AI Creator placeholder") === true, "plan preview should carry AI placeholders");
assert(fullSpecPlan.fullSpecSummary?.accountUserModel?.includes("multi-tenant") === true, "plan preview should carry commercial account model");

const fullSpecPlanningResponse = generateFounderSpecificationPlan(
  {
    projectName: "NF Web Developer",
    ideaText: nfWebDeveloperFullSpec,
    slug: "nf-web-developer",
    defaultPath: "D:\\dev\\nf-projects\\nf-web-developer",
    createdFrom: "prompt",
  },
  `${nfWebDeveloperFullSpec}\nCreate the full master build plan first. Do not write code yet.`
);
assert(fullSpecPlanningResponse.includes("Planning Mode: Website Platform Planner"), "full spec Planning Mode should use Website Platform planner");
assert(fullSpecPlanningResponse.includes("AWS/domain requirements: AWS integration"), "Planning Mode should expose AWS/domain extraction");
assert(fullSpecPlanningResponse.includes("AI Creator placeholder"), "Planning Mode should expose AI placeholder extraction");
assert(fullSpecPlanningResponse.includes("Full cloud deployment automation deferred"), "Planning Mode should include deferred cloud automation non-goal");
assert(!fullSpecPlanningResponse.includes("Founder-first software product"), "full spec Planning Mode should not use generic fallback");

const planningError = generateProjectCreationErrorResponse(new Error("Planner output was invalid"));
assert(planningError.includes("Project Planning Error"), "invalid planner output should render a planning error state");
assert(planningError.includes("No project files were created"), "planning error state should make file safety explicit");
assert(planningError.includes("will not fall back to a generic planner"), "planning error should preserve planner-lock behavior");

assert(
  routeNewProjectWorkflow("Create the full master build plan first. Do not write code yet.", createProjectCreationState({
    founderPrompt: nfWebDeveloperText,
    source: "prompt",
  })) === "project_creation",
  "planning prompt with active project creation state should stay in project creation"
);
assert(!chatPlanningResponse.includes("Open a workspace first"), "valid create-project planning should not trigger workspace guard");

const starterValidation = validateStarterFileGeneration({
  state: createProjectCreationState({
    founderPrompt: nfWebDeveloperText,
    source: "prompt",
  }),
  plan,
  plannerLock: lock,
});
assert(starterValidation.ok, "specialized Website Platform file plan should pass starter validation");
assert(
  !starterValidation.blockers.some((blocker) => blocker.includes("Generic Vite starter files")),
  "starter generation should use Website Platform specialized file plan"
);

const commercial = inferCommercialProductSettings("This is a SaaS product launch for multiple users, customers, clients, and subscriptions.");
assert(commercial.accountsTiming === "now", "SaaS/product launch should infer accounts now");
assert(commercial.users === "multiUser", "multiple users should infer multi-user scope");
assert(commercial.postMvpPlaceholders.some((item) => /Billing/i.test(item)), "billing should be a post-MVP placeholder unless approved");

console.log("project creation wizard regression passed");
