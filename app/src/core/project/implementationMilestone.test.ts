import type { LivingBuildPlan } from "../types";
import {
  isPlanningOnlyFileChange,
  milestoneCompletedWithPlanningOnlyPatches,
  resetImplementationMilestone,
} from "./implementationMilestone";
import { reconcileBuildPlanProgress } from "./scaffoldPhase";
import { getNextActionableBuildTask } from "./continueIntent";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  isPlanningOnlyFileChange(["docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md"]),
  "foundation doc edits should count as planning-only"
);
assert(
  !isPlanningOnlyFileChange(["package.json", "docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md"]),
  "mixed implementation and planning files should not be planning-only"
);

const falselyCompletedPlan: LivingBuildPlan = {
  schemaVersion: 1,
  projectId: "nf-web-developer",
  mvpDefinition: "Website Platform",
  milestones: [
    {
      id: "founder-mvp-phase",
      name: "Founder MVP Phase",
      goal: "Implementation",
      status: "done",
      tasks: [
        { id: "founder-mvp-phase-t1", title: "Set up website project workspace scaffold", status: "done" },
        { id: "founder-mvp-phase-t2", title: "Build industry template picker shell", status: "done" },
      ],
    },
  ],
  currentMilestoneId: "founder-mvp-phase",
  currentTaskId: "founder-mvp-phase-t2",
  completedSteps: [
    {
      id: "step-1",
      completedAt: "2026-06-29T18:38:20.374Z",
      milestoneId: "founder-mvp-phase",
      taskId: "founder-mvp-phase-t1",
      completed: "Set up website project workspace scaffold",
      filesChanged: ["docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md"],
      worksNow: [],
      stillNeedsWork: [],
      nextRecommendedStep: "",
    },
    {
      id: "step-2",
      completedAt: "2026-06-29T18:38:52.963Z",
      milestoneId: "founder-mvp-phase",
      taskId: "founder-mvp-phase-t2",
      completed: "Build industry template picker shell",
      filesChanged: ["docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md"],
      worksNow: [],
      stillNeedsWork: [],
      nextRecommendedStep: "",
    },
  ],
  nextRecommendedStep: "Generate Founder MVP Phase (Option A)",
  progressSummary: "Founder MVP Phase: 2 / 2 tasks complete.",
  pausedState: { isPaused: false },
};

const founderMvp = falselyCompletedPlan.milestones[0]!;
assert(
  milestoneCompletedWithPlanningOnlyPatches(founderMvp, falselyCompletedPlan.completedSteps),
  "founder MVP completed only via foundation docs should be falsely complete"
);

const reset = reconcileBuildPlanProgress(resetImplementationMilestone(falselyCompletedPlan, "founder-mvp-phase"));
const next = getNextActionableBuildTask(reset);
assert(next?.task.title === "Set up website project workspace scaffold", "reset should restore first implementation task");
assert(next?.task.status === "next", "reset first task should be next");

console.log("implementation milestone regression passed");
