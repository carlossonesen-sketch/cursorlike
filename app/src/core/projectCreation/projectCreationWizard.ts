import type {
  BuildMilestone,
  DiscoveryIntake,
  IntakeAnswer,
  NewProjectDraft,
  NewProjectPlanPreview,
  ProjectBlueprint,
  ProjectClassificationResult,
  RequiredPlanner,
  SpecializedPlannerOutput,
} from "../types";
import { classifyProjectRequest } from "../product/projectClassification";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { extractFullProjectSpec } from "../product/fullSpecExtraction";
import { createWebsitePlatformPlannerOutput, isWebsitePlatformClassification } from "../product/planners/websitePlatformPlanner";
import { createFoundationPlannerOutput, requiresSpecializedPlanner } from "../product/planners/foundationPlanner";
import { generateLocalBuildPlan } from "./buildPlanGenerator";
import { createProjectCreationState, type ProjectCreationState } from "./projectCreationState";
import { generateStarterFilePreview } from "./starterFileGenerator";

export const DEFAULT_PROJECTS_FOLDER = "D:\\dev\\nf-projects";

export type WorkspaceConflictStatus =
  | "ready"
  | "blockedExistingFiles"
  | "blockedEngineRepo"
  | "invalid";

export type LaunchType = "internal" | "productLaunch" | "commercialSaas";
export type UserScope = "single" | "team" | "multiUser" | "multiTenant";
export type HostingTarget = "local" | "aws" | "other";
export type AccountsTiming = "now" | "later";

export interface WorkspaceTargetEvaluation {
  projectName: string;
  slug: string;
  targetPath: string;
  conflictStatus: WorkspaceConflictStatus;
  canCreateFiles: boolean;
  reason: string;
  founderOptions: string[];
  existingEntries: string[];
}

export interface CommercialProductInference {
  launchType: LaunchType;
  users: UserScope;
  hostingTarget: HostingTarget;
  accountsTiming: AccountsTiming;
  inferredFeatures: string[];
  foundationDecisions: string[];
  postMvpPlaceholders: string[];
  reasoning: string[];
}

export interface PlannerLock {
  lockedPlanner: RequiredPlanner;
  classification: ProjectClassificationResult["primaryClassification"];
  founderApprovedFallback: boolean;
}

