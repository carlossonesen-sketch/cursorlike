import type {
  ArchitectureReviewReport,
  PhaseExecutionState,
  ProjectBlueprint,
  ProjectHealthCategory,
  ProjectHealthCategoryScore,
  ProjectHealthReport,
  ProjectHealthStatus,
} from "../types";

export interface ProjectHealthInput {
  blueprint: ProjectBlueprint;
  architectureReview?: ArchitectureReviewReport | null;
  previousHealth?: ProjectHealthReport | null;
  now?: string;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function statusFromScore(score: number): ProjectHealthStatus {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 45) return "Needs Attention";
  return "Critical";
}

function category(
  categoryName: ProjectHealthCategory,
  score: number,
  summary: string,
  recommendations: string[],
  evidence: string[],
  calculationDetails: string[],
  trend: ProjectHealthCategoryScore["trend"] = "stable"
): ProjectHealthCategoryScore {
  const normalized = clampScore(score);
  return {
    category: categoryName,
    score: normalized,
    status: statusFromScore(normalized),
    summary,
    recommendations,
    evidence,
    calculationDetails,
    trend,
  };
}

function executionState(blueprint: ProjectBlueprint): PhaseExecutionState | null {
  return blueprint.phaseExecutionState.data;
}

function phasePlanScore(blueprint: ProjectBlueprint): number {
  const plan = blueprint.phaseBuildPlan.data;
  if (!plan) return 35;
  const phasesWithGates = plan.phases.filter((phase) => phase.qualityGates.length > 0).length;
  const phasesWithTasks = plan.phases.filter((phase) => phase.tasks.length > 0).length;
  return 50 + Math.round((phasesWithGates / Math.max(1, plan.phases.length)) * 25) +
    Math.round((phasesWithTasks / Math.max(1, plan.phases.length)) * 25);
}

function checkScore(state: PhaseExecutionState | null): number {
  if (!state) return 45;
  const checks = [state.buildStatus, state.testStatus, state.checkStatus];
  const failed = checks.filter((check) => check.status === "failed" || check.status === "blocked").length;
  const passed = checks.filter((check) => check.status === "passed").length;
  if (state.phaseStatus === "blocked" || state.blockedTaskIds.length > 0) return 30;
  if (failed > 0) return 38;
  if (passed >= 2) return 82;
  return 58;
}

function dependencyScore(review: ArchitectureReviewReport | null | undefined): number {
  if (!review) return 55;
  const circular = review.findings.some((finding) => finding.id === "circular-dependency");
  if (circular) return 20;
  if (review.updatedDependencyGraph.length === 0) return 48;
  return review.status === "passed" ? 85 : 72;
}

function trendFor(previous: ProjectHealthReport | null | undefined, score: number): ProjectHealthCategoryScore["trend"] {
  if (!previous) return "unknown";
  if (score > previous.overallScore + 3) return "improving";
  if (score < previous.overallScore - 3) return "declining";
  return "stable";
}

