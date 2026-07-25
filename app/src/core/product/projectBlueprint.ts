import type {
  BlueprintBuildHistoryEntry,
  BlueprintDecision,
  BlueprintSection,
  BlueprintSource,
  ArchitectureReviewReport,
  ControlPreferences,
  DiscoveryIntake,
  ExistingProductAssessment,
  FrontEndComponentIntent,
  FrontEndGenerationIntent,
  FrontEndInteractionStateIntent,
  FrontEndRouteIntent,
  FrontEndValidationNeed,
  GapAnalysis,
  IntakeAnswer,
  IntakeConfidenceLevel,
  IntakeDefault,
  PhaseBuildPlan,
  PhaseExecutionState,
  ProductBrief,
  ProjectHealthReport,
  ProjectClassificationResult,
  ProjectBlueprint,
  ProjectIdentity,
  SpecializedPlannerOutput,
} from "../types";
import { classifyProjectRequest } from "./projectClassification";
import {
  createWebsitePlatformPlannerOutput,
  isWebsitePlatformClassification,
} from "./planners/websitePlatformPlanner";
import { createFoundationPlannerOutput, requiresSpecializedPlanner } from "./planners/foundationPlanner";

export interface ProjectBlueprintOptions {
  id?: string;
  now?: string;
  source?: BlueprintSource;
  projectId?: string;
  name?: string;
  slug?: string;
  path?: string;
}

function emptySection<T>(data: T): BlueprintSection<T> {
  return { status: "empty", data };
}

function draftSection<T>(data: T, updatedAt: string): BlueprintSection<T> {
  return { status: "draft", updatedAt, data };
}

function createDefaultControlPreferences(): ControlPreferences {
  return {
    controlLevel: "assisted",
    preferredMode: "developer",
    phaseGatesRequireApproval: true,
    patchesRequireApproval: true,
    allowAutomaticSafePatches: false,
    allowAutomaticBuildChecks: true,
    allowAutomaticTests: false,
    allowAutomaticRepair: false,
    stopForSensitiveActions: true,
    stopForDestructiveActions: true,
  };
}

