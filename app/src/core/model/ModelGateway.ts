/**
 * ModelGateway: generatePlanAndPatch(prompt, context).
 * MOCK provider first; LocalModelProvider (Ollama/llama.cpp) stubs later.
 */

import type { ModelContext, PlanAndPatch } from "../types";

export interface ChatResponseOptions {
  onChunk?: (chunk: string) => void;
}

export interface IModelProvider {
  generatePlanAndPatch(ctx: ModelContext): Promise<PlanAndPatch>;
  /** Chat-only: plain text reply, no diff. Use for "Send" / Enter. options.onChunk enables streaming. */
  generateChatResponse(ctx: ModelContext, options?: ChatResponseOptions): Promise<string>;
}

export interface ModelProviderInfo {
  kind: "local" | "openai" | "mock";
  label: string;
  isReal: boolean;
  available: boolean;
  reason?: string;
}

/** Build a minimal unified diff that prepends lines to oldStr. */
function buildPrependPatch(path: string, oldStr: string, prepend: string): string {
  const a = "a/" + path;
  const b = "b/" + path;
  const addLines = prepend.split(/\r?\n/);
  const oldLines = oldStr.split(/\r?\n/);
  const ctx = oldLines[0] ?? "";
  const hasCtx = ctx.length > 0;
  const oldStart = hasCtx ? 1 : 0;
  const oldCount = hasCtx ? 1 : 0;
  const newCount = addLines.length + (hasCtx ? 1 : 0);
  const hunk =
    `@@ -${oldStart},${oldCount} +1,${newCount} @@\n` +
    addLines.map((l) => "+" + l).join("\n") +
    (hasCtx ? "\n " + ctx : "") +
    "\n";
  return `--- ${a}\n+++ ${b}\n${hunk}`;
}

/** Deterministic mock: returns fixed explanation + valid unified diff for demo. */
export class MockModelProvider implements IModelProvider {
  async generateChatResponse(ctx: ModelContext, _options?: ChatResponseOptions): Promise<string> {
    const q = ctx.prompt.slice(0, 120);
    const files = ctx.selectedFiles.length
      ? ` Context files: ${ctx.selectedFiles.map((f) => f.path).join(", ")}.`
      : "";
    const memory = ctx.projectMemorySummary ? " Project memory is loaded." : "";
    return `[MOCK] You asked: "${q}${q.length >= 120 ? "..." : ""}".${files}${memory} I'm NF. I use the opened workspace as context; ask for a code change and I will identify files and propose a patch.`;
  }

  async generatePlanAndPatch(ctx: ModelContext): Promise<PlanAndPatch> {
    const files = ctx.selectedFiles.map((f) => f.path).join(", ");
    const plan = ctx.plan;
    const knowledgeNote =
      ctx.knowledgeChunks?.length ? ` + ${ctx.knowledgeChunks.length} knowledge chunk(s)` : "";
    const explanation = plan
      ? `[MOCK Coder] Plan: "${plan.slice(0, 80)}...". Context files: ${files}${knowledgeNote}. Implemented per plan; plug in local model (Ollama/llama.cpp) later.`
      : `[MOCK] You asked: "${ctx.prompt.slice(0, 100)}...". Context files: ${files}${knowledgeNote}. This is a placeholder; plug in a local model (Ollama/llama.cpp) later.`;
    const patch = this.mockPatch(ctx);
    return { explanation, patch };
  }

  private mockPatch(ctx: ModelContext): string {
    const paths = ctx.targetFiles?.length ? ctx.targetFiles : ctx.selectedFiles.map((f) => f.path);
    const first = ctx.selectedFiles.find((f) => paths.includes(f.path)) ?? ctx.selectedFiles[0];
    const path = first ? first.path : paths[0] ?? "README.md";
    const oldStr = first?.content ?? "";
    const prepend = "// NF mock edit - replace with real model output.\n\n";
    return buildPrependPatch(path, oldStr, prepend);
  }
}

// TODO: LocalModelProvider (Ollama / llama.cpp) - same interface, real model calls.
// export class LocalModelProvider implements IModelProvider { ... }

let defaultProvider: IModelProvider = new MockModelProvider();
let defaultProviderInfo: ModelProviderInfo = {
  kind: "mock",
  label: "Mock (development only)",
  isReal: false,
  available: true,
  reason: "Mock responses cannot be applied in Developer Mode.",
};

export function setModelProvider(p: IModelProvider, info?: ModelProviderInfo): void {
  defaultProvider = p;
  defaultProviderInfo = info ?? defaultProviderInfo;
}

export function getModelProvider(): IModelProvider {
  return defaultProvider;
}

export function getModelProviderInfo(): ModelProviderInfo {
  return { ...defaultProviderInfo };
}

export async function generatePlanAndPatch(ctx: ModelContext): Promise<PlanAndPatch> {
  return defaultProvider.generatePlanAndPatch(ctx);
}

export async function generateChatResponse(
  ctx: ModelContext,
  options?: ChatResponseOptions
): Promise<string> {
  return defaultProvider.generateChatResponse(ctx, options);
}
