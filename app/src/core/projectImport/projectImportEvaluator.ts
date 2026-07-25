import type {
  ExistingProjectImportEvaluation,
  KnownIssue,
  LivingBuildPlan,
  ProjectManifest,
  ProjectMemory,
  DetectedCommands,
} from "../types";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { assessExistingProduct, type ProductFileSnapshot } from "../product/existingProductAssessment";
import {
  attachExistingProductAssessment,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { ProjectDetector } from "../project/ProjectDetector";
import { ProjectInspector } from "../inspect/ProjectInspector";
import type { WorkspaceService } from "../workspace/WorkspaceService";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imported-project";
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "Imported Project";
}

function titleFromSlug(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}

async function readOptional(workspace: WorkspaceService, path: string): Promise<string | null> {
  try {
    return await workspace.readFile(path);
  } catch {
    return null;
  }
}

async function inferProjectName(workspace: WorkspaceService, workspaceRoot: string): Promise<string> {
  const packageJson = await readOptional(workspace, "package.json");
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson) as { name?: string };
      if (pkg.name?.trim()) return titleFromSlug(pkg.name);
    } catch {
      /* ignore */
    }
  }
  const pubspec = await readOptional(workspace, "pubspec.yaml");
  const pubspecName = pubspec?.match(/^name:\s*["']?([^"'\r\n]+)["']?/m)?.[1]?.trim();
  if (pubspecName) return titleFromSlug(pubspecName);
  return titleFromSlug(basename(workspaceRoot));
}

function inferLikelyAppType(detectedTypes: string[], fileList: string[]): string {
  if (detectedTypes.includes("Flutter")) return "Flutter app";
  if (detectedTypes.includes("Tauri")) return "Desktop app";
  if (detectedTypes.includes("Next.js")) return "Web app";
  if (detectedTypes.includes("Node/TS") && fileList.some((path) => path.startsWith("src/"))) return "Web or Node project";
  if (detectedTypes.includes("Python")) return "Python project";
  return "Software project";
}

function detectDocs(fileList: string[]): string[] {
  return fileList.filter((path) => /(^|\/)(readme|contributing|changelog|license)(\.[a-z0-9]+)?$/i.test(path));
}

function shouldReadForAssessment(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return (
    /(^|\/)(package\.json|pubspec\.yaml|vite\.config\.[cm]?[jt]s|README\.md)$/i.test(normalized) ||
    /(^|\/)(main|App|router|routes|navigation)\.(tsx|ts|jsx|js|dart)$/i.test(normalized) ||
    /\/(components|widgets|screens|pages|routes)\//i.test(normalized)
  );
}

async function createAssessmentSnapshot(
  workspace: WorkspaceService,
  fileList: string[]
): Promise<ProductFileSnapshot[]> {
  return Promise.all(
    fileList.map(async (path) => ({
      path,
      content: shouldReadForAssessment(path) ? await readOptional(workspace, path) ?? undefined : undefined,
    }))
  );
}

async function inferSummary(workspace: WorkspaceService, projectName: string): Promise<string> {
  const readme = await readOptional(workspace, "README.md");
  if (!readme) return `${projectName} is an imported project ready for NF tracking.`;
  const firstUsefulLine = readme
    .split(/\r?\n/g)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 20);
  return firstUsefulLine ?? `${projectName} is an imported project ready for NF tracking.`;
}

function createKnownIssues(docs: string[], commands: DetectedCommands): KnownIssue[] {
  const issues: KnownIssue[] = [];
  if (!docs.some((path) => /readme/i.test(path))) {
    issues.push({
      id: "issue-docs-readme",
      title: "README not detected",
      status: "open",
      notes: "NF could not find a README during import evaluation.",
    });
  }
  if (!commands.dev && !commands.build && !commands.test) {
    issues.push({
      id: "issue-commands-missing",
      title: "Run/build/test commands not detected",
      status: "open",
      notes: "NF could not infer standard project commands.",
    });
  }
  return issues;
}

