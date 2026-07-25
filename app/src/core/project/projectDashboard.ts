import type { FounderManifest, LivingBuildPlan, PhaseBuildPlan, PhaseExecutionState, ProjectBlueprint, ProjectManifest, ProjectMemory } from "../types";
import type { MvpDiskAuditResult } from "./mvpDiskAudit";
import { formatDiskTruthSummary } from "./mvpDiskAudit";

export interface ProjectDashboardModel {
  currentPhase: {
    phaseName: string;
    phaseStatus: string;
    currentTask: string;
    nextRecommendedAction: string;
    emptyState: string;
    phaseId?: string;
    taskId?: string;
  };
  phaseConfidence: {
    level: "High" | "Medium" | "Low" | "Blocked" | "Unknown";
    summary: string;
    detail: string;
    emptyState: string;
  };
  qualityGateStatus: {
    status: "Passed" | "Needs Attention" | "Blocked" | "Unknown";
    reason: string;
    detail: string;
    emptyState: string;
  };
  nextTask: {
    title: string;
    reason: string;
    status: "Ready" | "Blocked" | "Unknown";
    source: string;
    selectionReason: string;
    emptyState: string;
    taskId?: string;
    phaseId?: string;
    phaseTitle?: string;
    blockerInfo?: string;
  };
  blockers: {
    count: number;
    summary: string;
    items: {
      source: string;
      id: string;
      title: string;
      message: string;
      status: string;
      severity: "Critical" | "High" | "Medium" | "Unknown";
      phaseId?: string;
      phaseTitle?: string;
      taskId?: string;
      checkKind?: string;
      repairAttempts?: string;
    }[];
    emptyState: string;
  };
  modeState: {
    currentMode: "Founder Mode" | "Developer Mode" | "Unknown";
    explanation: string;
    developerDetailsHidden: string;
    rawDetail: string;
    emptyState: string;
  };
  architectureReview: {
    status: "Passed" | "Needs Review" | "Blocked" | "Unknown";
    score: string;
    summary: string;
    criticalFindings: string;
    recommendedImprovements: string;
    approvalRequired: string;
    rawDetail: string;
    emptyState: string;
  };
  projectHealth: {
    overallScore: string;
    overallStatus: string;
    topRisks: string;
    topStrengths: string;
    nextRecommendation: string;
    rawDetail: string;
    emptyState: string;
  };
  riskSummary: {
    summary: string;
    topRisks: string;
    blockerCount: number;
    architectureRisk: string;
    healthRisk: string;
    rawDetail: string;
  };
  projectPulse: {
    projectName: string;
    projectPath: string;
    buildStatus: string;
    criticalIssuesCount: number;
    currentTask: string;
    nextMilestone: string;
    estimatedMvpTime: string;
    overallConfidence: string;
  };
  progressLayers: {
    developmentProgress: string;
    founderMvpProgress: string;
    productVisionProgress: string;
    qualityProgress: string;
    launchReadiness: string;
  };
  currentWork: {
    developmentPhase: string;
    currentTask: string;
    completedTasks: string;
    blockedTasks: string;
    nextRecommendedStep: string;
  };
  founderDecisions: {
    approvedDecisions: string;
    pendingDecisions: string;
  };
  ctoRecommendation: {
    priority1: string;
    priority2: string;
    priority3: string;
    estimatedTimeToNextMilestone: string;
    confidenceScore: string;
  };
}

export type ProjectDashboardAppView = "chat" | "projectDashboard";

export interface ProjectDashboardViewTransition<TMessage = unknown> {
  activeView: ProjectDashboardAppView;
  messages: TMessage[];
  proposalCreated: boolean;
  filesChanged: string[];
}

export function openProjectDashboardView<TMessage>(messages: TMessage[]): ProjectDashboardViewTransition<TMessage> {
  return {
    activeView: "projectDashboard",
    messages,
    proposalCreated: false,
    filesChanged: [],
  };
}

export function closeProjectDashboardView<TMessage>(messages: TMessage[]): ProjectDashboardViewTransition<TMessage> {
  return {
    activeView: "chat",
    messages,
    proposalCreated: false,
    filesChanged: [],
  };
}

function percent(complete: number, total: number): number {
  if (!total) return 0;
  return Math.round((complete / total) * 100);
}

function taskCounts(plan: LivingBuildPlan | null): { complete: number; total: number; blocked: number } {
  const tasks = plan?.milestones.flatMap((milestone) => milestone.tasks) ?? [];
  return {
    complete: tasks.filter((task) => task.status === "done").length,
    total: tasks.length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
  };
}

function activeMilestone(plan: LivingBuildPlan | null): LivingBuildPlan["milestones"][number] | undefined {
  return plan?.milestones.find((milestone) => milestone.id === plan.currentMilestoneId) ?? plan?.milestones[0];
}

function activeTask(plan: LivingBuildPlan | null): LivingBuildPlan["milestones"][number]["tasks"][number] | undefined {
  const milestone = activeMilestone(plan);
  return milestone?.tasks.find((task) => task.id === plan?.currentTaskId) ??
    milestone?.tasks.find((task) => task.status === "next" || task.status === "doing" || task.status === "todo" || task.status === "blocked");
}

