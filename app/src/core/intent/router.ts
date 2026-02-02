/**
 * Message router: prioritizes file actions over generic chat.
 */

import {
  classifyFileActionIntent,
  type FileActionIntent,
  type FileActionIntentType,
} from "./fileActionIntent";

export type RouteDecision =
  | { action: "file_open"; targetPath: string }
  | { action: "file_edit"; targets: string[]; instructions: string }
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
 * Pass context.currentOpenFilePath when a file is open for "this file" / "here" references.
 */
export function routeUserMessage(message: string, context?: RouteContext): RouteDecision {
  const intent = classifyFileActionIntent(message, context);
  const hasEditVerb = intent.intentType === "file_edit" || intent.intentType === "file_open";

  // Multi-file: explicit multiple paths OR ambiguous prompt implying multiple files
  const hasMultiplePaths = intent.targets.length > 1;
  const impliesMulti = impliesMultiFile(message);

  if (intent.intentType === "none" && !impliesMulti) {
    console.log("router: no file intent, fallback to chat");
    return { action: "chat" };
  }

  const paths = intent.targets.map((t) => t.path);
  console.log("router:", intent.intentType, "targets:", paths, "instructions:", intent.instructions || "(none)");

  // Multi-file edit: multiple paths OR (implies multi-file AND has edit verb)
  if (hasEditVerb && (hasMultiplePaths || (impliesMulti && paths.length >= 0))) {
    if (impliesMulti || hasMultiplePaths) {
      return {
        action: "multi_file_edit",
        instructions: intent.instructions || message,
        targetHints: paths.length > 0 ? paths : undefined,
      };
    }
  }

  if (intent.intentType === "file_edit") {
    return {
      action: "file_edit",
      targets: paths,
      instructions: intent.instructions,
    };
  }

  if (paths.length > 0) {
    return {
      action: "file_open",
      targetPath: paths[0],
    };
  }

  // Multi-file with no explicit paths: only if edit verb present (else chat)
  if (impliesMulti && hasEditVerb) {
    return {
      action: "multi_file_edit",
      instructions: intent.instructions || message,
      targetHints: paths.length > 0 ? paths : undefined,
    };
  }

  return { action: "chat" };
}