export interface PlannerLockValidation {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface ProjectCreationWizardState {
  projectName: string;
  safeSavePath: string;
  projectType: ProjectClassificationResult["primaryClassification"];
  classification: ProjectClassificationResult;
  plannerLock: PlannerLock;
  launchType: LaunchType;
  users: UserScope;
  hostingTarget: HostingTarget;
  accountsTiming: AccountsTiming;
  workspace: WorkspaceTargetEvaluation;
  commercialInference: CommercialProductInference;
}

const GENERIC_PLACEHOLDERS = [
  "Untitled Project",
  "primary workflow",
  "simple dashboard",
  "basic settings",
  "smallest working version",
  "generic Vite scaffold",
];

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function isSameOrInsidePath(path: string, parent: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedParent = normalizePath(parent);
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

export function slugifyProjectName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled-project";
}

export function createDefaultProjectPath(projectName: string, projectsFolder = DEFAULT_PROJECTS_FOLDER): string {
  return `${projectsFolder.replace(/[\\/]+$/g, "")}\\${slugifyProjectName(projectName)}`;
}

export function evaluateProjectWorkspaceTarget(input: {
  projectName: string;
  targetPath?: string;
  defaultProjectsFolder?: string;
  engineRepoPath?: string;
  existingEntries?: string[];
}): WorkspaceTargetEvaluation {
  const projectName = input.projectName.trim() || "Untitled Project";
  const slug = slugifyProjectName(projectName);
  const targetPath = input.targetPath?.trim() || createDefaultProjectPath(projectName, input.defaultProjectsFolder);
  const existingEntries = [...new Set(input.existingEntries ?? [])].filter(Boolean);
  const founderOptions = [
    "choose a new path",
    "archive the existing project",
    "import the existing project",
  ];

  if (!/^[a-zA-Z]:[\\/]/.test(targetPath) || targetPath.split(/[\\/]+/).includes("..")) {
    return {
      projectName,
      slug,
      targetPath,
      conflictStatus: "invalid",
      canCreateFiles: false,
      reason: "Project creation requires a safe absolute Windows path with no path traversal.",
      founderOptions,
      existingEntries,
    };
  }

  if (input.engineRepoPath && isSameOrInsidePath(targetPath, input.engineRepoPath)) {
    return {
      projectName,
      slug,
      targetPath,
      conflictStatus: "blockedEngineRepo",
      canCreateFiles: false,
      reason: "NF will not scaffold a new product inside the NF engine repository.",
      founderOptions,
      existingEntries,
    };
  }

  if (existingEntries.length > 0) {
    return {
      projectName,
      slug,
      targetPath,
      conflictStatus: "blockedExistingFiles",
      canCreateFiles: false,
      reason: "The target project folder already contains files. NF will not overwrite package.json or existing project files.",
      founderOptions,
      existingEntries,
    };
  }

  return {
    projectName,
    slug,
    targetPath,
    conflictStatus: "ready",
    canCreateFiles: true,
    reason: "The target path is safe for a new project.",
    founderOptions: [],
    existingEntries,
  };
}

export function inferCommercialProductSettings(text: string): CommercialProductInference {
  const normalized = text.toLowerCase();
  const commercialSignals = /\b(product launch|platform|multiple users|accounts now|customers|clients|charge|subscriptions?|saas)\b/i.test(text);
  const multiTenant = /\b(multi-tenant|tenants|tenant boundaries|tenant\/account boundaries|account boundaries|organizations|workspaces)\b/i.test(text);
  const team = /\b(team|staff|employees|collaborators)\b/i.test(text);
  const aws = /\baws|amazon web services\b/i.test(text);
  const otherHosting = /\b(vercel|netlify|cloudflare|azure|gcp|hosting|deploy|deployment)\b/i.test(text) && !aws;
  const paid = /\b(charge|subscriptions?|billing|paid|payments?)\b/i.test(text);

  const launchType: LaunchType = /\b(saas|subscriptions?|charge|customers|clients)\b/.test(normalized)
    ? "commercialSaas"
    : commercialSignals
      ? "productLaunch"
      : "internal";
  const users: UserScope = multiTenant ? "multiTenant" : commercialSignals ? "multiUser" : team ? "team" : "single";
  const hostingTarget: HostingTarget = aws ? "aws" : otherHosting ? "other" : "local";
  const accountsTiming: AccountsTiming = commercialSignals ? "now" : "later";

  return {
    launchType,
    users,
    hostingTarget,
    accountsTiming,
    inferredFeatures: commercialSignals
      ? ["multi-user accounts", "roles/permissions", "tenant/account boundaries"]
      : [],
    foundationDecisions: commercialSignals
      ? ["Confirm authentication depth during Foundation before implementation."]
      : [],
    postMvpPlaceholders: paid
      ? ["Billing/subscription implementation needs explicit founder approval."]
      : commercialSignals
        ? ["Billing hooks remain a post-MVP placeholder unless explicitly requested."]
        : [],
    reasoning: commercialSignals
      ? ["Commercial launch language means accounts are part of the MVP, not a later enhancement."]
      : ["No commercial launch signal detected; accounts can stay later unless requested."],
  };
}

export function createPlannerLock(classification: ProjectClassificationResult): PlannerLock {
  return {
    lockedPlanner: classification.requiredPlanner,
    classification: classification.primaryClassification,
    founderApprovedFallback: false,
  };
}

export function validatePlannerLock(input: {
  lock: PlannerLock;
  downstreamPlanner?: RequiredPlanner;
  downstreamText?: string;
  founderApprovedFallback?: boolean;
}): PlannerLockValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const founderApprovedFallback = input.founderApprovedFallback ?? input.lock.founderApprovedFallback;

  if (input.downstreamPlanner && input.downstreamPlanner !== input.lock.lockedPlanner && !founderApprovedFallback) {
    blockers.push(`Planner lock requires ${input.lock.lockedPlanner}; downstream tried ${input.downstreamPlanner}.`);
  }

