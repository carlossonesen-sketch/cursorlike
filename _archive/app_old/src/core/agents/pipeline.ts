/**
 * Multi-agent pipeline: Planner → Coder → Reviewer.
 * No file writes; no background agents; no auto-apply.
 */

import type { ModelContext, PlanAndPatch, PlannerOutput, ReviewerOutput } from "../types";
import type { IPlannerAgent } from "./PlannerAgent";
import type { ICoderAgent } from "./CoderAgent";
import type { IReviewerAgent } from "./ReviewerAgent";
import { MockPlannerAgent } from "./PlannerAgent";
import { CoderAgent } from "./CoderAgent";
import { MockReviewerAgent } from "./ReviewerAgent";

export interface PipelineResult {
  planner: PlannerOutput;
  coder: PlanAndPatch;
  reviewer: ReviewerOutput;
}

export const defaultPlanner = new MockPlannerAgent();
export const defaultCoder = new CoderAgent();
export const defaultReviewer = new MockReviewerAgent();

export interface PipelineOverrides {
  planner?: IPlannerAgent;
  coder?: ICoderAgent;
  reviewer?: IReviewerAgent;
}

/** Run Planner → Coder → Reviewer. Returns all outputs; no file writes. */
export async function runPipeline(
  prompt: string,
  context: ModelContext,
  overrides?: PipelineOverrides
): Promise<PipelineResult> {
  const planner = overrides?.planner ?? defaultPlanner;
  const coder = overrides?.coder ?? defaultCoder;
  const reviewer = overrides?.reviewer ?? defaultReviewer;
  const plannerOut = await planner.run(prompt, context);
  const coderOut = await coder.run(plannerOut.plan, context, plannerOut.targetFiles);
  const reviewerOut = await reviewer.run(coderOut.patch, coderOut.explanation, context);
  return { planner: plannerOut, coder: coderOut, reviewer: reviewerOut };
}
