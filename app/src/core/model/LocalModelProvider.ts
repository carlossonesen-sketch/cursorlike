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
  runtimeChatStream,
  getRuntimeBaseUrl,
  type LocalModelSettings,
  type GenerateOptions,
  type ChatOptions,
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
  if (ctx.projectMemorySummary) {
    parts.push("");
    parts.push(ctx.projectMemorySummary.slice(0, 1200));
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

/** Normal chat: output the result only. Examples tell the model what "output" means. */
const CHAT_SYSTEM_PROMPT =
  "Output only the result. Example: user says 'say ok' → you reply: ok. User says 'count from 1 to 5' → you reply: 1 2 3 4 5. No explanation or extra text.";

/** file_read / explain: one sentence if requested, no extra commentary. */
const FILE_READ_SYSTEM_PROMPT =
  "You are a command-following assistant. For file or content questions answer in one sentence when that is requested. Do not add extra commentary.";

function buildChatUserPrompt(ctx: ModelContext): string {
  const parts: string[] = [ctx.prompt];
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
  if (ctx.projectMemorySummary) {
    parts.push("");
    parts.push(ctx.projectMemorySummary.slice(0, 1200));
  }
  if (ctx.knowledgeChunks?.length) {
    parts.push("");
    parts.push("Relevant knowledge:");
    for (const k of ctx.knowledgeChunks.slice(0, 3)) {
      parts.push("[" + k.title + "] " + k.chunkText.slice(0, 400));
    }
  }
  return parts.join("\n");
}

/** Used only for file_read/explain. Returns [system, user] from existing builders. */
function getMessagesForRequest(ctx: ModelContext): { system: string; user: string } {
  return { system: FILE_READ_SYSTEM_PROMPT, user: buildChatUserPrompt(ctx) };
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
    const port = await ensureLocalRuntime(settings, this.getToolRoot(), this.getPort());
    const baseUrl = getRuntimeBaseUrl(port);
    console.log("[runtime] request", "POST", baseUrl + "/completion");
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

  async generateChatResponse(
    ctx: ModelContext,
    options?: { onChunk?: (chunk: string) => void }
  ): Promise<string> {
    const settings = this.getSettings();
    const t0 = Date.now();
    console.log("[gen] ensureRuntime start", t0);
    const port = await ensureLocalRuntime(settings, this.getToolRoot(), this.getPort());
    console.log("[gen] ensureRuntime done", Date.now() - t0);
    const baseUrl = getRuntimeBaseUrl(port);
    const opts = this.getGenerateOptions();
    const maxTokens = Math.min(512, opts.max_tokens ?? settings.max_tokens);
    const temperature = Math.max(0.2, Math.min(0.7, opts.temperature ?? settings.temperature));
    const chatOpts: ChatOptions = { max_tokens: maxTokens, temperature };

    let systemPrompt: string;
    let userPrompt: string;
    if (ctx.includeFileProjectContext) {
      const built = getMessagesForRequest(ctx);
      systemPrompt = built.system;
      userPrompt = built.user;
    } else {
      systemPrompt = CHAT_SYSTEM_PROMPT;
      userPrompt = ctx.prompt;
    }

    if (options?.onChunk) {
      try {
        console.log("[runtime] request (stream)", "POST", baseUrl + "/v1/chat/completions");
        const t1 = Date.now();
        const raw = await runtimeChatStream(
          systemPrompt,
          userPrompt,
          chatOpts,
          { onChunk: options.onChunk }
        );
        console.log("[gen] runtimeChatStream done", Date.now() - t1);
        return (raw || "").trim() || "No response.";
      } catch (_) {
        console.log("[runtime] stream failed, falling back to non-streaming");
      }
    }

    try {
      console.log("[runtime] request", "POST", baseUrl + "/v1/chat/completions");
      const t1 = Date.now();
      const raw = await runtimeChat(systemPrompt, userPrompt, chatOpts);
      console.log("[gen] runtimeChat done", Date.now() - t1);
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