function findAnswer(intake: DiscoveryIntake, key: string): IntakeAnswer | undefined {
  return intake.inferredAnswers.find((answer) => answer.key === key);
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createProductBrief(intake: DiscoveryIntake, classification: ProjectClassificationResult): ProductBrief {
  const productType = findAnswer(intake, "productType")?.value ?? "software product";
  const platform = findAnswer(intake, "platform")?.value ?? "web app";
  const mvpFeatures = splitCsv(findAnswer(intake, "mvpFeatures")?.value ?? "");
  const classifiedProductType = productType === "software app" || productType === "software product"
    ? classification.primaryClassification
    : productType;

  return {
    summary: intake.understoodSummary,
    productType: classifiedProductType,
    platform,
    mvpFeatures,
    targetUsers: [],
    launchTarget: "MVP",
  };
}

function createSpecializedPlannerOutput(
  intake: DiscoveryIntake,
  classification: ProjectClassificationResult
): SpecializedPlannerOutput | null {
  if (isWebsitePlatformClassification(classification)) {
    return createWebsitePlatformPlannerOutput(intake, classification);
  }
  if (requiresSpecializedPlanner(classification)) {
    return createFoundationPlannerOutput(intake, classification);
  }
  return null;
}

function createBuildHistoryEntry(id: string, timestamp: string): BlueprintBuildHistoryEntry {
  return {
    id: `${id}-created`,
    timestamp,
    summary: "Project Blueprint created from Discovery Intake.",
    source: "DiscoveryIntake",
  };
}

function featureKey(value: string): string {
  return slugify(value) || "feature";
}

function titleCaseFeature(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createRouteIntents(features: string[]): FrontEndRouteIntent[] {
  const routes: FrontEndRouteIntent[] = [
    {
      path: "/",
      label: "Home",
      purpose: "Provide the first screen and entry point for the MVP experience.",
      sourceFeatureKeys: [],
    },
  ];

  for (const feature of features.slice(0, 4)) {
    const key = featureKey(feature);
    routes.push({
      path: `/${key}`,
      label: titleCaseFeature(feature),
      purpose: `Support the ${feature} MVP feature in the user interface.`,
      sourceFeatureKeys: [key],
    });
  }

  return routes;
}

function createComponentIntents(features: string[], routes: FrontEndRouteIntent[]): FrontEndComponentIntent[] {
  const components: FrontEndComponentIntent[] = [
    {
      name: "AppShell",
      purpose: "Provide the top-level responsive layout for the product.",
      componentType: "layout",
      supportsRoutes: routes.map((route) => route.path),
      sourceFeatureKeys: [],
    },
    {
      name: "PrimaryNavigation",
      purpose: "Help users move through the core MVP screens.",
      componentType: "navigation",
      supportsRoutes: routes.map((route) => route.path),
      sourceFeatureKeys: [],
    },
  ];

  for (const feature of features.slice(0, 6)) {
    const key = featureKey(feature);
    components.push({
      name: `${titleCaseFeature(feature).replace(/[^A-Za-z0-9]+/g, "") || "Feature"}Panel`,
      purpose: `Present and manage the ${feature} MVP feature.`,
      componentType: "display",
      supportsRoutes: routes.filter((route) => route.sourceFeatureKeys.includes(key)).map((route) => route.path),
      sourceFeatureKeys: [key],
    });
  }

  return components;
}

function createInteractionStates(features: string[]): FrontEndInteractionStateIntent[] {
  return [
    {
      target: "Primary screens",
      states: ["empty", "loading", "error", "ready"],
      reason: "Every MVP screen should handle basic user-visible states before polish.",
    },
    {
      target: features.length ? "Feature actions" : "Primary action",
      states: ["idle", "submitting", "success", "failure"],
      reason: "Core interactions need clear feedback without relying on backend implementation details.",
    },
  ];
}

function createValidationNeeds(): FrontEndValidationNeed[] {
  return [
    {
      id: "frontend-main-flow-navigable",
      label: "Main user flow is navigable",
      reason: "Founder testing depends on reaching every MVP screen without hidden technical steps.",
      required: true,
    },
    {
      id: "frontend-responsive-layout",
      label: "Responsive layout is specified",
      reason: "The default web app should be demoable on desktop and mobile browser sizes.",
      required: true,
    },
    {
      id: "frontend-basic-states",
      label: "Empty/loading/error states are planned",
      reason: "Basic interaction states keep the UI usable before backend and polish work are complete.",
      required: true,
    },
    {
      id: "frontend-preservation-check",
      label: "Existing UI preservation is checked",
      reason: "Imported products should be extended instead of redesigned unless the founder approves it.",
      required: true,
    },
  ];
}

function createFrontEndGenerationIntent(intake: DiscoveryIntake, productBrief: ProductBrief): FrontEndGenerationIntent {
  const features = productBrief.mvpFeatures.length ? productBrief.mvpFeatures : splitCsv(findAnswer(intake, "mvpFeatures")?.value ?? "");
  const routes = createRouteIntents(features);
  const productName = productBrief.productType || "software product";

  return {
    appType: productName,
    targetPlatform: productBrief.platform || "web app",
    founderSummary: `Plan a ${productBrief.platform || "web app"} front end for ${productName} with ${features.length ? features.join(", ") : "the core MVP flow"}.`,
    pagesOrScreens: routes.map((route) => route.label),
    routes,
    components: createComponentIntents(features, routes),
    layoutStylePreferences: [
      "Founder-first, simple, and demo-ready.",
      "Preserve existing UI language for imported projects.",
      "Defer polish unless the current UI blocks MVP usability.",
    ],
    userFlows: [
      features.length
        ? `User can move through the MVP flow for ${features.join(", ")}.`
        : "User can complete the primary MVP flow.",
    ],
    responsiveNeeds: [
      "Default to responsive web app behavior.",
      "Support desktop and mobile browser widths before native mobile work.",
    ],
    interactionStates: createInteractionStates(features),
    validationNeeds: createValidationNeeds(),
    developerNotes: [
      "This is Blueprint intent only; it does not write files.",
      "Keep front-end generation separate from backend/API/data implementation.",
      "Future generator output should become phase tasks before PatchEngine creates file changes.",
    ],
  };
}

function defaultAsAnswer(item: IntakeDefault, existing?: IntakeAnswer): IntakeAnswer {
  if (existing?.source === "default") {
    return existing;
  }

  return {
    key: item.key,
    label: item.label,
    value: item.value,
    source: "default",
    confidence: "medium",
  };
}

function confirmedAnswersWithDefaults(intake: DiscoveryIntake): IntakeAnswer[] {
  const answersByKey = new Map<string, IntakeAnswer>();

  for (const answer of [...intake.inferredAnswers, ...intake.userConfirmedAnswers]) {
    answersByKey.set(answer.key, answer);
  }

  for (const item of intake.recommendedDefaults) {
    const existing = answersByKey.get(item.key);
    if (existing && existing.source !== "default") {
      continue;
    }
    answersByKey.set(item.key, defaultAsAnswer(item, existing));
  }

  return Array.from(answersByKey.values());
}

function intakeAnswerDecision(answer: IntakeAnswer): BlueprintDecision {
  return {
    id: `intake-answer-${answer.key}`,
    key: answer.key,
    label: answer.label,
    value: answer.value,
    source: answer.source,
    confidence: answer.confidence,
    text: `${answer.label}: ${answer.value}`,
    status: "approved",
    reason:
      answer.source === "user"
        ? "Provided by the user during Discovery Intake."
        : answer.source === "inferred"
          ? "Inferred by NF during Discovery Intake."
          : "Defaulted by NF because the user skipped this non-blocking decision.",
  };
}

function laterConfirmationDecision(text: string, index: number): BlueprintDecision {
  return {
    id: `decision-${index + 1}`,
    text,
    status: "pending",
  };
}

export function createProjectBlueprintFromDiscoveryIntake(
  intake: DiscoveryIntake,
  options: ProjectBlueprintOptions = {}
): ProjectBlueprint {
  const now = options.now ?? new Date().toISOString();
  const productType = findAnswer(intake, "productType")?.value ?? "software product";
  const fallbackSlug = slugify(options.name ?? productType) || "project";
  const id = options.id ?? `blueprint-${fallbackSlug}`;
  const projectId = options.projectId ?? fallbackSlug;
  const identity: ProjectIdentity = {
    projectId,
    source: options.source ?? "newProject",
    name: options.name,
    slug: options.slug ?? fallbackSlug,
    path: options.path,
  };
  const confidence = intake.confidenceLevel;
  const projectClassification = classifyProjectRequest(intake);
  const specializedPlannerOutput = createSpecializedPlannerOutput(intake, projectClassification);
  const productBrief = specializedPlannerOutput?.productBrief ?? createProductBrief(intake, projectClassification);

  return {
    schemaVersion: 1,
    id,
    createdAt: now,
    updatedAt: now,
    identity,
    discoveryIntake: draftSection(intake, now),
    projectClassification: draftSection(projectClassification, now),
    specializedPlannerOutput: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput, now)
      : emptySection(null),
    productBrief: draftSection(productBrief, now),
    vision: emptySection(""),
    goals: specializedPlannerOutput
      ? draftSection([specializedPlannerOutput.mvpDefinition, ...specializedPlannerOutput.successCriteria], now)
      : emptySection([]),
    users: specializedPlannerOutput
      ? draftSection(productBrief.targetUsers, now)
      : emptySection([]),
    features: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.features, now)
      : emptySection([]),
    screens: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.screens, now)
      : emptySection([]),
    frontEndGenerationIntent: draftSection(createFrontEndGenerationIntent(intake, productBrief), now),
    dataModels: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.dataModels, now)
      : emptySection([]),
    apis: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.apis, now)
      : emptySection([]),
    integrations: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.integrations, now)
      : emptySection([]),
    architecture: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.architectureRecommendation, now)
      : emptySection([]),
    designSystem: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.designSystem, now)
      : emptySection([]),
    currentProductInventory: emptySection(null),
    preservationRules: emptySection(null),
    existingProductAssessment: emptySection(null),
    gapAnalysis: emptySection(null),
    architectureReview: emptySection(null),
    phaseBuildPlan: emptySection(null),
    phaseExecutionState: emptySection(null),
    projectHealth: emptySection(null),
    qualityState: specializedPlannerOutput
      ? draftSection(Object.values(specializedPlannerOutput.qualityGates).flat().map((gate) => gate.title), now)
      : emptySection([]),
    founderDecisions: draftSection(
      intake.decisionsRequiringLaterConfirmation.map(laterConfirmationDecision),
      now
    ),
    developerPreferences: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.developerDetails, now)
      : emptySection([]),
    controlPreferences: draftSection(createDefaultControlPreferences(), now),
    assumptions: draftSection(intake.assumptions, now),
    confidence: draftSection(confidence, now),
    buildHistory: draftSection(
      [
        createBuildHistoryEntry(id, now),
        ...(specializedPlannerOutput
          ? [{
              id: `${id}-specialized-planner`,
              timestamp: now,
              summary: `${specializedPlannerOutput.planner} generated specialized Blueprint planning sections.`,
              source: specializedPlannerOutput.planner,
            }]
          : []),
      ],
      now
    ),
    lessonsLearned: specializedPlannerOutput
      ? draftSection(specializedPlannerOutput.templateSeparationRules ?? [], now)
      : emptySection([]),
  };
}