function nextMilestone(plan: LivingBuildPlan | null): string {
  const currentIndex = plan?.milestones.findIndex((milestone) => milestone.id === plan.currentMilestoneId) ?? -1;
  const next = currentIndex >= 0 ? plan?.milestones.slice(currentIndex + 1).find((milestone) => milestone.status !== "done") : null;
  return normalizeDashboardLabel(next?.name) || "Next product milestone not estimated yet";
}

function normalizeDashboardLabel(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\bDemo Ready\b/gi, "Scaffold Complete").replace(/\bScaffold Demo\b/gi, "Demo Scaffold Complete");
}

function hasFounderVision(memory: ProjectMemory | null, founderManifest: FounderManifest | null): boolean {
  const text = [
    founderManifest?.vision,
    founderManifest?.mission,
    founderManifest?.mvpDefinition,
    memory?.fullIdea,
    memory?.summary,
  ].filter(Boolean).join(" ");
  return text.trim().length > 180 || /\b(founder|vision|mvp|customer|startup|platform|operating system)\b/i.test(text);
}

function founderMvpPercent(memory: ProjectMemory | null, founderManifest: FounderManifest | null, plan: LivingBuildPlan | null): number {
  if (!hasFounderVision(memory, founderManifest)) return 0;
  const counts = taskCounts(plan);
  const developmentPercent = percent(counts.complete, counts.total);
  if (developmentPercent >= 100 && counts.total <= 25) return 18;
  if (developmentPercent >= 75) return 45;
  if (developmentPercent >= 40) return 28;
  return 12;
}

function productVisionPercent(founderMvpProgress: number): number {
  if (founderMvpProgress >= 85) return 30;
  if (founderMvpProgress >= 40) return 14;
  if (founderMvpProgress > 0) return 6;
  return 0;
}

function developmentPhase(milestoneName: string | undefined, counts: { complete: number; total: number }): string {
  const name = milestoneName?.toLowerCase() ?? "";
  if (name.includes("scaffold") && counts.total > 0 && counts.complete === counts.total) return "Foundation Complete";
  if (name.includes("scaffold") || name.includes("foundation")) return "Foundation";
  if (name.includes("core")) return "Core Experience";
  if (name.includes("integration")) return "Integrations";
  if (name.includes("test") || name.includes("validation")) return "Testing";
  if (name.includes("polish") || name.includes("reliability")) return "Polish";
  return normalizeDashboardLabel(milestoneName) || "Not estimated yet";
}

function estimatedRemainingTime(plan: LivingBuildPlan | null): string {
  const counts = taskCounts(plan);
  const remaining = Math.max(0, counts.total - counts.complete);
  if (!counts.total) return "Not estimated yet";
  if (remaining === 0) return "Current scaffold plan complete; true MVP not estimated yet";
  if (remaining <= 3) return "1-3 days";
  if (remaining <= 10) return "1-2 weeks";
  return "Several weeks";
}

function qualityProgress(manifest: ProjectManifest | null, buildPassing: boolean): { label: string; confidence: string } {
  const files = manifest?.fileList ?? [];
  const sourceCount = files.filter((file) => /\.(tsx?|jsx?)$/i.test(file)).length;
  const testCount = files.filter((file) => /\.(test|spec)\.(tsx?|jsx?)$/i.test(file)).length;
  const testingPercent = sourceCount ? Math.min(100, Math.round((testCount / sourceCount) * 100)) : 0;
  const confidence = buildPassing ? Math.max(45, Math.min(82, 55 + testingPercent)) : Math.max(20, Math.min(50, 35 + testingPercent));
  return {
    label: `Testing ${testingPercent}% estimated; architecture health ${buildPassing ? "stable enough to continue" : "blocked or unverified"}.`,
    confidence: `${confidence}%`,
  };
}

function launchReadiness(manifest: ProjectManifest | null, buildPassing: boolean): string {
  const files = manifest?.fileList ?? [];
  const hasTests = files.some((file) => /\.(test|spec)\.(tsx?|jsx?)$/i.test(file));
  if (!buildPassing) return "Not Ready (0%)";
  if (!hasTests) return "Internal Testing (20%)";
  return "Founder Testing (35%)";
}

function getPhasePlan(blueprint: ProjectBlueprint | null): PhaseBuildPlan | null {
  return blueprint?.phaseBuildPlan.data ?? null;
}

function getPhaseExecutionState(blueprint: ProjectBlueprint | null): PhaseExecutionState | null {
  return blueprint?.phaseExecutionState.data ?? null;
}

