import type { BuildMilestone, BuildTask, LivingBuildPlan, ProjectMemory, TaskKind } from "../types";
import { defaultTasksForMilestone, inferProjectKind } from "../projectCreation/milestoneTasks";
import { getNextActionableBuildTask } from "./continueIntent";
import { writeLivingBuildPlan } from "../memory/buildPlanStore";
import { writeProjectMemory } from "../memory/projectMemoryStore";
import {
  milestoneCompletedWithPlanningOnlyPatches,
  resetImplementationMilestone,
} from "./implementationMilestone";
import { MVP_IMPLEMENTATION_MILESTONE_ID } from "./mvpImplementationPhase";

const FOUNDER_MVP_MILESTONE_ID = "founder-mvp-phase";
const PHASE_2_MILESTONE_ID = "phase-2-implementation";

function task(
  id: string,
  title: string,
  status: BuildTask["status"] = "todo",
  kind: TaskKind = "scaffold"
): BuildTask {
  return { id, title, status, kind };
}

export function isScaffoldPhaseComplete(plan: LivingBuildPlan | null): boolean {
  if (!plan?.milestones.length) return false;
  if (getNextActionableBuildTask(plan)) return false;
  const mvpImplementation = plan.milestones.find((milestone) => milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID);
  if (mvpImplementation?.tasks.some((task) => task.status !== "done")) return false;
  const hasImplementationMilestone = plan.milestones.some(
    (milestone) =>
      milestone.id === FOUNDER_MVP_MILESTONE_ID ||
      milestone.id === PHASE_2_MILESTONE_ID ||
      milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID
  );
  if (hasImplementationMilestone) {
    return plan.milestones.every((milestone) =>
      milestone.tasks.every((task) => task.status === "done")
    );
  }
  return true;
}

export function resolveDisplayNextStep(
  plan: LivingBuildPlan | null,
  projectMemory?: ProjectMemory | null
): string {
  if (!plan) return "Create or approve the master build plan.";
  const mvpImplementation = plan.milestones.find((milestone) => milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID);
  if (mvpImplementation) {
    const next = mvpImplementation.tasks.find(
      (item) => item.status === "next" || item.status === "doing" || item.status === "todo"
    );
    if (next) return next.title;
  }
  if (plan.milestones.some((milestone) => milestone.id === PHASE_2_MILESTONE_ID)) {
    const phase2 = plan.milestones.find((milestone) => milestone.id === PHASE_2_MILESTONE_ID);
    const next = phase2?.tasks.find((item) => item.status === "next" || item.status === "doing" || item.status === "todo");
    if (next) return next.title;
  }
  if (plan.milestones.some((milestone) => milestone.id === FOUNDER_MVP_MILESTONE_ID)) {
    const founderMvp = plan.milestones.find((milestone) => milestone.id === FOUNDER_MVP_MILESTONE_ID);
    const next = founderMvp?.tasks.find((item) => item.status === "next" || item.status === "doing" || item.status === "todo");
    if (next) return next.title;
  }
  if (isScaffoldPhaseComplete(plan)) {
    return "Generate Founder MVP Phase (Option A)";
  }
  const next = getNextActionableBuildTask(plan);
  if (next) return next.task.title;
  return plan.nextRecommendedStep?.trim() ||
    projectMemory?.resumeState?.resumePrompt?.trim() ||
    "Continue the current build plan.";
}

