import type {
  ControlPreferences,
  PhaseBuildPlan,
  PhaseBuildPlanPhase,
  PhaseExecutionCheckState,
  PhaseExecutionState,
  PhaseTask,
  ProjectBlueprint,
  QualityGate,
} from "../types";
import { controlPreferencesFromBlueprint, evaluateControlPolicy } from "./controlLevel";
import { isPatchApprovalBlockerText } from "../phase/changeApprovalNarration";
import { isChangeApprovalPending } from "../phase/phaseExecutionState";

export interface FounderPhaseGateSummary {
  mode: "founder";
  currentPhaseName: string;
  completed: string[];
  checks: string[];
  blockers: string[];
  decisionPrompt: string;
  recommendedNextAction: string;
  sensitiveDecisions: string[];
  showDeveloperDetails: false;
}

export interface DeveloperPhaseGateSummary {
  mode: "developer";
  currentPhaseName: string;
  completed: string[];
  checks: string[];
  blockers: string[];
  decisionPrompt: string;
  recommendedNextAction: string;
  sensitiveDecisions: string[];
  showDeveloperDetails: true;
  developerDetails: {
    phaseId: string;
    phaseStatus: PhaseBuildPlanPhase["status"];
    taskIds: string[];
    completedTaskIds: string[];
    blockedTaskIds: string[];
    skippedTaskIds: string[];
    qualityGates: QualityGate[];
    executionState: PhaseExecutionState;
  };
}

export type PhaseGateSummary = FounderPhaseGateSummary | DeveloperPhaseGateSummary;

export interface PhaseGateSummaryInput {
  blueprint: ProjectBlueprint;
  phaseBuildPlan: PhaseBuildPlan;
  phaseExecutionState: PhaseExecutionState;
  controlPreferences?: ControlPreferences | null;
}

const SENSITIVE_PATTERNS = [
  /\bcredential(s)?\b/i,
  /\bapi[\s_-]?key(s)?\b/i,
  /\baccount(s)?\b/i,
  /\bpaid\b/i,
  /\bpayment(s)?\b/i,
  /\bbilling\b/i,
  /\bdeployment\b/i,
  /\blegal\b/i,
  /\bprivacy\b/i,
  /\bscope change\b/i,
  /\bdestructive\b/i,
  /\bdelete\b/i,
  /\brewrite\b/i,
  /\bredesign\b/i,
  /\brestructure\b/i,
];

function phaseById(plan: PhaseBuildPlan, phaseId: string): PhaseBuildPlanPhase {
  return plan.phases.find((phase) => phase.id === phaseId) ?? plan.phases[0];
}

function taskText(task: PhaseTask): string {
  return [task.title, task.rationale, ...task.constraints].join(" ");
}

function humanCheck(label: string, check: PhaseExecutionCheckState): string {
  if (check.status === "notRun") return `${label}: not run yet`;
  if (check.status === "passed") return `${label}: passed`;
  if (check.status === "failed") return `${label}: failed`;
  if (check.status === "blocked") return `${label}: blocked`;
  return `${label}: running`;
}

function completedItems(phase: PhaseBuildPlanPhase, state: PhaseExecutionState): string[] {
  const byId = new Map(phase.tasks.map((task) => [task.id, task.title]));
  return state.completedTaskIds
    .map((taskId) => byId.get(taskId))
    .filter((value): value is string => Boolean(value));
}

function blockerItems(phase: PhaseBuildPlanPhase, state: PhaseExecutionState): string[] {
  if (isChangeApprovalPending(state)) {
    return [];
  }
  const byId = new Map(phase.tasks.map((task) => [task.id, task.title]));
  const taskBlockers = state.blockedTaskIds.map((taskId) => byId.get(taskId) ?? taskId);
  const checks = [state.buildStatus, state.testStatus, state.checkStatus]
    .filter((check) => check.status === "failed" || check.status === "blocked")
    .map((check) => check.summary ?? `${check.command ?? "Check"} ${check.status}`)
    .filter((summary) => !isPatchApprovalBlockerText(summary));
  const reasons = [...taskBlockers, ...checks, state.blockerReason].filter((value): value is string => Boolean(value));
  return reasons.filter((summary) => !isPatchApprovalBlockerText(summary));
}

function sensitiveDecisions(phase: PhaseBuildPlanPhase, blueprint: ProjectBlueprint): string[] {
  const taskDecisions = phase.tasks
    .filter((task) => SENSITIVE_PATTERNS.some((pattern) => pattern.test(taskText(task))))
    .map((task) => task.title);
  const founderDecisions = blueprint.founderDecisions.data
    .filter((decision) => decision.status === "pending" && SENSITIVE_PATTERNS.some((pattern) => pattern.test(decision.text)))
    .map((decision) => decision.text);
  return Array.from(new Set([...taskDecisions, ...founderDecisions]));
}

function decisionPromptFor(phase: PhaseBuildPlanPhase, state: PhaseExecutionState): string {
  if (state.phaseStatus === "blocked" || state.blockedTaskIds.length > 0) {
    return "Resolve the blocker before moving forward.";
  }
  if (state.phaseStatus === "complete") {
    return `Continue to the next phase after ${phase.title}?`;
  }
  return `Continue the ${phase.title} phase?`;
}

function recommendedAction(phase: PhaseBuildPlanPhase, state: PhaseExecutionState): string {
  if (state.phaseStatus === "complete") {
    return phase.approvalGate.approvalQuestion;
  }
  return state.nextRecommendedAction || phase.approvalGate.approvalQuestion;
}

export function createPhaseGateSummary(input: PhaseGateSummaryInput): PhaseGateSummary {
  const preferences = input.controlPreferences ?? controlPreferencesFromBlueprint(input.blueprint);
  const phase = phaseById(input.phaseBuildPlan, input.phaseExecutionState.currentPhaseId);
  const completed = completedItems(phase, input.phaseExecutionState);
  const checks = [
    humanCheck("Build", input.phaseExecutionState.buildStatus),
    humanCheck("Tests", input.phaseExecutionState.testStatus),
    humanCheck("Checks", input.phaseExecutionState.checkStatus),
  ];
  const blockers = blockerItems(phase, input.phaseExecutionState);
  const sensitive = sensitiveDecisions(phase, input.blueprint);
  const gateDecision = evaluateControlPolicy({
    preferences,
    action: "phaseProgression",
    isPhaseGate: true,
  });
  const base = {
    currentPhaseName: phase.title,
    completed: completed.length ? completed : ["No phase tasks are marked complete yet."],
    checks,
    blockers,
    decisionPrompt: gateDecision.requiresApproval
      ? decisionPromptFor(phase, input.phaseExecutionState)
      : "NF may continue this phase automatically until a blocker or phase gate appears.",
    recommendedNextAction: recommendedAction(phase, input.phaseExecutionState),
    sensitiveDecisions: sensitive,
  };

  if (preferences.preferredMode === "developer" || preferences.controlLevel === "manual" || preferences.controlLevel === "assisted") {
    return {
      mode: "developer",
      ...base,
      showDeveloperDetails: true,
      developerDetails: {
        phaseId: phase.id,
        phaseStatus: phase.status,
        taskIds: phase.tasks.map((task) => task.id),
        completedTaskIds: input.phaseExecutionState.completedTaskIds,
        blockedTaskIds: input.phaseExecutionState.blockedTaskIds,
        skippedTaskIds: input.phaseExecutionState.skippedTaskIds,
        qualityGates: phase.qualityGates,
        executionState: input.phaseExecutionState,
      },
    };
  }

  return {
    mode: "founder",
    ...base,
    showDeveloperDetails: false,
  };
}
