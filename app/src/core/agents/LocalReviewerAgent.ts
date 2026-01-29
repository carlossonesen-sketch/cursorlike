/**
 * LocalReviewerAgent: uses runtime_generate to produce review notes + recommended checks.
 */

import type { ModelContext } from "../types";
import type { ReviewerOutput } from "../types";
import type { IReviewerAgent } from "./ReviewerAgent";
import {
  ensureLocalRuntime,
  runtimeGenerate,
  type LocalModelSettings,
  type GenerateOptions,
} from "../runtime/runtimeApi";

function buildReviewerPrompt(patch: string, explanation: string, context: ModelContext): string {
  const parts: string[] = [];
  parts.push("You are a code review assistant. Review the following patch and explanation, then output brief review notes and a short list of recommended checks (e.g. lint, build, test).");
  parts.push("");
  parts.push("Explanation: " + explanation.slice(0, 500));
  parts.push("");
  parts.push("Patch (unified diff):");
  parts.push(patch.slice(0, 3000));
  if (context.selectedFiles.length) {
    parts.push("");
    parts.push("Context files: " + context.selectedFiles.map((f) => f.path).join(", "));
  }
  parts.push("");
  parts.push("Output format (use exactly these labels):");
  parts.push("REVIEW_NOTES:");
  parts.push("<2-4 sentences>");
  parts.push("RECOMMENDED_CHECKS:");
  parts.push("<comma-separated list, e.g. lint, build, test>");
  return parts.join("\n");
}

function parseReviewerOutput(raw: string): ReviewerOutput {
  const notesMatch = raw.match(/REVIEW_NOTES:\s*([\s\S]*?)(?=RECOMMENDED_CHECKS:|$)/i);
  const reviewNotes = notesMatch ? notesMatch[1].trim().slice(0, 1000) : raw.trim().slice(0, 1000) || "No review notes.";
  const checksMatch = raw.match(/RECOMMENDED_CHECKS:\s*([\s\S]*?)$/i);
  let recommendedChecks: string[] = [];
  if (checksMatch) {
    recommendedChecks = checksMatch[1]
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (recommendedChecks.length === 0) {
    recommendedChecks = ["lint", "build", "test"];
  }
  return { reviewNotes, recommendedChecks };
}

export class LocalReviewerAgent implements IReviewerAgent {
  constructor(
    private getSettings: () => LocalModelSettings,
    private getToolRoot: () => string | null,
    private getPort: () => number | undefined = () => undefined,
    private getGenerateOptions: () => GenerateOptions = () => ({})
  ) {}

  async run(
    patch: string,
    explanation: string,
    context: ModelContext
  ): Promise<ReviewerOutput> {
    const settings = this.getSettings();
    await ensureLocalRuntime(settings, this.getToolRoot(), this.getPort());
    const fullPrompt = buildReviewerPrompt(patch, explanation, context);
    const opts = this.getGenerateOptions();
    const raw = await runtimeGenerate(fullPrompt, false, {
      temperature: opts.temperature ?? settings.temperature,
      top_p: opts.top_p ?? settings.top_p,
      max_tokens: opts.max_tokens ?? settings.max_tokens,
    });
    return parseReviewerOutput(raw);
  }
}