export function reconcileBuildPlanProgress(plan: LivingBuildPlan): LivingBuildPlan {
  const next = getNextActionableBuildTask(plan);
  const milestones = plan.milestones.map((milestone) => ({
    ...milestone,
    tasks: milestone.tasks.map((item) => ({ ...item })),
  }));

  if (!next) {
    const activeMilestone =
      milestones.find((milestone) => milestone.id === plan.currentMilestoneId) ?? milestones[milestones.length - 1];
    const completed = activeMilestone?.tasks.filter((item) => item.status === "done").length ?? 0;
    const total = activeMilestone?.tasks.length ?? 0;
    const hasMvpImplementation = milestones.some((milestone) => milestone.id === MVP_IMPLEMENTATION_MILESTONE_ID);
    const hasFounderMvp = milestones.some((milestone) => milestone.id === FOUNDER_MVP_MILESTONE_ID);
    const nextRecommendedStep = hasMvpImplementation
      ? resolveDisplayNextStep({ ...plan, milestones })
      : hasFounderMvp
        ? resolveDisplayNextStep({ ...plan, milestones })
        : "Generate Founder MVP Phase (Option A)";
    return {
      ...plan,
      milestones,
      currentTaskId: undefined,
      nextRecommendedStep,
      progressSummary: activeMilestone
        ? `${activeMilestone.name}: ${completed} / ${total} tasks complete.`
        : plan.progressSummary,
    };
  }

  const activeMilestone = milestones.find((milestone) => milestone.id === next.milestone.id) ?? next.milestone;
  const completed = activeMilestone.tasks.filter((item) => item.status === "done").length;
  return {
    ...plan,
    milestones,
    currentMilestoneId: next.milestone.id,
    currentTaskId: next.task.id,
    nextRecommendedStep: next.task.title,
    progressSummary: `${activeMilestone.name}: ${completed} / ${activeMilestone.tasks.length} tasks complete.`,
  };
}

export type ScaffoldPhaseOption = "founder_mvp" | "phase_2" | "await";

export function detectScaffoldPhaseOptionIntent(prompt: string): ScaffoldPhaseOption | null {
  const normalized = prompt.trim().toLowerCase();
  if (
    /\b(option\s*a|generate\s+founder\s+mvp\s+phase|founder\s+mvp\s+phase|start\s+founder\s+mvp)\b/.test(normalized) ||
    /^a\.?$/.test(normalized)
  ) {
    return "founder_mvp";
  }
  if (/\b(option\s*b|generate\s+phase\s*2|phase\s*2\s+build\s+plan)\b/.test(normalized) || /^b\.?$/.test(normalized)) {
    return "phase_2";
  }
  if (/\b(option\s*c|await\s+founder|wait\s+for\s+instructions)\b/.test(normalized) || /^c\.?$/.test(normalized)) {
    return "await";
  }
  return null;
}

export function detectProjectPlanContinuationIntent(prompt: string): boolean {
  return (
    /\b(?:start|continue)\b.*\b(?:project\s+plan|build\s+plan|next\s+(?:phase|step|milestone|part|recommended\s+step))\b/i.test(prompt) ||
    /\bCurrent milestone:\b/i.test(prompt) ||
    /\bNext recommended step:\b/i.test(prompt) ||
    /\bcheck\s+(?:the\s+)?build\s+plan\b/i.test(prompt) ||
    /\bwhat\s+is\s+the\s+next\s+phase\b/i.test(prompt)
  );
}

export function shouldAutoStartFounderMvp(prompt: string, plan: LivingBuildPlan | null): boolean {
  if (!plan || !isScaffoldPhaseComplete(plan)) return false;
  if (plan.milestones.some((milestone) => milestone.id === FOUNDER_MVP_MILESTONE_ID)) return false;
  return (
    detectScaffoldPhaseOptionIntent(prompt) === "founder_mvp" ||
    (detectProjectPlanContinuationIntent(prompt) && /\b(?:start|continue)\b/i.test(prompt)) ||
    /^continue\s+with\s+that\.?$/i.test(prompt.trim())
  );
}