function phaseDashboardState(
  blueprint: ProjectBlueprint | null,
  livingBuildPlan: LivingBuildPlan | null
): ProjectDashboardModel["currentPhase"] {
  const phasePlan = getPhasePlan(blueprint);
  const executionState = getPhaseExecutionState(blueprint);

  if (phasePlan) {
    const phaseId = executionState?.currentPhaseId ?? phasePlan.currentPhaseId;
    const phase = phasePlan.phases.find((item) => item.id === phaseId) ?? phasePlan.phases[0];
    const taskId = executionState?.currentTaskId ?? phasePlan.recommendedNextTaskId;
    const task = phase?.tasks.find((item) => item.id === taskId) ??
      phase?.tasks.find((item) => item.status === "doing" || item.status === "todo" || item.status === "blocked");

    return {
      phaseName: phase?.title ?? "Current phase not found",
      phaseStatus: executionState?.phaseStatus ?? phase?.status ?? "planned",
      currentTask: task?.title ?? "No current task selected yet.",
      nextRecommendedAction: executionState?.nextRecommendedAction ?? task?.title ?? "Review the phase plan before continuing.",
      emptyState: "",
      phaseId: phase?.id,
      taskId: task?.id,
    };
  }

  const milestone = activeMilestone(livingBuildPlan);
  const task = activeTask(livingBuildPlan);
  if (milestone) {
    return {
      phaseName: normalizeDashboardLabel(milestone.name),
      phaseStatus: milestone.status,
      currentTask: task?.title ?? "No current task selected yet.",
      nextRecommendedAction: livingBuildPlan?.nextRecommendedStep?.trim() || task?.title || "Review the build plan before continuing.",
      emptyState: "",
      phaseId: milestone.id,
      taskId: task?.id,
    };
  }

  return {
    phaseName: "No phase plan yet",
    phaseStatus: "Not started",
    currentTask: "No current task yet.",
    nextRecommendedAction: "Create or load a Project Blueprint and phase plan.",
    emptyState: "No phase plan exists yet.",
  };
}

function statusFailed(status: string | undefined): boolean {
  return status === "failed" || status === "blocked";
}

function statusPassed(status: string | undefined): boolean {
  return status === "passed";
}

function phaseConfidenceState(blueprint: ProjectBlueprint | null): ProjectDashboardModel["phaseConfidence"] {
  const executionState = getPhaseExecutionState(blueprint);
  if (!executionState) {
    return {
      level: "Unknown",
      summary: "Phase confidence is not available yet.",
      detail: "No PhaseExecutionState is attached to the active Project Blueprint.",
      emptyState: "No phase confidence has been recorded yet.",
    };
  }

  const failedChecks = [
    executionState.buildStatus,
    executionState.testStatus,
    executionState.checkStatus,
  ].filter((item) => statusFailed(item.status));
  const passedChecks = [
    executionState.buildStatus,
    executionState.testStatus,
    executionState.checkStatus,
  ].filter((item) => statusPassed(item.status));
  const repairFailures = executionState.repairAttempts.filter((attempt) => attempt.status === "failed" || attempt.status === "blocked");
  const repairAttempts = executionState.repairAttempts.length;

  if (executionState.phaseStatus === "blocked" || executionState.blockedTaskIds.length > 0) {
    return {
      level: "Blocked",
      summary: executionState.blockerReason
        ? `Blocked: ${executionState.blockerReason}`
        : "Blocked: resolve the current task blocker before continuing.",
      detail: `rawConfidence=${executionState.confidenceLevel}; phaseStatus=${executionState.phaseStatus}; blockedTasks=${executionState.blockedTaskIds.join(", ") || "(none)"}; build=${executionState.buildStatus.status}; test=${executionState.testStatus.status}; check=${executionState.checkStatus.status}; repairAttempts=${repairAttempts}`,
      emptyState: "",
    };
  }

  if (failedChecks.length > 0 || repairFailures.length > 0) {
    return {
      level: "Low",
      summary: "Low: failed checks or repairs need attention before continuing.",
      detail: `rawConfidence=${executionState.confidenceLevel}; phaseStatus=${executionState.phaseStatus}; failedChecks=${failedChecks.map((item) => item.summary ?? item.status).join(" | ") || "(none)"}; repairFailures=${repairFailures.map((item) => item.summary).join(" | ") || "(none)"}`,
      emptyState: "",
    };
  }

  if (passedChecks.length >= 2 && executionState.confidenceLevel === "high") {
    return {
      level: "High",
      summary: "High: the current phase looks healthy and ready to continue.",
      detail: `rawConfidence=${executionState.confidenceLevel}; phaseStatus=${executionState.phaseStatus}; build=${executionState.buildStatus.status}; test=${executionState.testStatus.status}; check=${executionState.checkStatus.status}`,
      emptyState: "",
    };
  }

  if (executionState.confidenceLevel === "low") {
    return {
      level: "Low",
      summary: "Low: NF needs more reliable phase data before continuing confidently.",
      detail: `rawConfidence=${executionState.confidenceLevel}; phaseStatus=${executionState.phaseStatus}; build=${executionState.buildStatus.status}; test=${executionState.testStatus.status}; check=${executionState.checkStatus.status}; repairAttempts=${repairAttempts}`,
      emptyState: "",
    };
  }

  return {
    level: "Medium",
    summary: "Medium: safe to review the next action, but more checks may be needed.",
    detail: `rawConfidence=${executionState.confidenceLevel}; phaseStatus=${executionState.phaseStatus}; build=${executionState.buildStatus.status}; test=${executionState.testStatus.status}; check=${executionState.checkStatus.status}; repairAttempts=${repairAttempts}`,
    emptyState: "",
  };
}