  if (input.lock.lockedPlanner === "websitePlatformPlanner") {
    const text = input.downstreamText ?? "";
    const foundGeneric = GENERIC_PLACEHOLDERS.filter((placeholder) =>
      text.toLowerCase().includes(placeholder.toLowerCase())
    );
    if (foundGeneric.length > 0) {
      blockers.push(`Website Platform planning rejected generic placeholders: ${foundGeneric.join(", ")}.`);
    }
    if (input.downstreamPlanner === "generalSoftwarePlanner") {
      blockers.push("Website Platform planning cannot fall back to the generic software planner without explicit founder approval.");
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
  };
}

function accountAnswer(inference: CommercialProductInference): IntakeAnswer | null {
  if (inference.accountsTiming !== "now") return null;
  return {
    key: "accounts",
    label: "Accounts",
    value: "include multi-user accounts in MVP",
    source: "inferred",
    confidence: "high",
  };
}

export function applyCommercialInferenceToIntake(
  intake: DiscoveryIntake,
  inference: CommercialProductInference
): DiscoveryIntake {
  const accounts = accountAnswer(inference);
  if (!accounts) return intake;
  const inferredAnswers = [
    ...intake.inferredAnswers.filter((answer) => answer.key !== "accounts"),
    accounts,
    {
      key: "userScope",
      label: "Users",
      value: inference.users,
      source: "inferred",
      confidence: "high",
    } satisfies IntakeAnswer,
  ];
  return {
    ...intake,
    inferredAnswers,
    recommendedDefaults: intake.recommendedDefaults.map((item) =>
      item.key === "accounts"
        ? {
            ...item,
            value: "include multi-user accounts in MVP",
            reason: "Commercial/product-launch projects need account ownership, roles, and user boundaries in the MVP.",
          }
        : item
    ),
    assumptions: [
      ...intake.assumptions,
      ...inference.reasoning,
      ...inference.inferredFeatures.map((feature) => `Commercial product inference includes ${feature}.`),
    ],
    decisionsRequiringLaterConfirmation: [
      ...intake.decisionsRequiringLaterConfirmation.filter((decision) => !/whether accounts/i.test(decision)),
      ...inference.foundationDecisions,
      ...inference.postMvpPlaceholders,
    ],
  };
}

function plannerMilestonesToBuildMilestones(output: SpecializedPlannerOutput): BuildMilestone[] {
  return output.milestones.map((milestone, index) => {
    const sourceTasks =
      milestone.id === "mvp-website-platform"
        ? output.phaseTasks["mvp-features"] ?? []
        : output.phaseTasks[milestone.id] ?? [];
    const tasks = sourceTasks.length
      ? sourceTasks.map((task, taskIndex) => ({
          id: task.id,
          title: task.title,
          description: task.rationale,
          status: index === 0 && taskIndex === 0 ? "next" as const : "todo" as const,
        }))
      : milestone.items.map((item, taskIndex) => ({
          id: `${milestone.id}-task-${taskIndex + 1}`,
          title: item,
          status: index === 0 && taskIndex === 0 ? "next" as const : "todo" as const,
        }));
    return {
      id: milestone.id,
      name: milestone.title,
      goal: milestone.goal,
      status: index === 0 ? "active" as const : "planned" as const,
      tasks,
    };
  });
}

export function generateProjectCreationPlanPreview(
  draft: NewProjectDraft,
  intake: DiscoveryIntake = createDiscoveryIntake(`${draft.projectName}\n${draft.ideaText}`)
): NewProjectPlanPreview {
  const commercialInference = inferCommercialProductSettings(`${draft.projectName}\n${draft.ideaText}`);
  const effectiveIntake = applyCommercialInferenceToIntake(intake, commercialInference);
  const classification = classifyProjectRequest(effectiveIntake);
  const lock = createPlannerLock(classification);

  if (isWebsitePlatformClassification(classification)) {
    const output = createWebsitePlatformPlannerOutput(effectiveIntake, classification);
    return {
      mvpDefinition: output.mvpDefinition,
      milestones: plannerMilestonesToBuildMilestones(output),
      nextRecommendedStep: "Review Website Platform Blueprint and Architecture Review before any Foundation files are written.",
      suggestedCommands: { dev: "npm run dev", build: "npm run build", test: "npm test" },
      inferredStack: ["TypeScript", "Web App", "Website Platform", "Template Engine"],
      status: "draft",
      fullSpecSummary: output.fullSpecExtraction,
    };
  }

  if (requiresSpecializedPlanner(classification)) {
    const output = createFoundationPlannerOutput(effectiveIntake, classification);
    if (!output) {
      throw new Error(`Specialized planner ${classification.requiredPlanner} is required but no planner output was generated.`);
    }
    const stackByPlanner: Partial<Record<RequiredPlanner, string[]>> = {
      businessWebsitePlanner: ["TypeScript", "Web App", "Business Website"],
      saasPlanner: ["TypeScript", "Web App", "SaaS"],
      mobileAppPlanner: ["TypeScript", "Mobile App"],
      aiAgentPlanner: ["TypeScript", "AI Agent", "Web App"],
      ecommercePlanner: ["TypeScript", "Web App", "Ecommerce"],
      internalToolPlanner: ["TypeScript", "Web App", "Internal Tool"],
    };
    return {
      mvpDefinition: output.mvpDefinition,
      milestones: plannerMilestonesToBuildMilestones(output),
      nextRecommendedStep: `Review the ${classification.primaryClassification} plan and Architecture Review before any Foundation files are written.`,
      suggestedCommands: { dev: "npm run dev", build: "npm run build", test: "npm test" },
      inferredStack: stackByPlanner[classification.requiredPlanner] ?? ["TypeScript", "Web App", classification.primaryClassification],
      status: "draft",
      fullSpecSummary: output.fullSpecExtraction,
    };
  }

  const plan = generateLocalBuildPlan(draft);
  const validation = validatePlannerLock({
    lock,
    downstreamPlanner: "generalSoftwarePlanner",
    downstreamText: [
      plan.mvpDefinition,
      ...plan.milestones.flatMap((milestone) => [milestone.name, milestone.goal, ...milestone.tasks.map((task) => task.title)]),
    ].join("\n"),
  });
  if (!validation.ok) {
    throw new Error(validation.blockers.join("\n"));
  }
  return plan;
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function generateLockedPlanningModeResponse(
  draft: NewProjectDraft,
  prompt: string,
  intake: DiscoveryIntake = createDiscoveryIntake(`${draft.projectName}\n${draft.ideaText}\n${prompt}`)
): string | null {
  const commercialInference = inferCommercialProductSettings(`${draft.projectName}\n${draft.ideaText}\n${prompt}`);
  const effectiveIntake = applyCommercialInferenceToIntake(intake, commercialInference);
  const classification = classifyProjectRequest(effectiveIntake);
  const lock = createPlannerLock(classification);

  if (!isWebsitePlatformClassification(classification)) {
    return null;
  }

  const output = createWebsitePlatformPlannerOutput(effectiveIntake, classification);
  const fullSpec = output.fullSpecExtraction ?? extractFullProjectSpec({
    text: `${draft.projectName}\n${draft.ideaText}\n${prompt}`,
    projectName: draft.projectName,
    savePath: draft.defaultPath,
    classification: classification.primaryClassification,
    requiredPlanner: classification.requiredPlanner,
  });
  const response = [
    "Planning Mode: Website Platform Planner",
    "",
    "Executive Build Summary",
    `${draft.projectName} is a Website Platform / Website Builder project. NF will plan it with websitePlatformPlanner, not the generic software planner.`,
    output.founderSummary,
    fullSpec.uiSummary,
    "No code or files should be written until the founder approves Discovery and Architecture Review.",
    "",
    "MVP Definition",
    output.mvpDefinition,
    "",
    "MVP Scope",
    bulletList(output.productBrief.mvpFeatures),
    "",
    "Full Specification Extraction",
    bulletList([
      `Project name: ${fullSpec.projectName ?? draft.projectName}`,
      `Save path: ${fullSpec.savePath ?? draft.defaultPath}`,
      `Launch type: ${fullSpec.launchType ?? commercialInference.launchType}`,
      `Account/user model: ${fullSpec.accountUserModel ?? commercialInference.users}`,
      `AWS/domain requirements: ${fullSpec.awsDomainRequirements.join(", ") || "none confirmed"}`,
      `AI placeholders: ${fullSpec.aiPlaceholders.join(", ") || "none confirmed"}`,
    ]),
    "",
    "Architecture Recommendation",
    bulletList(output.architectureRecommendation),
    "",
    "Template Separation Rules",
    bulletList(output.templateSeparationRules ?? []),
    "",
    "Milestones",
    bulletList(output.milestones.map((milestone) => `${milestone.title}: ${milestone.goal}${milestone.deferred ? " (deferred)" : ""}`)),
    "",
    "Deferred Until After MVP",
    bulletList(output.deferredFeatures),
    "",
    "Non-goals",
    bulletList(fullSpec.nonGoals.length ? fullSpec.nonGoals : ["Full cloud automation, AI generation, and advanced editing are outside the first MVP unless explicitly approved."]),
    "",
    "Commercial Product Decisions",
    bulletList([
      `Launch type: ${commercialInference.launchType}`,
      `Users: ${commercialInference.users}`,
      `Accounts: ${commercialInference.accountsTiming === "now" ? "include multi-user accounts in MVP" : "later"}`,
      ...commercialInference.inferredFeatures,
      ...commercialInference.foundationDecisions,
      ...commercialInference.postMvpPlaceholders,
    ]),
    "",
    "Quality Gates",
    bulletList(Object.values(output.qualityGates).flat().map((gate) => gate.title)),
    "",
    "Approval Gates",
    bulletList(fullSpec.approvalGates),
    "",
    "Founder Action List",
    "- Approve or revise this Website Platform plan.",
    "- Confirm the safe save path before files are generated.",
    "- Approve Architecture Review before Foundation starts.",
    "- Confirm any external hosting, auth, or billing decisions before implementation depends on them.",
    "",
    "Developer Mode Details",
    bulletList([
      `lockedPlanner=${lock.lockedPlanner}`,
      `classification=${classification.primaryClassification}`,
      `savePath=${draft.defaultPath}`,
      ...output.developerDetails,
    ]),
  ].join("\n");

  const validation = validatePlannerLock({
    lock,
    downstreamPlanner: output.planner,
    downstreamText: response,
  });
  if (!validation.ok) {
    throw new Error(validation.blockers.join("\n"));
  }
  return response;
}

export function validateStarterFileGeneration(input: {
  state?: ProjectCreationState;
  draft?: NewProjectDraft;
  plan: NewProjectPlanPreview;
  plannerLock: PlannerLock;
  blueprint?: ProjectBlueprint | null;
}): PlannerLockValidation {
  const state = input.state ?? createProjectCreationState({
    founderPrompt: input.draft?.ideaText ?? "",
    existingDraft: input.draft ?? null,
    source: input.draft?.createdFrom ?? "prompt",
  });
  try {
    generateStarterFilePreview(state, { ...input.plan, status: "approved" }, input.blueprint ?? null);
    return { ok: true, blockers: [], warnings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      blockers: message.split("\n").filter(Boolean),
      warnings: [],
    };
  }
}

export function createProjectCreationWizardState(input: {
  projectName: string;
  founderText: string;
  targetPath?: string;
  defaultProjectsFolder?: string;
  engineRepoPath?: string;
  existingEntries?: string[];
}): ProjectCreationWizardState {
  const commercialInference = inferCommercialProductSettings(input.founderText);
  const intake = applyCommercialInferenceToIntake(createDiscoveryIntake(input.founderText), commercialInference);
  const classification = classifyProjectRequest(intake);
  const workspace = evaluateProjectWorkspaceTarget({
    projectName: input.projectName,
    targetPath: input.targetPath,
    defaultProjectsFolder: input.defaultProjectsFolder,
    engineRepoPath: input.engineRepoPath,
    existingEntries: input.existingEntries,
  });

  return {
    projectName: workspace.projectName,
    safeSavePath: workspace.targetPath,
    projectType: classification.primaryClassification,
    classification,
    plannerLock: createPlannerLock(classification),
    launchType: commercialInference.launchType,
    users: commercialInference.users,
    hostingTarget: commercialInference.hostingTarget,
    accountsTiming: commercialInference.accountsTiming,
    workspace,
    commercialInference,
  };
}
