/**
 * Generate human-readable change summary for a proposal.
 * Grounded: summaries are derived from actual proposed changes and validated.
 */

import { runtimeChat } from "../runtime/runtimeApi";
import type { ChangeSummary } from "../types";
import type { ProposalGroundTruth } from "./groundTruth";
import { buildProposalGroundTruth } from "./groundTruth";

/** Model outputs ONLY these; file list is built from proposal in code. */
const GROUNDED_JSON_SCHEMA = `{
  "title": "string, max 80 chars",
  "whatChanged": ["string", "3-8 bullets"],
  "behaviorAfter": ["string", "3-8 bullets"],
  "risks": ["string", "optional 0-4 bullets"]
}`;

export interface GenerateSummaryInputSingle {
  type: "single";
  filePath: string;
  instructions: string;
  plan?: string[];
  diffSummary?: string;
}

export interface GenerateSummaryInputMulti {
  type: "multi";
  plan: string[];
  files: Array<{ path: string; summary: string }>;
}

/** Grounded input: provide ground truth + plan; model must not invent paths or tokens. */
export interface GenerateSummaryInputGrounded {
  type: "grounded";
  groundTruth: ProposalGroundTruth;
  plan: string[];
}

export type GenerateSummaryInput =
  | GenerateSummaryInputSingle
  | GenerateSummaryInputMulti
  | GenerateSummaryInputGrounded;

function buildGroundedSummaryPrompt(groundTruth: ProposalGroundTruth, plan: string[]): string {
  const parts: string[] = [];
  parts.push("You are a coding assistant. Generate a SHORT change summary based ONLY on the following grounded data.");
  parts.push("");
  parts.push("STRICT RULES:");
  parts.push("- Output ONLY valid JSON. No prose, no markdown.");
  parts.push("- Do NOT mention any file path, endpoint, or identifier that is not listed below.");
  parts.push("- title: max 80 characters.");
  parts.push("- whatChanged: 3-8 bullets describing what changed; only reference the file paths and anchors listed.");
  parts.push("- behaviorAfter: 3-8 bullets; only describe behavior implied by the listed anchors/paths.");
  parts.push("- risks: optional 0-4 bullets; put anything uncertain here.");
  parts.push("- You must NOT output a \"files\" field. The file list is built from the proposal in code.");
  parts.push("");
  parts.push("Output this exact structure (no \"files\" key):");
  parts.push(GROUNDED_JSON_SCHEMA);
  parts.push("");
  parts.push("Plan:");
  plan.forEach((p) => parts.push(`- ${p}`));
  parts.push("");
  parts.push("Files (only these exist in the proposal):");
  for (const f of groundTruth.files) {
    parts.push(`- ${f.path} [${f.kind}] +${f.diffStats.linesAdded} -${f.diffStats.linesRemoved}`);
    if (f.anchors.length) parts.push(`  anchors: ${f.anchors.slice(0, 8).join(", ")}`);
  }
  parts.push("");
  parts.push("Global anchors (you may reference these):");
  parts.push(groundTruth.globalAnchors.slice(0, 30).join(", "));
  parts.push("");
  parts.push("Output the JSON object only (no \"files\"):");
  return parts.join("\n");
}

function buildSummaryPrompt(input: GenerateSummaryInputSingle | GenerateSummaryInputMulti): string {
  const parts: string[] = [];
  parts.push("You are a coding assistant. Generate a SHORT change summary for a code proposal.");
  parts.push("");
  parts.push("RULES:");
  parts.push("- Output ONLY valid JSON. No prose, no markdown.");
  parts.push("- title: max 80 characters, one line describing the change.");
  parts.push("- whatChanged: 3-8 bullet points (what code/files changed).");
  parts.push("- behaviorAfter: 3-8 bullet points (how the project should behave after the change).");
  parts.push("- risks: optional, 0-4 bullet points if any.");
  parts.push("- Do NOT output a \"files\" field.");
  parts.push("");
  parts.push("Output this exact structure:");
  parts.push(GROUNDED_JSON_SCHEMA);
  parts.push("");

  if (input.type === "single") {
    parts.push("SINGLE FILE PROPOSAL:");
    parts.push(`File: ${input.filePath}`);
    parts.push(`Instructions: ${input.instructions}`);
    if (input.plan?.length) parts.push(`Plan: ${input.plan.join("; ")}`);
    if (input.diffSummary) parts.push(`Diff summary: ${input.diffSummary.slice(0, 500)}`);
  } else {
    parts.push("MULTI-FILE PROPOSAL:");
    parts.push(`Plan: ${input.plan.join("\n")}`);
    parts.push("Files:");
    for (const f of input.files) {
      parts.push(`- ${f.path}: ${f.summary}`);
    }
  }

  parts.push("");
  parts.push("Output the JSON object only:");
  return parts.join("\n");
}