function qualityGateDashboardState(blueprint: ProjectBlueprint | null): ProjectDashboardModel["qualityGateStatus"] {
  const phasePlan = getPhasePlan(blueprint);
  const executionState = getPhaseExecutionState(blueprint);
  const phaseId = executionState?.currentPhaseId ?? phasePlan?.currentPhaseId;
  const phase = phasePlan?.phases.find((item) => item.id === phaseId) ?? phasePlan?.phases[0];
  const qualityGates = phase?.qualityGates ?? [];
  const requiredGates = qualityGates.filter((gate) => gate.required);
  const checkStates = [
    executionState?.buildStatus,
    executionState?.testStatus,
    executionState?.checkStatus,
  ].filter((state): state is NonNullable<typeof state> => Boolean(state));
  const blockedGates = requiredGates.filter((gate) => gate.status === "blocked");
  const failedGates = requiredGates.filter((gate) => gate.status === "failed");
  const pendingGates = requiredGates.filter((gate) => gate.status === "pending");
  const failedChecks = checkStates.filter((state) => state.status === "failed");
  const blockedChecks = checkStates.filter((state) => state.status === "blocked");
  const runningChecks = checkStates.filter((state) => state.status === "running");
  const missingChecks = checkStates.filter((state) => state.status === "notRun");
  const blockingRepairAttempts = executionState?.repairAttempts.filter((attempt) => attempt.status === "blocked") ?? [];
  const detail = [
    `phaseId=${phase?.id ?? "(none)"}`,
    `qualityGates=${qualityGates.map((gate) => `${gate.id}:${gate.status}${gate.required ? ":required" : ":optional"}`).join(", ") || "(none)"}`,
    `build=${executionState?.buildStatus.status ?? "(none)"}`,
    `test=${executionState?.testStatus.status ?? "(none)"}`,
    `check=${executionState?.checkStatus.status ?? "(none)"}`,
    `blockedTasks=${executionState?.blockedTaskIds.join(", ") || "(none)"}`,
    `repairAttempts=${executionState?.repairAttempts.map((attempt) => `${attempt.id}:${attempt.status}`).join(", ") || "(none)"}`,
  ].join("; ");

  if (!phasePlan && !executionState) {
    return {
      status: "Unknown",
      reason: "No quality gate data available yet.",
      detail,
      emptyState: "No quality gate data available yet.",
    };
  }

  if (
    executionState?.phaseStatus === "blocked" ||
    (executionState?.blockedTaskIds.length ?? 0) > 0 ||
    blockedGates.length > 0 ||
    blockedChecks.length > 0 ||
    blockingRepairAttempts.length > 0
  ) {
    return {
      status: "Blocked",
      reason: "Blocked by unresolved issues.",
      detail,
      emptyState: "",
    };
  }

  if (
    qualityGates.length === 0 &&
    checkStates.length === 0
  ) {
    return {
      status: "Unknown",
      reason: "No quality gate data available yet.",
      detail,
      emptyState: "No quality gate data available yet.",
    };
  }

  if (
    failedGates.length > 0 ||
    pendingGates.length > 0 ||
    failedChecks.length > 0 ||
    runningChecks.length > 0 ||
    missingChecks.length === checkStates.length
  ) {
    return {
      status: "Needs Attention",
      reason: "Some checks are missing or incomplete.",
      detail,
      emptyState: "",
    };
  }

  return {
    status: "Passed",
    reason: "All required checks passed.",
    detail,
    emptyState: "",
  };
}

function nextTaskFromPhaseState(
  blueprint: ProjectBlueprint | null
): ProjectDashboardModel["nextTask"] | null {
  const phasePlan = getPhasePlan(blueprint);
  if (!phasePlan) return null;

  const executionState = getPhaseExecutionState(blueprint);
  const phaseId = executionState?.currentPhaseId ?? phasePlan.currentPhaseId;
  const phase = phasePlan.phases.find((item) => item.id === phaseId) ?? phasePlan.phases[0];
  if (!phase) return null;

  const completed = new Set(executionState?.completedTaskIds ?? []);
  const skipped = new Set(executionState?.skippedTaskIds ?? []);
  const blocked = new Set(executionState?.blockedTaskIds ?? []);
  const taskById = executionState?.currentTaskId
    ? phase.tasks.find((task) => task.id === executionState.currentTaskId)
    : undefined;
  const nextAvailableTask = taskById && !completed.has(taskById.id) && !skipped.has(taskById.id)
    ? taskById
    : phase.tasks.find((task) =>
        !completed.has(task.id) &&
        !skipped.has(task.id) &&
        task.status !== "done"
      );

  if (!nextAvailableTask) {
    return {
      title: "No next task available",
      reason: `Phase ${phase.title} has no remaining actionable tasks.`,
      status: "Unknown",
      source: "Project Blueprint Phase Build Plan",
      selectionReason: "Current phase has no uncompleted, unskipped tasks.",
      emptyState: "No next task is available yet.",
      phaseId: phase.id,
      phaseTitle: phase.title,
    };
  }

  const isBlocked = executionState?.phaseStatus === "blocked" ||
    blocked.has(nextAvailableTask.id) ||
    nextAvailableTask.status === "blocked";
  const blockerInfo = isBlocked
    ? executionState?.blockerReason ?? "This task is blocked in the current phase state."
    : undefined;

  return {
    title: nextAvailableTask.title,
    reason: isBlocked
      ? blockerInfo ?? "Resolve this blocker before continuing."
      : executionState?.nextRecommendedAction ?? nextAvailableTask.rationale,
    status: isBlocked ? "Blocked" : "Ready",
    source: executionState ? "Project Blueprint PhaseExecutionState" : "Project Blueprint Phase Build Plan",
    selectionReason: taskById && taskById.id === nextAvailableTask.id
      ? "Selected from the current execution task."
      : "Selected as the first remaining task in the current phase.",
    emptyState: "",
    taskId: nextAvailableTask.id,
    phaseId: phase.id,
    phaseTitle: phase.title,
    blockerInfo,
  };
}

