import type { LivingBuildPlan } from "../types";
import { milestoneCompletedWithPlanningOnlyPatches } from "./implementationMilestone";
import { MVP_IMPLEMENTATION_MILESTONE_ID } from "./mvpImplementationPhase";

const FOUNDER_MVP_MILESTONE_ID = "founder-mvp-phase";
const PHASE_2_MILESTONE_ID = "phase-2-implementation";

export function buildMvpImplementationReadyReply(plan: LivingBuildPlan | null): string | null {
  const milestone = plan?.milestones.find((item) => item.id === MVP_IMPLEMENTATION_MILESTONE_ID);
  const next = milestone?.tasks.find((task) => task.status === "next" || task.status === "doing" || task.status === "todo");
  if (!next) return null;
  return [
    "MVP Implementation queue ready",
    "",
    `Next task: ${next.title}`,
    "Say continue to generate the next implementation patch.",
    "NF reconciled build-plan status against disk and found placeholder MVP modules.",
  ].join("\n");
}

export function detectContinueBuildIntent(prompt: string): boolean {
  return /^(?:(?:continue|conyinue|contune|continuee|continuw)(?:\s+(?:(?:with\s+)?(?:that|option\s+[abc])|here|from\s+here|this\s+project|the\s+build))?|(?:ok\s+)?let'?s\s+(?:continue|conyinue|contune)|(?:ok\s+)?lets\s+(?:continue|conyinue|contune)|keep\s+going|keep\s+building|go\s+on|next|next\s+task|let'?s\s+complete\s+task\s+\d+)\.?$/i.test(prompt.trim());
}

export function getNextActionableBuildTask(plan: LivingBuildPlan | null): {
  milestone: LivingBuildPlan["milestones"][number];
  task: LivingBuildPlan["milestones"][number]["tasks"][number];
} | null {
  const milestone = plan?.milestones.find((item) => item.id === plan.currentMilestoneId) ?? plan?.milestones[0];
  if (!milestone) return null;
  const task = milestone.tasks.find((item) => item.id === plan?.currentTaskId && item.status !== "done") ??
    milestone.tasks.find((item) => item.status === "next" || item.status === "doing" || item.status === "todo" || item.status === "blocked");
  if (task) return { milestone, task };
  for (const nextMilestone of plan?.milestones ?? []) {
    if (nextMilestone.id === milestone.id) continue;
    const nextTask = nextMilestone.tasks.find((item) => item.status === "next" || item.status === "doing" || item.status === "todo" || item.status === "blocked");
    if (nextTask) return { milestone: nextMilestone, task: nextTask };
  }
  return null;
}

export function buildScaffoldCompleteContinuationReply(plan: LivingBuildPlan | null): string {
  const next = getNextActionableBuildTask(plan);
  if (next) {
    return [
      "Ready to continue implementation",
      "",
      `Next task: ${next.task.title}`,
      "Say continue to generate the next implementation patch.",
    ].join("\n");
  }

  const mvpReady = buildMvpImplementationReadyReply(plan);
  if (mvpReady) return mvpReady;

  const founderMvp = plan?.milestones.find((item) => item.id === FOUNDER_MVP_MILESTONE_ID);
  const phase2 = plan?.milestones.find((item) => item.id === PHASE_2_MILESTONE_ID);
  const founderFalselyComplete =
    founderMvp &&
    founderMvp.tasks.every((task) => task.status === "done") &&
    plan &&
    milestoneCompletedWithPlanningOnlyPatches(founderMvp, plan.completedSteps);

  if (founderFalselyComplete || (founderMvp && founderMvp.tasks.every((task) => task.status === "done") && !phase2)) {
    return [
      "Implementation Phase Needed",
      "",
      "Foundation planning is complete, but the application workspace has not been scaffolded yet.",
      founderMvp ? `Founder MVP Phase: ${founderMvp.tasks.length} / ${founderMvp.tasks.length} planning-only tasks were marked complete.` : "",
      "",
      "Next action options:",
      "A. Restart Founder MVP implementation (real app files)",
      "B. Generate Phase 2 Build Plan",
      "C. Await founder instructions",
    ].filter(Boolean).join("\n");
  }

  const milestone = plan?.milestones.find((item) => item.id === plan.currentMilestoneId) ?? plan?.milestones[0];
  const completed = milestone?.tasks.filter((task) => task.status === "done").length ?? 0;
  const total = milestone?.tasks.length ?? 0;
  return [
    "Scaffold Complete",
    "",
    total > 0 ? `Current build-plan phase: ${completed}/${total} tasks complete.` : "Current build-plan phase is complete.",
    "The scaffold/build-plan phase is done, so I will not repeat the final completed task.",
    "",
    "Next action options:",
    "A. Generate Founder MVP Phase",
    "B. Generate Phase 2 Build Plan",
    "C. Await founder instructions",
  ].join("\n");
}

export function isStatusOnlyProjectPrompt(prompt: string): boolean {
  return /\b(what\s+were\s+we\s+working\s+on|what(?:'s| is)\s+(?:the\s+)?next(?:\s+recommended\s+step)?|what\s+are\s+we\s+building|what\s+milestone\s+are\s+we\s+on|what\s+is\s+left\s+to\s+do|what\s+was\s+the\s+last\s+thing\s+we\s+completed|what\s+should\s+we\s+work\s+on\s+next|summarize\s+project\s+progress|what\s+is\s+the\s+next\s+phase|check\s+(?:the\s+)?build\s+plan|show\s+(?:the\s+)?current\s+build\s+status(?:\s+only)?)\b/i.test(prompt);
}
