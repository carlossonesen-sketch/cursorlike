import { extractFileMentions } from "../workspace/readProjectFile";
import type { LivingBuildPlan, ProjectMemory } from "../types";
import {
  detectProjectPlanContinuationIntent,
  detectScaffoldPhaseOptionIntent,
  generateFounderMvpPhase,
  isScaffoldPhaseComplete,
  reconcileBuildPlanProgress,
  resolveDisplayNextStep,
  shouldAutoStartFounderMvp,
} from "./scaffoldPhase";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const websiteFoundationPlan: LivingBuildPlan = {
  schemaVersion: 1,
  projectId: "nf-web-developer",
  mvpDefinition: "Website Platform with industry templates and layout templates.",
  milestones: [
    {
      id: "advanced-dnd",
      name: "Advanced Drag-and-Drop Editor",
      goal: "Plan post-MVP drag-and-drop editor.",
      status: "done",
      tasks: [
        { id: "dnd-t1", title: "Plan Advanced Drag-and-Drop Editor", status: "done" },
        { id: "dnd-t2", title: "Implement first Advanced Drag-and-Drop Editor task", status: "done" },
        { id: "dnd-t3", title: "Verify Advanced Drag-and-Drop Editor", status: "done" },
      ],
    },
  ],
  currentMilestoneId: "advanced-dnd",
  currentTaskId: "dnd-t3",
  completedSteps: [],
  nextRecommendedStep: "Plan Advanced Drag-and-Drop Editor",
  progressSummary: "Advanced Drag-and-Drop Editor: 3 / 3 tasks complete.",
  pausedState: { isPaused: false },
};

assert(isScaffoldPhaseComplete(websiteFoundationPlan), "foundation-only plan should be scaffold complete");
const reconciled = reconcileBuildPlanProgress(websiteFoundationPlan);
assert(
  reconciled.nextRecommendedStep === "Generate Founder MVP Phase (Option A)",
  "stale planning step should reconcile to Founder MVP option"
);

const projectMemory = {
  schemaVersion: 1 as const,
  projectId: "nf-web-developer",
  name: "NF Web Developer",
  aliases: [],
  path: "D:/dev/nf-projects/nf-web-developer",
  createdAt: new Date().toISOString(),
  summary: "Website Platform",
  fullIdea: "Industry templates and layout templates for roofing websites.",
  techStack: ["TypeScript", "Web App"],
  architectureNotes: [],
  decisions: [],
  importantFiles: [],
  status: "active" as const,
  lifecycleStage: "buildingMvp" as const,
  commands: {},
  knownIssues: [],
  updatedAt: new Date().toISOString(),
  todos: [],
  recentWork: [],
  generatedFiles: [],
  resumeState: {
    status: "active" as const,
    resumePrompt: "Plan Advanced Drag-and-Drop Editor",
    lastWorkedAt: new Date().toISOString(),
  },
} satisfies ProjectMemory;

const falselyCompletedFounderPlan: LivingBuildPlan = {
  ...reconciled,
  milestones: [
    ...reconciled.milestones,
    {
      id: "founder-mvp-phase",
      name: "Founder MVP Phase",
      goal: "Implementation",
      status: "done",
      tasks: [
        { id: "founder-mvp-phase-t1", title: "Set up website project workspace scaffold", status: "done" },
        { id: "founder-mvp-phase-t2", title: "Build industry template picker shell", status: "done" },
      ],
    },
  ],
  currentMilestoneId: "founder-mvp-phase",
  completedSteps: [
    {
      id: "step-1",
      completedAt: "2026-06-29T18:38:20.374Z",
      milestoneId: "founder-mvp-phase",
      taskId: "founder-mvp-phase-t1",
      completed: "Set up website project workspace scaffold",
      filesChanged: ["docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md"],
      worksNow: [],
      stillNeedsWork: [],
      nextRecommendedStep: "",
    },
  ],
};
const resetFounder = generateFounderMvpPhase(falselyCompletedFounderPlan, projectMemory, { hasScaffold: false });
assert(
  resetFounder.nextRecommendedStep === "Set up website project workspace scaffold",
  "option A should reset falsely completed founder MVP tasks"
);

const founderMvp = generateFounderMvpPhase(reconciled, projectMemory);
assert(
  founderMvp.milestones.some((milestone) => milestone.id === "founder-mvp-phase"),
  "founder MVP phase milestone should be added"
);
assert(
  founderMvp.nextRecommendedStep === "Set up website project workspace scaffold",
  "founder MVP should point at first implementation task"
);
assert(
  resolveDisplayNextStep(founderMvp, projectMemory) === "Set up website project workspace scaffold",
  "display next step should follow founder MVP task"
);

assert(detectScaffoldPhaseOptionIntent("continue option A") === "founder_mvp", "option A should map to founder MVP");
assert(detectScaffoldPhaseOptionIntent("Generate Founder MVP Phase") === "founder_mvp", "explicit founder MVP phrase should map");
assert(detectProjectPlanContinuationIntent("check build plan"), "check build plan should be a project-plan prompt");
assert(detectProjectPlanContinuationIntent("what is the next phase"), "next phase query should be a project-plan prompt");
assert(
  shouldAutoStartFounderMvp("start this part of the project plan Project: NF Web Developer", websiteFoundationPlan),
  "start project plan should auto-start founder MVP when scaffold is complete"
);
assert(
  !shouldAutoStartFounderMvp("check build plan", websiteFoundationPlan),
  "status-only build plan check should not auto-start founder MVP"
);

const projectPathMentions = extractFileMentions(
  "start this part of the project plan Project: NF Web Developer Path: D:\\dev\\nf-projects\\nf-web-developer"
);
assert(projectPathMentions.length === 0, "project directory paths should not be treated as file mentions");

console.log("scaffold phase regression passed");
