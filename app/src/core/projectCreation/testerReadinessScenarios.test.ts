import { classifyProjectRequest } from "../product/projectClassification";
import { routeNewProjectWorkflow } from "./newProjectIntent";
import {
  generateProjectCreationFilePreview,
  runProjectCreationPlanningPipeline,
} from "./projectCreationPipeline";
import { createProjectCreationState } from "./projectCreationState";
import { generateProjectCreationPlanPreview } from "./projectCreationWizard";
import { projectCreationStateToDraft } from "./projectCreationState";

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

interface ScenarioExpectation {
  prompt: string;
  expectedNameIncludes: string;
  expectedClassification: string;
  expectedPlanner: string;
  specializedFilePlan: boolean;
}

const scenarios: ScenarioExpectation[] = [
  {
    prompt: "I want a budgeting app.",
    expectedNameIncludes: "Budgeting App",
    expectedClassification: "Generic Software App",
    expectedPlanner: "generalSoftwarePlanner",
    specializedFilePlan: false,
  },
  {
    prompt: "Build me a roofing website that gets leads.",
    expectedNameIncludes: "Roofing Website",
    expectedClassification: "Business Website",
    expectedPlanner: "businessWebsitePlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "I need a simple CRM for my small business.",
    expectedNameIncludes: "Crm",
    expectedClassification: "Internal Business Tool",
    expectedPlanner: "internalToolPlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "Make a restaurant website with menu and online reservations.",
    expectedNameIncludes: "Restaurant Website",
    expectedClassification: "Business Website",
    expectedPlanner: "businessWebsitePlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "Create a workout tracker.",
    expectedNameIncludes: "Workout Tracker",
    expectedClassification: "Generic Software App",
    expectedPlanner: "generalSoftwarePlanner",
    specializedFilePlan: false,
  },
  {
    prompt: "Build a task manager for my team.",
    expectedNameIncludes: "Task Manager",
    expectedClassification: "Generic Software App",
    expectedPlanner: "generalSoftwarePlanner",
    specializedFilePlan: false,
  },
  {
    prompt: "I need a chatbot for customer support.",
    expectedNameIncludes: "Chatbot",
    expectedClassification: "AI Agent",
    expectedPlanner: "aiAgentPlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "Make a landing page for my mobile app.",
    expectedNameIncludes: "Landing Page",
    expectedClassification: "Business Website",
    expectedPlanner: "businessWebsitePlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "Build a school attendance tracker.",
    expectedNameIncludes: "School Attendance Tracker",
    expectedClassification: "Internal Business Tool",
    expectedPlanner: "internalToolPlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "Create an invoice generator.",
    expectedNameIncludes: "Invoice Generator",
    expectedClassification: "Generic Software App",
    expectedPlanner: "generalSoftwarePlanner",
    specializedFilePlan: false,
  },
  {
    prompt: "Make a portfolio website.",
    expectedNameIncludes: "Portfolio Website",
    expectedClassification: "Business Website",
    expectedPlanner: "businessWebsitePlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "Build a real estate listing website.",
    expectedNameIncludes: "Real Estate Listing Website",
    expectedClassification: "Business Website",
    expectedPlanner: "businessWebsitePlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "Create a church website with events.",
    expectedNameIncludes: "Church Website",
    expectedClassification: "Business Website",
    expectedPlanner: "businessWebsitePlanner",
    specializedFilePlan: true,
  },
  {
    prompt: "Build a simple ecommerce store.",
    expectedNameIncludes: "Simple Ecommerce Store",
    expectedClassification: "Ecommerce",
    expectedPlanner: "ecommercePlanner",
    specializedFilePlan: true,
  },
  {
    prompt: nfWebDeveloperFullSpec,
    expectedNameIncludes: "NF Web Developer",
    expectedClassification: "Website Platform / Website Builder",
    expectedPlanner: "websitePlatformPlanner",
    specializedFilePlan: true,
  },
];

let passed = 0;

