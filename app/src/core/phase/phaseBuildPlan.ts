import type {
  GapAnalysis,
  GapAnalysisItem,
  PhaseBuildPlan,
  PhaseBuildPlanPhase,
  PhaseTask,
  PreservationRules,
  ProjectBlueprint,
  QualityGate,
} from "../types";

const DEFAULT_PHASES = [
  "Discovery",
  "Architecture Review",
  "Foundation",
  "MVP Features",
  "Testing/Stabilization",
  "Polish",
  "Launch Readiness",
] as const;

function qualityGate(id: string, title: string, check: string, required = true): QualityGate {
  return {
    id,
    title,
    check,
    required,
    status: "pending",
  };
}

function phase(
  id: string,
  title: string,
  goal: string,
  tasks: PhaseTask[],
  definitionOfDone: string[],
  qualityGates: QualityGate[],
  status: PhaseBuildPlanPhase["status"] = "planned"
): PhaseBuildPlanPhase {
  return {
    id,
    title,
    goal,
    tasks,
    definitionOfDone,
    qualityGates,
    approvalGate: {
      id: `${id}-approval`,
      title: `${title} approval`,
      requiresApproval: true,
      approvalQuestion: `Approve the ${title} phase before NF starts this phase?`,
    },
    status,
  };
}

function task(
  id: string,
  title: string,
  rationale: string,
  sourceGapKeys: string[] = [],
  constraints: string[] = []
): PhaseTask {
  return {
    id,
    title,
    rationale,
    sourceGapKeys,
    constraints,
    status: "todo",
  };
}

function preservationConstraints(blueprint: ProjectBlueprint): string[] {
  const rules = blueprint.preservationRules.data;
  if (!rules) return [];
  const constraints: string[] = [];
  if (rules.preserveWorkingUi) constraints.push("Preserve existing working UI.");
  if (rules.preserveUserFlows) constraints.push("Preserve existing user workflows.");
  if (rules.preserveFolderStructure) constraints.push("Preserve current folder structure where practical.");
  if (rules.preserveBusinessLogic) constraints.push("Preserve existing business logic.");
  if (rules.preserveArchitectureDecisions) constraints.push("Preserve current architecture decisions.");
  if (rules.requireApprovalForRewrite) constraints.push("Do not rewrite, redesign, or restructure without explicit founder approval.");
  if (rules.defaultChangeMode === "extend") constraints.push("Prefer additive extension over replacement.");
  return constraints;
}

function warningConstraints(gap: GapAnalysis, gapKey: string): string[] {
  return gap.preservationWarnings
    .filter((warning) => warning.key === gapKey)
    .map((warning) => warning.reason);
}

function tasksFromGaps(gap: GapAnalysis, baseConstraints: string[]): PhaseTask[] {
  const partialTasks = gap.partialFeatures.map((item) =>
    task(
      `mvp-complete-${item.key}`,
      `Complete ${item.label}`,
      item.reason,
      [item.key],
      [...baseConstraints, ...warningConstraints(gap, item.key)]
    )
  );
  const missingTasks = gap.missingMvpFeatures.map((item) =>
    task(
      `mvp-build-${item.key}`,
      `Build ${item.label}`,
      item.reason,
      [item.key],
      [...baseConstraints, ...warningConstraints(gap, item.key)]
    )
  );
  return [...partialTasks, ...missingTasks];
}

function blockerTasks(blockers: GapAnalysisItem[], constraints: string[]): PhaseTask[] {
  return blockers.map((blocker) =>
    task(
      `foundation-resolve-${blocker.key}`,
      `Resolve ${blocker.label}`,
      blocker.reason,
      [blocker.key],
      constraints
    )
  );
}

function discoveryTasks(blueprint: ProjectBlueprint): PhaseTask[] {
  const tasks = [
    task(
      "discovery-confirm-blueprint",
      "Confirm Project Blueprint",
      "Confirm the project identity, product brief, assumptions, and founder decisions before deeper planning."
    ),
  ];
  if (blueprint.identity.source === "existingProject") {
    tasks.push(
      task(
        "discovery-review-inventory",
        "Review existing product inventory",
        "Validate imported files, UI entry points, commands, and preservation rules before planning changes."
      )
    );
  }
  return [...tasks, ...plannerTasks(blueprint, "discovery")];
}

