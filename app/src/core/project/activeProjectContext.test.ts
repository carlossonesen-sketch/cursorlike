import {
  isEstablishedProjectWorkspace,
  isExplicitCreateNewProjectIntent,
  shouldBlockNewProjectRouting,
  type ActiveProjectContext,
} from "./activeProjectContext";
import {
  routeNewProjectWorkflow,
  shouldHandleNewProjectMessage,
} from "../projectCreation/newProjectIntent";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const nfWebDeveloperContext: ActiveProjectContext = {
  workspacePath: "D:\\dev\\nf-projects\\nf-web-developer",
  projectMemory: {
    schemaVersion: 1,
    projectId: "nf-web-developer",
    name: "NF Web Developer",
    aliases: [],
    path: "D:\\dev\\nf-projects\\nf-web-developer",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    status: "active",
    lifecycleStage: "buildingMvp",
    fullIdea: "Website Platform",
    summary: "Website Platform",
    techStack: ["TypeScript", "Web App"],
    architectureNotes: [],
    decisions: [],
    importantFiles: [],
    generatedFiles: [],
    commands: {},
    todos: [],
    knownIssues: [],
    recentWork: [],
    resumeState: { status: "active", resumePrompt: "Continue build plan" },
  },
  livingBuildPlan: {
    schemaVersion: 1,
    projectId: "nf-web-developer",
    mvpDefinition: "Website Platform MVP",
    milestones: [{ id: "m1", name: "MVP", goal: "Build", status: "active", tasks: [] }],
    currentMilestoneId: "m1",
    completedSteps: [],
    nextRecommendedStep: "Continue build plan",
    progressSummary: "MVP: 0 / 0 tasks complete.",
    pausedState: { isPaused: false },
  },
};

const founderSpecPaste = [
  "# Create a New NF Project",
  "**Project Name:** NF Web Developer",
  "**Save Path:** `D:\\dev\\nf-projects\\nf-web-developer`",
  "Website Platform with industry templates and layout templates.",
].join("\n");

assert(
  isEstablishedProjectWorkspace(nfWebDeveloperContext),
  "opened NF Web Developer workspace should count as established"
);
assert(
  shouldBlockNewProjectRouting(founderSpecPaste, nfWebDeveloperContext, false),
  "founder spec paste should be blocked from new-project routing on established workspace"
);
assert(
  routeNewProjectWorkflow(founderSpecPaste, null, nfWebDeveloperContext) === "other",
  "founder spec paste should route to other on established workspace"
);
assert(
  !shouldHandleNewProjectMessage(founderSpecPaste, null, nfWebDeveloperContext),
  "founder spec paste must not draft a new project on established workspace"
);
assert(
  shouldHandleNewProjectMessage("Create a new NF project called Demo", null, nfWebDeveloperContext),
  "explicit create-new-project intent should still be allowed"
);
assert(
  isExplicitCreateNewProjectIntent("Create a new NF project called Demo"),
  "explicit create-new-project phrase should be detected"
);

console.log("active project context regression passed");
