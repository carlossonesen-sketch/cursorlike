import { isValidElement, type ReactNode } from "react";
import type { LivingBuildPlan, PhaseBuildPlan, ProjectManifest, ProjectMemory } from "../types";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import {
  attachArchitectureReview,
  attachPhaseBuildPlan,
  attachPhaseExecutionState,
  attachProjectHealthReport,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createPhaseBuildPlan } from "../phase/phaseBuildPlan";
import { createPhaseExecutionState, markPhaseTaskBlocked, recordPhaseCheckStatus, recordRepairAttempt } from "../phase/phaseExecutionState";
import { createArchitectureReviewReport } from "../architecture/architectureReview";
import { createProjectHealthReport } from "../architecture/projectHealth";
import { ProjectDashboard } from "../../components/ProjectDashboard";
import {
  buildProjectDashboardModel,
  closeProjectDashboardView,
  openProjectDashboardView,
  shouldShowProjectDashboardButton,
} from "./projectDashboard";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function childrenOf(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  return Array.isArray(children) ? children : children == null ? [] : [children];
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    if (typeof node.type === "function") {
      const render = node.type as (props: unknown) => ReactNode;
      return textOf(render(node.props));
    }
    return childrenOf(node).map(textOf).join("");
  }
  return "";
}

const plan: LivingBuildPlan = {
  schemaVersion: 1,
  projectId: "foundry",
  mvpDefinition: "Foundry MVP",
  milestones: [
    {
      id: "m1",
      name: "Scaffold Demo",
      goal: "Complete scaffold tasks.",
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
  completedSteps: [],
  nextRecommendedStep: "Add request validation",
  progressSummary: "Scaffold Demo: 17 / 17 tasks complete.",
  timelineEstimate: "4-6 weeks for MVP candidate",
  pausedState: { isPaused: false },
};

const memory = {
  name: "Foundry",
  path: "D:\\dev\\nf-projects\\foundry",
  fullIdea: "Foundry is an AI-native startup operating system for founders. It needs project creation, memory isolation, living build plans, build verification, approvals, and a polished MVP workflow.",
  knownIssues: [{ id: "issue-1", title: "Build status unknown", status: "open" }],
  decisions: [{ id: "d1", date: "2026-06-26", decision: "Use Founder-first workflow" }],
  todos: [{ id: "todo-1", text: "Confirm MVP onboarding scope", status: "blocked" }],
} as ProjectMemory;

const manifest: ProjectManifest = {
  projectTypes: ["typescript", "vite"],
  configFiles: ["package.json", "tsconfig.json"],
  lockfiles: [],
  fileList: ["src/main.tsx", "package.json", "tsconfig.json"],
  dependencyIndicators: {},
};

assert(shouldShowProjectDashboardButton("D:\\dev\\nf-projects\\foundry"), "active project should show Project Dashboard button");
assert(!shouldShowProjectDashboardButton(null), "no project open should hide Project Dashboard button");

const dashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\foundry",
  projectMemory: memory,
  livingBuildPlan: plan,
  founderManifest: null,
  manifest,
  developerMode: false,
});

assert(dashboard.projectPulse.projectName === "Foundry", "dashboard should display active project name");
assert(dashboard.projectPulse.projectPath === "D:\\dev\\nf-projects\\foundry", "dashboard should display active project path");
assert(dashboard.progressLayers.developmentProgress.includes("100%"), "dashboard should show scoped build-plan progress");
assert(dashboard.progressLayers.developmentProgress.includes("scaffold/build-plan progress only"), "development 100% should identify scope");
assert(dashboard.progressLayers.founderMvpProgress.includes("18%"), "dashboard should not confuse scaffold completion with founder MVP completion");
assert(dashboard.progressLayers.founderMvpProgress.includes("real founder-intended MVP progress"), "founder MVP label should describe real MVP scope");
assert(dashboard.progressLayers.productVisionProgress.includes("6%"), "dashboard should separate product vision progress");
assert(dashboard.progressLayers.qualityProgress.length > 0, "dashboard should include quality progress");
assert(dashboard.progressLayers.launchReadiness.length > 0, "dashboard should include launch readiness");
assert(dashboard.founderDecisions.approvedDecisions.includes("Founder-first"), "dashboard should include approved decisions");
assert(dashboard.founderDecisions.pendingDecisions.includes("Confirm MVP onboarding scope"), "dashboard should include pending decisions");
assert(dashboard.ctoRecommendation.priority1.length > 0, "dashboard should include CTO recommendation");
assert(dashboard.nextTask.title === "Add request validation", "legacy living build plan nextRecommendedStep should supply next task");
assert(dashboard.nextTask.status === "Ready", "legacy next task should be ready when not blocked");
assert(dashboard.nextTask.source === "Living Build Plan", "legacy next task should identify its source");
assert(dashboard.blockers.count === 2, "project memory issue and blocked todo should produce multiple blockers");
assert(dashboard.blockers.summary.includes("Build status unknown"), "known issue should appear in blocker summary");
assert(dashboard.blockers.summary.includes("Confirm MVP onboarding scope"), "blocked todo should appear in blocker summary");

