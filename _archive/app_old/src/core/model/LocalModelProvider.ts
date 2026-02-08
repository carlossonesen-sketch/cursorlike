/**
 * LocalModelProvider: plan-based patch pipeline.
 * A) Model produces ONLY a compact JSON edit plan (targetFiles + operations: insert_after, replace_range, append, prepend).
 * B) We apply the plan locally (string-based).
 * C) We generate the unified diff locally (diff library), no model call for diff.
 * D) If plan invalid or apply fails: fall back to "model generates diff" capped at 120s and 300 lines.
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
import { generateFileEdit } from "../intent/simpleEdit";
import * as diff from "diff";
import { validateEditPlan, type EditPlan as IncrementalEditPlan } from "../patch/EditPlan";

/** Operation kinds: anchor = exact string to find, line = 1-based line number. */
type EditOp =
  | { op: "replace_range"; startLine: number; endLine: number; newText: string }
  | { op: "insert_after"; anchor?: string; line?: number; newText: string }
  | { op: "append"; newText: string }
  | { op: "prepend"; newText: string };

interface FileEditPlan {
  path: string;
  operations: EditOp[];
}

interface EditPlan {
  targetFiles: string[];
  fileEdits: FileEditPlan[];
}

function isEditOp(o: unknown): o is EditOp {
  if (!o || typeof o !== "object") return false;
  const op = o as Record<string, unknown>;
  if (typeof op.op !== "string") return false;
  if (op.op === "replace_range") {
    return (
      typeof op.startLine === "number" &&
      typeof op.endLine === "number" &&
      typeof op.newText === "string"
    );
  }
  if (op.op === "insert_after") {
    const hasAnchor = op.anchor !== undefined;
    const hasLine = op.line !== undefined;
    return typeof op.newText === "string" && (hasAnchor || hasLine);
  }
  if (op.op === "append" || op.op === "prepend") {
    return typeof op.newText === "string";
  }
  return false;
}

function parseEditPlan(raw: string): EditPlan | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const data = JSON.parse(jsonMatch[0]) as unknown;
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.targetFiles) || !Array.isArray(obj.fileEdits)) return null;
    const targetFiles = obj.targetFiles as unknown[];
    const fileEdits = obj.fileEdits as unknown[];
    if (!targetFiles.every((p) => typeof p === "string")) return null;
    for (const fe of fileEdits) {
      if (!fe || typeof fe !== "object") return null;
      const f = fe as Record<string, unknown>;
      if (typeof f.path !== "string" || !Array.isArray(f.operations)) return null;
      if (!(f.operations as unknown[]).every(isEditOp)) return null;
    }
    return { targetFiles: targetFiles as string[], fileEdits: fileEdits as FileEditPlan[] };
  } catch {
    return null;
  }
}

function parseIncrementalEditPlan(raw: string): IncrementalEditPlan | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  // Strip trailing commas (common LLM quirk)
  const jsonStr = jsonMatch[0].replace(/,\s*([}\]])/g, "$1");

  try {
    const data = JSON.parse(jsonStr) as unknown;
    const validated = validateEditPlan(data);
    return validated.ok ? validated.value : null;
  } catch {
    return null;
  }
}
/\*\* Apply one operation to content\. Returns new content\. \*/
function applyOp(content: string, op: EditOp): string {
  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;

  switch (op.op) {
    case "prepend":
      return op.newText + (content ? "\n" + content : "");
    case "append":
      return (content ? content + "\n" : "") + op.newText;
    case "replace_range": {
      const startIdx = Math.max(0, op.startLine - 1);
      const endIdx = Math.min(lineCount, op.endLine);
      const newLines = op.newText.split(/\r?\n/);
      const out = lines.slice(0, startIdx).concat(newLines).concat(lines.slice(endIdx));
      return out.join("\n");
    }
    case "insert_after": {
      if (op.anchor !== undefined) {
        const idx = content.indexOf(op.anchor);
        if (idx < 0) return content;
        const after = idx + op.anchor.length;
        return content.slice(0, after) + op.newText + content.slice(after);
      }
      if (op.line !== undefined) {
        const afterIdx = Math.min(lineCount, Math.max(0, op.line - 1));
        const before = lines.slice(0, afterIdx + 1).join("\n");
        const after = lines.slice(afterIdx + 1).join("\n");
        const sep = afterIdx + 1 < lineCount ? "\n" : "";
        return before + sep + op.newText + (after ? "\n" + after : "");
      }
      return content;
    }
    default:
      return content;
  }
}

