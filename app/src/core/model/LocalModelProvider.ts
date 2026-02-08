/**
 * LocalModelProvider: uses bundled llama-server runtime (runtime_generate).
 * Produces real PlanAndPatch; throws if Coder output has no valid unified diff.
 */

import type { ModelContext, PlanAndPatch } from "../types";
import type { IModelProvider } from "./ModelGateway";
import {
  ensureLocalRuntime,
  runtimeGenerate,
  runtimeChat,
  type LocalModelSettings,
  type GenerateOptions,
} from "../runtime/runtimeApi";
import { extractUnifiedDiff, extractExplanation } from "../runtime/parseCoderOutput";

function buildCoderPrompt(ctx: ModelContext): string {
  const parts: string[] = [];
  parts.push("You are a coding assistant. Produce a brief explanation, then a single unified diff that implements the requested change.");
  parts.push("");
  parts.push("User request: " + ctx.prompt);
  if (ctx.plan) {
    parts.push("");
    parts.push("Plan to implement: " + ctx.plan);
  }
  const targetPaths = ctx.targetFiles?.length ? ctx.targetFiles : ctx.selectedFiles.map((f) => f.path);
  if (targetPaths.length) {
    parts.push("");
    parts.push("Target files: " + targetPaths.join(", "));
  }
  const files = ctx.targetFiles?.length
    ? ctx.selectedFiles.filter((f) => targetPaths.includes(f.path))
    : ctx.selectedFiles;
  if (files.length) {
    parts.push("");
    parts.push("Current file contents (use a/ and b/ paths in the diff):");
    for (const f of files) {
      parts.push("");
      parts.push("--- " + f.path + " ---");
      parts.push(f.content || "(empty)");
    }
  }
  if (ctx.manifestSummary) {
    parts.push("");
    parts.push("Project context: " + ctx.manifestSummary.slice(0, 800));
  }
  if (ctx.knowledgeChunks?.length) {
    parts.push("");
    parts.push("Relevant knowledge:");
    for (const k of ctx.knowledgeChunks) {
      parts.push("");
      parts.push("[" + k.title + " from " + k.sourcePath + "]");
      parts.push(k.chunkText.slice(0, 1500));
    }
  }
  parts.push("");
  parts.push("Output format: Write a short explanation (1–3 sentences), then output a valid unified diff. The diff must start with --- a/<path> and +++ b/<path> and contain at least one @@ hunk. Use paths relative to repo root (e.g. a/src/main.ts).");
  return parts.join("\n");
}

const CHAT_SYSTEM_PROMPT =
  "You are a helpful dev assistant. Answer the user's question concisely. Do NOT output a diff, unified patch, or code changes. Just answer normally in plain text.";

function buildChatUserPrompt(ctx: ModelContext): string {
  const parts: string[] = [];
  parts.push("User: " + ctx.prompt);
  if (ctx.selectedFiles.length) {
    parts.push("");
    parts.push("Context files: " + ctx.selectedFiles.map((f) => f.path).join(", "));
    for (const f of ctx.selectedFiles.slice(0, 3)) {
      parts.push("");
      parts.push("--- " + f.path + " ---");
      parts.push((f.content || "(empty)").slice(0, 800));
    }
  }
  if (ctx.manifestSummary) {
    parts.push("");
    parts.push("Project: " + ctx.manifestSummary.slice(0, 500));
  }
  if (ctx.knowledgeChunks?.length) {
    parts.push("");
    parts.push("Relevant knowledge:");
    for (const k of ctx.knowledgeChunks.slice(0, 3)) {
      parts.push("[" + k.title + "] " + k.chunkText.slice(0, 400));
    }
  }
  parts.push("");
  parts.push("Answer (plain text only, no diff):");
  return parts.join("\n");
}

export class LocalModelProvider implements IModelProvider {
  constructor(
    private getSettings: () => LocalModelSettings,
    private getToolRoot: () => string | null,
    private getPort: () => number | undefined = () => undefined,
    private getGenerateOptions: () => GenerateOptions = () => ({})
  ) {}

  async generatePlanAndPatch(ctx: ModelContext): Promise<PlanAndPatch> {
    const settings = this.getSettings();
    await ensureLocalRuntime(settings, this.getToolRoot(), this.getPort());
    const prompt = buildCoderPrompt(ctx);
    const opts = this.getGenerateOptions();
    const raw = await runtimeGenerate(prompt, false, {
      temperature: opts.temperature ?? settings.temperature,
      top_p: opts.top_p ?? settings.top_p,
      max_tokens: opts.max_tokens ?? settings.max_tokens,
    });
    const patch = extractUnifiedDiff(raw);
    if (!patch) {
      throw new Error(
        "Coder did not produce a valid unified diff. The model output must include a diff starting with --- a/<path> and +++ b/<path> with @@ hunks. Please try again or use a model that follows instructions."
      );
    }
    const explanation = extractExplanation(raw, patch);
    return { explanation, patch };
  }

  async generateChatResponse(ctx: ModelContext): Promise<string> {
    const settings = this.getSettings();
    await ensureLocalRuntime(settings, this.getToolRoot(), this.getPort());
    const userPrompt = buildChatUserPrompt(ctx);
    const opts = this.getGenerateOptions();
    const maxTokens = Math.min(512, opts.max_tokens ?? settings.max_tokens);
    const temperature = Math.max(0.2, Math.min(0.7, opts.temperature ?? settings.temperature));
    try {
      const raw = await runtimeChat(CHAT_SYSTEM_PROMPT, userPrompt, {
        max_tokens: maxTokens,
        temperature,
      });
      return (raw || "").trim() || "No response.";
    } catch (e) {
      const msg = String(e);
      const lines = msg.split("\n");
      const first = lines[0]?.trim() || msg;
      const rest = lines.slice(1).filter(Boolean).join("\n");
      const second = rest ? rest : "Endpoint: n/a";
      return `LOCAL_MODEL_ERROR: ${first}\n${second}`;
    }
  }
}
