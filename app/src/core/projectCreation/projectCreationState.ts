import type { DiscoveryIntake, NewProjectDraft, ProjectClassificationResult, RequiredPlanner } from "../types";
import { createDiscoveryIntakeFromProjectState } from "../product/discoveryIntake";
import { classifyProjectRequest } from "../product/projectClassification";
import {
  applyCommercialInferenceToIntake,
  createDefaultProjectPath,
  createPlannerLock,
  evaluateProjectWorkspaceTarget,
  inferCommercialProductSettings,
  validatePlannerLock,
  type AccountsTiming,
  type LaunchType,
  type PlannerLockValidation,
  type UserScope,
  type WorkspaceConflictStatus,
} from "./projectCreationWizard";
import {
  buildClassificationPrompt,
  inferProjectNameFromSavePath,
  isUnresolvedProjectName,
  projectNameRequestMessage,
  UNRESOLVED_PROJECT_NAME,
} from "./projectIdentity";
import {
  extractStructuredProjectFields,
  type IntentDepth,
  type StructuredProjectFields,
} from "./structuredFieldExtraction";

const DEFAULT_PROJECTS_FOLDER = "D:\\dev\\nf-projects";

export interface ProjectCreationState {
  projectId: string;
  projectName: string;
  slug: string;
  savePath: string;
  fullFounderPrompt: string;
  boundedDisplaySummary: string;
  extractedFields: StructuredProjectFields;
  inferredDefaults: string[];
  conflicts: string[];
  classification: ProjectClassificationResult;
  lockedPlanner: RequiredPlanner;
  launchType: LaunchType;
  accountUserModel: UserScope;
  accountsTiming: AccountsTiming;
  workspaceSafetyStatus: WorkspaceConflictStatus;
  approvalState: "draft" | "needsApproval" | "approved" | "blocked";
  plannerLockDiagnostics: PlannerLockValidation;
  needsProjectName: boolean;
  discoveryIntake: DiscoveryIntake;
  intentDepth: IntentDepth;
  createdFrom: "menu" | "prompt";
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled-project";
}

function summary(fields: StructuredProjectFields, prompt: string): string {
  const features = fields.mvpFeatures.value.length
    ? fields.mvpFeatures.value.slice(0, 6).join(", ")
    : "the first MVP workflow";
  return [
    `${fields.projectName.value}: ${fields.projectType?.value ?? "software product"}.`,
    `MVP focus: ${features}${fields.mvpFeatures.value.length > 6 ? ", and more" : ""}.`,
    `Intent depth: ${fields.intentDepth}.`,
    `Accounts: ${fields.accountsModel.value}.`,
    fields.hostingTarget.value === "AWS" ? "Hosting target: AWS." : "Hosting target needs confirmation.",
    prompt.length > 1200 ? "Full founder prompt is preserved; UI should show this bounded summary." : "",
  ].filter(Boolean).join(" ");
}

export function createMenuProjectCreationState(
  defaultProjectsFolder?: string
): ProjectCreationState {
  return createProjectCreationState({
    founderPrompt: "",
    source: "menu",
    defaultProjectsFolder,
  });
}

export function updateProjectCreationStateFromPrompt(
  existing: ProjectCreationState | null,
  prompt: string,
  options: {
    defaultProjectsFolder?: string;
    engineRepoPath?: string;
    existingEntries?: string[];
  } = {}
): ProjectCreationState {
  const base = existing ?? createProjectCreationState({ founderPrompt: "", source: "prompt", ...options });
  const placeholderIdea = "Tell NF the project idea, target user, and MVP goal.";
  const existingIdea = base.fullFounderPrompt === placeholderIdea ? "" : base.fullFounderPrompt.trim();
  const nextPrompt = [existingIdea, prompt.trim()].filter(Boolean).join("\n\n");
  return createProjectCreationState({
    founderPrompt: nextPrompt || base.fullFounderPrompt,
    existingState: base,
    existingDraft: projectCreationStateToDraft(base, base.createdFrom),
    source: "prompt",
    defaultProjectsFolder: options.defaultProjectsFolder,
    engineRepoPath: options.engineRepoPath,
    existingEntries: options.existingEntries,
  });
}