/** Parse model response; files are NOT from model — caller sets from proposal. */
function parseSummaryResponse(raw: string): Omit<ChangeSummary, "files"> & { files?: Array<{ path: string; change: string }> } | null {
  let jsonStr = raw.trim();
  const codeBlockMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)```$/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const title = typeof parsed.title === "string" ? parsed.title.slice(0, 80) : "Changes applied";
    const whatChanged = Array.isArray(parsed.whatChanged)
      ? parsed.whatChanged.filter((x): x is string => typeof x === "string").slice(0, 8)
      : [];
    const behaviorAfter = Array.isArray(parsed.behaviorAfter)
      ? parsed.behaviorAfter.filter((x): x is string => typeof x === "string").slice(0, 8)
      : [];
    const risks = Array.isArray(parsed.risks)
      ? parsed.risks.filter((x): x is string => typeof x === "string").slice(0, 4)
      : undefined;
    const files: Array<{ path: string; change: string }> = [];
    if (Array.isArray(parsed.files)) {
      for (const f of parsed.files) {
        const obj = f as Record<string, unknown>;
        if (typeof obj.path === "string" && typeof obj.change === "string") {
          files.push({ path: obj.path, change: obj.change });
        }
      }
    }
    return { title, whatChanged, behaviorAfter, files: files.length ? files : undefined, risks };
  } catch {
    return null;
  }
}

const GENERIC_WORDS = new Set([
  "bug", "fix", "refactor", "code", "file", "files", "support", "change", "changes",
  "update", "add", "remove", "improve", "project", "behavior", "logic", "test", "tests",
  "api", "auth", "endpoint", "route", "handler", "config", "data", "type", "types",
]);

/** Check if a bullet references only allowed paths and anchors (or generic words). */
function bulletReferencesAllowed(
  bullet: string,
  validPaths: Set<string>,
  allAnchors: Set<string>
): boolean {
  if (Array.from(validPaths).some((p) => bullet.includes(p))) return true;
  const tokens = bullet.split(/\s+/).filter((t) => t.length > 1);
  for (const t of tokens) {
    const clean = t.replace(/[^\w/-]/g, "");
    if (!clean) continue;
    if (GENERIC_WORDS.has(clean.toLowerCase())) continue;
    if (validPaths.has(clean) || validPaths.has(clean.replace(/^[/\\]+/, ""))) continue;
    if (allAnchors.has(clean)) continue;
    if (allAnchors.has(clean.replace(/["'`]/g, ""))) continue;
    if (Array.from(validPaths).some((p) => p.includes(clean) || clean.includes(p))) continue;
    if (Array.from(allAnchors).some((a) => a.toLowerCase().includes(clean.toLowerCase()) || clean.toLowerCase().includes(a.toLowerCase()))) continue;
    return false;
  }
  return true;
}

export interface ValidateSummaryOptions {
  groundTruth: ProposalGroundTruth;
  getProposedContent: (path: string) => string;
}

/**
 * Validate and fix summary: remove bullets that reference unknown paths/tokens or ungrounded claims.
 * If too much is removed, return a conservative summary.
 * Sets confidence: high = most bullets unchanged, medium = some rewrites/removals, low = heavy cleanup or fallback.
 */
