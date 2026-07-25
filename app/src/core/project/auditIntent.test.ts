import type { LivingBuildPlan, ProjectManifest, ProjectMemory } from "../types";
import { buildCodeAuditReport, buildProjectAuditReport, detectAuditMode, isAuditSaveRequest } from "./auditIntent";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const prompt = "audit the entire project do not fix anything just give a report";
assert(detectAuditMode(prompt) === "ProjectAudit", "entire project audit should route to ProjectAudit");

const plan: LivingBuildPlan = {
  schemaVersion: 1,
  projectId: "foundry",
  mvpDefinition: "Foundry MVP",
  milestones: [
    {
      id: "m1",
      name: "Core Experience",
      goal: "Build core project workflow.",
      status: "active",
      tasks: [
        { id: "t1", title: "Add primary API route", status: "done" },
        { id: "t2", title: "Add request validation", status: "next" },
      ],
    },
  ],
  currentMilestoneId: "m1",
  currentTaskId: "t2",
  completedSteps: [],
  nextRecommendedStep: "Add request validation",
  progressSummary: "Core Experience: 1 / 2 tasks complete.",
  pausedState: { isPaused: false },
};

const memory = {
  name: "Foundry",
  path: "D:\\dev\\nf-projects\\foundry",
} as ProjectMemory;

const manifest: ProjectManifest = {
  projectTypes: ["typescript", "vite"],
  configFiles: ["package.json", "tsconfig.json"],
  lockfiles: [],
  fileList: ["src/main.tsx", "package.json", "tsconfig.json"],
  dependencyIndicators: {},
};

const report = buildProjectAuditReport({
  workspacePath: "D:\\dev\\nf-projects\\foundry",
  projectMemory: memory,
  livingBuildPlan: plan,
  manifest,
  latestBuildResult: null,
  latestFailure: null,
});

assert(report.includes("Project Audit Report"), "project audit should have one project audit title");
assert(report.includes("Development Progress"), "project audit should include Development Progress");
assert(report.includes("Founder MVP Progress"), "project audit should include Founder MVP Progress");
assert(report.includes("Product Vision Progress"), "project audit should include Product Vision Progress");
assert(report.includes("Quality Progress"), "project audit should include Quality Progress");
assert(report.includes("Launch Readiness"), "project audit should include Launch Readiness");
assert(report.indexOf("Development Progress") < report.indexOf("Founder MVP Progress"), "progress layers should be ordered");
assert(report.indexOf("Founder MVP Progress") < report.indexOf("Product Vision Progress"), "progress layers should be ordered");
assert(report.indexOf("Product Vision Progress") < report.indexOf("Quality Progress"), "progress layers should be ordered");
assert(report.indexOf("Quality Progress") < report.indexOf("Launch Readiness"), "progress layers should be ordered");
assert(report.indexOf("Launch Readiness") < report.indexOf("Architecture Review"), "Architecture Review should follow progress layers");
assert(report.includes("Roadmap Alignment"), "project audit should include Roadmap Alignment");
assert(report.includes("Next recommended step: Add request validation"), "project audit should include next step");
assert(report.includes("Code Findings"), "project audit can include code findings as one section");
assert(!report.includes("Code Audit Report"), "project audit should not concatenate a full code audit report");
assert(!report.includes("AUDIT_REPORT.md"), "project audit should not create or name a report file unless asked");
assert(report.indexOf("Development Progress") < report.indexOf("Code Findings"), "project audit should not be only code/file focused");

const completedLocalPlan: LivingBuildPlan = {
  ...plan,
  milestones: [
    {
      id: "m1",
      name: "Scaffold Demo",
      goal: "Complete a local scaffold/demo plan.",
      status: "done",
      tasks: Array.from({ length: 17 }, (_, index) => ({
        id: `t${index + 1}`,
        title: `Scaffold task ${index + 1}`,
        status: "done" as const,
      })),
    },
  ],
  currentMilestoneId: "m1",
  currentTaskId: "t17",
  nextRecommendedStep: "Review founder workflow gaps",
  progressSummary: "Scaffold Demo: 17 / 17 tasks complete.",
};