function nextTaskFromLivingBuildPlan(plan: LivingBuildPlan | null): ProjectDashboardModel["nextTask"] | null {
  const milestone = activeMilestone(plan);
  if (!milestone) return null;

  const task = milestone.tasks.find((item) => item.status === "blocked" || item.status === "doing" || item.status === "next" || item.status === "todo");
  const fallbackTitle = plan?.nextRecommendedStep?.trim();
  const isBlocked = task?.status === "blocked";
  if (!task && !fallbackTitle) {
    return {
      title: "No next task available",
      reason: "The living build plan has no remaining actionable task recorded.",
      status: "Unknown",
      source: "Living Build Plan",
      selectionReason: "No todo, next, doing, or blocked task was found in the current milestone.",
      emptyState: "No next task is available yet.",
      phaseId: milestone.id,
      phaseTitle: normalizeDashboardLabel(milestone.name),
    };
  }

  return {
    title: task?.title ?? fallbackTitle ?? "No next task available",
    reason: isBlocked
      ? "Resolve this blocked build-plan task before continuing."
      : fallbackTitle || task?.title || "Continue the next available build-plan task.",
    status: isBlocked ? "Blocked" : "Ready",
    source: "Living Build Plan",
    selectionReason: task
      ? "Selected as the first todo, next, doing, or blocked task in the current milestone."
      : "Selected from living build plan nextRecommendedStep.",
    emptyState: "",
    taskId: task?.id,
    phaseId: milestone.id,
    phaseTitle: normalizeDashboardLabel(milestone.name),
    blockerInfo: isBlocked ? task?.title : undefined,
  };
}

function nextTaskDashboardState(
  blueprint: ProjectBlueprint | null,
  livingBuildPlan: LivingBuildPlan | null
): ProjectDashboardModel["nextTask"] {
  return nextTaskFromPhaseState(blueprint) ??
    nextTaskFromLivingBuildPlan(livingBuildPlan) ??
    {
      title: "No next task available",
      reason: "No mission, phase, or build-plan task data is available yet.",
      status: "Unknown",
      source: "No task source",
      selectionReason: "No Project Blueprint phase plan or living build plan is loaded.",
      emptyState: "No next task is available yet.",
    };
}

function blockerSeverity(status: string): ProjectDashboardModel["blockers"]["items"][number]["severity"] {
  if (status === "blocked") return "Critical";
  if (status === "failed") return "High";
  if (status === "open" || status === "todo") return "Medium";
  return "Unknown";
}

