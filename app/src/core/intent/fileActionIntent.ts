/**
 * File action intent classifier (pure logic, no fs).
 * Used by router to prioritize file_open/file_edit over generic chat.
 */

import { extractFileMentions } from "../workspace/readProjectFile";

export type FileActionIntentType = "file_open" | "file_edit" | "file_read" | "none";

export interface FileTarget {
  path: string;
  confidence: number;
}

export interface FileActionIntent {
  intentType: FileActionIntentType;
  targets: FileTarget[];
  instructions: string;
}

/** Just open/view/show/display — no read-only question. */
const OPEN_VERBS = /\b(open|show|view|display)\b/i;
/** Read-only: summarize, explain, describe, etc. */
const READ_VERBS = /\b(summarize|summarise|explain|read|describe|outline)\b|tell\s+me|what\s+does/i;
const EDIT_VERBS = /\b(edit|change|modify|update|fix|add|remove|delete|replace|rename|move|prepend|append)\b/i;
/** User explicitly said read-only: force file_read, never file_edit. */
const READ_ONLY_PHRASES = /\b(do not edit|don't edit|no edits|do not change|don't change|read only|read-only)\b/i;
/** Allow simple code/file hints like "open worker", "read queue", "explain the workspace file". */
const SIMPLE_FILE_HINT = /^(open|show|view|display|read|summarize|summarise|explain|describe)\s+(?:the\s+)?([a-z0-9._\-\/\\]+)(?:\s+file)?\s*$/i;

/** Prefer concrete path (with / or extension), then bare name. */
export function pickBestFileTarget(mentions: string[]): string {
  if (mentions.length === 0) return "";
  const withSlash = mentions.find((m) => m.includes("/") || m.includes("\\"));
  if (withSlash) return withSlash;
  const withExt = mentions.find((m) => /\.([a-z0-9]{1,6})$/i.test(m));
  if (withExt) return withExt;
  return mentions[0];
}

/** Remove only "open/show/view/display [the] <path>" fragments; do not strip path from rest of message. */
function stripOpenFileFragment(message: string, filePath: string): string {
  const t = message.trim();
  if (!filePath) return t;
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(?:open|show|view|display)\\s+(?:the\\s+)?${escaped}\\b`, "gi");
  return t.replace(re, "").replace(/\s+/g, " ").trim();
}

/** Extract edit instruction portion from message (text after "and" or file reference). */
function extractInstructions(message: string, primaryPath: string): string {
  const t = message.trim();
  const pathLower = primaryPath.toLowerCase();

  const andMatch = t.match(/\band\s+(.+)$/i);
  if (andMatch) return andMatch[1].trim();

  const inFileMatch = t.match(/in\s+[^\s]+\s+(.+)$/i);
  if (inFileMatch) return inFileMatch[1].trim();

  const addToTop = t.match(/(?:add|prepend|insert)\s+(.+?)\s+(?:to|at)\s+(?:the\s+)?top/i);
  if (addToTop) return `add to top: ${addToTop[1].trim()}`;

  return t.replace(new RegExp(pathLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
}

/**
 * Classify file action intent from user message.
 * Pure logic; does not verify file existence.
 */
export function classifyFileActionIntent(
  message: string,
  _context?: { currentOpenFilePath?: string }
): FileActionIntent {
  const t = message.trim();
  if (!t) {
    return { intentType: "none", targets: [], instructions: "" };
  }

  let mentions = extractFileMentions(t);

  // Fallback for simple non-path prompts like "Open worker"
  if (mentions.length === 0) {
    const simple = t.match(SIMPLE_FILE_HINT);
    if (simple && simple[2]) {
      mentions = [simple[2].trim()];
    }
  }

  if (mentions.length === 0) {
    return { intentType: "none", targets: [], instructions: "" };
  }

  const primaryPath = pickBestFileTarget(mentions);
  const targets: FileTarget[] = [{ path: primaryPath, confidence: 1 }];

  const hasOpen = OPEN_VERBS.test(t);
  const hasRead = READ_VERBS.test(t);
  const hasReadOnlyPhrase = READ_ONLY_PHRASES.test(t);
  const hasEdit = EDIT_VERBS.test(t) && !hasReadOnlyPhrase;

  if (hasReadOnlyPhrase) {
    return {
      intentType: "file_read",
      targets,
      instructions: stripOpenFileFragment(t, primaryPath) || t,
    };
  }

  if (hasEdit) {
    return {
      intentType: "file_edit",
      targets,
      instructions: extractInstructions(t, primaryPath),
    };
  }

  if (hasRead) {
    const instructions = stripOpenFileFragment(t, primaryPath) || t;
    return {
      intentType: "file_read",
      targets,
      instructions,
    };
  }

  if (hasOpen) {
    const extra = extractInstructions(t, primaryPath).trim();
    const onlyOpenVerb = extra === "" || /^\s*(open|show|view|display)\s*$/i.test(extra);
    if (extra.length > 0 && !onlyOpenVerb) {
      return {
        intentType: "file_read",
        targets,
        instructions: stripOpenFileFragment(t, primaryPath) || extra,
      };
    }
    return {
      intentType: "file_open",
      targets,
      instructions: "",
    };
  }

  if (mentions.length > 0) {
    return {
      intentType: "file_read",
      targets,
      instructions: stripOpenFileFragment(t, primaryPath) || t,
    };
  }

  return { intentType: "none", targets: [], instructions: "" };
}