export function applyDiscoveryIntakeDefaultsToBlueprint(
  blueprint: ProjectBlueprint,
  intake: DiscoveryIntake = blueprint.discoveryIntake.data ?? createDiscoveryIntakeFallback(blueprint),
  now = new Date().toISOString()
): ProjectBlueprint {
  const userConfirmedAnswers = confirmedAnswersWithDefaults(intake);
  const confirmedIntake: DiscoveryIntake = {
    ...intake,
    userConfirmedAnswers,
  };
  const approvedDecisions = userConfirmedAnswers.map(intakeAnswerDecision);
  const pendingDecisionTexts = new Set(intake.decisionsRequiringLaterConfirmation);
  const existingNonIntakeDecisions = blueprint.founderDecisions.data.filter(
    (decision) => !decision.id.startsWith("intake-answer-") && !pendingDecisionTexts.has(decision.text)
  );
  const laterDecisions = intake.decisionsRequiringLaterConfirmation.map(laterConfirmationDecision);

  return {
    ...blueprint,
    updatedAt: now,
    discoveryIntake: draftSection(confirmedIntake, now),
    founderDecisions: draftSection([...approvedDecisions, ...laterDecisions, ...existingNonIntakeDecisions], now),
    assumptions: draftSection(intake.assumptions, now),
    confidence: draftSection(intake.confidenceLevel, now),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-discovery-intake-defaults-${Date.parse(now) || 0}`,
          timestamp: now,
          summary: "Discovery Intake answers and defaults confirmed into Project Blueprint.",
          source: "DiscoveryIntake",
        },
      ],
      now
    ),
  };
}

function createDiscoveryIntakeFallback(blueprint: ProjectBlueprint): DiscoveryIntake {
  return {
    userRequest: blueprint.productBrief.data?.summary ?? "",
    understoodSummary: blueprint.productBrief.data?.summary ?? "",
    inferredAnswers: [],
    unansweredQuestions: [],
    recommendedDefaults: [],
    userConfirmedAnswers: [],
    assumptions: blueprint.assumptions.data,
    confidenceLevel: blueprint.confidence.data,
    decisionsRequiringLaterConfirmation: blueprint.founderDecisions.data
      .filter((decision) => decision.status === "pending")
      .map((decision) => decision.text),
    canContinue: true,
  };
}

export function attachControlPreferences(
  blueprint: ProjectBlueprint,
  controlPreferences: ControlPreferences,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    controlPreferences: draftSection(controlPreferences, now),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-control-preferences`,
          timestamp: now,
          summary: "Control preferences attached to Project Blueprint.",
          source: "ControlPreferences",
        },
      ],
      now
    ),
  };
}

