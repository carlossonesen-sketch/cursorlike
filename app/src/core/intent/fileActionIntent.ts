/**
 * File action intent classifier (pure logic, no fs).
 * Deterministic: OPEN / EDIT / CHAT based on explicit patterns and file mentions.
 */

import { extractFileMentions } from "../workspace/readProjectFile";

export type FileActionIntentType = "file_open" | "file_edit" | "file_edit_search" | "none";

export interface FileTarget {
  path: string;
  confidence: number;
}

export interface FileActionIntent {
  intentType: FileActionIntentType;
  targets: FileTarget[];
  instructions: string;
}

/** OPEN: open, show, view, read, or explicit "open the file: X" (plain-English) */
const OPEN_VERBS = /\b(open|show|view|read|navigate|display)\b/i;
const OPEN_THE_FILE = /\bopen\s+the\s+file\s*:/i;

/** EDIT: edit, add, change, fix, update, refactor, remove, block, guard (and related). */
const EDIT_VERBS = /\b(edit|modify|update|change|fix|refactor|add|remove|create|rename|move|replace|prepend|append|block|guard)\b/i;

/** "Find where …" + edit verb: treat as EDIT intent (find then edit). */
const FIND_WHERE_EDIT = /\bfind\s+where\b[\s\S]*\b(block|add|change|guard|fix|update|remove|edit)\b/i;
const EDIT_PATH_COLON = /\bedit\s+[^\s:]+\s*:/i;

/** Extract edit instruction portion from message (text after "and", colon, or file reference). */
function extractInstructions(message: string, primaryPath: string): string {
  const t = message.trim();
  const pathLower = primaryPath.toLowerCase();

  const andMatch = t.match(/\band\s+(.+)$/i);
  if (andMatch) return andMatch[1].trim();

  // "Edit README.md: add a section" -> "add a section"
  const editColonMatch = t.match(/\bedit\s+[^\s:]+\s*:\s*(.+)$/i);
  if (editColonMatch?.[1]) return editColonMatch[1].trim();

  const inFileMatch = t.match(/in\s+[^\s]+\s+(.+)$/i);
  if (inFileMatch) return inFileMatch[1].trim();

  const addToTop = t.match(/(?:add|prepend|insert)\s+(.+?)\s+(?:to|at)\s+(?:the\s+)?top/i);
  if (addToTop) return `add to top: ${addToTop[1].trim()}`;

  let out = t.replace(new RegExp(pathLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
  out = out.replace(/\s+to\s+the\s*$/i, "").trim();
  return out;
}

/** "This file" / "current file" / "here" reference patterns. */
const CURRENT_FILE_REF = /\b(this\s+file|current\s+file|the\s+file|here)\b/i;

/**
 * Deterministic intent classifier:
 * - OPEN if message contains open/show/view or "open the file: X" and has filename/path.
 * - EDIT if message contains edit verbs and has filename/path.
 * - CHAT otherwise.
 */
export function classifyFileActionIntent(
  message: string,
  context?: { currentOpenFilePath?: string }
): FileActionIntent {
  const t = message.trim();
  if (!t) {
    return { intentType: "none", targets: [], instructions: "" };
  }

  const mentions = extractFileMentions(t);
  let targets: FileTarget[];

  if (CURRENT_FILE_REF.test(t) && context?.currentOpenFilePath) {
    targets = [{ path: context.currentOpenFilePath, confidence: 1 }];
  } else if (mentions.length > 0) {
    targets = mentions.map((path, i) => ({
      path,
      confidence: 1 - i * 0.1,
    }));
  } else {
    // "Find where …" + edit verb -> find-then-edit (never generic advice when files exist)
    if (FIND_WHERE_EDIT.test(t)) {
      return { intentType: "file_edit_search", targets: [], instructions: t };
    }
    // Edit verb but no file mentioned -> auto-search flow
    const hasEditPhraseOnly = (EDIT_PATH_COLON.test(t) || EDIT_VERBS.test(t)) && mentions.length === 0;
    if (hasEditPhraseOnly) {
      return {
        intentType: "file_edit_search",
        targets: [],
        instructions: t,
      };
    }
    return { intentType: "none", targets: [], instructions: "" };
  }

  const hasOpenPhrase = OPEN_THE_FILE.test(t) || OPEN_VERBS.test(t);
  const hasEditPhrase = EDIT_PATH_COLON.test(t) || EDIT_VERBS.test(t);

  // Deterministic: EDIT takes precedence when both path and edit verb present
  if (hasEditPhrase && targets.length > 0) {
    return {
      intentType: "file_edit",
      targets,
      instructions: extractInstructions(t, targets[0].path),
    };
  }

  // OPEN: explicit "open the file" or open/show/view with path
  if (hasOpenPhrase && targets.length > 0) {
    return {
      intentType: "file_open",
      targets,
      instructions: "",
    };
  }

  // Paths but no open/edit verb: treat as OPEN (e.g. "readme" alone)
  if (targets.length > 0) {
    return {
      intentType: "file_open",
      targets,
      instructions: "",
    };
  }

  return { intentType: "none", targets: [], instructions: "" };
}