const blueprintBase = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-budgeting",
  projectId: "budgeting",
  name: "Budgeting",
  now: "2026-06-27T00:00:00.000Z",
});
const phasePlan = createPhaseBuildPlan(blueprintBase, createGapAnalysis(blueprintBase, "2026-06-27T00:01:00.000Z"));
const executionState = createPhaseExecutionState(phasePlan, "2026-06-27T00:02:00.000Z");
function withCurrentPhaseQualityGatesPassed(plan: PhaseBuildPlan): PhaseBuildPlan {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === plan.currentPhaseId
        ? {
            ...phase,
            qualityGates: phase.qualityGates.map((gate) => ({ ...gate, status: "passed" as const })),
          }
        : phase
    ),
  };
}
const blueprintWithPhase = attachPhaseExecutionState(
  attachPhaseBuildPlan(blueprintBase, phasePlan, "2026-06-27T00:03:00.000Z"),
  executionState,
  "2026-06-27T00:04:00.000Z"
);
const architectureReview = createArchitectureReviewReport(blueprintWithPhase, "2026-06-27T00:05:00.000Z");
const blueprintWithReview = attachArchitectureReview(blueprintWithPhase, architectureReview, "2026-06-27T00:06:00.000Z");
const projectHealth = createProjectHealthReport({
  blueprint: blueprintWithReview,
  architectureReview,
  now: "2026-06-27T00:07:00.000Z",
});
const blueprintWithHealth = attachProjectHealthReport(blueprintWithReview, projectHealth, "2026-06-27T00:08:00.000Z");
const phaseDashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\budgeting",
  projectBlueprint: blueprintWithHealth,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest,
  developerMode: false,
});
const developerPhaseDashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\budgeting",
  projectBlueprint: blueprintWithHealth,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest,
  developerMode: true,
});
assert(phaseDashboard.currentPhase.phaseName === "Discovery", "current phase renders when execution state exists");
assert(phaseDashboard.currentPhase.phaseStatus === "active", "current phase status comes from execution state");
assert(phaseDashboard.currentPhase.currentTask === "Confirm Project Blueprint", "current task renders when available");
assert(
  phaseDashboard.currentPhase.nextRecommendedAction.includes("Continue Discovery"),
  "next recommended action renders from execution state"
);
assert(phaseDashboard.currentPhase.phaseId === "discovery", "developer details include phase id in the model");
assert(phaseDashboard.currentPhase.taskId === "discovery-confirm-blueprint", "developer details include task id in the model");
assert(phaseDashboard.phaseConfidence.level === "Medium", "phase confidence renders from execution state when available");
assert(phaseDashboard.phaseConfidence.summary.includes("Medium"), "phase confidence includes founder-readable wording");
assert(phaseDashboard.qualityGateStatus.status === "Needs Attention", "pending quality gates show needs attention");
assert(
  phaseDashboard.qualityGateStatus.reason === "Some checks are missing or incomplete.",
  "needs-attention quality gate status explains missing checks"
);
assert(phaseDashboard.nextTask.title === "Confirm Project Blueprint", "next ready task renders from phase execution state");
assert(phaseDashboard.nextTask.status === "Ready", "next task shows ready status when not blocked");
assert(
  phaseDashboard.nextTask.reason.includes("Continue Discovery"),
  "next task includes the execution-state next recommended action"
);
assert(phaseDashboard.nextTask.source === "Project Blueprint PhaseExecutionState", "next task identifies phase execution source");
assert(phaseDashboard.nextTask.phaseId === "discovery", "next task includes phase id details in the model");
assert(phaseDashboard.nextTask.taskId === "discovery-confirm-blueprint", "next task includes task id details in the model");
assert(phaseDashboard.blockers.count === 0, "healthy phase state should show no blockers");
assert(phaseDashboard.blockers.summary === "No blockers recorded.", "no blockers state should be clear");
assert(phaseDashboard.modeState.currentMode === "Founder Mode", "Founder Mode state is derived from app dashboard mode");
assert(phaseDashboard.modeState.developerDetailsHidden === "Yes", "Founder Mode state says developer details are hidden");
assert(phaseDashboard.modeState.explanation.includes("plain-language summaries"), "Founder Mode state explains simplified presentation");
assert(developerPhaseDashboard.modeState.currentMode === "Developer Mode", "Developer Mode state is derived from app dashboard mode");
assert(developerPhaseDashboard.modeState.developerDetailsHidden === "No", "Developer Mode state says developer details are visible");
assert(developerPhaseDashboard.modeState.rawDetail.includes("appDeveloperMode=true"), "Developer Mode raw detail includes app mode source");
assert(developerPhaseDashboard.modeState.rawDetail.includes("controlLevel="), "Developer Mode raw detail includes control preference detail");
assert(phaseDashboard.architectureReview.status !== "Unknown", "Architecture Review dashboard section should render when review exists");
assert(phaseDashboard.architectureReview.score.endsWith("/100"), "Architecture Review dashboard section should show score");
assert(phaseDashboard.architectureReview.summary.length > 0, "Architecture Review dashboard section should show summary");
assert(phaseDashboard.projectHealth.overallScore.endsWith("/100"), "Project Health dashboard section should show overall score");
assert(phaseDashboard.projectHealth.topRisks.length > 0, "Project Health dashboard section should show top risks");
assert(phaseDashboard.projectHealth.topStrengths.length > 0, "Project Health dashboard section should show top strengths");
assert(phaseDashboard.riskSummary.summary.length > 0, "Risk Summary dashboard section should show summary");
assert(phaseDashboard.riskSummary.rawDetail.includes("architectureStatus="), "Risk Summary should include raw detail in model");

