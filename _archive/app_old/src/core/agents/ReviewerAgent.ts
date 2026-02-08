/**
 * ReviewerAgent: review notes + recommended checks. NO patch.
 * Mock implementation; pluggable for Ollama/llama.cpp later.
 */

import type { ModelContext } from "../types";
import type { ReviewerOutput } from "../types";

export interface IReviewerAgent {
  run(patch: string, explanation: string, context: ModelContext): Promise<ReviewerOutput>;
}

/** Deterministic mock. */
export class MockReviewerAgent implements IReviewerAgent {
  async run(
    patch: string,
    explanation: string,
    context: ModelContext
  ): Promise<ReviewerOutput> {
    const paths = context.selectedFiles.map((f) => f.path).join(", ");
    const hunkCount = (patch.match(/^@@ /gm) ?? []).length;
    const reviewNotes = `[MOCK Reviewer] Patch has ${hunkCount} hunk(s), touches ${context.selectedFiles.length} file(s): ${paths}. Summary: "${explanation.slice(0, 60)}…". Manual review recommended; no issues detected in mock.`;
    const recommendedChecks = ["lint", "build", "test"];
    return { reviewNotes, recommendedChecks };
  }
}