function blockersDashboardState(input: {
  projectBlueprint: ProjectBlueprint | null;
  projectMemory: ProjectMemory | null;
  livingBuildPlan: LivingBuildPlan | null;
}): ProjectDashboardModel["blockers"] {
  const items: ProjectDashboardModel["blockers"]["items"] = [];

  for (const issue of input.projectMemory?.knownIssues ?? []) {
    if (issue.status === "resolved") continue;
    items.push({
      source: "Project Memory Known Issue",
      id: issue.id,
      title: issue.title,
      message: issue.notes ?? issue.title,
      status: issue.status,
      severity: blockerSeverity(issue.status),
    });
  }

  for (const todo of input.projectMemory?.todos ?? []) {
    if (todo.status !== "blocked") continue;
    items.push({
      source: "Project Memory Todo",
      id: todo.id,
      title: todo.text,
      message: todo.text,
      status: todo.status,
      severity: blockerSeverity(todo.status),
    });
  }

  for (const milestone of input.livingBuildPlan?.milestones ?? []) {
    for (const task of milestone.tasks) {
      if (task.status !== "blocked") continue;
      items.push({
        source: "Living Build Plan",
        id: task.id,
        title: task.title,
        message: task.description ?? task.title,
        status: task.status,
        severity: blockerSeverity(task.status),
        phaseId: milestone.id,
        phaseTitle: normalizeDashboardLabel(milestone.name),
        taskId: task.id,
      });
    }
  }

  const phasePlan = getPhasePlan(input.projectBlueprint);
  const executionState = getPhaseExecutionState(input.projectBlueprint);
  const currentPhase = phasePlan?.phases.find((phase) => phase.id === executionState?.currentPhaseId) ??
    phasePlan?.phases.find((phase) => phase.id === phasePlan.currentPhaseId) ??
    phasePlan?.phases[0];

  if (executionState) {
    for (const taskId of executionState.blockedTaskIds) {
      const task = currentPhase?.tasks.find((item) => item.id === taskId);
      items.push({
        source: "Phase Execution State",
        id: taskId,
        title: task?.title ?? taskId,
        message: executionState.blockerReason ?? task?.rationale ?? "Task is blocked.",
        status: "blocked",
        severity: "Critical",
        phaseId: currentPhase?.id ?? executionState.currentPhaseId,
        phaseTitle: currentPhase?.title,
        taskId,
      });
    }

    if (executionState.phaseStatus === "blocked" && executionState.blockedTaskIds.length === 0) {
      items.push({
        source: "Phase Execution State",
        id: `${executionState.currentPhaseId}-phase-blocked`,
        title: "Current phase is blocked",
        message: executionState.blockerReason ?? "The current phase is blocked.",
        status: executionState.phaseStatus,
        severity: "Critical",
        phaseId: currentPhase?.id ?? executionState.currentPhaseId,
        phaseTitle: currentPhase?.title,
      });
    }

    const checkEntries = [
      ["build", executionState.buildStatus] as const,
      ["test", executionState.testStatus] as const,
      ["check", executionState.checkStatus] as const,
    ];
    for (const [kind, check] of checkEntries) {
      if (check.status !== "failed" && check.status !== "blocked") continue;
      items.push({
        source: "Phase Execution Check",
        id: `${executionState.currentPhaseId}-${kind}-${check.status}`,
        title: `${kind} ${check.status}`,
        message: check.summary ?? `${kind} ${check.status}.`,
        status: check.status,
        severity: blockerSeverity(check.status),
        phaseId: currentPhase?.id ?? executionState.currentPhaseId,
        phaseTitle: currentPhase?.title,
        taskId: executionState.currentTaskId,
        checkKind: kind,
      });
    }

    for (const attempt of executionState.repairAttempts) {
      if (attempt.status !== "failed" && attempt.status !== "blocked") continue;
      items.push({
        source: "Phase Repair Attempt",
        id: attempt.id,
        title: `Repair ${attempt.status}`,
        message: attempt.summary,
        status: attempt.status,
        severity: blockerSeverity(attempt.status),
        phaseId: currentPhase?.id ?? executionState.currentPhaseId,
        phaseTitle: currentPhase?.title,
        taskId: attempt.taskId,
        repairAttempts: `${executionState.repairAttempts.length}`,
      });
    }
  }

  for (const gate of currentPhase?.qualityGates ?? []) {
    if (gate.status !== "failed" && gate.status !== "blocked") continue;
    items.push({
      source: "Phase Quality Gate",
      id: gate.id,
      title: gate.title,
      message: gate.check,
      status: gate.status,
      severity: blockerSeverity(gate.status),
      phaseId: currentPhase?.id,
      phaseTitle: currentPhase?.title,
    });
  }

  if (items.length === 0) {
    return {
      count: 0,
      summary: "No blockers recorded.",
      items: [],
      emptyState: "No blockers recorded.",
    };
  }

  return {
    count: items.length,
    summary: `${items.length} blocker${items.length === 1 ? "" : "s"} recorded: ${items.map((item) => {
      const message = item.message && item.message !== item.title ? ` - ${item.message}` : "";
      return `${item.severity} ${item.status}: ${item.title}${message}`;
    }).join("; ")}`,
    items,
    emptyState: "",
  };
}

function modeDashboardState(input: {
  developerMode?: boolean | null;
  projectBlueprint: ProjectBlueprint | null;
}): ProjectDashboardModel["modeState"] {
  const preferences = input.projectBlueprint?.controlPreferences.data;
  const preferenceDetail = preferences
    ? `blueprintPreferredMode=${preferences.preferredMode}; controlLevel=${preferences.controlLevel}; patchesRequireApproval=${preferences.patchesRequireApproval}; automaticSafePatches=${preferences.allowAutomaticSafePatches}; automaticBuildChecks=${preferences.allowAutomaticBuildChecks}; automaticTests=${preferences.allowAutomaticTests}; automaticRepair=${preferences.allowAutomaticRepair}`
    : "blueprintControlPreferences=(none)";

  if (input.developerMode == null) {
    return {
      currentMode: "Unknown",
      explanation: "Dashboard mode is not available yet.",
      developerDetailsHidden: "Unknown",
      rawDetail: `appDeveloperMode=(unknown); ${preferenceDetail}`,
      emptyState: "Dashboard mode is not available yet.",
    };
  }

  if (input.developerMode) {
    return {
      currentMode: "Developer Mode",
      explanation: "Developer Mode exposes raw task state, ids, logs, checks, patch controls, and detailed diagnostics.",
      developerDetailsHidden: "No",
      rawDetail: `appDeveloperMode=true; dashboardDetails=expanded; ${preferenceDetail}`,
      emptyState: "",
    };
  }

  return {
    currentMode: "Founder Mode",
    explanation: "Founder Mode keeps the dashboard focused on phase progress, blockers, next action, and plain-language summaries.",
    developerDetailsHidden: "Yes",
    rawDetail: `appDeveloperMode=false; dashboardDetails=simplified; ${preferenceDetail}`,
    emptyState: "",
  };
}