function applyFileEditPlan(content: string, operations: EditOp[]): string {
  let current = content;
  for (const op of operations) {
    current = applyOp(current, op);
  }
  return current;
}

/** Step 1: Ask for structured plan (files, intent, exact changes). No diff yet. */
function buildPlanPrompt(ctx: ModelContext): string {
  const parts: string[] = [];
  parts.push("You are a coding assistant. Produce a structured plan for the following change. Do NOT output a diff or code yet.");
  parts.push("");
  parts.push("User request: " + ctx.prompt);
  const targetPaths = ctx.targetFiles?.length ? ctx.targetFiles : ctx.selectedFiles.map((f) => f.path);
  if (targetPaths.length) {
    parts.push("");
    parts.push("Target files: " + targetPaths.join(", "));
  }
  if (ctx.manifestSummary) {
    parts.push("");
    parts.push("Project context: " + ctx.manifestSummary.slice(0, 600));
  }
  parts.push("");
  parts.push("Output your plan: list the files to change, the intent, and the exact changes (in plain language). Keep it concise.");
  return parts.join("\n");
}

/** Pass A: Ask for edit plan as compact JSON only (targetFiles + operations). */
function buildEditPlanPrompt(ctx: ModelContext, plan: string): string {
  const parts: string[] = [];
  parts.push("Using this plan, output ONLY a valid JSON object. No other text, no markdown.");
  parts.push("");
  parts.push("Plan: " + plan.slice(0, 1500));
  parts.push("");
  parts.push("User request: " + ctx.prompt);
  const targetPaths = ctx.targetFiles?.length ? ctx.targetFiles : ctx.selectedFiles.map((f) => f.path);
  const files = ctx.targetFiles?.length
    ? ctx.selectedFiles.filter((f) => targetPaths.includes(f.path))
    : ctx.selectedFiles;
  parts.push("");
  parts.push('JSON format (exact keys): {"version":1,"steps":[{"id":"step-1","filePath":"relative/path.ts","operation":"modify","summary":"...","rationale":"...","operations":[{"kind":"replace_range","startLine":1,"endLine":2,"newText":"..."},{"kind":"search_and_replace","search":"EXACT","replace":"...","all":false},{"kind":"append","newText":"..."},{"kind":"prepend","newText":"..."}]}]}' );
  parts.push("- steps must be ordered; each step touches exactly ONE filePath.");
  parts.push("- operation is one of: modify | create | delete.");
  parts.push("- For delete: operations MUST be empty array.");
  parts.push("- For modify/create: operations must be non-empty.");
  parts.push("- Use workspace-relative paths with forward slashes. filePath must match one of: " + targetPaths.join(", "));
  parts.push("- Operations kinds: replace_range (1-based, endLine inclusive), search_and_replace (exact match), append, prepend.");
  if (files.length) {
    parts.push("");
    parts.push("Current file contents (for anchors and line numbers):");
    for (const f of files) {
      const content = f.content || "(empty)";
      const lineCount = content.split(/\r?\n/).length;
      parts.push("");
      parts.push("--- " + f.path + " (" + lineCount + " lines) ---");
      parts.push(content.slice(0, 12000));
    }
  }
  parts.push("");
  parts.push("Output ONLY the JSON object.");
  return parts.join("\n");
}

