import {
  developerModeControlPreferences,
  founderModeControlPreferences,
} from "../control/controlLevel";
import {
  shouldRequireApprovalForRiskyDeveloperAction,
  shouldShowAuditControls,
} from "../control/developerModeTools";
import type { LivingBuildPlan, ProjectManifest, ProjectMemory } from "../types";
import { buildProjectDashboardModel } from "./projectDashboard";
import {
  buildCodeAuditReport,
  buildProjectAuditReport,
  detectAuditMode,
  inspectSourceFilesForCodeAudit,
  isAuditSaveRequest,
  selectCodeAuditFiles,
} from "./auditIntent";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const workspacePath = "D:\\dev\\nf-projects\\audit-preservation";

const livingBuildPlan: LivingBuildPlan = {
  schemaVersion: 1,
  projectId: "audit-preservation",
  mvpDefinition: "Preserve audit workflows while adding autonomous phase behavior.",
  milestones: [
    {
      id: "m1",
      name: "Core Experience",
      goal: "Keep existing developer audit tools available.",
      status: "active",
      tasks: [
        { id: "t1", title: "Preserve project audit", status: "done" },
        { id: "t2", title: "Preserve code audit", status: "next" },
      ],
    },
  ],
  currentMilestoneId: "m1",
  currentTaskId: "t2",
  completedSteps: [
    {
      id: "s1",
      completedAt: "2026-06-28T12:00:00.000Z",
      milestoneId: "m1",
      taskId: "t1",
      completed: "Preserved project audit",
      filesChanged: ["app/src/core/project/auditIntent.ts"],
      worksNow: ["Project audit remains available"],
      stillNeedsWork: ["Preserve code audit regression"],
      nextRecommendedStep: "Preserve code audit",
    },
  ],
  nextRecommendedStep: "Preserve code audit",
  progressSummary: "Core Experience: 1 / 2 tasks complete.",
  pausedState: { isPaused: false },
};

const projectMemory = {
  name: "Audit Preservation",
  path: workspacePath,
  fullIdea: "NF should preserve Developer Mode audit workflows while Founder Mode can simplify what is shown by default.",
  summary: "Audit preservation regression project.",
  todos: [{ id: "todo-audit", text: "Keep audit tools importable", status: "todo" }],
  architectureNotes: ["Developer Mode audit helpers must remain direct and reusable."],
} as ProjectMemory;

const manifest: ProjectManifest = {
  projectTypes: ["typescript", "react", "vite"],
  configFiles: ["package.json", "tsconfig.json", "vite.config.ts"],
  lockfiles: ["package-lock.json"],
  fileList: [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/components/AuditPanel.tsx",
    "src/core/project/auditIntent.ts",
  ],
  dependencyIndicators: {},
};

const latestBuildResult = {
  runId: "audit-preservation-build",
  command: "npm run build",
  workingDirectory: workspacePath,
  startTimestamp: "2026-06-28T12:00:00.000Z",
  endTimestamp: "2026-06-28T12:00:03.000Z",
  durationMs: 3000,
  stdout: "built",
  stderr: "",
  exitCode: 0,
};

assert(detectAuditMode("audit the entire project do not fix anything") === "ProjectAudit", "manual project audit still routes to ProjectAudit");
assert(detectAuditMode("what is the health of this project") === "ProjectAudit", "project health request still routes to ProjectAudit");
assert(detectAuditMode("audit code") === "CodeAudit", "manual code audit still routes to CodeAudit");
assert(detectAuditMode("audit src/main.tsx") === "FileAudit", "manual file audit still routes to FileAudit");
assert(!isAuditSaveRequest("audit the entire project"), "normal audit request should not become a save request");
assert(isAuditSaveRequest("save audit report"), "explicit save audit report request remains detectable");

const projectAudit = buildProjectAuditReport({
  workspacePath,
  projectMemory,
  livingBuildPlan,
  manifest,
  latestBuildResult,
  latestFailure: null,
});