function founderMvpTasks(milestoneId: string, plan: LivingBuildPlan, projectMemory: ProjectMemory | null): BuildTask[] {
  const text = [plan.mvpDefinition, projectMemory?.summary, projectMemory?.fullIdea].filter(Boolean).join(" ");
  if (/website\s+platform|industry\s+templates?|layout\s+templates?/i.test(text)) {
    return [
      task(`${milestoneId}-t1`, "Set up website project workspace scaffold", "next"),
      task(`${milestoneId}-t2`, "Build industry template picker shell"),
      task(`${milestoneId}-t3`, "Build layout template picker shell"),
      task(`${milestoneId}-t4`, "Build page and section editor shell"),
      task(`${milestoneId}-t5`, "Verify founder-testable Roofing website flow"),
    ];
  }
  const kind = inferProjectKind(text, projectMemory?.techStack ?? []);
  const defaults = defaultTasksForMilestone(milestoneId, "Founder MVP Phase", kind);
  if (defaults[0]) defaults[0].status = "next";
  return defaults;
}

function phase2Tasks(milestoneId: string, plan: LivingBuildPlan, projectMemory: ProjectMemory | null): BuildTask[] {
  const text = [plan.mvpDefinition, projectMemory?.summary, projectMemory?.fullIdea].filter(Boolean).join(" ");
  if (/website\s+platform|industry\s+templates?|layout\s+templates?/i.test(text)) {
    return [
      task(`${milestoneId}-t1`, "Scaffold TypeScript web app workspace", "next"),
      task(`${milestoneId}-t2`, "Add website project models and local persistence"),
      task(`${milestoneId}-t3`, "Build industry template picker page shell"),
      task(`${milestoneId}-t4`, "Build layout template picker page shell"),
      task(`${milestoneId}-t5`, "Build page and section editor route shell"),
      task(`${milestoneId}-t6`, "Verify local dev build and Roofing preview flow"),
    ];
  }
  const kind = inferProjectKind(text, projectMemory?.techStack ?? []);
  const defaults = defaultTasksForMilestone(milestoneId, "Phase 2 Implementation", kind);
  if (defaults[0]) defaults[0].status = "next";
  return defaults;
}

export function generatePhase2BuildPlan(
  plan: LivingBuildPlan,
  projectMemory: ProjectMemory | null,
  options?: { hasScaffold?: boolean }
): LivingBuildPlan {
  const existing = plan.milestones.find((milestone) => milestone.id === PHASE_2_MILESTONE_ID);
  if (existing) {
    if (options?.hasScaffold === false || milestoneCompletedWithPlanningOnlyPatches(existing, plan.completedSteps)) {
      return reconcileBuildPlanProgress(resetImplementationMilestone(plan, PHASE_2_MILESTONE_ID));
    }
    const nextTask =
      existing.tasks.find((item) => item.status === "next" || item.status === "doing" || item.status === "todo") ??
      existing.tasks.find((item) => item.status !== "done");
    return reconcileBuildPlanProgress({
      ...plan,
      currentMilestoneId: existing.id,
      currentTaskId: nextTask?.id,
      nextRecommendedStep: nextTask?.title ?? "Continue Phase 2 Implementation",
    });
  }

  const tasks = phase2Tasks(PHASE_2_MILESTONE_ID, plan, projectMemory);
  const milestone: BuildMilestone = {
    id: PHASE_2_MILESTONE_ID,
    name: "Phase 2 Implementation",
    goal: "Implement the first founder-testable application workspace and UI shells.",
    status: "active",
    tasks,
  };

  return reconcileBuildPlanProgress({
    ...plan,
    milestones: [...plan.milestones, milestone],
    currentMilestoneId: milestone.id,
    currentTaskId: tasks[0]?.id,
    nextRecommendedStep: tasks[0]?.title ?? "Start Phase 2 Implementation",
    progressSummary: `Phase 2 Implementation: 0 / ${tasks.length} tasks complete.`,
  });
}

