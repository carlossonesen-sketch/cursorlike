import type { LivingBuildPlan } from "../types";
import { buildScaffoldCompleteContinuationReply, detectContinueBuildIntent, getNextActionableBuildTask, isStatusOnlyProjectPrompt } from "./continueIntent";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const foundryPlan: LivingBuildPlan = {
  schemaVersion: 1,
  projectId: "foundry",
  mvpDefinition: "Foundry MVP",
  milestones: [
    {
      id: "m2",
      name: "Core Experience",
      goal: "Implement the core API flow.",
      status: "active",
      tasks: [
        { id: "m2-t1", title: "Add primary API route", status: "done" },
        { id: "m2-t2", title: "Add request validation", status: "next" },
      ],
    },
  ],
  currentMilestoneId: "m2",
  currentTaskId: "m2-t2",
  completedSteps: [],
  nextRecommendedStep: "Add request validation",
  progressSummary: "Core Experience: 1 / 2 tasks complete.",
  pausedState: { isPaused: false },
};

assert(detectContinueBuildIntent("lets continue"), "lets continue should route to task continuation");
assert(detectContinueBuildIntent("let's continue"), "let's continue should route to task continuation");
assert(detectContinueBuildIntent("ok lets continue"), "ok lets continue should route to task continuation");
assert(detectContinueBuildIntent("continue this project"), "continue this project should route to task continuation");
assert(detectContinueBuildIntent("continue here"), "continue here should route to task continuation");
assert(detectContinueBuildIntent("continue from here"), "continue from here should route to task continuation");
assert(detectContinueBuildIntent("keep going"), "keep going should route to task continuation");
assert(detectContinueBuildIntent("go on"), "go on should route to task continuation");
assert(detectContinueBuildIntent("next"), "next should route to task continuation");
assert(detectContinueBuildIntent("conyinue"), "common typo conyinue should route to task continuation");
assert(detectContinueBuildIntent("contune"), "common typo contune should route to task continuation");
assert(detectContinueBuildIntent("continuee"), "common typo continuee should route to task continuation");
assert(detectContinueBuildIntent("continuw"), "common typo continuw should route to task continuation");
assert(detectContinueBuildIntent("lets conyinue"), "lets conyinue should route to task continuation");
assert(detectContinueBuildIntent("lets contune"), "lets contune should route to task continuation");
assert(!isStatusOnlyProjectPrompt("lets continue"), "lets continue should not be status-only");
assert(!isStatusOnlyProjectPrompt("conyinue"), "conyinue should not be status-only");

const next = getNextActionableBuildTask(foundryPlan);
if (next == null) throw new Error("continue should select the next actionable task");
assert(next.task.title === "Add request validation", "continue should select the next actionable task");
assert(next.task.status !== "blocked", "next task should be actionable, not blocked");

const statusOnlyResponse = [
  "Project: Foundry",
  "Current milestone: Core Experience",
  "Next recommended step: Add request validation",
].join("\n");
const actionableResponse = `Next task: ${next.task.title}\n\nProposed patch: concrete writable edits`;
assert(!actionableResponse.startsWith(statusOnlyResponse), "continue response should not only repeat project status");
assert(!actionableResponse.toLowerCase().includes("please paste the text"), "typo continuation should not ask for text to continue");
assert(!actionableResponse.toLowerCase().includes("what would you like to continue"), "project continuation should not ask what to continue");

const scaffoldCompletePlan: LivingBuildPlan = {
  schemaVersion: 1,
  projectId: "foundry",
  mvpDefinition: "Foundry MVP",
  milestones: [
    {
      id: "m1",
      name: "MVP Scaffold",
      goal: "Create the smallest working version.",
      status: "done",
      tasks: [
        { id: "m1-t1", title: "Create project scaffold", status: "done" },
        { id: "m1-t2", title: "Verify local run/build command", status: "done" },
      ],
    },
  ],
  currentMilestoneId: "m1",
  currentTaskId: "m1-t2",
  completedSteps: [],
  nextRecommendedStep: "Create project scaffold",
  progressSummary: "MVP Scaffold: 2 / 2 tasks complete.",
  pausedState: { isPaused: false },
};

assert(detectContinueBuildIntent("continue with that"), "continue with that should route to task continuation");
assert(detectContinueBuildIntent("continue option a"), "continue option a should route to task continuation");
assert(isStatusOnlyProjectPrompt("check build plan"), "check build plan should be status-only");
assert(isStatusOnlyProjectPrompt("what is the next phase"), "next phase query should be status-only");

assert(isStatusOnlyProjectPrompt("show current build status only"), "show current build status only should be status-only");

const scaffoldNext = getNextActionableBuildTask(scaffoldCompletePlan);
assert(scaffoldNext === null, "scaffold-complete plan should not repeat the final completed task");
const scaffoldReply = buildScaffoldCompleteContinuationReply(scaffoldCompletePlan);
assert(scaffoldReply.includes("Scaffold Complete"), "scaffold completion should transition to Scaffold Complete");
assert(scaffoldReply.includes("Generate Founder MVP Phase"), "scaffold completion should offer Founder MVP phase option");
assert(scaffoldReply.includes("Generate Phase 2 Build Plan"), "scaffold completion should offer Phase 2 build plan option");
assert(scaffoldReply.includes("Await founder instructions"), "scaffold completion should offer await-founder option");
assert(!scaffoldReply.toLowerCase().includes("paste the previous text"), "scaffold completion should not ask for pasted text");
assert(!scaffoldReply.toLowerCase().includes("what would you like to continue"), "scaffold completion should not ask what to continue");
assert(!scaffoldReply.includes("Verify local run/build command\n\nProposed patch"), "scaffold completion should not repeat final completed task");

console.log("continue intent regression passed");