/** Pass B fallback: Ask for ONLY a unified diff given the plan and file contents. */
function buildDiffOnlyPrompt(ctx: ModelContext, plan: string): string {
  const parts: string[] = [];
  parts.push("Using this plan, output ONLY a unified diff. No explanation, no other text.");
  parts.push("");
  parts.push("Plan: " + plan.slice(0, 1500));
  parts.push("");
  parts.push("User request: " + ctx.prompt);
  const targetPaths = ctx.targetFiles?.length ? ctx.targetFiles : ctx.selectedFiles.map((f) => f.path);
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
  parts.push("");
  parts.push("Output format: Return ONLY a valid unified diff. Must start with --- a/<path> and +++ b/<path> and contain @@ hunks. Use paths relative to repo root (e.g. a/src/main.ts).");
  return parts.join("\n");
}

const STRICT_DIFF_INSTRUCTION =
  "Return ONLY a unified diff. Must start with --- a/<path> and +++ b/<path> and contain @@ hunks. No other text.";

/** Fallback (model-generated diff): cap at 300 lines. */
const FALLBACK_DIFF_MAX_LINES = 300;

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
    const opts = this.getGenerateOptions();

    // Step 1: Structured plan (files, intent, exact changes) â€” stream: true, max 256
    const planPrompt = buildPlanPrompt(ctx);
    const planRaw = await runtimeGenerate(planPrompt, true, {
      temperature: opts.temperature ?? settings.temperature,
      top_p: opts.top_p ?? settings.top_p,
      max_tokens: Math.min(256, opts.max_tokens ?? settings.max_tokens),
    }, ctx.runId);
    const plan = (planRaw || "").trim().slice(0, 2000) || "Implement the user request.";

    const targetPaths = ctx.targetFiles?.length ? ctx.targetFiles : ctx.selectedFiles.map((f) => f.path);
    const files = ctx.targetFiles?.length
      ? ctx.selectedFiles.filter((f) => targetPaths.includes(f.path))
      : ctx.selectedFiles;
    const fileByPath = new Map(files.map((f) => [f.path, f]));

    // Pass A: Edit plan JSON â†’ apply locally â†’ generate unified diff locally (no model diff)
    const editPlanPrompt = buildEditPlanPrompt(ctx, plan);
    const editPlanOpts = {
      temperature: Math.max(0, (opts.temperature ?? settings.temperature) - 0.1),
      top_p: opts.top_p ?? settings.top_p,
      max_tokens: Math.min(4096, opts.max_tokens ?? settings.max_tokens),
    };
    let editPlanRaw = await runtimeGenerate(editPlanPrompt, true, editPlanOpts, ctx.runId);
    let incrementalEditPlan = parseIncrementalEditPlan(editPlanRaw || "") ?? undefined;
    let editPlan = incrementalEditPlan ? null : parseEditPlan(editPlanRaw || "");
    if (!incrementalEditPlan && !editPlan && editPlanRaw?.trim()) {
      editPlanRaw = await runtimeGenerate(
        editPlanPrompt + "\n\nOutput ONLY valid JSON. No markdown, no explanation.",
        false,
        { ...editPlanOpts, temperature: 0.1 },
        ctx.runId
      );
      incrementalEditPlan = parseIncrementalEditPlan(editPlanRaw || "") ?? undefined;
      editPlan = incrementalEditPlan ? null : parseEditPlan(editPlanRaw || "");
    }
    if (editPlan && editPlan.fileEdits.length > 0) {
      const patches: string[] = [];
      let applied = 0;
      for (const fe of editPlan.fileEdits) {
        const f = fileByPath.get(fe.path);
        if (!f || !fe.operations.length) continue;
        const oldContent = f.content ?? "";
        try {
          const newContent = applyFileEditPlan(oldContent, fe.operations);
          if (newContent !== oldContent) {
            let chunk = diff.createTwoFilesPatch(
              "a/" + f.path,
              "b/" + f.path,
              oldContent,
              newContent,
              "a/" + f.path,
              "b/" + f.path
            );
            chunk = chunk.replace(/^Index: .*\n=+\n?/m, "").trim();
            if (chunk) {
              patches.push(chunk);
              applied++;
            }
          }
        } catch {
          /* skip file */
        }
      }
      if (applied > 0 && patches.length > 0) {
        const patch = patches.join("\n");
        return { explanation: plan, patch, editPlan: (incrementalEditPlan ?? undefined) };
      }
    }

    // Pass B (fallback): Model generates unified diff â€” cap at 120s total (caller) and 300 lines output
    const diffPrompt = buildDiffOnlyPrompt(ctx, plan);
    let raw = await runtimeGenerate(diffPrompt, false, {
      temperature: Math.max(0, (opts.temperature ?? settings.temperature) - 0.1),
      top_p: opts.top_p ?? settings.top_p,
      max_tokens: Math.min(8000, opts.max_tokens ?? settings.max_tokens),
    }, ctx.runId);
    let patch = extractUnifiedDiff(raw);

    if (!patch) {
      raw = await runtimeGenerate(diffPrompt + "\n\n" + STRICT_DIFF_INSTRUCTION, false, {
        temperature: 0.1,
        top_p: opts.top_p ?? settings.top_p,
        max_tokens: Math.min(8000, opts.max_tokens ?? settings.max_tokens),
      }, ctx.runId);
      patch = extractUnifiedDiff(raw);
    }

    if (patch) {
      const patchLines = patch.split(/\r?\n/);
      const capped = patchLines.length > FALLBACK_DIFF_MAX_LINES;
      const cappedPatch = capped ? patchLines.slice(0, FALLBACK_DIFF_MAX_LINES).join("\n") : undefined;
      const explanation = extractExplanation(raw, patch);
      return {
        explanation,
        patch,
        fallbackDiff: true,
        ...(capped ? { partialDiff: true, cappedPatch } : {}),
      };
    }

    // Fallback: direct file edit per file, then build diff from before/after
    const fallbackFiles = ctx.selectedFiles.length ? ctx.selectedFiles : [];
    const instructions = ctx.prompt + "\n\nPlan: " + plan;
    const fallbackPatches: string[] = [];
    for (const f of fallbackFiles) {
      try {
        const editResult = await generateFileEdit({
          filePath: f.path,
          originalContent: f.content ?? "",
          instructions,
          isNewFile: false,
        });
        if (editResult.proposedContent === (f.content ?? "")) continue;
        let chunk = diff.createTwoFilesPatch(
          "a/" + f.path,
          "b/" + f.path,
          f.content ?? "",
          editResult.proposedContent,
          "a/" + f.path,
          "b/" + f.path
        );
        chunk = chunk.replace(/^Index: .*\n=+\n?/m, "").trim();
        if (chunk) fallbackPatches.push(chunk);
      } catch {
        /* skip file */
      }
    }
    const fallbackPatch = fallbackPatches.join("\n");
    if (!fallbackPatch) {
      return { explanation: plan, patch: "", fallbackDiff: true };
    }
    return {
      explanation: plan,
      patch: fallbackPatch,
      fallbackDiff: true,
    };
  }

  async generateChatResponse(ctx: ModelContext): Promise<string> {
    const settings = this.getSettings();
    await ensureLocalRuntime(settings, this.getToolRoot(), this.getPort());
    const userPrompt = buildChatUserPrompt(ctx);
    const opts = this.getGenerateOptions();
    const maxTokens = Math.min(128, opts.max_tokens ?? settings.max_tokens);
    const temperature = Math.max(0.2, Math.min(0.7, opts.temperature ?? settings.temperature));
    try {
      const raw = await runtimeChat(CHAT_SYSTEM_PROMPT, userPrompt, {
        max_tokens: maxTokens,
        temperature,
      }, ctx.runId);
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







