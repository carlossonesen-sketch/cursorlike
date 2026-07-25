import type { LivingBuildPlan } from "../types";
import { reconcileBuildPlanWithDisk } from "./diskReconciliation";
import { getNextActionableBuildTask } from "./continueIntent";
import { MVP_IMPLEMENTATION_MILESTONE_ID } from "./mvpImplementationPhase";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const placeholderApp = `
<Route path="pages" element={<WorkspacePlaceholderPage title="Pages" />} />
<Route path="theme" element={<WorkspacePlaceholderPage title="Theme" />} />
`;

const completedPlan: LivingBuildPlan = {
  schemaVersion: 1,
  projectId: "nf-web-developer",
  mvpDefinition: "Website Platform with industry templates",
  milestones: [
    {
      id: "phase-2-implementation",
      name: "Phase 2 Implementation",
      goal: "Shells",
      status: "done",
      tasks: [{ id: "p2-t1", title: "Scaffold TypeScript web app workspace", status: "done" }],
    },
  ],
  currentMilestoneId: "phase-2-implementation",
  currentTaskId: "p2-t1",
  completedSteps: [],
  nextRecommendedStep: "Generate Founder MVP Phase (Option A)",
  progressSummary: "Phase 2 Implementation: 1 / 1 tasks complete.",
  pausedState: { isPaused: false },
};

const workspace = {
  async readFile(path: string): Promise<string> {
    if (path === "src/App.tsx") return placeholderApp;
    if (path === "package.json") return "{}";
    if (path === "src/main.tsx") return "import React from 'react';";
    if (path === "src/pages/ProjectsIndexPage.tsx") return "export function ProjectsIndexPage() { return null; }";
    if (path === "src/models/websiteProject.ts") return "export function saveWebsiteProject() {}";
    if (path === "src/workspace/pages/WorkspaceSetupPage.tsx") return "import { mockData } from '../../data/mockData';";
    if (path === "src/data/mockData.ts") return "export const demoProjects = [];";
    return "";
  },
  async exists(path: string): Promise<boolean> {
    return ["package.json", "src/main.tsx", "src/pages/LayoutTemplatePicker.tsx"].includes(path);
  },
};

const reconciled = await reconcileBuildPlanWithDisk(workspace, completedPlan, {
  schemaVersion: 1,
  projectId: "nf-web-developer",
  name: "NF Web Developer",
  aliases: [],
  path: "D:/dev/nf-projects/nf-web-developer",
  createdAt: new Date().toISOString(),
  summary: "Website Platform",
  fullIdea: "Industry templates",
  techStack: [],
  architectureNotes: [],
  decisions: [],
  importantFiles: [],
  status: "active",
  lifecycleStage: "buildingMvp",
  commands: {},
  knownIssues: [],
  updatedAt: new Date().toISOString(),
  todos: [],
  recentWork: [],
  generatedFiles: [],
  resumeState: { status: "active", resumePrompt: "", lastWorkedAt: new Date().toISOString() },
});

assert(reconciled.changed, "disk reconciliation should change stale completed plan");
assert(
  reconciled.plan.milestones.some((milestone) => milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID),
  "MVP implementation milestone should be created"
);
const next = getNextActionableBuildTask(reconciled.plan);
assert(next?.milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID, "next task should be in MVP implementation phase");
assert(
  !reconciled.plan.nextRecommendedStep.includes("Generate Founder MVP Phase"),
  "stale founder MVP option should be replaced"
);

console.log("disk reconciliation regression passed");