export function generateFounderMvpPhase(
  plan: LivingBuildPlan,
  projectMemory: ProjectMemory | null,
  options?: { hasScaffold?: boolean }
): LivingBuildPlan {
  const existing = plan.milestones.find((milestone) => milestone.id === FOUNDER_MVP_MILESTONE_ID);
  if (existing) {
    if (options?.hasScaffold === false || milestoneCompletedWithPlanningOnlyPatches(existing, plan.completedSteps)) {
      return reconcileBuildPlanProgress(resetImplementationMilestone(plan, FOUNDER_MVP_MILESTONE_ID));
    }
    const nextTask =
      existing.tasks.find((item) => item.status === "next" || item.status === "doing" || item.status === "todo") ??
      existing.tasks.find((item) => item.status !== "done");
    return reconcileBuildPlanProgress({
      ...plan,
      currentMilestoneId: existing.id,
      currentTaskId: nextTask?.id,
      nextRecommendedStep: nextTask?.title ?? "Continue Founder MVP Phase",
    });
  }

  const tasks = founderMvpTasks(FOUNDER_MVP_MILESTONE_ID, plan, projectMemory);
  const milestone: BuildMilestone = {
    id: FOUNDER_MVP_MILESTONE_ID,
    name: "Founder MVP Phase",
    goal: "Move from foundation planning into the first founder-testable MVP implementation.",
    status: "active",
    tasks,
  };

  return reconcileBuildPlanProgress({
    ...plan,
    milestones: [
      ...plan.milestones.map((item) =>
        item.id === plan.currentMilestoneId ? { ...item, status: "done" as const } : item
      ),
      milestone,
    ],
    currentMilestoneId: milestone.id,
    currentTaskId: tasks[0]?.id,
    nextRecommendedStep: tasks[0]?.title ?? "Start Founder MVP Phase",
    progressSummary: `Founder MVP Phase: 0 / ${tasks.length} tasks complete.`,
  });
}

export function buildScaffoldPhaseOptionReply(option: ScaffoldPhaseOption, plan: LivingBuildPlan | null): string {
  if (option === "founder_mvp") {
    const next = plan?.milestones.find((milestone) => milestone.id === FOUNDER_MVP_MILESTONE_ID)?.tasks.find((task) => task.status === "next");
    return [
      "Founder MVP Phase started",
      "",
      "NF moved the project from foundation planning into Founder MVP Phase.",
      next ? `Next task: ${next.title}` : "Say continue to work the first Founder MVP task.",
      "No install or run commands were executed automatically.",
    ].join("\n");
  }
  if (option === "phase_2") {
    const next = plan?.milestones.find((milestone) => milestone.id === PHASE_2_MILESTONE_ID)?.tasks.find((task) => task.status === "next");
    return [
      "Phase 2 Build Plan started",
      "",
      "NF added Phase 2 Implementation tasks to the living build plan.",
      next ? `Next task: ${next.title}` : "Say continue to work the first Phase 2 task.",
      "No install or run commands were executed automatically.",
    ].join("\n");
  }
  return [
    "Awaiting founder instructions",
    "",
    "NF will hold here until you choose the next phase or give a specific direction.",
    "You can still ask for a build-plan status summary at any time.",
  ].join("\n");
}

export async function applyFounderMvpPhase(
  workspaceRoot: string,
  projectMemory: ProjectMemory,
  livingBuildPlan: LivingBuildPlan,
  hasScaffold = false
): Promise<{ projectMemory: ProjectMemory; livingBuildPlan: LivingBuildPlan }> {
  const updatedPlan = generateFounderMvpPhase(livingBuildPlan, projectMemory, { hasScaffold });
  const now = new Date().toISOString();
  const activeMilestone = updatedPlan.milestones.find((milestone) => milestone.id === updatedPlan.currentMilestoneId);
  const activeTask = activeMilestone?.tasks.find((task) => task.id === updatedPlan.currentTaskId);
  const memory: ProjectMemory = {
    ...projectMemory,
    updatedAt: now,
    todos: updatedPlan.milestones.flatMap((milestone) =>
      milestone.tasks.map((task) => ({
        id: task.id,
        text: task.title,
        status:
          task.status === "done"
            ? "done"
            : task.status === "blocked"
              ? "blocked"
              : task.id === activeTask?.id
                ? "doing"
                : "todo",
      }))
    ),
    resumeState: {
      ...projectMemory.resumeState,
      status: "active",
      activeMilestoneId: updatedPlan.currentMilestoneId,
      activeTaskId: updatedPlan.currentTaskId,
      lastWorkedAt: now,
      resumePrompt: updatedPlan.nextRecommendedStep,
    },
  };
  await writeLivingBuildPlan(workspaceRoot, updatedPlan);
  await writeProjectMemory(workspaceRoot, memory);
  return { projectMemory: memory, livingBuildPlan: updatedPlan };
}

