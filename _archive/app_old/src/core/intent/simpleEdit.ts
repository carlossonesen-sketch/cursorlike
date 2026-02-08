/**
 * Simple inline edit executor for trivial patterns.
 * Used when file_edit is detected but we don't want full diff/patch.
 */

import { runtimeChat } from "../runtime/runtimeApi";

export interface GenerateFileEditOptions {
  filePath: string;
  originalContent: string;
  instructions: string;
  isNewFile: boolean;
  /** Optional run id for cancellation. */
  runId?: string;
}

export interface GenerateFileEditResult {
  proposedContent: string;
  plan: string[];
  usedModel: boolean;
}

/**
 * Generate proposed content from original + instructions.
 * Returns modified content; returns original unchanged if no pattern matched.
 */
export function generateSimpleEdit(original: string, instructions: string): string {
  const ins = instructions.trim();
  if (!ins) return original;

  const addToTopMatch = instructions.match(/(?:add|prepend|insert)\s+(.+?)\s+(?:to|at)\s+(?:the\s+)?top/i);
  if (addToTopMatch) {
    const toAdd = addToTopMatch[1].trim();
    const line = toAdd.endsWith("\n") ? toAdd : toAdd + "\n";
    return line + original;
  }

  const addToTopSimple = instructions.match(/^add\s+(.+)\s+to\s+top$/i);
  if (addToTopSimple) {
    const toAdd = addToTopSimple[1].trim();
    const line = toAdd.endsWith("\n") ? toAdd : toAdd + "\n";
    return line + original;
  }

  const prependMatch = instructions.match(/^prepend\s+(.+)$/i);
  if (prependMatch) {
    const toAdd = prependMatch[1].trim();
    const line = toAdd.endsWith("\n") ? toAdd : toAdd + "\n";
    return line + original;
  }

  return original;
}

/**
 * Check if a simple edit pattern was matched.
 */
export function isSimpleEditPatternMatched(instructions: string): boolean {
  const ins = instructions.trim();
  if (!ins) return false;
  
  const patterns = [
    /(?:add|prepend|insert)\s+(.+?)\s+(?:to|at)\s+(?:the\s+)?top/i,
    /^add\s+(.+)\s+to\s+top$/i,
    /^prepend\s+(.+)$/i,
  ];
  
  return patterns.some((p) => p.test(ins));
}

/**
 * Apply a simple edit to content based on instructions.
 * Returns modified content. Alias for generateSimpleEdit.
 */
export function applySimpleEdit(content: string, instructions: string): string {
  return generateSimpleEdit(content, instructions);
}

/**
 * Build prompt for model-based file edit generation.
 * Instructs model to output FULL file content, not a diff.
 */
function buildFileEditPrompt(opts: GenerateFileEditOptions): string {
  const { filePath, originalContent, instructions, isNewFile } = opts;
  const parts: string[] = [];
  
  parts.push("You are a coding assistant. Generate the FULL content of the file after applying the requested changes.");
  parts.push("");
  parts.push("IMPORTANT:");
  parts.push("- Output ONLY the complete file content after changes");
  parts.push("- Do NOT output a diff or patch format");
  parts.push("- Do NOT include any explanation or markdown");
  parts.push("- Start directly with the file content");
  parts.push("");
  parts.push(`File: ${filePath}`);
  parts.push(`Instructions: ${instructions}`);
  parts.push("");
  
  if (isNewFile) {
    parts.push("This is a NEW FILE. Create the content from scratch based on the instructions.");
  } else {
    parts.push("CURRENT FILE CONTENT:");
    parts.push("```");
    parts.push(originalContent || "(empty file)");
    parts.push("```");
    parts.push("");
    parts.push("Apply the changes and output the FULL updated file content:");
  }
  
  return parts.join("\n");
}

/**
 * Extract plan bullets from instructions.
 */
function extractPlanFromInstructions(instructions: string, isNewFile: boolean): string[] {
  const plan: string[] = [];
  
  if (isNewFile) {
    plan.push("Create new file");
  }
  
  // Extract verbs and what they operate on
  const verbMatches = instructions.match(/\b(add|remove|rename|change|modify|update|fix|refactor|create|implement|insert)\s+(\w+)/gi);
  if (verbMatches) {
    for (const match of verbMatches.slice(0, 5)) {
      plan.push(match.charAt(0).toUpperCase() + match.slice(1).toLowerCase());
    }
  }
  
  if (plan.length === 0) {
    plan.push("Apply requested changes");
  }
  
  return plan;
}

/**
 * Generate file content using local model.
 * Falls back to simple edit if model is unavailable.
 */
export async function generateFileEdit(opts: GenerateFileEditOptions): Promise<GenerateFileEditResult> {
  const { filePath: _filePath, originalContent, instructions, isNewFile } = opts;
  
  // First, try simple edit patterns
  if (!isNewFile && isSimpleEditPatternMatched(instructions)) {
    const proposedContent = generateSimpleEdit(originalContent, instructions);
    if (proposedContent !== originalContent) {
      return {
        proposedContent,
        plan: extractPlanFromInstructions(instructions, isNewFile),
        usedModel: false,
      };
    }
  }
  
  // Try model-based generation
  try {
    const systemPrompt = "You are a coding assistant that outputs complete file contents. Never output diffs or patches. Only output the raw file content with no extra explanation or markdown.";
    const userPrompt = buildFileEditPrompt(opts);
    
    const response = await runtimeChat(systemPrompt, userPrompt, {
      temperature: 0.2,
      max_tokens: 8192,
    }, opts.runId);
    
    // Clean up response - remove markdown code blocks if present
    let content = response.trim();
    const codeBlockMatch = content.match(/^```[\w]*\n?([\s\S]*?)```$/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1].trim();
    }
    
    // Verify we got something
    if (content.length > 0) {
      return {
        proposedContent: content,
        plan: extractPlanFromInstructions(instructions, isNewFile),
        usedModel: true,
      };
    }
  } catch (e) {
    console.warn("Model generation failed, using simple edit fallback:", e);
  }
  
  // Fallback: return original with simple edit applied (may be unchanged)
  const proposedContent = isNewFile ? `// TODO: ${instructions}\n` : generateSimpleEdit(originalContent, instructions);
  return {
    proposedContent,
    plan: extractPlanFromInstructions(instructions, isNewFile),
    usedModel: false,
  };
}
