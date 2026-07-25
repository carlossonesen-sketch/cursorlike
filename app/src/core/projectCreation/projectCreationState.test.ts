import { createDiscoveryIntake } from "../product/discoveryIntake";
import { classifyProjectRequest } from "../product/projectClassification";
import { generateProjectCreationPlanPreview, validatePlannerLock } from "./projectCreationWizard";
import { createNewProjectDraftFromPrompt, updateNewProjectDraftFromPrompt } from "./newProjectIntent";
import { createProjectCreationState, createMenuProjectCreationState, projectCreationStateToDraft, updateProjectCreationStateFromPrompt } from "./projectCreationState";
import { extractStructuredProjectFields } from "./structuredFieldExtraction";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const fullNfWebDeveloperPrompt = [
  "Create a new NF project named “NF Web Developer.”",
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

const naturalName = extractStructuredProjectFields("Create a new NF project named “NF Web Developer.”");
assert(naturalName.projectName.value === "NF Web Developer", "natural language project name should be extracted");
assert(naturalName.projectName.source === "explicit", "natural language project name should be explicit");

const explicitName = extractStructuredProjectFields("Project Name: NF Web Developer");
assert(explicitName.projectName.value === "NF Web Developer", "explicit label project name should be extracted");

const bulletName = extractStructuredProjectFields("- Project name: NF Web Developer");
assert(bulletName.projectName.value === "NF Web Developer", "bullet label project name should be extracted");

const badName = extractStructuredProjectFields("Project save path: D:\\dev\\nf-projects\\nf-web-developer");
assert(badName.projectName.value !== "project save path", "project name must not match project save path");
assert(badName.projectName.value === "Untitled Project", "project save path should not masquerade as project name");

const pathLabel = extractStructuredProjectFields("Save path: D:\\dev\\nf-projects\\nf-web-developer");
assert(pathLabel.savePath?.value === "D:\\dev\\nf-projects\\nf-web-developer", "save path label should be extracted");

const pathNextLine = extractStructuredProjectFields(["Save path", "D:\\dev\\nf-projects\\nf-web-developer"].join("\n"));
assert(pathNextLine.savePath?.value === "D:\\dev\\nf-projects\\nf-web-developer", "save path next-line value should be extracted");

const explicitPathDraft = createNewProjectDraftFromPrompt(
  ["Project Name: NF Web Developer", "Save path: D:\\dev\\nf-projects\\nf-web-developer"].join("\n"),
  "prompt"
);
assert(explicitPathDraft.defaultPath === "D:\\dev\\nf-projects\\nf-web-developer", "explicit save path should be preserved in draft");

const menuDraft = createNewProjectDraftFromPrompt("", "menu");
const mergedDraft = updateNewProjectDraftFromPrompt(menuDraft, fullNfWebDeveloperPrompt);
assert(mergedDraft.projectName === "NF Web Developer", "project state should replace Untitled Project defaults");
assert(mergedDraft.defaultPath === "D:\\dev\\nf-projects\\nf-web-developer", "project state should replace untitled save path");

const state = createProjectCreationState({
  founderPrompt: fullNfWebDeveloperPrompt,
  existingDraft: menuDraft,
  source: "prompt",
  existingEntries: [],
});
assert(state.projectName === "NF Web Developer", "project state should own project name");
assert(state.savePath === "D:\\dev\\nf-projects\\nf-web-developer", "project state should own save path");
assert(state.intentDepth === "technicalArchitectureSpec" || state.intentDepth === "detailedProductSpec", "full prompt should have deep intent");
assert(state.classification.primaryClassification === "Website Platform / Website Builder", "state should classify Website Platform");
assert(state.lockedPlanner === "websitePlatformPlanner", "state should lock Website Platform planner");
assert(state.launchType === "commercialSaas" || state.launchType === "productLaunch", "state should infer commercial/product launch");
assert(state.extractedFields.awsRequirements.value.includes("AWS integration"), "state should extract AWS requirements");
assert(state.extractedFields.domainRequirements.value.includes("domain connection"), "state should extract domain requirements");
assert(state.extractedFields.aiPlaceholders.value.includes("AI Creator placeholder"), "state should extract AI Creator placeholder");
assert(state.extractedFields.postMvpFeatures.value.includes("AI chatbot"), "state should defer AI chatbot");
assert(state.extractedFields.postMvpFeatures.value.includes("advanced drag-and-drop editor"), "state should defer advanced editor");
assert(state.plannerLockDiagnostics.ok, "planner lock should validate committed project state");

const stateDraft = projectCreationStateToDraft(state);
const stateIntake = createDiscoveryIntake(state.fullFounderPrompt);
const stateClassification = classifyProjectRequest(state.discoveryIntake);
const statePlan = generateProjectCreationPlanPreview(stateDraft, state.discoveryIntake);
assert(stateDraft.projectName === state.projectName, "card/draft adapter should read project state name");
assert(stateIntake.userRequest === state.fullFounderPrompt, "Discovery Intake should read project state prompt");
assert(stateClassification.requiredPlanner === state.lockedPlanner, "planner lock should read same state classification");
assert(statePlan.fullSpecSummary?.projectName === state.projectName, "plan preview should read same project state identity");
assert(statePlan.fullSpecSummary?.savePath === state.savePath, "file preview inputs should keep project state save path");
assert(
  state.discoveryIntake.understoodSummary.includes("Website Platform / Website Builder"),
  "state discovery intake should describe Website Platform / Website Builder"
);
assert(
  !state.discoveryIntake.understoodSummary.includes("business dashboard"),
  "state discovery intake should not describe business dashboard"
);

const simpleIdeaState = createProjectCreationState({ founderPrompt: "Build me a budgeting app", source: "prompt" });
assert(simpleIdeaState.intentDepth === "simpleIdea", "one-sentence idea should stay simpleIdea");
assert(simpleIdeaState.extractedFields.targetPlatform.value === "web app", "simple idea should get inferred/defaulted web app platform");
assert(simpleIdeaState.projectName === "Budgeting App", "simple idea should infer a readable project name");

const conflictState = createProjectCreationState({
  founderPrompt: fullNfWebDeveloperPrompt,
  existingEntries: ["package.json"],
});
assert(conflictState.conflicts.length > 0, "existing files should be detected as conflicts");
assert(conflictState.workspaceSafetyStatus === "blockedExistingFiles", "existing package.json should block workspace safety");

const fallbackLock = validatePlannerLock({
  lock: { lockedPlanner: "websitePlatformPlanner", classification: "Website Platform / Website Builder", founderApprovedFallback: false },
  downstreamPlanner: "generalSoftwarePlanner",
  downstreamText: "Untitled Project primary workflow generic Vite scaffold",
});
assert(!fallbackLock.ok, "generic fallback should still be blocked");

const exactNfWebDeveloperPrompt = [
  "Project Name: NF Web Developer",
  "Save Path: D:\\dev\\nf-projects\\nf-web-developer",
  "website development platform",
  "website hosting",
  "website builder",
  "Website Projects",
  "Industry Templates",
  "Layout Templates",
  "AWS integration",
  "Domain Management",
  "Publishing",
  "Website Preview",
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

const exactState = createProjectCreationState({ founderPrompt: exactNfWebDeveloperPrompt, source: "prompt" });
const exactIntake = exactState.discoveryIntake;
const exactProductType = exactIntake.inferredAnswers.find((answer) => answer.key === "productType")?.value ?? "";
const exactPlatform = exactIntake.inferredAnswers.find((answer) => answer.key === "platform")?.value ?? "";
const exactMvp = exactIntake.inferredAnswers.find((answer) => answer.key === "mvpFeatures")?.value ?? "";
const exactDisplay = [
  exactState.projectName,
  exactState.savePath,
  exactProductType,
  exactPlatform,
  exactState.lockedPlanner,
  exactIntake.understoodSummary,
  exactMvp,
].join("\n");

assert(exactState.projectName === "NF Web Developer", "exact prompt should keep NF Web Developer name");
assert(exactState.savePath === "D:\\dev\\nf-projects\\nf-web-developer", "exact prompt should keep save path");
assert(exactProductType === "Website Platform / Website Builder", "exact prompt intake product type should match classification");
assert(exactPlatform === "web app", "exact prompt intake platform should be web app");
assert(exactState.lockedPlanner === "websitePlatformPlanner", "exact prompt should lock websitePlatformPlanner");
assert(
  exactIntake.understoodSummary === "NF understood this as a Website Platform / Website Builder.",
  "exact prompt intake summary should describe Website Platform / Website Builder"
);
assert(!exactDisplay.includes("Untitled Project"), "exact prompt display should not include Untitled Project");
assert(!exactDisplay.includes("business dashboard"), "exact prompt display should not include business dashboard");
assert(!exactDisplay.includes("desktop app"), "exact prompt display should not include desktop app");
assert(!exactMvp.includes("primary workflow, simple dashboard, basic settings"), "exact prompt should not use generic MVP fallback");

const menuThenPasteState = updateProjectCreationStateFromPrompt(createMenuProjectCreationState(), exactNfWebDeveloperPrompt);
const menuThenPasteDisplay = [
  menuThenPasteState.projectName,
  menuThenPasteState.savePath,
  menuThenPasteState.discoveryIntake.understoodSummary,
  menuThenPasteState.discoveryIntake.inferredAnswers.find((answer) => answer.key === "productType")?.value ?? "",
].join("\n");
assert(menuThenPasteState.projectName === "NF Web Developer", "menu then paste should keep extracted project name");
assert(menuThenPasteState.savePath === "D:\\dev\\nf-projects\\nf-web-developer", "menu then paste should keep extracted save path");
assert(
  menuThenPasteState.discoveryIntake.understoodSummary.includes("Website Platform / Website Builder"),
  "menu then paste intake should describe Website Platform / Website Builder"
);
assert(!menuThenPasteDisplay.includes("Untitled Project"), "menu then paste should not retain Untitled Project");

const markdownFounderSpec = [
  "# Create a New NF Project",
  "**Project Name:** NF Web Developer",
  "**Save Path:** `D:\\dev\\nf-projects\\nf-web-developer`",
  "---",
  "# Founder Vision",
  "NF Web Developer is an AI-assisted website development platform built by NF.",
  "Required MVP: website projects, industry templates, layout templates, publishing, preview, AWS, domains.",
].join("\n");

const markdownState = createProjectCreationState({ founderPrompt: markdownFounderSpec, source: "prompt" });
assert(markdownState.projectName === "NF Web Developer", "markdown Project Name label should be extracted");
assert(markdownState.savePath === "D:\\dev\\nf-projects\\nf-web-developer", "markdown Save Path label should be extracted");
assert(!markdownState.needsProjectName, "markdown founder spec should resolve project identity");

console.log("project creation state regression passed");
