import { invoke } from "@tauri-apps/api/core";
import type {
  ActionLogEntry,
  DirEntry,
  FounderManifest,
  GlobalMemory,
  KnownProject,
  LivingBuildPlan,
  NewProjectDraft,
  NewProjectFilePreview,
  NewProjectPlanPreview,
  ProjectBlueprint,
  ProjectMemory,
} from "../types";
import { writeWorkspaceProjectBlueprint } from "../product/projectBlueprintStore";
import { appendActionLogEntry } from "../memory/actionLogStore";
import { readGlobalMemory, writeGlobalMemory } from "../memory/globalMemoryStore";
import { writeFounderManifest } from "../memory/founderManifestStore";
import { writeLivingBuildPlan } from "../memory/buildPlanStore";
import { writeProjectMemory } from "../memory/projectMemoryStore";

const MEMORY_FILES = [
  ".devassistant/project-memory.json",
  ".devassistant/build-plan.json",
  ".devassistant/action-log.jsonl",
  "founder-manifest.json",
];
const POST_CREATION_FALLBACK_STEP = "Run build check or continue the first working interaction.";

function toForwardSlash(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function assertSafeRelativePath(path: string): void {
  const normalized = toForwardSlash(path);
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`Unsafe project file path: ${path}`);
  }
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Path traversal is not allowed: ${path}`);
  }
}

function splitWindowsRoot(targetPath: string): { root: string; rel: string } {
  const normalized = toForwardSlash(targetPath.trim());
  const match = /^([a-zA-Z]:)\/(.+)$/.exec(normalized);
  if (!match) throw new Error("Target project path must be an absolute Windows path.");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("Target project path must not contain path traversal.");
  }
  return { root: `${match[1]}/`, rel: match[2] };
}

function normalizeAbsolutePath(path: string): string {
  return toForwardSlash(path).toLowerCase();
}

function assertNotInsideEngineRepo(targetPath: string, engineRepoPath?: string): void {
  if (!engineRepoPath) return;
  const target = normalizeAbsolutePath(targetPath);
  const engine = normalizeAbsolutePath(engineRepoPath);
  if (target === engine || target.startsWith(`${engine}/`)) {
    throw new Error("Refusing to create a new project inside the NF engine repository.");
  }
}

function projectIdFromDraft(draft: NewProjectDraft): string {
  return draft.slug || draft.projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "untitled-project";
}

function createPostCreationMilestones(plan: NewProjectPlanPreview, now: string): {
  milestones: LivingBuildPlan["milestones"];
  currentMilestoneId: string;
  currentTaskId?: string;
  nextRecommendedStep: string;
} {
  const milestones = plan.milestones.map((milestone) => ({
    ...milestone,
    tasks: milestone.tasks.map((task) => ({ ...task })),
  }));
  const activeMilestone = milestones.find((milestone) => milestone.status === "active") ?? milestones[0];
  if (!activeMilestone) {
    return { milestones, currentMilestoneId: "", nextRecommendedStep: POST_CREATION_FALLBACK_STEP };
  }
  const scaffoldTask =
    activeMilestone.tasks.find((task) => task.id === "m1-t1") ??
    activeMilestone.tasks.find((task) => /scaffold/i.test(task.title)) ??
    activeMilestone.tasks[0];
  if (scaffoldTask) {
    scaffoldTask.status = "done";
    scaffoldTask.completedAt = now;
  }
  const nextTask = activeMilestone.tasks.find((task) => task.status === "next" || task.status === "doing" || task.status === "todo");
  if (nextTask) {
    nextTask.status = "next";
  }
  return {
    milestones,
    currentMilestoneId: activeMilestone.id,
    currentTaskId: nextTask?.id,
    nextRecommendedStep: nextTask?.title ?? POST_CREATION_FALLBACK_STEP,
  };
}

function createProjectMemory(
  draft: NewProjectDraft,
  plan: NewProjectPlanPreview,
  filePreview: NewProjectFilePreview,
  now: string,
  postCreation: ReturnType<typeof createPostCreationMilestones>
): ProjectMemory {
  const projectId = projectIdFromDraft(draft);
  return {
    schemaVersion: 1,
    projectId,
    name: draft.projectName,
    aliases: [draft.projectName, draft.slug].filter(Boolean),
    path: filePreview.targetPath,
    createdAt: now,
    updatedAt: now,
    status: "active",
    lifecycleStage: "buildingMvp",
    fullIdea: draft.ideaText,
    summary: plan.mvpDefinition,
    techStack: plan.inferredStack,
    architectureNotes: [],
    decisions: [],
    importantFiles: filePreview.filesToCreate.map((file) => ({
      path: file.path,
      reason: file.reason,
    })),
    generatedFiles: filePreview.filesToCreate.map((file) => ({
      path: file.path,
      createdAt: now,
      reason: file.reason,
    })),
    commands: plan.suggestedCommands,
    todos: plan.milestones.flatMap((milestone) =>
      milestone.tasks.map((task) => ({
        id: task.id,
        text: task.title,
        status:
          task.id === "m1-t1" ? "done" :
          task.id === postCreation.currentTaskId ? "doing" :
          task.status === "done" ? "done" : task.status === "doing" ? "doing" : task.status === "blocked" ? "blocked" : "todo",
      }))
    ),
    knownIssues: [],
    recentWork: [
      {
        id: `work-${Date.now()}`,
        date: now,
        completed: "Created initial project files and NF memory.",
        filesChanged: [...filePreview.filesToCreate.map((file) => file.path), ...MEMORY_FILES],
        worksNow: ["Project scaffold exists on disk."],
        stillNeedsWork: ["Run/install commands have not been executed."],
        nextRecommendedStep: postCreation.nextRecommendedStep,
      },
    ],
    resumeState: {
      status: "active",
      activeMilestoneId: postCreation.currentMilestoneId,
      activeTaskId: postCreation.currentTaskId,
      lastWorkedAt: now,
      resumePrompt: postCreation.nextRecommendedStep,
    },
  };
}

function createLivingBuildPlan(
  draft: NewProjectDraft,
  plan: NewProjectPlanPreview,
  postCreation: ReturnType<typeof createPostCreationMilestones>,
  now: string,
  filesChanged: string[]
): LivingBuildPlan {
  return {
    schemaVersion: 1,
    projectId: projectIdFromDraft(draft),
    mvpDefinition: plan.mvpDefinition,
    milestones: postCreation.milestones,
    currentMilestoneId: postCreation.currentMilestoneId,
    currentTaskId: postCreation.currentTaskId,
    completedSteps: [
      {
        id: `step-${Date.now()}`,
        completedAt: now,
        milestoneId: postCreation.currentMilestoneId,
        taskId: "m1-t1",
        completed: "Create project scaffold",
        filesChanged,
        worksNow: ["Initial project files exist on disk."],
        stillNeedsWork: ["Install/build commands have not been run."],
        nextRecommendedStep: postCreation.nextRecommendedStep,
      },
    ],
    nextRecommendedStep: postCreation.nextRecommendedStep,
    progressSummary: "MVP Scaffold: 1 / 4 tasks complete.",
    pausedState: { isPaused: false },
  };
}

function createFounderManifest(draft: NewProjectDraft, plan: NewProjectPlanPreview, now: string): FounderManifest {
  return {
    schemaVersion: 1,
    projectId: projectIdFromDraft(draft),
    vision: draft.ideaText,
    mission: `Ship the first working MVP for ${draft.projectName}.`,
    targetCustomer: "Needs founder clarification",
    problem: "Needs founder clarification",
    mvpDefinition: plan.mvpDefinition,
    successMetric: "A clean local demo can be run and explained.",
    notInV1: ["Unapproved feature expansion", "Production deployment automation"],
    futureRoadmap: plan.milestones.slice(1).map((milestone) => milestone.name),
    updatedAt: now,
  };
}

function upsertGlobalProject(memory: GlobalMemory, projectMemory: ProjectMemory, _plan: LivingBuildPlan): GlobalMemory {
  const now = new Date().toISOString();
  const knownProject: KnownProject = {
    id: projectMemory.projectId,
    name: projectMemory.name,
    aliases: projectMemory.aliases,
    path: projectMemory.path,
    summary: projectMemory.summary,
    lastOpenedAt: now,
  };
  return {
    ...memory,
    updatedAt: now,
    projects: [
      knownProject,
      ...memory.projects.filter((project) => project.id !== knownProject.id && project.path !== knownProject.path),
    ],
  };
}

async function exists(workspaceRoot: string, path: string): Promise<boolean> {
  return invoke<boolean>("workspace_exists", { workspaceRoot, path });
}

async function readTargetEntries(targetPath: string): Promise<{ exists: boolean; entries: DirEntry[] }> {
  const target = splitWindowsRoot(targetPath);
  const targetExists = await exists(target.root, target.rel).catch(() => false);
  if (!targetExists) return { exists: false, entries: [] };
  try {
    return { exists: true, entries: await invoke<DirEntry[]>("workspace_read_dir", { workspaceRoot: target.root, path: target.rel }) };
  } catch {
    return { exists: true, entries: [] };
  }
}

export interface CreatedProjectResult {
  projectMemory: ProjectMemory;
  livingBuildPlan: LivingBuildPlan;
  founderManifest: FounderManifest;
}

export async function commitNewProjectFiles(
  draft: NewProjectDraft,
  plan: NewProjectPlanPreview,
  filePreview: NewProjectFilePreview,
  options: { engineRepoPath?: string; blueprint?: ProjectBlueprint } = {}
): Promise<CreatedProjectResult> {
  const targetPath = toForwardSlash(filePreview.targetPath);
  assertNotInsideEngineRepo(targetPath, options.engineRepoPath);
  const target = splitWindowsRoot(targetPath);
  const proposedFiles = filePreview.filesToCreate.map((file) => toForwardSlash(file.path));
  const proposedFolders = filePreview.foldersToCreate.map(toForwardSlash);
  [...proposedFiles, ...proposedFolders].forEach(assertSafeRelativePath);

  const targetEntries = await readTargetEntries(targetPath);
  if (targetEntries.entries.length > 0) {
    throw new Error(`Target project folder is not empty. Choose a new path, archive it, or import it instead: ${targetEntries.entries.map((entry) => entry.name).join(", ")}`);
  }

  const blockedExistingFiles = [...proposedFiles, ...MEMORY_FILES];
  if (targetEntries.exists) {
    for (const path of blockedExistingFiles) {
      assertSafeRelativePath(path);
      if (await exists(targetPath, path)) {
        throw new Error(`Refusing to overwrite existing file: ${path}`);
      }
    }
  }

  await invoke("workspace_mkdir_all", { workspaceRoot: target.root, path: target.rel });

  for (const folder of proposedFolders) {
    await invoke("workspace_mkdir_all", { workspaceRoot: targetPath, path: folder });
  }
  for (const file of filePreview.filesToCreate) {
    await invoke("workspace_write_file", {
      workspaceRoot: targetPath,
      path: toForwardSlash(file.path),
      content: file.content,
    });
  }

  const now = new Date().toISOString();
  const postCreation = createPostCreationMilestones(plan, now);
  const projectMemory = createProjectMemory(draft, plan, filePreview, now, postCreation);
  const livingBuildPlan = createLivingBuildPlan(draft, plan, postCreation, now, proposedFiles);
  const founderManifest = createFounderManifest(draft, plan, now);
  await writeProjectMemory(targetPath, projectMemory);
  await writeLivingBuildPlan(targetPath, livingBuildPlan);
  await writeFounderManifest(targetPath, founderManifest);

  const createEntry: ActionLogEntry = {
    ts: now,
    projectId: projectMemory.projectId,
    action: "create_project",
    summary: `Created new project ${projectMemory.name}`,
    files: [...proposedFiles, ...MEMORY_FILES],
    approved: true,
  };
  const writeEntry: ActionLogEntry = {
    ts: now,
    projectId: projectMemory.projectId,
    action: "write_file",
    summary: "Created approved starter files.",
    files: proposedFiles,
    approved: true,
  };
  await appendActionLogEntry(targetPath, createEntry);
  await appendActionLogEntry(targetPath, writeEntry);
  if (options.blueprint) {
    await writeWorkspaceProjectBlueprint(targetPath, options.blueprint);
  }
  writeGlobalMemory(upsertGlobalProject(readGlobalMemory(), projectMemory, livingBuildPlan));

  return { projectMemory, livingBuildPlan, founderManifest };
}