export function createProjectHealthReport(input: ProjectHealthInput): ProjectHealthReport {
  const blueprint = input.blueprint;
  const review = input.architectureReview ?? null;
  const state = executionState(blueprint);
  const now = input.now ?? new Date().toISOString();
  const pendingDecisions = blueprint.founderDecisions.data.filter((decision) => decision.status === "pending");
  const criticalArchitectureFindings = review?.findings.filter((finding) => finding.severity === "critical") ?? [];
  const warningArchitectureFindings = review?.findings.filter((finding) => finding.severity === "warning") ?? [];
  const repairFailures = state?.repairAttempts.filter((attempt) => attempt.status === "failed" || attempt.status === "blocked") ?? [];
  const blockedTasks = state?.blockedTaskIds.length ?? 0;
  const planScore = phasePlanScore(blueprint);
  const validationScore = checkScore(state);
  const dependencyHealth = dependencyScore(review);
  const architectureScore = review?.architectureScore ?? 55;
  const hasSecurityRisk = warningArchitectureFindings.some((finding) => /security|privacy|credential|auth/i.test(finding.title + finding.explanation));
  const docsScore = blueprint.specializedPlannerOutput.data ? 72 : 48;
  const autonomyScore = blueprint.phaseBuildPlan.data && blueprint.phaseExecutionState.data ? 70 : 48;

  const categories: ProjectHealthCategoryScore[] = [
    category(
      "Planning",
      planScore,
      blueprint.phaseBuildPlan.data ? "Phase plan is available and ready for gated review." : "Phase plan is missing.",
      blueprint.phaseBuildPlan.data ? ["Approve the current phase gate before execution."] : ["Generate a Phase Build Plan."],
      [`blueprint=${blueprint.id}`, `phasePlan=${blueprint.phaseBuildPlan.status}`],
      [`phasePlanScore=${planScore}`]
    ),
    category(
      "Architecture",
      architectureScore,
      review ? `Architecture Review status is ${review.status}.` : "Architecture Review has not run yet.",
      review?.recommendedImprovements.length ? review.recommendedImprovements : ["Run Architecture Review before Foundation."],
      review ? [`findings=${review.findings.length}`, `score=${review.architectureScore}`] : ["architectureReview=(none)"],
      [`criticalFindings=${criticalArchitectureFindings.length}`, `warningFindings=${warningArchitectureFindings.length}`]
    ),
    category(
      "Dependencies",
      dependencyHealth,
      review ? "Dependency graph is available for review." : "Dependency graph has not been architecturally reviewed yet.",
      dependencyHealth < 70 ? ["Validate dependency graph and block circular dependencies."] : ["Keep dependency graph updated as tasks change."],
      [`dependencyCount=${review?.updatedDependencyGraph.length ?? 0}`],
      [`dependencyScore=${dependencyHealth}`]
    ),
    category(
      "Implementation",
      state ? 62 : 42,
      state ? "Implementation state exists, but no production implementation should begin before approval gates." : "Implementation state is not initialized.",
      ["Keep implementation behind approved phase gates and PatchEngine validation."],
      [`phaseStatus=${state?.phaseStatus ?? "(none)"}`, `currentTask=${state?.currentTaskId ?? "(none)"}`],
      [`completedTasks=${state?.completedTaskIds.length ?? 0}`, `blockedTasks=${blockedTasks}`]
    ),
    category(
      "Testing",
      validationScore,
      state ? `Validation status is build=${state.buildStatus.status}, test=${state.testStatus.status}, check=${state.checkStatus.status}.` : "No validation state is available yet.",
      validationScore < 70 ? ["Run build/test/check gates before phase completion."] : ["Keep validation evidence attached to quality gates."],
      [`build=${state?.buildStatus.status ?? "(none)"}`, `test=${state?.testStatus.status ?? "(none)"}`, `check=${state?.checkStatus.status ?? "(none)"}`],
      [`validationScore=${validationScore}`]
    ),
    category("Documentation", docsScore, "Planner and Blueprint documentation are present at planning level.", ["Add implementation docs when real files are created."], [`specializedPlanner=${blueprint.specializedPlannerOutput.data?.planner ?? "(none)"}`], [`docsScore=${docsScore}`]),
    category("Security", hasSecurityRisk ? 52 : 68, hasSecurityRisk ? "Security/privacy assumptions need attention before implementation." : "Security risks are known but not fully reviewed.", ["Review auth depth, lead data privacy, API keys, and account boundaries before implementation."], [`securityFinding=${hasSecurityRisk}`], [`pendingDecisions=${pendingDecisions.length}`]),
    category("Performance", 64, "Performance is not yet measurable because implementation has not started.", ["Define performance checks when preview/export paths exist."], ["implementationStarted=false"], ["defaultPlanningScore=64"]),
    category("Scalability", architectureScore >= 75 ? 74 : 58, "Scalability depends on preserving structured project/template/page data models.", ["Keep WebsiteProject, IndustryTemplate, LayoutTemplate, Page, Section, and Theme contracts separate."], [`architectureScore=${architectureScore}`], ["scalabilityDerivedFromArchitecture=true"]),
    category("Technical Debt", criticalArchitectureFindings.length ? 35 : 66, criticalArchitectureFindings.length ? "Critical architecture issues are present." : "No critical technical debt is known yet.", criticalArchitectureFindings.length ? ["Resolve critical architecture findings before Foundation."] : ["Track technical debt as implementation begins."], [`criticalArchitectureFindings=${criticalArchitectureFindings.length}`], [`repairFailures=${repairFailures.length}`]),
    category("Maintainability", architectureScore >= 75 ? 76 : 60, "Maintainability is strongest if NF reuses existing Blueprint, phase, patch, validation, repair, and dashboard modules.", ["Do not create parallel execution systems for this project."], [`reuseFinding=${review?.findings.some((finding) => finding.id === "reuse-existing-nf-engine") ?? false}`], [`architectureScore=${architectureScore}`]),
    category("Risk", blockedTasks || criticalArchitectureFindings.length ? 38 : 68, blockedTasks || criticalArchitectureFindings.length ? "Blocking risks exist." : "Risks are visible and manageable at the planning gate.", ["Surface top risks in Founder Mode and raw evidence in Developer Mode."], [`blockedTasks=${blockedTasks}`, `criticalFindings=${criticalArchitectureFindings.length}`], [`repairFailures=${repairFailures.length}`]),
    category("Autonomy Readiness", autonomyScore, "NF can plan and gate this project, but should not fully autonomously build it yet.", ["Require phase approvals and concrete PatchEngine-validated patches."], [`phasePlan=${Boolean(blueprint.phaseBuildPlan.data)}`, `executionState=${Boolean(blueprint.phaseExecutionState.data)}`], [`autonomyScore=${autonomyScore}`]),
  ];

  const preOverall = Math.round(categories.reduce((sum, item) => sum + item.score, 0) / categories.length);
  const overall = category(
    "Overall Project Health",
    preOverall,
    preOverall >= 70 ? "Project is healthy enough for the next gated planning step." : "Project needs attention before implementation.",
    preOverall >= 70 ? ["Proceed only through the next approved phase gate."] : ["Resolve critical findings and blockers before Foundation."],
    [`categoryCount=${categories.length}`],
    [`averageScore=${preOverall}`],
    trendFor(input.previousHealth, preOverall)
  );
  const allCategories = [...categories, overall];
  const topRisks = allCategories
    .filter((item) => item.status === "Critical" || item.status === "Needs Attention")
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((item) => `${item.category}: ${item.summary}`);
  const topStrengths = allCategories
    .filter((item) => item.status === "Excellent" || item.status === "Good")
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => `${item.category}: ${item.summary}`);

  return {
    schemaVersion: 1,
    blueprintId: blueprint.id,
    updatedAt: now,
    overallScore: overall.score,
    overallStatus: overall.status,
    topRisks,
    topStrengths,
    nextRecommendation: criticalArchitectureFindings.length
      ? "Resolve critical Architecture Review findings before Foundation."
      : "Approve the Architecture Review gate before Foundation.",
    categories: allCategories,
    history: [
      ...(input.previousHealth?.history ?? []),
      {
        timestamp: now,
        overallScore: overall.score,
        summary: overall.summary,
      },
    ],
  };
}