function architectureReviewDashboardState(
  blueprint: ProjectBlueprint | null
): ProjectDashboardModel["architectureReview"] {
  const review = blueprint?.architectureReview.data ?? null;
  if (!review) {
    return {
      status: "Unknown",
      score: "Not reviewed yet",
      summary: "Architecture Review has not run yet.",
      criticalFindings: "Not reviewed yet",
      recommendedImprovements: "Run Architecture Review before Foundation.",
      approvalRequired: "Unknown",
      rawDetail: "architectureReview=(none)",
      emptyState: "Architecture Review has not run yet.",
    };
  }
  const critical = review.findings.filter((finding) => finding.severity === "critical");
  const status = review.status === "passed"
    ? "Passed"
    : review.status === "blocked"
      ? "Blocked"
      : "Needs Review";
  return {
    status,
    score: `${review.architectureScore}/100`,
    summary: review.shouldContinueToFoundation
      ? "Architecture is healthy enough to continue after required approvals."
      : "Architecture must be fixed before Foundation can begin.",
    criticalFindings: critical.length
      ? critical.map((finding) => finding.title).join("; ")
      : "No critical findings recorded.",
    recommendedImprovements: review.recommendedImprovements.length
      ? review.recommendedImprovements.slice(0, 3).join("; ")
      : "No improvements required before Foundation.",
    approvalRequired: review.requiredFounderApprovals.length
      ? `${review.requiredFounderApprovals.length} approval${review.requiredFounderApprovals.length === 1 ? "" : "s"} required`
      : "No founder approvals required.",
    rawDetail: [
      `status=${review.status}`,
      `score=${review.architectureScore}`,
      `findings=${review.findings.map((finding) => `${finding.id}:${finding.severity}:canContinue=${finding.canContinue}`).join(", ") || "(none)"}`,
      `dependencyCount=${review.updatedDependencyGraph.length}`,
      `shouldContinueToFoundation=${review.shouldContinueToFoundation}`,
    ].join("; "),
    emptyState: "",
  };
}

function projectHealthDashboardState(
  blueprint: ProjectBlueprint | null
): ProjectDashboardModel["projectHealth"] {
  const health = blueprint?.projectHealth.data ?? null;
  if (!health) {
    return {
      overallScore: "Not calculated yet",
      overallStatus: "Unknown",
      topRisks: "Project Health has not run yet.",
      topStrengths: "Project Health has not run yet.",
      nextRecommendation: "Run Project Health after Blueprint and Architecture Review.",
      rawDetail: "projectHealth=(none)",
      emptyState: "Project Health has not been calculated yet.",
    };
  }
  return {
    overallScore: `${health.overallScore}/100`,
    overallStatus: health.overallStatus,
    topRisks: health.topRisks.length ? health.topRisks.join("; ") : "No top risks recorded.",
    topStrengths: health.topStrengths.length ? health.topStrengths.join("; ") : "No top strengths recorded.",
    nextRecommendation: health.nextRecommendation,
    rawDetail: [
      `updatedAt=${health.updatedAt}`,
      `categories=${health.categories.map((category) => `${category.category}:${category.score}:${category.status}`).join(", ")}`,
      `history=${health.history.map((item) => `${item.timestamp}:${item.overallScore}`).join(", ")}`,
    ].join("; "),
    emptyState: "",
  };
}

function riskSummaryDashboardState(input: {
  architectureReview: ProjectDashboardModel["architectureReview"];
  projectHealth: ProjectDashboardModel["projectHealth"];
  blockers: ProjectDashboardModel["blockers"];
}): ProjectDashboardModel["riskSummary"] {
  const topRisks = input.projectHealth.emptyState
    ? input.blockers.summary
    : input.projectHealth.topRisks;
  const architectureRisk = input.architectureReview.status === "Blocked"
    ? "Architecture is blocking Foundation."
    : input.architectureReview.status === "Needs Review"
      ? "Architecture needs review before Foundation."
      : input.architectureReview.status === "Passed"
        ? "Architecture Review passed."
        : "Architecture Review has not run yet.";
  const healthRisk = input.projectHealth.overallStatus === "Critical"
    ? "Project Health is critical."
    : input.projectHealth.overallStatus === "Needs Attention"
      ? "Project Health needs attention."
      : input.projectHealth.emptyState
        ? "Project Health has not run yet."
        : "Project Health is acceptable for the next gate.";

  return {
    summary: input.blockers.count
      ? `${input.blockers.count} blocker${input.blockers.count === 1 ? "" : "s"} plus health/architecture risks need review.`
      : "No blockers recorded; review architecture and health before continuing.",
    topRisks,
    blockerCount: input.blockers.count,
    architectureRisk,
    healthRisk,
    rawDetail: [
      `blockerCount=${input.blockers.count}`,
      `architectureStatus=${input.architectureReview.status}`,
      `architectureScore=${input.architectureReview.score}`,
      `healthStatus=${input.projectHealth.overallStatus}`,
      `healthScore=${input.projectHealth.overallScore}`,
    ].join("; "),
  };
}

export function shouldShowProjectDashboardButton(workspacePath: string | null): boolean {
  return Boolean(workspacePath?.trim());
}

