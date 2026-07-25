import { duplicateExportFunctionNames } from "../patch/patchDuplicateGuard";
import { auditWebsitePlatformMvp, isPlaceholderRoute, isWebsitePlatformProject } from "./mvpDiskAudit";
import type { LivingBuildPlan, ProjectMemory } from "../types";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const placeholderApp = `
import { WorkspacePlaceholderPage } from "./workspace/pages/WorkspacePlaceholderPage";
<Route path="pages" element={<WorkspacePlaceholderPage title="Pages" />} />
<Route path="theme" element={<WorkspacePlaceholderPage title="Theme" />} />
`;

assert(isPlaceholderRoute(placeholderApp, "pages"), "pages route is placeholder");
assert(isPlaceholderRoute(placeholderApp, "theme"), "theme route is placeholder");
assert(isWebsitePlatformProject("Website Platform with industry templates"), "detect website platform");

const corruptedComponent = `
export function WorkspaceSetupPage() { return <div>A</div>; }
export function WorkspaceSetupPage() { return <div>B</div>; }
`;
assert(
  duplicateExportFunctionNames(corruptedComponent).includes("WorkspaceSetupPage"),
  "detect duplicate export functions"
);

const workspace = {
  async readFile(path: string): Promise<string> {
    if (path === "src/App.tsx") return placeholderApp;
    if (path === "src/pages/ProjectsIndexPage.tsx") return "export function ProjectsIndexPage() { return <ul />; }";
    if (path === "src/models/websiteProject.ts") return "export function saveWebsiteProject() {}";
    if (path === "src/workspace/pages/WorkspaceSetupPage.tsx") return corruptedComponent;
    if (path === "src/data/mockData.ts") return "import { getProjectByTenantAndId } from './mockData';";
    return "";
  },
  async exists(path: string): Promise<boolean> {
    return path === "src/pages/LayoutTemplatePicker.tsx";
  },
};

const plan = {
  schemaVersion: 1,
  projectId: "nf-web-developer",
  mvpDefinition: "Website Platform",
  milestones: [],
  currentMilestoneId: "",
  completedSteps: [],
  nextRecommendedStep: "",
  progressSummary: "",
  pausedState: { isPaused: false },
} satisfies LivingBuildPlan;

const memory = {
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
} satisfies ProjectMemory;

const audit = await auditWebsitePlatformMvp(workspace, plan, memory);
assert(audit != null, "audit should run for website platform");
assert(audit!.incompleteModules.length >= 8, "placeholder routes should leave many incomplete modules");
assert(
  audit!.incompleteModules.some((module) => module.id === "pages-editor"),
  "pages editor should be incomplete"
);

console.log("mvp disk audit regression passed");
