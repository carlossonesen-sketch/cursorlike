import type { NewProjectFilePreview, NewProjectPlanPreview, NewProjectStarterFile, ProjectBlueprint } from "../types";
import { createPlannerLock, validatePlannerLock } from "./projectCreationWizard";
import type { ProjectCreationState } from "./projectCreationState";

function foundationDocument(
  state: ProjectCreationState,
  plan: NewProjectPlanPreview,
  blueprint: ProjectBlueprint | null | undefined
): string {
  const phases = blueprint?.phaseBuildPlan.data?.phases.map((phase) => `- ${phase.title}: ${phase.goal}`) ?? [];
  const architectureStatus = blueprint?.architectureReview.data?.status ?? "pending";
  return [
    `# ${state.lockedPlanner} Foundation Plan`,
    ``,
    `Project: ${state.projectName}`,
    `Save path: ${state.savePath}`,
    `Classification: ${state.classification.primaryClassification}`,
    ``,
    `## MVP Definition`,
    plan.mvpDefinition,
    ``,
    `## Architecture Review`,
    `Status: ${architectureStatus}`,
    blueprint?.architectureReview.data?.recommendedImprovements.join("; ") ?? plan.nextRecommendedStep,
    ``,
    `## Phase Build Plan`,
    ...(phases.length ? phases : ["- Phase plan attached in Project Blueprint"]),
    ``,
    `## Implementation Note`,
    `This foundation plan describes the specialized ${state.classification.primaryClassification} structure. NF will implement modules through the phase execution engine after founder approval.`,
  ].join("\n");
}

export function generateSpecializedFoundationFilePlan(
  state: ProjectCreationState,
  plan: NewProjectPlanPreview,
  blueprint?: ProjectBlueprint | null
): NewProjectFilePreview {
  const lock = createPlannerLock(state.classification);
  const foundationPath = `docs/foundation/${state.lockedPlanner.toUpperCase()}_FOUNDATION.md`;
  const files: NewProjectStarterFile[] = [
    {
      path: "README.md",
      reason: "Founder-facing project overview and specialized MVP scope",
      content: [
        `# ${state.projectName}`,
        ``,
        state.boundedDisplaySummary,
        ``,
        `## MVP`,
        plan.mvpDefinition,
        ``,
        `## Stack`,
        plan.inferredStack.join(", "),
        ``,
        `## Next Step`,
        plan.nextRecommendedStep,
      ].join("\n"),
    },
    {
      path: foundationPath,
      reason: `Specialized ${state.lockedPlanner} foundation plan (not a generic Vite scaffold)`,
      content: foundationDocument(state, plan, blueprint),
    },
  ];

  const validation = validatePlannerLock({
    lock,
    downstreamPlanner: state.lockedPlanner,
    downstreamText: [
      state.projectName,
      state.fullFounderPrompt,
      plan.mvpDefinition,
      ...files.map((file) => file.content),
    ].join("\n"),
  });
  if (!validation.ok) {
    throw new Error(validation.blockers.join("\n"));
  }

  const folders = [...new Set(files.map((file) => file.path.split("/").slice(0, -1).join("/")).filter(Boolean))];
  return {
    targetPath: state.savePath,
    foldersToCreate: folders,
    filesToCreate: files,
    keyStarterFiles: files,
  };
}
