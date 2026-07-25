import type {
  ArchitectureFinding,
  ArchitectureReviewReport,
  PlannerDependency,
  ProjectBlueprint,
} from "../types";

function finding(
  id: string,
  severity: ArchitectureFinding["severity"],
  title: string,
  explanation: string,
  affectedModules: string[],
  suggestedSolution: string,
  canContinue: boolean
): ArchitectureFinding {
  return {
    id,
    severity,
    title,
    explanation,
    affectedModules,
    suggestedSolution,
    canContinue,
  };
}

function dependenciesFromBlueprint(blueprint: ProjectBlueprint): PlannerDependency[] {
  return blueprint.specializedPlannerOutput.data?.dependencyGraph ?? [];
}

export function findCircularDependencies(dependencies: PlannerDependency[]): string[][] {
  const graph = new Map(dependencies.map((item) => [item.id, item.dependsOn]));
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(id: string): void {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;

    visiting.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) {
      if (graph.has(dependency)) visit(dependency);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const dependency of dependencies) {
    visit(dependency.id);
  }

  return cycles;
}

function scoreFindings(findings: ArchitectureFinding[]): number {
  const penalty = findings.reduce((sum, item) => {
    if (item.severity === "critical") return sum + 35;
    if (item.severity === "warning") return sum + 14;
    if (item.severity === "recommendation") return sum + 5;
    return sum + 1;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function statusFrom(findings: ArchitectureFinding[]): ArchitectureReviewReport["status"] {
  if (findings.some((item) => item.severity === "critical" && !item.canContinue)) return "blocked";
  if (findings.some((item) => item.severity === "warning" || item.severity === "critical")) return "needsReview";
  return "passed";
}

export function createArchitectureReviewReport(
  blueprint: ProjectBlueprint,
  now = new Date().toISOString()
): ArchitectureReviewReport {
  const dependencies = dependenciesFromBlueprint(blueprint);
  const cycles = findCircularDependencies(dependencies);
  const findings: ArchitectureFinding[] = [];
  const planner = blueprint.specializedPlannerOutput.data;
  const brief = blueprint.productBrief.data;
  const hasSecurityModel = blueprint.architecture.data.some((item) => /\b(auth|security|privacy|permission|credential)\b/i.test(item)) ||
    blueprint.apis.data.some((item) => /\b(auth|permission|account)\b/i.test(item));
  const hasDataModels = blueprint.dataModels.data.length > 0;
  const hasQualityGates = Boolean(blueprint.phaseBuildPlan.data?.phases.some((phase) => phase.qualityGates.length > 0));
  const hasAiDeferred = (planner?.deferredFeatures ?? []).some((feature) => /\bAI\b/i.test(feature));
  const hasTemplateSeparation = (planner?.templateSeparationRules?.length ?? 0) > 0 ||
    blueprint.architecture.data.some((item) => /industry templates.*layout templates|layout templates.*industry templates/i.test(item));

  findings.push(finding(
    "architecture-overall-shape",
    "info",
    "Architecture is Blueprint-led and phase-gated",
    "The project has a central Blueprint, specialized planner output, and a phase plan before implementation.",
    ["ProjectBlueprint", "PhaseBuildPlan", planner?.planner ?? "planner"],
    "Keep implementation behind phase gates and write future decisions back to Blueprint.",
    true
  ));

  if (!brief) {
    findings.push(finding(
      "missing-product-brief",
      "critical",
      "Product Brief is missing",
      "Foundation should not begin without a Product Brief because the build would lack a clear product target.",
      ["ProjectBlueprint.productBrief"],
      "Create or repair the Product Brief before approving Architecture Review.",
      false
    ));
  }

  if (!planner) {
    findings.push(finding(
      "missing-specialized-planner-output",
      "critical",
      "Specialized planner output is missing",
      "The request needs planner-specific architecture, milestones, dependencies, and quality gates before implementation.",
      ["ProjectBlueprint.specializedPlannerOutput"],
      "Run the required specialized planner and attach its output to the Blueprint.",
      false
    ));
  }

  if (cycles.length > 0) {
    findings.push(finding(
      "circular-dependency",
      "critical",
      "Circular dependency detected",
      `The dependency graph contains cycle(s): ${cycles.map((cycle) => cycle.join(" -> ")).join("; ")}.`,
      cycles.flat(),
      "Break the cycle before Foundation begins so task scheduling cannot loop.",
      false
    ));
  }

  if (!hasDataModels) {
    findings.push(finding(
      "missing-data-models",
      "warning",
      "Data model quality is not ready",
      "The Blueprint does not yet define data models, which makes implementation risky.",
      ["ProjectBlueprint.dataModels"],
      "Define the core data model contracts in Architecture Review or Foundation before UI work.",
      true
    ));
  }

  if (!hasTemplateSeparation && brief?.productType === "Website Platform / Website Builder") {
    findings.push(finding(
      "template-separation-missing",
      "critical",
      "Industry/layout template separation is missing",
      "Website Platform work must separate business content templates from visual layout templates.",
      ["IndustryTemplate", "LayoutTemplate", "ProjectBlueprint.architecture"],
      "Add explicit template separation rules before Foundation.",
      false
    ));
  }

  if (!hasSecurityModel) {
    findings.push(finding(
      "security-model-needed",
      "warning",
      "Security and privacy assumptions need review",
      "The MVP includes accounts, leads, analytics, and media, so auth/privacy boundaries need explicit review.",
      ["UserAccountSettings", "LeadRecord", "AnalyticsEvent", "MediaAsset"],
      "Add a Foundation task or founder decision for auth depth, lead data privacy, and API key handling.",
      true
    ));
  }

  if (!hasQualityGates) {
    findings.push(finding(
      "quality-gates-missing",
      "critical",
      "Quality gates are missing",
      "Implementation should not begin unless each phase has quality gates.",
      ["PhaseBuildPlan.qualityGates"],
      "Generate or repair phase quality gates before Foundation.",
      false
    ));
  }

  if (hasAiDeferred) {
    findings.push(finding(
      "future-ai-integration-deferred",
      "recommendation",
      "AI integration is correctly deferred",
      "The planner keeps AI out of the MVP while preserving an AI-ready architecture path.",
      ["SpecializedPlannerOutput.deferredFeatures", "ProjectBlueprint.integrations"],
      "Keep extension points clear but do not build AI before the non-AI MVP works.",
      true
    ));
  }

  findings.push(finding(
    "reuse-existing-nf-engine",
    "recommendation",
    "Reuse existing NF engine modules",
    "Implementation should route through Blueprint, PhaseBuildPlan, ExecutionLoop, PatchEngine, validation adapters, repair runners, progress recorder, and dashboard instead of creating parallel systems.",
    ["ProjectBlueprint", "PhaseBuildPlan", "ExecutionLoop", "PatchEngine", "ProjectDashboard"],
    "Keep all generated work inside the existing autonomous phase engine.",
    true
  ));

  const architectureScore = scoreFindings(findings);
  const status = statusFrom(findings);
  const shouldContinueToFoundation = status === "passed" || (status === "needsReview" && findings.every((item) => item.canContinue));

  return {
    schemaVersion: 1,
    blueprintId: blueprint.id,
    reviewedAt: now,
    status,
    architectureScore,
    findings,
    requiredFounderApprovals: findings
      .filter((item) => !item.canContinue || item.severity === "warning")
      .map((item) => ({
        id: `${item.id}-approval`,
        question: `Approve architecture handling for: ${item.title}?`,
        reason: item.explanation,
        required: !item.canContinue || item.severity === "critical",
      })),
    updatedDependencyGraph: dependencies,
    recommendedImprovements: findings
      .filter((item) => item.severity !== "info")
      .map((item) => item.suggestedSolution),
    shouldContinueToFoundation,
  };
}
