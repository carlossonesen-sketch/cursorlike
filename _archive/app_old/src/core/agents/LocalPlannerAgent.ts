/**
 * LocalPlannerAgent: uses runtime_generate to produce plan + target files.
 */

import type { ModelContext } from "../types";
import type { PlannerOutput } from "../types";
import type { IPlannerAgent } from "./PlannerAgent";
import {
  ensureLocalRuntime,
  runtimeGenerate,
  type LocalModelSettings,
  type GenerateOptions,
} from "../runtime/runtimeApi";

function buildPlannerPrompt(prompt: string, context: ModelContext): string {
  const parts: string[] = [];
  parts.push("You are a planning assistant for code changes. Given the user request and context, output a short plan and the list of target file paths to modify.");
  parts.push("");
  parts.push("User request: " + prompt);
  if (context.selectedFiles.length) {
    parts.push("");
    parts.push("Selected files: " + context.selectedFiles.map((f) => f.path).join(", "));
  }
  if (context.manifestSummary) {
    parts.push("");
    parts.push("Project context: " + context.manifestSummary.slice(0, 600));
  }
  if (context.knowledgeChunks?.length) {
    parts.push("");
    parts.push("Relevant knowledge:");
    for (const k of context.knowledgeChunks) {
      parts.push("[" + k.title + "] " + k.chunkText.slice(0, 400));
    }
  }
  parts.push("");
  parts.push("Output format (use exactly these labels):");
  parts.push("PLAN:");
  parts.push("<your plan in 2-5 sentences>");
  parts.push("TARGET_FILES:");
  parts.push("<one file path per line, relative to repo root>");
  return parts.join("\n");
}

function parsePlannerOutput(raw: string, context: ModelContext): PlannerOutput {
  const planMatch = raw.match(/PLAN:\s*([\s\S]*?)(?=TARGET_FILES:|$)/i);
  const plan = planMatch ? planMatch[1].trim().slice(0, 2000) : raw.trim().slice(0, 2000) || "No plan produced.";
  const filesMatch = raw.match(/TARGET_FILES:\s*([\s\S]*?)$/i);
  let targetFiles: string[] = [];
  if (filesMatch) {
    targetFiles = filesMatch[1]
      .split(/\r?\n/)
      .map((s) => s.trim().replace(/^[-*]\s*/, ""))
      .filter((s) => s.length > 0 && !s.startsWith("#"));
  }
  if (targetFiles.length === 0 && context.selectedFiles.length) {
    targetFiles = context.selectedFiles.map((f) => f.path);
  }
  if (targetFiles.length === 0) {
    targetFiles = ["README.md"];
  }
  return { plan, targetFiles };
}

export class LocalPlannerAgent implements IPlannerAgent {
  constructor(
    private getSettings: () => LocalModelSettings,
    private getToolRoot: () => string | null,
    private getPort: () => number | undefined = () => undefined,
    private getGenerateOptions: () => GenerateOptions = () => ({})
  ) {}

  async run(prompt: string, context: ModelContext): Promise<PlannerOutput> {
    const settings = this.getSettings();
    await ensureLocalRuntime(settings, this.getToolRoot(), this.getPort());
    const fullPrompt = buildPlannerPrompt(prompt, context);
    const opts = this.getGenerateOptions();
    const raw = await runtimeGenerate(fullPrompt, false, {
      temperature: opts.temperature ?? settings.temperature,
      top_p: opts.top_p ?? settings.top_p,
      max_tokens: opts.max_tokens ?? settings.max_tokens,
    });
    return parsePlannerOutput(raw, context);
  }
}