function createBuildPlanDraft(projectId: string, summary: string, needsClarification: boolean): LivingBuildPlan {
  return {
    schemaVersion: 1,
    projectId,
    mvpDefinition: needsClarification
      ? "Needs founder clarification before NF can define the MVP confidently."
      : `Continue shaping the existing project into a clean MVP: ${summary}`,
    milestones: [
      {
        id: "m1",
        name: "Import and Baseline",
        goal: "Confirm project purpose, run commands, and current working state.",
        status: "active",
        tasks: [
          { id: "m1-t1", title: "Confirm project goal and MVP definition", status: "next" },
          { id: "m1-t2", title: "Verify run/build/test commands", status: "todo" },
          { id: "m1-t3", title: "Identify current blockers and next milestone", status: "todo" },
        ],
      },
      {
        id: "m2",
        name: "MVP Completion",
        goal: "Finish the shortest path to a presentable MVP.",
        status: "planned",
        tasks: [],
      },
      {
        id: "m3",
        name: "Polish and Demo",
        goal: "Make the MVP presentable and easy to demo.",
        status: "planned",
        tasks: [],
      },
    ],
    currentMilestoneId: "m1",
    currentTaskId: "m1-t1",
    completedSteps: [],
    nextRecommendedStep: needsClarification
      ? "Answer the import questions so NF can lock the MVP definition."
      : "Confirm the MVP definition and baseline commands.",
    progressSummary: "Project import evaluation is drafted in memory only.",
    timelineEstimate: needsClarification ? "Cannot estimate until project goal is clarified." : "Initial import baseline: 1-2 focused sessions.",
    pausedState: { isPaused: false },
  };
}

export async function evaluateExistingProjectImport(
  workspace: WorkspaceService,
  workspaceRoot: string,
  manifest?: ProjectManifest | null
): Promise<ExistingProjectImportEvaluation> {
  const inspector = new ProjectInspector(workspace);
  const projectManifest = manifest ?? await inspector.buildManifest();
  const detector = new ProjectDetector(workspace);
  const detected = await detector.detect();
  const projectName = await inferProjectName(workspace, workspaceRoot);
  const projectId = slugify(projectName);
  const docs = detectDocs(projectManifest.fileList);
  const summary = await inferSummary(workspace, projectName);
  const likelyAppType = inferLikelyAppType(detected.detectedTypes, projectManifest.fileList);
  const assessment = assessExistingProduct({
    projectPath: workspaceRoot,
    files: await createAssessmentSnapshot(workspace, projectManifest.fileList),
  });
  const missingInformation = [
    summary.includes("ready for NF tracking") ? "MVP definition" : "",
    detected.detectedTypes.length === 0 ? "Tech stack confirmation" : "",
    !detected.detectedCommands.dev && !detected.detectedCommands.build ? "Run/build command" : "",
  ].filter(Boolean);
  const suggestedQuestions = missingInformation.length
    ? [
        "What is the MVP this project should ship first?",
        "What command should NF use to run or build it?",
        "What is the current milestone or blocker?",
      ]
    : [];
  const now = new Date().toISOString();
  const discoveryIntake = createDiscoveryIntake(`Continue existing project ${projectName}. ${summary}`);
  const projectBlueprintDraft = attachExistingProductAssessment(
    createProjectBlueprintFromDiscoveryIntake(discoveryIntake, {
      id: `blueprint-${projectId}`,
      projectId,
      name: projectName,
      slug: projectId,
      source: "existingProject",
      path: workspaceRoot,
      now,
    }),
    assessment,
    now
  );
  const projectMemoryDraft: ProjectMemory = {
    schemaVersion: 1,
    projectId,
    name: projectName,
    aliases: [projectName],
    path: workspaceRoot,
    createdAt: now,
    updatedAt: now,
    status: "active",
    lifecycleStage: missingInformation.length ? "planning" : "buildingMvp",
    fullIdea: summary,
    summary,
    techStack: detected.detectedTypes,
    architectureNotes: [],
    decisions: [],
    importantFiles: detected.importantFiles.map((path) => ({ path, reason: "Detected during import evaluation" })),
    generatedFiles: [],
    commands: detected.detectedCommands,
    todos: [],
    knownIssues: createKnownIssues(docs, detected.detectedCommands),
    recentWork: [],
    resumeState: {
      status: "active",
      activeMilestoneId: "m1",
      activeTaskId: "m1-t1",
      lastWorkedAt: now,
      resumePrompt: missingInformation.length
        ? "Clarify MVP definition and baseline commands."
        : "Confirm import baseline and choose the next milestone.",
    },
  };
  return {
    projectName,
    path: workspaceRoot,
    detectedStack: detected.detectedTypes,
    likelyAppType,
    detectedCommands: detected.detectedCommands,
    detectedDocs: docs,
    summary,
    missingInformation,
    suggestedQuestions,
    projectMemoryDraft,
    livingBuildPlanDraft: createBuildPlanDraft(projectId, summary, missingInformation.length > 0),
    projectBlueprintDraft,
  };
}
