import {
  createNewProjectDraftFromPrompt,
  detectFounderSpecificationIntent,
  detectNewProjectDetails,
  detectNewProjectIntent,
  generateFounderSpecificationPlan,
  parseProjectNameSupply,
  routeNewProjectWorkflow,
  shouldHandleNewProjectMessage,
  updateNewProjectDraftFromPrompt,
} from "./newProjectIntent";
import { detectBuildCheckIntent, detectBuildCommand } from "../project/buildCheck";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const firstPrompt = "this is a new project creation";
assert(detectNewProjectIntent(firstPrompt), "new project creation prompt should start project flow");
assert(shouldHandleNewProjectMessage(firstPrompt, null), "new project creation prompt should bypass workspace guard");
assert(
  detectNewProjectIntent("Create a new NF project named \"NF Web Developer.\""),
  "new NF project named prompt should start project flow"
);

const draft = createNewProjectDraftFromPrompt(firstPrompt, "prompt");
assert(draft.projectName === "Untitled Project", "generic project creation should use an untitled draft");

const detailsPrompt = [
  "Project Name: Foundry",
  "Project Type: AI-Native Startup Operating System",
  "Project Purpose: Help founders operate from idea to MVP.",
].join("\n");

assert(detectNewProjectDetails(detailsPrompt), "Project Name details should be detected");
assert(detectNewProjectDetails("**Project Name:** NF Web Developer"), "markdown Project Name details should be detected");
assert(parseProjectNameSupply("add project name WEB site Developer") === "WEB site Developer", "chat name supply should parse add project name");
assert(shouldHandleNewProjectMessage(detailsPrompt, draft), "Project Name follow-up should continue project flow");

const updatedDraft = updateNewProjectDraftFromPrompt(draft, detailsPrompt);
assert(updatedDraft.projectName === "Foundry", "Project Name should update the draft name");
assert(updatedDraft.slug === "foundry", "Project Name should update the draft slug");
assert(updatedDraft.defaultPath === "D:\\dev\\nf-projects\\foundry", "Project Name should update the default path");
assert(updatedDraft.ideaText.includes("Project Name: Foundry"), "details should be preserved in idea text");
assert(
  updatedDraft.ideaText.includes("AI-Native Startup Operating System"),
  "project type should be preserved in idea text"
);

const blockedResponse = "Open a workspace first, or describe the new project you want to create.";
const routedResponse = shouldHandleNewProjectMessage(detailsPrompt, draft) ? "project-flow" : blockedResponse;
assert(routedResponse !== blockedResponse, "Project Name follow-up must not route to the workspace guard");

const founderVision = [
  "Full founder vision",
  "Founder owns the vision. Never Finished owns the execution plan.",
  "Create a master build plan. Do not write code yet.",
  "Expected build plan format:",
  "- Executive Build Summary",
  "- Phased Build Plan",
  "- MVP Definition",
  "- Architecture Recommendation",
  "- Founder Action List",
  "MVP scope: project memory, living build plans, founder-first UI, approval-gated code changes, and resume accuracy.",
  "External services: OpenAI, authentication, database, hosting, analytics.",
  "The phased build plan should include founder testing checkpoints and external setup tasks.",
].join("\n");

assert(detectFounderSpecificationIntent(founderVision), "founder vision should route to planning");
assert(
  !shouldHandleNewProjectMessage(founderVision, updatedDraft),
  "founder vision should not route back to project draft update"
);
assert(
  routeNewProjectWorkflow(founderVision, updatedDraft) === "founder_specification",
  "founder vision should enter Founder Specification mode"
);

const establishedContext = {
  workspacePath: "D:\\dev\\nf-projects\\nf-web-developer",
  projectMemory: {
    projectId: "nf-web-developer",
    path: "D:\\dev\\nf-projects\\nf-web-developer",
  } as any,
  livingBuildPlan: {
    milestones: [{ id: "m1", name: "MVP", goal: "Build", status: "active", tasks: [] }],
  } as any,
};
assert(
  routeNewProjectWorkflow(detailsPrompt, null, establishedContext) === "other",
  "Project Name details should not start a new project when an established workspace is active"
);
assert(
  !shouldHandleNewProjectMessage(detailsPrompt, null, establishedContext),
  "Project Name details must not draft a new project on an established workspace"
);

const planningResponse = generateFounderSpecificationPlan(updatedDraft, founderVision);
assert(!planningResponse.includes("No files have been created yet"), "planning response should not use draft-update copy");
assert(planningResponse.includes("Executive Build Summary"), "planning response should include executive summary");
assert(planningResponse.includes("Phased Build Plan"), "planning response should include phased plan");
assert(planningResponse.includes("Founder Action List"), "planning response should include founder action list");
assert(planningResponse.includes("Total estimated build time"), "planning response should include total build time");
assert(planningResponse.includes("Estimated MVP time"), "planning response should include MVP estimate");
assert(planningResponse.includes("External Services Required"), "planning response should include external services");
assert(planningResponse.includes("Founder Manual Testing Checkpoints"), "planning response should include manual checkpoints");
assert(!planningResponse.includes("Proposed patch"), "planning response should not propose a patch");
assert(!planningResponse.includes("Create project files"), "planning response should not create files");

const buildTimeQuestion = "what is the build time on this project";
assert(
  !routeNewProjectWorkflow(buildTimeQuestion, updatedDraft).includes("project_creation"),
  "build-time questions should not update project creation"
);

assert(detectBuildCheckIntent("run build test"), "run build test should use the active workspace build check flow");
const detectedCommand = await detectBuildCommand(
  "D:\\dev\\nf-projects\\foundry",
  null,
  null,
  async (path) => {
    if (path !== "package.json") throw new Error(`Unexpected read: ${path}`);
    return JSON.stringify({ scripts: { build: "vite build" } });
  }
);
assert(detectedCommand === "npm run build", "run build test should resolve to the active workspace npm build command");

console.log("new project intent regression passed");
