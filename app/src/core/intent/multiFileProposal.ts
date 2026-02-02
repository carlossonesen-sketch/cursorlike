/**
 * Multi-file proposal generation.
 * LLM outputs JSON matching MultiFileProposal structure.
 */

import { runtimeChat } from "../runtime/runtimeApi";
import type { ChangeSummary } from "../types";

export interface ProposedFileChange {
  path: string;
  exists: boolean;
  originalContent: string;
  proposedContent: string;
  summary: string;
}

export interface MultiFileProposal {
  id: string;
  createdAt: number;
  plan: string[];
  files: ProposedFileChange[];
  summary?: ChangeSummary | null;
}

/** Default JSON schema for LLM output. */
const JSON_SCHEMA = `{
  "plan": ["string"],
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "exists": true,
      "originalContent": "full file content or empty string",
      "proposedContent": "full proposed file content",
      "summary": "1-2 line description of changes"
    }
  ]
}`;

/**
 * Build prompt for multi-file proposal generation.
 */
function buildMultiFilePrompt(
  userPrompt: string,
  contextFiles: { path: string; content: string }[],
  manifestSummary?: string
): string {
  const parts: string[] = [];
  parts.push("You are a coding assistant. The user has requested changes across multiple files.");
  parts.push("");
  parts.push("IMPORTANT RULES:");
  parts.push("- Output ONLY valid JSON. No prose, no markdown, no code blocks.");
  parts.push("- The JSON must match this exact structure:");
  parts.push(JSON_SCHEMA);
  parts.push("- For each file: include the FULL proposedContent (entire file text). No partial snippets.");
  parts.push("- For new files: exists=false, originalContent=\"\".");
  parts.push("- For existing files: exists=true, originalContent must contain current content.");
  parts.push("- If you cannot confidently generate full file content, reduce scope and propose fewer files.");
  parts.push("- plan: 3-10 bullet points describing the overall approach.");
  parts.push("- summary per file: 1-2 lines describing what changed.");
  parts.push("");
  parts.push("User request: " + userPrompt);
  parts.push("");
  
  if (contextFiles.length > 0) {
    parts.push("Context files (current content):");
    for (const f of contextFiles) {
      parts.push("");
      parts.push("--- " + f.path + " ---");
      parts.push(f.content || "(empty)");
    }
    parts.push("");
  }
  
  if (manifestSummary) {
    parts.push("Project context: " + manifestSummary.slice(0, 600));
    parts.push("");
  }
  
  parts.push("Output the JSON object only:");
  return parts.join("\n");
}

/**
 * Parse LLM response into MultiFileProposal.
 * Handles common LLM output quirks (markdown code blocks, trailing commas).
 */
export function parseMultiFileProposal(raw: string): MultiFileProposal | null {
  let jsonStr = raw.trim();
  
  // Strip markdown code block if present
  const codeBlockMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)```$/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  
  // Remove trailing commas before ] or }
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");
  
  try {
    const parsed = JSON.parse(jsonStr) as { plan?: string[]; files?: unknown[] };
    
    if (!parsed.files || !Array.isArray(parsed.files)) {
      return null;
    }
    
    const plan: string[] = Array.isArray(parsed.plan)
      ? parsed.plan.filter((p): p is string => typeof p === "string").slice(0, 10)
      : [];
    
    const files: ProposedFileChange[] = [];
    for (const f of parsed.files) {
      const obj = f as Record<string, unknown>;
      if (typeof obj.path !== "string") continue;
      
      const path = obj.path.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      const exists = obj.exists === true;
      const originalContent = typeof obj.originalContent === "string" ? obj.originalContent : "";
      const proposedContent = typeof obj.proposedContent === "string" ? obj.proposedContent : "";
      const summary = typeof obj.summary === "string" ? obj.summary : "Changes applied";
      
      files.push({ path, exists, originalContent, proposedContent, summary });
    }
    
    if (files.length === 0) return null;
    
    return {
      id: `mfp-${Date.now()}`,
      createdAt: Date.now(),
      plan,
      files,
    };
  } catch {
    return null;
  }
}

export interface GenerateMultiFileProposalOptions {
  userPrompt: string;
  contextFiles: { path: string; content: string }[];
  manifestSummary?: string;
}

/**
 * Generate multi-file proposal via LLM.
 * Returns parsed MultiFileProposal or null on failure.
 */
export async function generateMultiFileProposal(
  opts: GenerateMultiFileProposalOptions
): Promise<MultiFileProposal | null> {
  const systemPrompt =
    "You are a coding assistant. Output ONLY valid JSON. No explanation, no markdown. The JSON must have 'plan' (array of strings) and 'files' (array of {path, exists, originalContent, proposedContent, summary}).";
  
  const userPrompt = buildMultiFilePrompt(
    opts.userPrompt,
    opts.contextFiles,
    opts.manifestSummary
  );
  
  try {
    const response = await runtimeChat(systemPrompt, userPrompt, {
      temperature: 0.2,
      max_tokens: 16384,
    });
    
    return parseMultiFileProposal(response);
  } catch (e) {
    console.error("generateMultiFileProposal failed:", e);
    return null;
  }
}