function foundationTasks(blueprint: ProjectBlueprint, gap: GapAnalysis, constraints: string[]): PhaseTask[] {
  const tasks = [
    task(
      "foundation-confirm-commands",
      "Confirm run/build/test commands",
      "Quality gates need reliable commands before automated execution can safely begin.",
      [],
      constraints
    ),
    task(
      "foundation-baseline-current-state",
      "Baseline current product state",
      "Record what currently works before feature work starts.",
      [],
      constraints
    ),
    ...blockerTasks(gap.possibleBlockers, constraints),
    ...plannerTasks(blueprint, "foundation"),
  ];

  if (blueprint.identity.source === "existingProject") {
    tasks.push(
      task(
        "foundation-preserve-existing-product",
        "Lock preservation boundaries",
        "Existing products are continued, not replaced. Confirm constraints before implementing missing work.",
        [],
        constraints
      )
    );
  }

  return tasks;
}

function plannerTasks(blueprint: ProjectBlueprint, phaseId: string): PhaseTask[] {
  return blueprint.specializedPlannerOutput.data?.phaseTasks[phaseId] ?? [];
}

function plannerQualityGates(blueprint: ProjectBlueprint, phaseId: string): QualityGate[] {
  return blueprint.specializedPlannerOutput.data?.qualityGates[phaseId] ?? [];
}

function defaultQualityGates(phaseId: string): QualityGate[] {
  return [
    qualityGate(`${phaseId}-build-check`, "Build check", "Run the detected build command or confirm no build command exists."),
    qualityGate(`${phaseId}-test-check`, "Test check", "Run detected tests where available or record why tests are unavailable."),
  ];
}

function createPreservationSummary(rules: PreservationRules | null): string {
  if (!rules) {
    return "No preservation rules are attached yet.";
  }
  if (rules.defaultChangeMode === "extend") {
    return "Preservation-first: extend existing UI, workflows, structure, logic, and architecture unless the founder approves a rewrite.";
  }
  return "Preservation rules are present, but replacement may be allowed by configuration.";
}