export function isValidProjectBlueprint(value: ProjectBlueprint): boolean {
  return (
    value.schemaVersion === 1 &&
    Boolean(value.id) &&
    Boolean(value.identity.projectId) &&
    value.discoveryIntake.status !== "empty" &&
    value.productBrief.status !== "empty" &&
    value.confidence.data !== "low"
  );
}

export function getProjectBlueprintConfidence(blueprint: ProjectBlueprint): IntakeConfidenceLevel {
  return blueprint.confidence.data;
}

export function attachExistingProductAssessment(
  blueprint: ProjectBlueprint,
  assessment: ExistingProductAssessment,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    identity: {
      ...blueprint.identity,
      source: "existingProject",
      path: assessment.projectPath ?? blueprint.identity.path,
    },
    currentProductInventory: draftSection(assessment.inventory, now),
    preservationRules: draftSection(assessment.preservationRules, now),
    existingProductAssessment: draftSection(assessment, now),
    architecture: draftSection(
      Array.from(new Set([...blueprint.architecture.data, ...assessment.architectureNotes])),
      now
    ),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-existing-product-assessment`,
          timestamp: now,
          summary: "Existing product assessment attached to Project Blueprint.",
          source: "ExistingProductAssessment",
        },
      ],
      now
    ),
  };
}

export function attachGapAnalysis(
  blueprint: ProjectBlueprint,
  gapAnalysis: GapAnalysis,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    gapAnalysis: draftSection(gapAnalysis, now),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-gap-analysis`,
          timestamp: now,
          summary: "Gap Analysis attached to Project Blueprint.",
          source: "GapAnalysis",
        },
      ],
      now
    ),
  };
}