export function validateAndFixSummary(
  summary: ChangeSummary,
  opts: ValidateSummaryOptions
): ChangeSummary {
  const { groundTruth, getProposedContent } = opts;
  const validPaths = new Set(groundTruth.files.map((f) => f.path));
  const allAnchors = new Set(groundTruth.globalAnchors);
  for (const f of groundTruth.files) {
    f.anchors.forEach((a) => allAnchors.add(a));
  }

  const originalWhatCount = summary.whatChanged.length;
  const whatChanged = summary.whatChanged.filter((b) => bulletReferencesAllowed(b, validPaths, allAnchors));
  const removedWhat = originalWhatCount - whatChanged.length;

  let behaviorAfter = summary.behaviorAfter.filter((b) => bulletReferencesAllowed(b, validPaths, allAnchors));
  const originalBehaviorCount = behaviorAfter.length;

  let allProposed = "";
  try {
    allProposed = groundTruth.files.map((f) => getProposedContent(f.path)).join("\n");
  } catch {
    allProposed = "";
  }

  const weakClaims: string[] = [];
  const strongBehavior: string[] = [];
  for (const b of behaviorAfter) {
    const routeLike = b.match(/\/[\w/-]+|https?:\/\/[^\s"'`]+/g);
    let grounded = true;
    if (routeLike?.length) {
      for (const r of routeLike) {
        if (r && !allProposed.includes(r)) {
          grounded = false;
          break;
        }
      }
    }
    if (grounded) strongBehavior.push(b);
    else weakClaims.push(b);
  }

  const removedOrMovedBehavior = originalBehaviorCount - strongBehavior.length;
  const totalRemoved = removedWhat + removedOrMovedBehavior;
  const totalOriginal = Math.max(1, originalWhatCount + originalBehaviorCount);

  if (weakClaims.length) {
    const risks = [...(summary.risks ?? []), ...weakClaims.map((c) => `Unverified: ${c}`)].slice(0, 4);
    summary = { ...summary, behaviorAfter: strongBehavior, risks };
  } else {
    summary = { ...summary, behaviorAfter: strongBehavior };
  }

  const totalBullets = whatChanged.length + strongBehavior.length;
  if (totalBullets < 2 || whatChanged.length === 0) {
    const n = groundTruth.totals.fileCount;
    return {
      title: summary.title.length <= 80 ? summary.title : `Updated ${n} file(s).`,
      whatChanged: [`Updated ${n} file(s).`],
      behaviorAfter: ["Review file list for details."],
      files: summary.files?.length ? summary.files : buildFileListFromGroundTruth(groundTruth),
      risks: summary.risks,
      confidence: "low",
    };
  }

  const confidence: "high" | "medium" | "low" =
    totalRemoved === 0 ? "high" : totalRemoved <= Math.ceil(totalOriginal * 0.5) ? "medium" : "low";
  return { ...summary, whatChanged, confidence };
}

/** Build file list for UI from ground truth (not from model). */
export function buildFileListFromGroundTruth(groundTruth: ProposalGroundTruth): Array<{ path: string; change: string }> {
  return groundTruth.files.map((f) => ({
    path: f.path,
    change: f.kind === "new" ? "New file" : `Modified (+${f.diffStats.linesAdded} -${f.diffStats.linesRemoved})`,
  }));
}

/**
 * Generate a change summary for a proposal. Uses compact input; does not send full file contents.
 * When using grounded input, model does not output files; caller sets files from buildFileListFromGroundTruth.
 */
export async function generateProposalSummary(input: GenerateSummaryInput): Promise<ChangeSummary | null> {
  try {
    let parsed: ReturnType<typeof parseSummaryResponse>;
    let systemPrompt: string;
    let userPrompt: string;

    if (input.type === "grounded") {
      systemPrompt =
        "You output only valid JSON for a change summary. No markdown. No \"files\" key. Only mention file paths and identifiers that appear in the provided list. If uncertain, put it in risks.";
      userPrompt = buildGroundedSummaryPrompt(input.groundTruth, input.plan);
      const response = await runtimeChat(systemPrompt, userPrompt, {
        temperature: 0.2,
        max_tokens: 1024,
      });
      parsed = parseSummaryResponse(response);
      if (!parsed) return null;
      const files = buildFileListFromGroundTruth(input.groundTruth);
      return { ...parsed, files };
    }

    systemPrompt =
      "You output only valid JSON for a change summary. No markdown. No \"files\" key. Title max 80 chars. whatChanged and behaviorAfter are arrays of short bullet strings.";
    userPrompt = buildSummaryPrompt(input as GenerateSummaryInputSingle | GenerateSummaryInputMulti);
    const response = await runtimeChat(systemPrompt, userPrompt, {
      temperature: 0.2,
      max_tokens: 1024,
    });
    parsed = parseSummaryResponse(response);
    if (!parsed) return null;
    const files = parsed.files?.length ? parsed.files : [];
    return { ...parsed, files };
  } catch (e) {
    console.warn("generateProposalSummary failed:", e);
    return null;
  }
}

/** Build ground truth from proposal files (single or multi). Re-export for callers. */
export { buildProposalGroundTruth };
export type { ProposalGroundTruth, ProposalFileLike, FileGroundTruth } from "./groundTruth";