const founderVisionMemory = {
  ...memory,
  fullIdea: "Foundry is an AI-native startup operating system for founders. It needs project creation, memory isolation, living build plans, project execution, review loops, build verification, founder approvals, and a polished MVP workflow for real startup operations.",
} as ProjectMemory;

const scopedCompletionReport = buildProjectAuditReport({
  workspacePath: "D:\\dev\\nf-projects\\foundry",
  projectMemory: founderVisionMemory,
  livingBuildPlan: completedLocalPlan,
  manifest,
  latestBuildResult: { command: "npm run build", workingDirectory: "D:\\dev\\nf-projects\\foundry", startTimestamp: "2026-06-26T00:00:00.000Z", endTimestamp: "2026-06-26T00:00:01.000Z", durationMs: 1000, exitCode: 0, stdout: "", stderr: "", runId: "test-run" },
  latestFailure: null,
});

assert(!scopedCompletionReport.includes("Overall completion estimate"), "project audit should not use unqualified overall completion");
assert(!scopedCompletionReport.includes("Overall completion estimate: 100%"), "project audit should not claim overall project completion is 100%");
assert(scopedCompletionReport.includes("Current build plan progress"), "project audit should include current build plan progress");
assert(scopedCompletionReport.includes("17/17 tasks complete"), "project audit should show local task count separately");
assert(scopedCompletionReport.includes("Development build plan: 100%"), "100% should identify the development build-plan scope");
assert(scopedCompletionReport.includes("Founder vision completion"), "project audit should include founder vision completion");
assert(scopedCompletionReport.includes("Founder vision completion: low"), "scaffold/demo completion should not imply founder vision completion");
assert(scopedCompletionReport.includes("Founder MVP progress: 18%"), "scaffold-only project should show low founder MVP progress");
assert(scopedCompletionReport.includes("MVP readiness"), "project audit should include MVP readiness");
assert(scopedCompletionReport.includes("scaffold/prototype only"), "complete scaffold plan should be labeled scaffold/prototype only");
assert(scopedCompletionReport.includes("Launch readiness"), "project audit should include launch readiness");
assert(scopedCompletionReport.includes("Vision completion: 6%"), "project audit should include separate product vision progress");
assert(!scopedCompletionReport.includes("Demo Ready"), "project audit should not use Demo Ready as readiness wording");

assert(detectAuditMode("audit src/main.tsx") === "FileAudit", "file audit should remain file-level");
assert(detectAuditMode("audit code") === "CodeAudit", "code audit should remain code-level");
assert(isAuditSaveRequest("save audit report"), "save audit report should be an explicit save request");

const codeReport = buildCodeAuditReport({
  workspacePath: "D:\\dev\\nf-projects\\foundry",
  manifest,
  latestFailure: null,
  sourceFiles: [
    {
      path: "src/main.tsx",
      content: [
        "const root = document.getElementById('root');",
        "root!.innerHTML = '<main></main>';",
        "const requestSummary: any = document.querySelector('#request-summary');",
        "console.log(requestSummary);",
        "// TODO: split validation out before release",
      ].join("\n"),
    },
  ],
});
assert(codeReport.includes("Code Audit Report"), "code audit should include one code audit title");
assert(codeReport.includes("Code/File Findings"), "code audit should focus on code/file findings");
assert(codeReport.includes("Concrete file findings"), "code audit should include inspected source findings");
assert((codeReport.match(/src\/main\.tsx:/g) ?? []).length >= 3, "code audit should include at least three concrete file findings");
assert(codeReport.includes("innerHTML"), "code audit should report concrete content issues");
assert(!codeReport.includes("Project Audit Report"), "code audit should not concatenate project audit report");
assert(!codeReport.includes("Development Progress"), "code audit should not include full project audit progress template");

console.log("audit intent regression passed");
