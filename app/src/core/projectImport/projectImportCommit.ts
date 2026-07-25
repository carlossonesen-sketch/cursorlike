import type {
  ActionLogEntry,
  ExistingProjectImportEvaluation,
  GlobalMemory,
  KnownProject,
  LivingBuildPlan,
  ProjectBlueprint,
  ProjectMemory,
} from "../types";
import { appendActionLogEntry } from "../memory/actionLogStore";
import { readGlobalMemory, writeGlobalMemory } from "../memory/globalMemoryStore";
import { writeLivingBuildPlan } from "../memory/buildPlanStore";
import { writeProjectMemory } from "../memory/projectMemoryStore";
import { writeWorkspaceProjectBlueprint } from "../product/projectBlueprintStore";

export interface ExistingProjectImportCommitDeps {
  writeProjectMemory: (workspaceRoot: string, memory: ProjectMemory) => Promise<void>;
  writeLivingBuildPlan: (workspaceRoot: string, plan: LivingBuildPlan) => Promise<void>;
  writeProjectBlueprint: (workspaceRoot: string, blueprint: ProjectBlueprint) => Promise<void>;
  appendActionLogEntry: (workspaceRoot: string, entry: ActionLogEntry) => Promise<void>;
  readGlobalMemory: () => GlobalMemory;
  writeGlobalMemory: (memory: GlobalMemory) => void;
}

function defaultDeps(): ExistingProjectImportCommitDeps {
  return {
    writeProjectMemory,
    writeLivingBuildPlan,
    writeProjectBlueprint: writeWorkspaceProjectBlueprint,
    appendActionLogEntry,
    readGlobalMemory,
    writeGlobalMemory,
  };
}

function upsertKnownProject(memory: GlobalMemory, evaluation: ExistingProjectImportEvaluation): GlobalMemory {
  const now = new Date().toISOString();
  const projectMemory = evaluation.projectMemoryDraft;
  const knownProject: KnownProject = {
    id: projectMemory.projectId,
    name: evaluation.projectName,
    aliases: projectMemory.aliases,
    path: evaluation.path,
    summary: evaluation.summary,
    lastOpenedAt: now,
  };
  const projects = memory.projects.filter((project) =>
    project.id !== knownProject.id && project.path !== knownProject.path
  );
  return {
    ...memory,
    updatedAt: now,
    projects: [knownProject, ...projects],
  };
}

export async function commitExistingProjectImport(
  evaluation: ExistingProjectImportEvaluation,
  deps: ExistingProjectImportCommitDeps = defaultDeps()
): Promise<void> {
  const now = new Date().toISOString();
  const workspaceRoot = evaluation.path;
  const projectMemory = {
    ...evaluation.projectMemoryDraft,
    status: "active" as const,
    updatedAt: now,
    resumeState: {
      ...evaluation.projectMemoryDraft.resumeState,
      status: "active" as const,
      lastWorkedAt: now,
    },
  };
  const buildPlan = {
    ...evaluation.livingBuildPlanDraft,
    progressSummary: "Project imported into NF memory.",
  };
  const actionLogEntry: ActionLogEntry = {
    ts: now,
    projectId: projectMemory.projectId,
    action: "update_memory",
    summary: `Imported existing project into NF memory: ${evaluation.projectName}`,
    files: [
      ".devassistant/project-memory.json",
      ".devassistant/build-plan.json",
      ...(evaluation.projectBlueprintDraft ? [".devassistant/project-blueprint.json"] : []),
      ".devassistant/action-log.jsonl",
    ],
    approved: true,
  };

  await deps.writeProjectMemory(workspaceRoot, projectMemory);
  await deps.writeLivingBuildPlan(workspaceRoot, buildPlan);
  if (evaluation.projectBlueprintDraft) {
    await deps.writeProjectBlueprint(workspaceRoot, evaluation.projectBlueprintDraft);
  }
  await deps.appendActionLogEntry(workspaceRoot, actionLogEntry);
  deps.writeGlobalMemory(upsertKnownProject(deps.readGlobalMemory(), evaluation));
}