export function createPhaseBuildPlan(
  blueprint: ProjectBlueprint,
  gapAnalysis: GapAnalysis,
  now = new Date().toISOString()
): PhaseBuildPlan {
  const constraints = preservationConstraints(blueprint);
  const specializedMvpTasks = plannerTasks(blueprint, "mvp-features");
  const mvpTasks = specializedMvpTasks.length ? specializedMvpTasks : tasksFromGaps(gapAnalysis, constraints);
  const phases: PhaseBuildPlanPhase[] = [
    phase(
      "discovery",
      DEFAULT_PHASES[0],
      "Confirm the product truth and clarify anything that blocks planning.",
      discoveryTasks(blueprint),
      [
        "Project Blueprint has been reviewed.",
        "Assumptions and pending founder decisions are visible.",
        "Existing product inventory is reviewed when this is an imported project.",
      ],
      [qualityGate("discovery-blueprint-ready", "Blueprint ready", "Blueprint has product brief, assumptions, and confidence state.")],
      "planned"
    ),
    phase(
      "architecture-review",
      DEFAULT_PHASES[1],
      "Review architecture, dependency graph, risk, scalability, security, and founder decisions before Foundation begins.",
      [
        task(
          "architecture-review-run",
          "Run Architecture Review",
          "Evaluate the Blueprint like a senior software architect before implementation planning continues.",
          [],
          constraints
        ),
        task(
          "architecture-review-resolve-critical-findings",
          "Resolve critical architecture findings",
          "Foundation must not begin until critical architecture findings are resolved or explicitly blocked.",
          [],
          constraints
        ),
        task(
          "architecture-review-confirm-founder-approvals",
          "Confirm required founder approvals",
          "Architecture decisions that affect scope, security, hosting, cost, or implementation direction need founder approval.",
          [],
          constraints
        ),
      ],
      [
        "Architecture Report is generated.",
        "Architecture Score is recorded.",
        "Critical findings are resolved or the project is blocked.",
        "Required founder approvals are listed.",
        "Dependency graph has no circular dependencies.",
      ],
      [
        qualityGate("architecture-review-report-ready", "Architecture Report ready", "Architecture Review has produced findings, score, dependency graph, and recommendations."),
        qualityGate("architecture-review-no-critical-blockers", "No critical architecture blockers", "No unresolved critical architecture finding can block Foundation."),
        qualityGate("architecture-review-dependency-graph-valid", "Dependency graph valid", "Dependency graph has no circular dependencies."),
      ]
    ),
    phase(
      "foundation",
      DEFAULT_PHASES[2],
      "Prepare the project for safe implementation without replacing existing working product structure.",
      foundationTasks(blueprint, gapAnalysis, constraints),
      [
        "Run/build/test commands are confirmed or explicitly marked unavailable.",
        "Current working state is baselined.",
        "Preservation boundaries are clear for existing projects.",
      ],
      defaultQualityGates("foundation")
    ),
    phase(
      "mvp-features",
      DEFAULT_PHASES[3],
      "Implement the missing and partial MVP features in the shortest safe order.",
      mvpTasks.length
        ? mvpTasks
        : [
            task(
              "mvp-confirm-no-gaps",
              "Confirm no MVP feature gaps remain",
              "Gap Analysis did not find missing or partial MVP features."
            ),
          ],
      [
        "Missing MVP features are implemented or deliberately deferred.",
        "Partial MVP features are completed or deliberately deferred.",
        "Existing product UI and workflows are preserved unless explicitly approved otherwise.",
      ],
      [...defaultQualityGates("mvp-features"), ...plannerQualityGates(blueprint, "mvp-features")]
    ),
    phase(
      "testing-stabilization",
      DEFAULT_PHASES[4],
      "Stabilize the MVP through build checks, tests, and focused repair.",
      [
        task("testing-run-build", "Run build check", "Verify the product builds after MVP feature work."),
        task("testing-run-tests", "Run available tests", "Verify existing tests or document missing test coverage."),
        task("testing-repair-failures", "Repair blocking failures", "Fix build or test failures before polish."),
        ...plannerTasks(blueprint, "testing-stabilization"),
      ],
      [
        "Build check passes or blockers are documented.",
        "Available tests pass or missing tests are documented.",
        "Known blocking failures are repaired or escalated.",
      ],
      [...defaultQualityGates("testing-stabilization"), ...plannerQualityGates(blueprint, "testing-stabilization")]
    ),
    phase(
      "polish",
      DEFAULT_PHASES[5],
      "Improve usability and presentation after MVP behavior is working.",
      [
        task(
          "polish-ux-audit",
          "Run focused UI/UX audit",
          "Polish comes after MVP unless UI blocks usability."
        ),
        task(
          "polish-accessibility-pass",
          "Improve accessibility and wording",
          "Make the working MVP easier to understand and use."
        ),
      ],
      [
        "Core MVP remains functional.",
        "UI polish does not change core flows without approval.",
        "Usability issues are addressed after functional work is stable.",
      ],
      defaultQualityGates("polish")
    ),
    phase(
      "launch-readiness",
      DEFAULT_PHASES[6],
      "Prepare the product for demo, MVP release, or launch decision.",
      [
        task("launch-readiness-review", "Review launch readiness", "Check deployment, docs, analytics, auth, privacy, and known risks."),
        task("launch-next-decision", "Recommend launch or next phase", "Summarize whether this is demo-ready, MVP candidate, or blocked."),
      ],
      [
        "Launch blockers are listed.",
        "Founder decisions are identified.",
        "Next release recommendation is clear.",
      ],
      defaultQualityGates("launch-readiness")
    ),
  ];

  return {
    schemaVersion: 1,
    blueprintId: blueprint.id,
    createdAt: now,
    updatedAt: now,
    phases,
    currentPhaseId: "discovery",
    recommendedNextPhaseId: "discovery",
    recommendedNextTaskId: phases[0].tasks[0]?.id,
    preservationSummary: createPreservationSummary(blueprint.preservationRules.data),
  };
}