const founderDashboardText = textOf(ProjectDashboard({
  dashboard: phaseDashboard,
  onClose: () => {},
  developerMode: false,
}));
assert(founderDashboardText.includes("Current Phase"), "dashboard component renders Current Phase section");
assert(founderDashboardText.includes("Discovery"), "Founder Mode shows simple current phase name");
assert(founderDashboardText.includes("Confirm Project Blueprint"), "Founder Mode shows simple current task");
assert(founderDashboardText.includes("Phase Confidence"), "dashboard component renders Phase Confidence section");
assert(founderDashboardText.includes("Medium"), "Founder Mode shows simple confidence wording");
assert(founderDashboardText.includes("Quality Gate Status"), "dashboard component renders Quality Gate Status section");
assert(founderDashboardText.includes("Needs Attention"), "Founder Mode shows simple quality gate status");
assert(founderDashboardText.includes("Some checks are missing or incomplete."), "Founder Mode shows quality gate reason");
assert(founderDashboardText.includes("Next Task"), "dashboard component renders Next Task section");
assert(founderDashboardText.includes("Why next"), "Founder Mode shows why the next task was selected");
assert(founderDashboardText.includes("Ready"), "Founder Mode shows simple next task readiness");
assert(founderDashboardText.includes("Blockers"), "dashboard component renders Blockers section");
assert(founderDashboardText.includes("No blockers recorded."), "Founder Mode shows no blockers message when clear");
assert(founderDashboardText.includes("Mode State"), "dashboard component renders Mode State section");
assert(founderDashboardText.includes("Founder Mode"), "Founder Mode renders current mode");
assert(founderDashboardText.includes("Developer details hidden"), "Founder Mode renders developer detail visibility");
assert(founderDashboardText.includes("Yes"), "Founder Mode says developer details are hidden");
assert(!founderDashboardText.includes("Phase ID"), "Founder Mode hides phase ids");
assert(!founderDashboardText.includes("Task ID"), "Founder Mode hides task ids");
assert(!founderDashboardText.includes("rawConfidence="), "Founder Mode hides raw confidence details");
assert(!founderDashboardText.includes("qualityGates="), "Founder Mode hides raw quality gate details");
assert(!founderDashboardText.includes("Project Blueprint PhaseExecutionState"), "Founder Mode hides raw next-task source details");
assert(!founderDashboardText.includes("Selected from the current execution task."), "Founder Mode hides next-task selection reason");
assert(!founderDashboardText.includes("source=Phase Execution"), "Founder Mode hides raw blocker details");
assert(!founderDashboardText.includes("Raw mode detail"), "Founder Mode hides raw mode/debug detail");
assert(founderDashboardText.includes("Architecture Review"), "dashboard component renders Architecture Review section");
assert(founderDashboardText.includes("Project Health"), "dashboard component renders Project Health section");
assert(founderDashboardText.includes("Risk Summary"), "dashboard component renders Risk Summary section");
assert(founderDashboardText.includes("Overall score"), "Founder Mode shows project health score");
assert(!founderDashboardText.includes("Raw architecture detail"), "Founder Mode hides raw architecture details");
assert(!founderDashboardText.includes("Raw health detail"), "Founder Mode hides raw health details");
assert(!founderDashboardText.includes("Raw risk detail"), "Founder Mode hides raw risk details");