export async function applyPhase2BuildPlan(
  workspaceRoot: string,
  projectMemory: ProjectMemory,
  livingBuildPlan: LivingBuildPlan,
  hasScaffold = false
): Promise<{ projectMemory: ProjectMemory; livingBuildPlan: LivingBuildPlan }> {
  const updatedPlan = generatePhase2BuildPlan(livingBuildPlan, projectMemory, { hasScaffold });
  const now = new Date().toISOString();
  const activeMilestone = updatedPlan.milestones.find((milestone) => milestone.id === updatedPlan.currentMilestoneId);
  const activeTask = activeMilestone?.tasks.find((task) => task.id === updatedPlan.currentTaskId);
  const memory: ProjectMemory = {
    ...projectMemory,
    updatedAt: now,
    todos: updatedPlan.milestones.flatMap((milestone) =>
      milestone.tasks.map((task) => ({
        id: task.id,
        text: task.title,
        status:
          task.status === "done"
            ? "done"
            : task.status === "blocked"
              ? "blocked"
              : task.id === activeTask?.id
                ? "doing"
                : "todo",
      }))
    ),
    resumeState: {
      ...projectMemory.resumeState,
      status: "active",
      activeMilestoneId: updatedPlan.currentMilestoneId,
      activeTaskId: updatedPlan.currentTaskId,
      lastWorkedAt: now,
      resumePrompt: updatedPlan.nextRecommendedStep,
    },
  };
  await writeLivingBuildPlan(workspaceRoot, updatedPlan);
  await writeProjectMemory(workspaceRoot, memory);
  return { projectMemory: memory, livingBuildPlan: updatedPlan };
}

export async function persistReconciledBuildPlan(
  workspaceRoot: string,
  projectMemory: ProjectMemory,
  livingBuildPlan: LivingBuildPlan
): Promise<{ projectMemory: ProjectMemory; livingBuildPlan: LivingBuildPlan }> {
  const reconciled = reconcileBuildPlanProgress(livingBuildPlan);
  const unchanged =
    reconciled.nextRecommendedStep === livingBuildPlan.nextRecommendedStep &&
    reconciled.currentTaskId === livingBuildPlan.currentTaskId &&
    reconciled.currentMilestoneId === livingBuildPlan.currentMilestoneId &&
    reconciled.progressSummary === livingBuildPlan.progressSummary;
  if (unchanged) {
    return { projectMemory, livingBuildPlan };
  }
  const now = new Date().toISOString();
  const memory: ProjectMemory = {
    ...projectMemory,
    updatedAt: now,
    resumeState: {
      ...projectMemory.resumeState,
      status: "active",
      activeMilestoneId: reconciled.currentMilestoneId,
      activeTaskId: reconciled.currentTaskId,
      lastWorkedAt: now,
      resumePrompt: reconciled.nextRecommendedStep,
    },
  };
  await writeLivingBuildPlan(workspaceRoot, reconciled);
  await writeProjectMemory(workspaceRoot, memory);
  return { projectMemory: memory, livingBuildPlan: reconciled };
}
