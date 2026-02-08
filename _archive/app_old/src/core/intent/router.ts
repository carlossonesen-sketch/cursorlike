/**
 * Message router: prioritizes file actions over generic chat.
 * OPEN bypasses proposal; single-file EDIT never goes to multi_file_edit.
 */

import { classifyFileActionIntent } from "./fileActionIntent";

export type RouteDecision =
  | { action: "file_open"; targetPath: string }
  | { action: "file_edit"; targets: string[]; instructions: string }
  | { action: "file_edit_auto_search"; instructions: string }
  | { action: "multi_file_edit"; instructions: string; targetHints?: string[] }
  | { action: "chat" };

export type RouteContext = { activeFilePath?: string; currentOpenFilePath?: string; workspaceRoot?: string };

/** Phrases that imply changes across multiple files. */
const MULTI_FILE_INDICATORS = [
  /\b(across|both|multiple|several)\s+(files?|modules?|parts?)\b/i,
  /\b(backend|frontend|ui|api)\s*(and|\+)\s*(backend|frontend|ui|api)\b/i,
  /\b(add|create|wire)\s+(endpoint|route|api)\s+(and|then)\s+(wire|connect|update)\s+(ui|frontend)\b/i,
  /\b(add\s+.*\s+and\s+wire\s+it\s+into)/i,
  /\b(update|refactor)\s+.*\s+across\b/i,
];

/**
 * Check if prompt implies multiple file changes.
 */
export function impliesMultiFile(prompt: string): boolean {
  const t = prompt.trim();
  return MULTI_FILE_INDICATORS.some((pat) => pat.test(t));
}

/**
 * Route user message. Must be called before any chat/patch generation.
 * - OPEN intent -> file_open only (bypass proposal).
 * - EDIT intent with explicit path(s) -> file_edit with targetFiles (single-file never multi_file_edit).
 * - multi_file_edit only when multiple paths or prompt implies multi-file (and no single-file EDIT).
 */
export function routeUserMessage(message: string, context?: RouteContext): RouteDecision {
  const intent = classifyFileActionIntent(message, context);
  const extractedFiles = intent.targets.map((t) => t.path);

  // Debug: every request
  console.log("MESSAGE_ROUTING intent", {
    detectedIntent: intent.intentType,
    extractedFiles,
    instructions: intent.instructions || "(none)",
  });

  // Edit intent but no file mentioned -> auto-search for likely file(s)
  if (intent.intentType === "file_edit_search") {
    const route: RouteDecision = { action: "file_edit_auto_search", instructions: intent.instructions };
    console.log("MESSAGE_ROUTING chosenRoute: file_edit_auto_search", "instructions:", route.instructions.slice(0, 60));
    return route;
  }

  if (intent.intentType === "none") {
    if (!impliesMultiFile(message)) {
      console.log("MESSAGE_ROUTING chosenRoute: chat (no file intent)");
      return { action: "chat" };
    }
    // Implies multi but no paths -> multi_file_edit so LLM can propose
    const route: RouteDecision = {
      action: "multi_file_edit",
      instructions: message.trim(),
      targetHints: undefined,
    };
    console.log("MESSAGE_ROUTING chosenRoute:", route.action, "targetHints:", route.targetHints);
    return route;
  }

  const hasMultiplePaths = extractedFiles.length > 1;
  const impliesMulti = impliesMultiFile(message);

  // OPEN: always file_open, bypass proposal entirely
  if (intent.intentType === "file_open" && extractedFiles.length > 0) {
    const route: RouteDecision = { action: "file_open", targetPath: extractedFiles[0] };
    console.log("MESSAGE_ROUTING chosenRoute: file_open", "targetPath:", route.targetPath);
    return route;
  }

  // EDIT with explicit path(s): file_edit with targetFiles (never multi_file_edit for single file)
  if (intent.intentType === "file_edit" && extractedFiles.length > 0) {
    if (hasMultiplePaths) {
      const route: RouteDecision = {
        action: "multi_file_edit",
        instructions: intent.instructions || message,
        targetHints: extractedFiles,
      };
      console.log("MESSAGE_ROUTING chosenRoute: multi_file_edit (multiple paths)", "targetHints:", route.targetHints);
      return route;
    }
    const route: RouteDecision = {
      action: "file_edit",
      targets: extractedFiles,
      instructions: intent.instructions,
    };
    console.log("MESSAGE_ROUTING chosenRoute: file_edit", "targets:", route.targets);
    return route;
  }

  // Implies multi-file but no explicit paths (e.g. "Update the code that selects GGUF...") -> multi_file_edit or chat
  if (impliesMulti) {
    const route: RouteDecision = {
      action: "multi_file_edit",
      instructions: intent.instructions || message,
      targetHints: extractedFiles.length > 0 ? extractedFiles : undefined,
    };
    console.log("MESSAGE_ROUTING chosenRoute: multi_file_edit (implies multi)", "targetHints:", route.targetHints);
    return route;
  }

  console.log("MESSAGE_ROUTING chosenRoute: chat");
  return { action: "chat" };
}