export function buildProjectDashboardModel(input: {
  workspacePath: string;
  projectBlueprint?: ProjectBlueprint | null;
  projectMemory: ProjectMemory | null;
  livingBuildPlan: LivingBuildPlan | null;
  founderManifest: FounderManifest | null;
  manifest: ProjectManifest | null;
  developerMode?: boolean | null;
  diskTruth?: MvpDiskAuditResult | null;
}): ProjectDashboardModel {
  const counts = taskCounts(input.livingBuildPlan);
  const milestone = activeMilestone(input.livingBuildPlan);
  const task = activeTask(input.livingBuildPlan);
  const developmentPercent = percent(counts.complete, counts.total);
  const founderMvp = founderMvpPercent(input.projectMemory, input.founderManifest, input.livingBuildPlan);
  const vision = productVisionPercent(founderMvp);
  const buildPassing = false;
  const quality = qualityProgress(input.manifest, buildPassing);
  const openIssues = input.projectMemory?.knownIssues?.filter((issue) => issue.status !== "resolved").length ?? 0;
  const blockedTasks = input.livingBuildPlan?.milestones
    .flatMap((item) => item.tasks)
    .filter((item) => item.status === "blocked") ?? [];
  const approvedDecisions = input.projectMemory?.decisions?.map((decision) => decision.decision).slice(0, 5) ?? [];
  const pendingDecisions = input.projectMemory?.todos
    ?.filter((todo) => todo.status === "blocked" || /\b(decide|choose|confirm|approve)\b/i.test(todo.text))
    .map((todo) => todo.text)
    .slice(0, 5) ?? [];
  const projectName = input.projectMemory?.name?.trim() ||
    input.founderManifest?.projectId?.trim() ||
    input.projectBlueprint?.identity.name?.trim() ||
    input.workspacePath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
    "Current project";
  const nextStep = input.livingBuildPlan?.nextRecommendedStep?.trim() || task?.title || "Not estimated yet";
  const diskTruth = formatDiskTruthSummary(input.diskTruth ?? null);
  const currentPhase = phaseDashboardState(input.projectBlueprint ?? null, input.livingBuildPlan);
  const phaseConfidence = phaseConfidenceState(input.projectBlueprint ?? null);
  const qualityGateStatus = qualityGateDashboardState(input.projectBlueprint ?? null);
  const nextTask = nextTaskDashboardState(input.projectBlueprint ?? null, input.livingBuildPlan);
  const blockers = blockersDashboardState({
    projectBlueprint: input.projectBlueprint ?? null,
    projectMemory: input.projectMemory,
    livingBuildPlan: input.livingBuildPlan,
  });
  const modeState = modeDashboardState({
    developerMode: input.developerMode,
    projectBlueprint: input.projectBlueprint ?? null,
  });
  const architectureReview = architectureReviewDashboardState(input.projectBlueprint ?? null);
  const projectHealth = projectHealthDashboardState(input.projectBlueprint ?? null);
  const riskSummary = riskSummaryDashboardState({ architectureReview, projectHealth, blockers });

  return {
    currentPhase,
    phaseConfidence,
    qualityGateStatus,
    nextTask,
    blockers,
    modeState,
    architectureReview,
    projectHealth,
    riskSummary,
    projectPulse: {
      projectName,
      projectPath: input.workspacePath,
      buildStatus: diskTruth ?? "Not estimated yet",
      criticalIssuesCount: openIssues + blockedTasks.length + (input.diskTruth?.incompleteModules.length ?? 0),
      currentTask: currentPhase.currentTask || task?.title || "Not estimated yet",
      nextMilestone: nextMilestone(input.livingBuildPlan),
      estimatedMvpTime: input.livingBuildPlan?.timelineEstimate || estimatedRemainingTime(input.livingBuildPlan),
      overallConfidence: quality.confidence,
    },
    progressLayers: {
      developmentProgress: diskTruth
        ? `${developmentPercent}% (${counts.complete}/${counts.total} build-plan tasks). ${input.diskTruth?.summary ?? ""}`
        : `${developmentPercent}% (${counts.complete}/${counts.total} build-plan tasks). Scope: scaffold/build-plan progress only, not true MVP completion.`,
      founderMvpProgress: `${founderMvp}%. Scope: real founder-intended MVP progress, separate from scaffold completion.`,
      productVisionProgress: `${vision}%. Scope: long-term product/company vision.`,
      qualityProgress: quality.label,
      launchReadiness: launchReadiness(input.manifest, buildPassing),
    },
    currentWork: {
      developmentPhase: developmentPhase(milestone?.name, counts),
      currentTask: task?.title || "Not estimated yet",
      completedTasks: counts.total ? `${counts.complete}/${counts.total}` : "Not estimated yet",
      blockedTasks: blockedTasks.length ? blockedTasks.map((blocked) => blocked.title).join("; ") : "No blocked tasks recorded.",
      nextRecommendedStep: diskTruth ? `${nextStep}\n${diskTruth}` : nextStep,
    },
    founderDecisions: {
      approvedDecisions: approvedDecisions.length ? approvedDecisions.join("; ") : "No approved decisions recorded.",
      pendingDecisions: pendingDecisions.length ? pendingDecisions.join("; ") : "No pending decisions recorded.",
    },
    ctoRecommendation: {
      priority1: blockedTasks.length ? `Unblock: ${blockedTasks[0].title}` : nextStep,
      priority2: buildPassing ? "Keep the current task small and verify after applying changes." : "Run or verify the build check before stacking more feature work.",
      priority3: "Confirm founder MVP gaps before treating scaffold progress as product readiness.",
      estimatedTimeToNextMilestone: estimatedRemainingTime(input.livingBuildPlan),
      confidenceScore: quality.confidence,
    },
  };
}
