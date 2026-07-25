import { buildDiscoveryUnderstoodSummary } from "../product/discoveryIntake";
import { projectNameRequestMessage } from "./projectIdentity";
import type { ProjectCreationState } from "./projectCreationState";

export type ProjectCreationNarrationStep =
  | "readingIdea"
  | "detectingType"
  | "creatingBlueprint"
  | "checkingArchitecture"
  | "preparingFilePlan"
  | "waitingForApproval"
  | "runningBuildCheck"
  | "repairingFailedTest";

export function describeCreationStep(step: ProjectCreationNarrationStep): string {
  switch (step) {
    case "readingIdea":
      return "Reading your project idea.";
    case "detectingType":
      return "Detecting project type.";
    case "creatingBlueprint":
      return "Creating project blueprint.";
    case "checkingArchitecture":
      return "Checking architecture.";
    case "preparingFilePlan":
      return "Preparing file plan.";
    case "waitingForApproval":
      return "Waiting for approval.";
    case "runningBuildCheck":
      return "Running build check.";
    case "repairingFailedTest":
      return "Repairing failed test.";
  }
}

export interface FounderCreationSummary {
  understood: string;
  buildFirst: string;
  later: string;
  needFromYou: string;
  nextAction: string;
}

export function buildFounderCreationSummary(state: ProjectCreationState): FounderCreationSummary {
  const intake = state.discoveryIntake;
  const mvpFeatures = state.extractedFields.mvpFeatures.value.length
    ? state.extractedFields.mvpFeatures.value.slice(0, 6).join(", ")
    : intake.inferredAnswers.find((answer) => answer.key === "mvpFeatures")?.value ?? "the core workflow";
  const laterItems = state.extractedFields.postMvpFeatures.value.length
    ? state.extractedFields.postMvpFeatures.value.slice(0, 4).join(", ")
    : "advanced integrations, polish, and optional accounts or sync";
  return {
    understood: buildDiscoveryUnderstoodSummary(state.classification, state.extractedFields.targetPlatform.value),
    buildFirst: `${state.classification.primaryClassification}: ${mvpFeatures}.`,
    later: laterItems,
    needFromYou: state.needsProjectName
      ? projectNameRequestMessage()
      : state.conflicts.length
        ? state.conflicts.join(" ")
        : "Review the plan, approve it, then approve the file preview before NF writes anything.",
    nextAction: state.needsProjectName
      ? "Tell NF the project name in chat, for example `Project Name: NF Web Developer`."
      : state.conflicts.length
        ? "Resolve the blocker shown above."
        : intake.canContinue
          ? "Continue with defaults or generate the build plan."
          : "Answer the essential questions or continue with defaults.",
  };
}

export function currentCreationNarration(state: ProjectCreationState, options: {
  hasBlueprint?: boolean;
  hasPlanPreview?: boolean;
  hasFilePreview?: boolean;
}): string {
  if (options.hasFilePreview) return describeCreationStep("waitingForApproval");
  if (options.hasPlanPreview) return describeCreationStep("preparingFilePlan");
  if (options.hasBlueprint) return describeCreationStep("checkingArchitecture");
  if (state.discoveryIntake) return describeCreationStep("creatingBlueprint");
  return describeCreationStep("detectingType");
}