for (const scenario of scenarios) {
  const label = scenario.prompt.split("\n")[0].slice(0, 60);
  assert(
    routeNewProjectWorkflow(scenario.prompt, null) === "project_creation",
    `${label}: prompt should route to project creation`
  );

  const state = createProjectCreationState({ founderPrompt: scenario.prompt, source: "prompt" });
  assert(
    state.projectName.toLowerCase().includes(scenario.expectedNameIncludes.toLowerCase()),
    `${label}: expected project name to include "${scenario.expectedNameIncludes}", got "${state.projectName}"`
  );
  assert(
    state.savePath.includes("D:\\dev\\nf-projects\\"),
    `${label}: save path should be generated safely`
  );
  assert(
    state.classification.primaryClassification === scenario.expectedClassification,
    `${label}: expected classification ${scenario.expectedClassification}, got ${state.classification.primaryClassification}`
  );
  assert(
    state.lockedPlanner === scenario.expectedPlanner,
    `${label}: expected planner ${scenario.expectedPlanner}, got ${state.lockedPlanner}`
  );
  assert(
    state.classification.requiredPlanner === state.lockedPlanner,
    `${label}: planner lock should match classification`
  );
  assert(
    state.discoveryIntake.userRequest.includes(scenario.prompt.split("\n")[0]),
    `${label}: founder prompt should be preserved in discovery intake`
  );

  const draft = projectCreationStateToDraft(state);
  const planPreview = generateProjectCreationPlanPreview(draft, state.discoveryIntake);
  assert(!!planPreview.mvpDefinition.trim(), `${label}: plan preview should include MVP definition`);
  if (scenario.expectedPlanner !== "generalSoftwarePlanner") {
    const specializedPlanOk =
      planPreview.mvpDefinition.includes(scenario.expectedPlanner) ||
      planPreview.mvpDefinition.includes(scenario.expectedClassification) ||
      (scenario.expectedPlanner === "websitePlatformPlanner" && /website/i.test(planPreview.mvpDefinition));
    assert(specializedPlanOk, `${label}: specialized plan preview should reflect the locked planner`);
  }

  const pipeline = runProjectCreationPlanningPipeline(state, {
    applyDiscoveryDefaults: true,
    persistBlueprint: false,
    now: "2026-06-29T12:00:00.000Z",
  });
  assert(pipeline.blueprint.gapAnalysis.data !== null, `${label}: blueprint should include gap analysis`);
  assert(pipeline.blueprint.architectureReview.data !== null, `${label}: blueprint should include architecture review`);
  assert(pipeline.blueprint.phaseBuildPlan.data !== null, `${label}: blueprint should include phase build plan`);

  const filePreview = generateProjectCreationFilePreview(
    state,
    { ...pipeline.planPreview, status: "approved" },
    pipeline.blueprint
  );
  assert(filePreview.targetPath === state.savePath, `${label}: file preview should use canonical save path`);
  assert(filePreview.filesToCreate.length > 0, `${label}: file preview should include files`);

  const hasPackageJson = filePreview.filesToCreate.some((file) => file.path === "package.json");
  if (scenario.specializedFilePlan) {
    assert(!hasPackageJson, `${label}: specialized file plan should not use generic Vite package.json`);
    assert(
      filePreview.filesToCreate.some((file) => file.path.includes("FOUNDATION.md")),
      `${label}: specialized file plan should include a foundation document`
    );
  } else {
    assert(hasPackageJson, `${label}: generic software plan should include package.json scaffold`);
  }

  const rediscovered = classifyProjectRequest(state.discoveryIntake);
  assert(
    rediscovered.requiredPlanner === scenario.expectedPlanner,
    `${label}: classification from discovery intake should stay stable`
  );

  passed += 1;
}

assert(passed === scenarios.length, `expected ${scenarios.length} scenarios, ran ${passed}`);
console.log(`tester readiness scenarios passed (${scenarios.length}/${scenarios.length})`);