const developerDashboardText = textOf(ProjectDashboard({
  dashboard: developerPhaseDashboard,
  onClose: () => {},
  developerMode: true,
}));
assert(developerDashboardText.includes("Phase ID"), "Developer Mode can show phase id label");
assert(developerDashboardText.includes("discovery"), "Developer Mode can show phase id value");
assert(developerDashboardText.includes("Task ID"), "Developer Mode can show task id label");
assert(developerDashboardText.includes("discovery-confirm-blueprint"), "Developer Mode can show task id value");
assert(developerDashboardText.includes("Details"), "Developer Mode can show phase confidence details");
assert(developerDashboardText.includes("rawConfidence=high"), "Developer Mode can show raw confidence/status details");
assert(developerDashboardText.includes("qualityGates=discovery-blueprint-ready:pending:required"), "Developer Mode can show raw quality gate details");
assert(developerDashboardText.includes("Source"), "Developer Mode can show next-task source label");
assert(developerDashboardText.includes("Project Blueprint PhaseExecutionState"), "Developer Mode can show next-task source");
assert(developerDashboardText.includes("Selection"), "Developer Mode can show next-task selection label");
assert(developerDashboardText.includes("Selected from the current execution task."), "Developer Mode can show next-task selection reason");
assert(developerDashboardText.includes("Developer Mode"), "Developer Mode renders current mode");
assert(developerDashboardText.includes("Raw mode detail"), "Developer Mode shows raw mode/debug detail");
assert(developerDashboardText.includes("appDeveloperMode=true"), "Developer Mode raw detail shows app mode source");
assert(developerDashboardText.includes("blueprintPreferredMode="), "Developer Mode raw detail shows Blueprint control preference source");
assert(developerDashboardText.includes("Raw architecture detail"), "Developer Mode shows raw architecture details");
assert(developerDashboardText.includes("dependencyCount="), "Developer Mode architecture details include dependency count");
assert(developerDashboardText.includes("Raw health detail"), "Developer Mode shows raw health details");
assert(developerDashboardText.includes("categories="), "Developer Mode health details include category scores");
assert(developerDashboardText.includes("Raw risk detail"), "Developer Mode shows raw risk details");
assert(developerDashboardText.includes("healthScore="), "Developer Mode risk details include health score");

const passingState = recordPhaseCheckStatus(
  recordPhaseCheckStatus(
    recordPhaseCheckStatus(executionState, "build", "passed", { summary: "Build passed." }),
    "check",
    "passed",
    { summary: "Quality checks passed." }
  ),
  "test",
  "passed",
  { summary: "Tests passed." }
);
const passedPhasePlan = withCurrentPhaseQualityGatesPassed(phasePlan);
const passingDashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\budgeting",
  projectBlueprint: attachPhaseExecutionState(
    attachPhaseBuildPlan(blueprintBase, passedPhasePlan),
    passingState
  ),
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest,
  developerMode: false,
});
assert(passingDashboard.phaseConfidence.level === "High", "passing checks/tests show high confidence");
assert(passingDashboard.qualityGateStatus.status === "Passed", "passed gates/checks show passed quality gate status");
assert(
  passingDashboard.qualityGateStatus.reason === "All required checks passed.",
  "passed quality gate status explains all required checks passed"
);

