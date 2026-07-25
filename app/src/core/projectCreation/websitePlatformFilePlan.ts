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
    `# Website Platform Foundation Plan`,
    ``,
    `Project: ${state.projectName}`,
    `Save path: ${state.savePath}`,
    `Planner: websitePlatformPlanner`,
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
    `## Deferred From MVP`,
    ...(state.extractedFields.postMvpFeatures.value.length
      ? state.extractedFields.postMvpFeatures.value.map((feature) => `- ${feature}`)
      : ["- AI generation features", "- Advanced drag-and-drop editor"]),
    ``,
    `## Implementation Note`,
    `This foundation plan describes the Website Platform structure. NF will implement platform modules through the phase execution engine after founder approval.`,
  ].join("\n");
}

export function generateWebsitePlatformFilePlan(
  state: ProjectCreationState,
  plan: NewProjectPlanPreview,
  blueprint?: ProjectBlueprint | null
): NewProjectFilePreview {
  const lock = createPlannerLock(state.classification);
  const files: NewProjectStarterFile[] = [
    {
      path: "README.md",
      reason: "Founder-facing project overview and Website Platform MVP scope",
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
      path: "docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md",
      reason: "Specialized Website Platform foundation plan (not a generic Vite scaffold)",
      content: foundationDocument(state, plan, blueprint),
    },
  ];

  const validation = validatePlannerLock({
    lock,
    downstreamPlanner: "websitePlatformPlanner",
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