function resolveProjectName(
  fields: StructuredProjectFields,
  options: {
    existingName?: string;
    explicitSavePath?: string;
  }
): string {
  if (!isUnresolvedProjectName(fields.projectName.value)) {
    return fields.projectName.value.trim();
  }
  if (!isUnresolvedProjectName(options.existingName)) {
    return options.existingName!.trim();
  }
  const fromPath = inferProjectNameFromSavePath(options.explicitSavePath ?? fields.savePath?.value);
  if (fromPath) return fromPath;
  return UNRESOLVED_PROJECT_NAME;
}

export function createProjectCreationState(input: {
  founderPrompt: string;
  existingDraft?: NewProjectDraft | null;
  existingState?: ProjectCreationState | null;
  source?: "menu" | "prompt";
  defaultProjectsFolder?: string;
  engineRepoPath?: string;
  existingEntries?: string[];
}): ProjectCreationState {
  const prompt = input.source === "menu" && !input.founderPrompt.trim()
    ? "Tell NF the project idea, target user, and MVP goal."
    : input.founderPrompt.trim();
  const fields = extractStructuredProjectFields(prompt);
  const existingName = input.existingState?.projectName?.trim() ?? input.existingDraft?.projectName?.trim();
  const explicitSavePath = fields.savePath?.value;
  const projectName = resolveProjectName(fields, { existingName, explicitSavePath });
  const needsProjectName = isUnresolvedProjectName(projectName);
  const slug = slugify(projectName);
  const generatedPath = createDefaultProjectPath(projectName, input.defaultProjectsFolder ?? DEFAULT_PROJECTS_FOLDER);
  const existingPath = input.existingState?.savePath ?? input.existingDraft?.defaultPath;
  const existingPathWasGenerated = existingName
    ? existingPath === createDefaultProjectPath(existingName, input.defaultProjectsFolder ?? DEFAULT_PROJECTS_FOLDER)
    : true;
  const savePath = explicitSavePath ?? (existingPath && !existingPathWasGenerated ? existingPath : generatedPath);
  const classificationPrompt = buildClassificationPrompt(projectName, prompt);
  const classification = classifyProjectRequest(classificationPrompt);
  const commercial = inferCommercialProductSettings(classificationPrompt);
  const discoveryIntake = applyCommercialInferenceToIntake(
    createDiscoveryIntakeFromProjectState({
      projectName,
      fullFounderPrompt: prompt,
      classification,
      extractedFields: fields,
    }),
    commercial
  );
  const lock = createPlannerLock(classification);
  const workspace = evaluateProjectWorkspaceTarget({
    projectName,
    targetPath: savePath,
    defaultProjectsFolder: input.defaultProjectsFolder,
    engineRepoPath: input.engineRepoPath,
    existingEntries: input.existingEntries,
  });
  const plannerLockDiagnostics = validatePlannerLock({
    lock,
    downstreamPlanner: classification.requiredPlanner,
    downstreamText: classificationPrompt,
  });
  const identityBlockers = needsProjectName ? [projectNameRequestMessage()] : [];
  const conflicts = [
    ...identityBlockers,
    ...(workspace.canCreateFiles ? [] : [workspace.reason]),
    ...plannerLockDiagnostics.blockers.filter(
      (blocker) => !needsProjectName || !/generic placeholders/i.test(blocker)
    ),
  ];

  return {
    projectId: slug,
    projectName,
    slug,
    savePath,
    fullFounderPrompt: prompt,
    boundedDisplaySummary: summary(fields, prompt),
    extractedFields: fields,
    inferredDefaults: [
      fields.targetPlatform.source === "defaulted" ? "target platform defaults to web app" : "",
      fields.accountsModel.source === "defaulted" ? "accounts default to single-user/internal first" : "",
    ].filter(Boolean),
    conflicts,
    classification,
    lockedPlanner: classification.requiredPlanner,
    launchType: commercial.launchType,
    accountUserModel: commercial.users,
    accountsTiming: commercial.accountsTiming,
    workspaceSafetyStatus: workspace.conflictStatus,
    approvalState: conflicts.length ? "blocked" : "draft",
    plannerLockDiagnostics,
    needsProjectName,
    discoveryIntake,
    intentDepth: fields.intentDepth,
    createdFrom: input.source ?? "prompt",
  };
}

export function projectCreationStateToDraft(state: ProjectCreationState, createdFrom: NewProjectDraft["createdFrom"] = "prompt"): NewProjectDraft {
  return {
    projectName: state.projectName,
    ideaText: state.fullFounderPrompt,
    slug: state.slug,
    defaultPath: state.savePath,
    createdFrom,
  };
}
