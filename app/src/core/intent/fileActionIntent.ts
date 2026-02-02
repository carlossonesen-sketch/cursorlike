/**
 * File action intent classifier (pure logic, no fs).
 * Used by router to prioritize file_open/file_edit over generic chat.
 */

import { extractFileMentions } from "../workspace/readProjectFile";

export type FileActionIntentType = "file_open" | "file_edit" | "none";

export interface FileTarget {
  path: string;
  confidence: number;
}

export interface FileActionIntent {
  intentType: FileActionIntentType;
  targets: FileTarget[];
  instructions: string;
}

const OPEN_VERBS = /\b(open|show|view|navigate)\b/i;
const EDIT_VERBS = /\b(edit|modify|update|change|fix|refactor|add|remove|create|rename|move)\b/i;

/** Extract edit instruction portion from message (text after "and" or file reference). */
function extractInstructions(message: string, primaryPath: string): string {
  const t = message.trim();
  const lower = t.toLowerCase();
  const pathLower = primaryPath.toLowerCase();

  const andMatch = t.match(/\band\s+(.+)$/i);
  if (andMatch) return andMatch[1].trim();

  const inFileMatch = t.match(/in\s+[^\s]+\s+(.+)$/i);
  if (inFileMatch) return inFileMatch[1].trim();

  const addToTop = t.match(/(?:add|prepend|insert)\s+(.+?)\s+(?:to|at)\s+(?:the\s+)?top/i);
  if (addToTop) return `add to top: ${addToTop[1].trim()}`;

  return t.replace(new RegExp(pathLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
}

/** "This file" / "current file" / "here" reference patterns. */
const CURRENT_FILE_REF = /\b(this\s+file|current\s+file|the\s+file|here)\b/i;

/**
 * Classify file action intent from user message.
 * Pure logic; does not verify file existence.
 * Pass currentOpenFilePath when a file is open in the editor for "this file" / "here" references.
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

  // "This file" / "here" reference: use currentOpenFilePath if available
  if (CURRENT_FILE_REF.test(t) && context?.currentOpenFilePath) {
    targets = [{ path: context.currentOpenFilePath, confidence: 1 }];
  } else if (mentions.length > 0) {
    targets = mentions.map((path, i) => ({
      path,
      confidence: 1 - i * 0.1,
    }));
  } else {
    return { intentType: "none", targets: [], instructions: "" };
  }

  const hasOpen = OPEN_VERBS.test(t);
  const hasEdit = EDIT_VERBS.test(t);

  if (hasEdit) {
    return {
      intentType: "file_edit",
      targets,
      instructions: extractInstructions(t, targets[0].path),
    };
  }

  if (hasOpen && !hasEdit) {
    return {
      intentType: "file_open",
      targets,
      instructions: "",
    };
  }

  if (targets.length > 0 && !hasEdit) {
    return {
      intentType: "file_open",
      targets,
      instructions: "",
    };
  }

  return { intentType: "none", targets: [], instructions: "" };
}
