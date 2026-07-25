import { invoke } from "@tauri-apps/api/core";
import type { LivingBuildPlan } from "../types";

const BUILD_PLAN_PATH = ".devassistant/build-plan.json";

export function createDefaultLivingBuildPlan(projectId = ""): LivingBuildPlan {
  return {
    schemaVersion: 1,
    projectId,
    mvpDefinition: "",
    milestones: [],
    currentMilestoneId: "",
    completedSteps: [],
    nextRecommendedStep: "",
    progressSummary: "",
    pausedState: { isPaused: false },
  };
}

export async function readLivingBuildPlan(workspaceRoot: string, projectId = ""): Promise<LivingBuildPlan> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: BUILD_PLAN_PATH,
    });
    return { ...createDefaultLivingBuildPlan(projectId), ...(JSON.parse(raw) as Partial<LivingBuildPlan>) };
  } catch {
    return createDefaultLivingBuildPlan(projectId);
  }
}

export async function writeLivingBuildPlan(workspaceRoot: string, plan: LivingBuildPlan): Promise<void> {
  await invoke("workspace_mkdir_all", { workspaceRoot, path: ".devassistant" });
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: BUILD_PLAN_PATH,
    content: JSON.stringify({ ...plan, schemaVersion: 1 }, null, 2),
  });
}