assert(projectAudit.includes("Project Audit Report: Audit Preservation"), "manual project audit still works");
assert(projectAudit.includes("Development Progress"), "project audit keeps development progress");
assert(projectAudit.includes("Founder MVP Progress"), "project audit keeps founder MVP progress");
assert(projectAudit.includes("Product Vision Progress"), "project audit keeps product vision progress");
assert(projectAudit.includes("Quality Progress"), "project audit keeps quality progress");
assert(projectAudit.includes("Launch Readiness"), "project audit keeps launch readiness");
assert(projectAudit.includes("Architecture Review"), "project audit keeps architecture review");
assert(projectAudit.includes("Roadmap Alignment"), "project audit keeps roadmap alignment");
assert(projectAudit.includes("Founder Summary"), "project audit keeps founder summary");
assert(!projectAudit.includes("Code Audit Report"), "project audit should not concatenate code audit output");

const codeFindings = inspectSourceFilesForCodeAudit([
  {
    path: "src/main.tsx",
    content: [
      "const root = document.getElementById('root');",
      "root!.innerHTML = '<main></main>';",
      "const value: any = document.querySelector('#value');",
      "console.log(value);",
      "// TODO: preserve audit tools",
    ].join("\n"),
  },
]);

assert(codeFindings.length >= 3, "code audit inspection still returns concrete file findings");
assert(codeFindings.some((finding) => finding.includes("src/main.tsx")), "code audit findings keep file names");

const selectedCodeFiles = selectCodeAuditFiles(manifest);
assert(selectedCodeFiles.includes("src/main.tsx"), "code audit file selection still prefers main source files");
assert(selectedCodeFiles.includes("src/App.tsx"), "code audit file selection still includes app source files");

const codeAudit = buildCodeAuditReport({
  workspacePath,
  manifest,
  latestFailure: null,
  sourceFiles: [
    {
      path: "src/main.tsx",
      content: [
        "const root = document.getElementById('root');",
        "root!.innerHTML = '<main></main>';",
        "const value: any = document.querySelector('#value');",
        "console.log(value);",
      ].join("\n"),
    },
  ],
});

assert(codeAudit.includes("Code Audit Report"), "code audit still works when requested");
assert(codeAudit.includes("Code/File Findings"), "code audit keeps code/file findings section");
assert(codeAudit.includes("src/main.tsx"), "code audit includes concrete source file references");
assert(!codeAudit.includes("Project Audit Report"), "code audit should not concatenate project audit output");
assert(!codeAudit.includes("Development Progress"), "code audit should not become project audit output");

const dashboard = buildProjectDashboardModel({
  workspacePath,
  projectMemory,
  livingBuildPlan,
  founderManifest: null,
  manifest,
});
assert(dashboard.projectPulse.projectName === "Audit Preservation", "dashboard/audit-related project helper remains importable");
assert(dashboard.progressLayers.developmentProgress.includes("build-plan tasks"), "dashboard still exposes project health progress context");

const developer = developerModeControlPreferences("assisted");
const founder = founderModeControlPreferences("guided");
assert(shouldShowAuditControls({ preferences: developer }), "Developer Mode can still access audit controls");
assert(!shouldShowAuditControls({ preferences: founder }), "Founder Mode may hide audit controls by default");
assert(typeof buildProjectAuditReport === "function", "Founder Mode simplification does not delete project audit helper");
assert(typeof buildCodeAuditReport === "function", "Founder Mode simplification does not delete code audit helper");
assert(typeof detectAuditMode === "function", "audit routing helper remains importable");

assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: developer, isSensitive: true }),
  "sensitive actions still require approval in Developer Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: founder, isSensitive: true }),
  "sensitive actions still require approval in Founder Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: developer, isDestructive: true }),
  "destructive actions still require approval in Developer Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: founder, isDestructive: true }),
  "destructive actions still require approval in Founder Mode"
);

console.log("audit preservation regression passed");