export function attachPhaseBuildPlan(
  blueprint: ProjectBlueprint,
  phaseBuildPlan: PhaseBuildPlan,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    phaseBuildPlan: draftSection(phaseBuildPlan, now),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-phase-build-plan`,
          timestamp: now,
          summary: "Phase Build Plan attached to Project Blueprint.",
          source: "PhaseBuildPlan",
        },
      ],
      now
    ),
  };
}

export function attachArchitectureReview(
  blueprint: ProjectBlueprint,
  architectureReview: ArchitectureReviewReport,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    architectureReview: draftSection(architectureReview, now),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-architecture-review`,
          timestamp: now,
          summary: "Architecture Review attached to Project Blueprint.",
          source: "ArchitectureReview",
        },
      ],
      now
    ),
  };
}

export function attachPhaseExecutionState(
  blueprint: ProjectBlueprint,
  phaseExecutionState: PhaseExecutionState,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    phaseExecutionState: draftSection(phaseExecutionState, now),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-phase-execution-state`,
          timestamp: now,
          summary: "Phase Execution State attached to Project Blueprint.",
          source: "PhaseExecutionState",
        },
      ],
      now
    ),
  };
}

export function attachProjectHealthReport(
  blueprint: ProjectBlueprint,
  projectHealth: ProjectHealthReport,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    projectHealth: draftSection(projectHealth, now),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-project-health`,
          timestamp: now,
          summary: "Project Health report attached to Project Blueprint.",
          source: "ProjectHealth",
        },
      ],
      now
    ),
  };
}

export function attachFrontEndGenerationIntent(
  blueprint: ProjectBlueprint,
  frontEndGenerationIntent: FrontEndGenerationIntent,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    frontEndGenerationIntent: draftSection(frontEndGenerationIntent, now),
    buildHistory: draftSection(
      [
        ...blueprint.buildHistory.data,
        {
          id: `${blueprint.id}-front-end-generation-intent`,
          timestamp: now,
          summary: "Front-end generation intent attached to Project Blueprint.",
          source: "FrontEndGenerationIntent",
        },
      ],
      now
    ),
  };
}