const failedState = recordPhaseCheckStatus(executionState, "build", "failed", {
  summary: "Build failed with TypeScript errors.",
});
const failedDashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\budgeting",
  projectBlueprint: attachPhaseExecutionState(
    attachPhaseBuildPlan(blueprintBase, phasePlan),
    failedState
  ),
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest,
  developerMode: false,
});
assert(failedDashboard.phaseConfidence.level === "Low", "failed checks/tests lower confidence");
assert(failedDashboard.phaseConfidence.summary.includes("failed checks"), "failed confidence explains why it is low");
assert(failedDashboard.qualityGateStatus.status === "Needs Attention", "failed checks show quality gate needs attention");
assert(failedDashboard.blockers.count === 1, "failed build check should create one blocker");
assert(failedDashboard.blockers.items[0]?.source === "Phase Execution Check", "failed build blocker should identify check source");
assert(failedDashboard.blockers.items[0]?.checkKind === "build", "failed build blocker should identify build check kind");

const blockedState = markPhaseTaskBlocked(executionState, executionState.currentTaskId, "Needs founder decision.");
const blockedGatePlan: PhaseBuildPlan = {
  ...phasePlan,
  phases: phasePlan.phases.map((phase) =>
    phase.id === phasePlan.currentPhaseId
      ? {
          ...phase,
          qualityGates: phase.qualityGates.map((gate) => ({ ...gate, status: "blocked" as const })),
        }
      : phase
  ),
};
const blockedDashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\budgeting",
  projectBlueprint: attachPhaseExecutionState(
    attachPhaseBuildPlan(blueprintBase, blockedGatePlan),
    blockedState
  ),
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest,
  developerMode: false,
});
assert(blockedDashboard.phaseConfidence.level === "Blocked", "blocked phase shows blocked confidence");
assert(blockedDashboard.phaseConfidence.summary.includes("Needs founder decision"), "blocked confidence shows blocker reason");
assert(blockedDashboard.qualityGateStatus.status === "Blocked", "blocked phase shows blocked quality gate status");
assert(
  blockedDashboard.qualityGateStatus.reason === "Blocked by unresolved issues.",
  "blocked quality gate status explains unresolved issues"
);
assert(blockedDashboard.nextTask.status === "Blocked", "blocked next task shows blocked status");
assert(blockedDashboard.nextTask.reason === "Needs founder decision.", "blocked next task shows blocker reason");
assert(blockedDashboard.nextTask.blockerInfo === "Needs founder decision.", "blocked next task preserves blocker info for Developer Mode");
assert(blockedDashboard.blockers.count === 2, "blocked task plus blocked quality gate should produce multiple blockers");
assert(blockedDashboard.blockers.summary.includes("Needs founder decision"), "blocked task reason should appear in blocker summary");
assert(
  blockedDashboard.blockers.items.some((item) => item.source === "Phase Quality Gate" && item.status === "blocked"),
  "blocked quality gate should create a blocker"
);
const blockedDeveloperText = textOf(ProjectDashboard({
  dashboard: blockedDashboard,
  onClose: () => {},
  developerMode: true,
}));
assert(blockedDeveloperText.includes("Blocker 1 details"), "Developer Mode shows raw blocker detail fields");
assert(blockedDeveloperText.includes("source=Phase Execution State"), "Developer Mode shows blocker source detail");
assert(blockedDeveloperText.includes("phase=discovery"), "Developer Mode shows blocker phase detail");
assert(blockedDeveloperText.includes("task=discovery-confirm-blueprint"), "Developer Mode shows blocker task detail");

const repairBlockedState = recordRepairAttempt(
  recordPhaseCheckStatus(executionState, "test", "blocked", { summary: "Tests blocked by missing credentials." }),
  {
    taskId: executionState.currentTaskId ?? "discovery-confirm-blueprint",
    summary: "Repair blocked by credential setup.",
    status: "blocked",
  }
);
const repairBlockedDashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\budgeting",
  projectBlueprint: attachPhaseExecutionState(
    attachPhaseBuildPlan(blueprintBase, phasePlan),
    repairBlockedState
  ),
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest,
  developerMode: false,
});
assert(repairBlockedDashboard.blockers.count === 2, "blocked check and blocked repair attempt should both be listed");
assert(
  repairBlockedDashboard.blockers.items.some((item) => item.checkKind === "test"),
  "blocked test check should create a blocker"
);
assert(
  repairBlockedDashboard.blockers.items.some((item) => item.source === "Phase Repair Attempt" && item.repairAttempts === "1"),
  "blocked repair attempt should create a blocker with attempt count"
);

const emptyDashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\empty",
  projectBlueprint: null,
  projectMemory: null,
  livingBuildPlan: null,
  founderManifest: null,
  manifest: null,
});
assert(emptyDashboard.currentPhase.emptyState === "No phase plan exists yet.", "empty state renders when no phase plan exists");
assert(emptyDashboard.phaseConfidence.level === "Unknown", "missing phase confidence shows unknown confidence");
assert(emptyDashboard.phaseConfidence.emptyState === "No phase confidence has been recorded yet.", "missing phase confidence has clear empty state");
assert(emptyDashboard.qualityGateStatus.status === "Unknown", "missing quality gate data shows unknown status");
assert(
  emptyDashboard.qualityGateStatus.reason === "No quality gate data available yet.",
  "unknown quality gate status has clear reason"
);
assert(emptyDashboard.nextTask.status === "Unknown", "missing task data shows unknown next task status");
assert(emptyDashboard.nextTask.emptyState === "No next task is available yet.", "missing task data has a clear empty state");
assert(emptyDashboard.nextTask.source === "No task source", "unknown next task identifies no source");
assert(emptyDashboard.blockers.count === 0, "missing blocker data should not invent blockers");
assert(emptyDashboard.blockers.emptyState === "No blockers recorded.", "missing blocker data has clear no-blocker state");
assert(emptyDashboard.modeState.currentMode === "Unknown", "missing mode data shows unknown mode");
assert(emptyDashboard.modeState.emptyState === "Dashboard mode is not available yet.", "missing mode data has clear empty state");
assert(emptyDashboard.architectureReview.emptyState === "Architecture Review has not run yet.", "missing Architecture Review has clear empty state");
assert(emptyDashboard.projectHealth.emptyState === "Project Health has not been calculated yet.", "missing Project Health has clear empty state");
assert(emptyDashboard.riskSummary.architectureRisk === "Architecture Review has not run yet.", "Risk Summary reflects missing Architecture Review");
assert(
  textOf(ProjectDashboard({ dashboard: emptyDashboard, onClose: () => {} })).includes("No phase plan exists yet."),
  "dashboard component renders no-phase-plan empty state"
);
assert(
  textOf(ProjectDashboard({ dashboard: emptyDashboard, onClose: () => {} })).includes("No phase confidence has been recorded yet."),
  "dashboard component renders no-phase-confidence empty state"
);
assert(
  textOf(ProjectDashboard({ dashboard: emptyDashboard, onClose: () => {} })).includes("No quality gate data available yet."),
  "dashboard component renders no-quality-gate-data state"
);
assert(
  textOf(ProjectDashboard({ dashboard: emptyDashboard, onClose: () => {} })).includes("No next task available"),
  "dashboard component renders no-next-task state"
);

const noTimelineDashboard = buildProjectDashboardModel({
  workspacePath: "D:\\dev\\nf-projects\\foundry",
  projectMemory: memory,
  livingBuildPlan: { ...plan, timelineEstimate: undefined },
  founderManifest: null,
  manifest,
  developerMode: false,
});
assert(
  noTimelineDashboard.projectPulse.estimatedMvpTime === "Current scaffold plan complete; true MVP not estimated yet",
  "dashboard should not show 0 days as true MVP time"
);
assert(
  noTimelineDashboard.projectPulse.nextMilestone === "Next product milestone not estimated yet",
  "dashboard should use product milestone placeholder"
);
assert(!JSON.stringify(noTimelineDashboard).includes("Demo Ready"), "dashboard should not use Demo Ready wording");

const messages = [{ role: "assistant", text: "Project status." }];
const opened = openProjectDashboardView(messages);
assert(opened.activeView === "projectDashboard", "clicking Project Dashboard should switch app view to dashboard");
assert(opened.messages === messages, "opening dashboard should not append chat messages");
assert(!opened.messages.some((message) => /Opened/i.test(message.text)), "opening dashboard should not append assistant Opened message");
assert(!opened.proposalCreated, "opening dashboard should not create a proposal");
assert(opened.filesChanged.length === 0, "opening dashboard should not create file changes");

const closed = closeProjectDashboardView(opened.messages);
assert(closed.activeView === "chat", "closing dashboard should return to chat view");
assert(closed.messages === messages, "closing dashboard should not append chat messages");
assert(!closed.proposalCreated, "closing dashboard should not create a proposal");
assert(closed.filesChanged.length === 0, "closing dashboard should not create file changes");

console.log("project dashboard regression passed");
