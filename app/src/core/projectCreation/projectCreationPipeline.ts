import { createArchitectureReviewReport } from "../architecture/architectureReview";
import { createGapAnalysis } from "../product/gapAnalysis";
import {
  applyDiscoveryIntakeDefaultsToBlueprint,
  attachArchitectureReview,
  attachGapAnalysis,
  attachPhaseBuildPlan,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { saveProjectBlueprint } from "../product/projectBlueprintStore";
import { createPhaseBuildPlan } from "../phase/phaseBuildPlan";
import type {
  ArchitectureReviewReport,
  NewProjectFilePreview,
  NewProjectPlanPreview,
  PhaseBuildPlan,
  ProjectBlueprint,
} from "../types";
import { generateProjectCreationPlanPreview } from "./projectCreationWizard";
import { assertProjectIdentityReady } from "./projectIdentity";
import type { ProjectCreationState } from "./projectCreationState";
import { projectCreationStateToDraft } from "./projectCreationState";
import { generateStarterFilePreview } from "./starterFileGenerator";

export interface ProjectCreationPipelineResult {
  state: ProjectCreationState;
  blueprint: ProjectBlueprint;
  planPreview: NewProjectPlanPreview;
  architectureReview: ArchitectureReviewReport;
  phaseBuildPlan: PhaseBuildPlan;
}

export function runProjectCreationPlanningPipeline(
  state: ProjectCreationState,
  options: { applyDiscoveryDefaults?: boolean; now?: string; persistBlueprint?: boolean } = {}
): ProjectCreationPipelineResult {
  assertProjectIdentityReady(state.projectName);

  const now = options.now ?? new Date().toISOString();
  const intake = state.discoveryIntake;
  let blueprint = createProjectBlueprintFromDiscoveryIntake(intake, {
    name: state.projectName,
    slug: state.slug,
    path: state.savePath,
    now,
  });

  if (options.applyDiscoveryDefaults) {
    blueprint = applyDiscoveryIntakeDefaultsToBlueprint(blueprint, intake, now);
  }

  const gap = createGapAnalysis(blueprint, now);
  blueprint = attachGapAnalysis(blueprint, gap, now);

  const architectureReview = createArchitectureReviewReport(blueprint, now);
  blueprint = attachArchitectureReview(blueprint, architectureReview, now);

  const phaseBuildPlan = createPhaseBuildPlan(blueprint, gap, now);
  blueprint = attachPhaseBuildPlan(blueprint, phaseBuildPlan, now);

  const draft = projectCreationStateToDraft(state);
  const planPreview = generateProjectCreationPlanPreview(draft, intake);

  if (options.persistBlueprint !== false) {
    saveProjectBlueprint(blueprint);
  }

  return {
    state,
    blueprint,
    planPreview,
    architectureReview,
    phaseBuildPlan,
  };
}

export function generateProjectCreationFilePreview(
  state: ProjectCreationState,
  planPreview: NewProjectPlanPreview,
  blueprint?: ProjectBlueprint | null
): NewProjectFilePreview {
  return generateStarterFilePreview(state, { ...planPreview, status: "approved" }, blueprint);
}
