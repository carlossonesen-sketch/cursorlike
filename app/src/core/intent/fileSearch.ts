/**
 * Auto-search for likely target file(s) when user has edit intent but no file named.
 * Uses keyword extraction + filename heuristics; prefers runner, index, main, send, email, ses, provider, etc.
 * Optional CancellationToken: each searchFilesByName call is raced with token.whenCancelled so Stop aborts quickly.
 */

import type { CancellationToken } from "../runManager/runManager";
import { raceWithCancel } from "../runManager/runManager";

const STOP_WORDS = new Set(
  "a an the to of in on at by for with from as is was are were be been being have has had do does did will would could should may might must can need dare ought used".split(" ")
);

/** Filename stems we prefer when they match (e.g. runner, index, main, send, ses, provider). */
export const PREFERRED_FILENAME_STEMS = new Set([
  "runner", "index", "main", "send", "email", "ses", "provider", "mailbox", "throttle",
  "config", "app", "server", "client", "handler", "service", "api", "util", "lib",
]);

/** Extract searchable keywords from message. Splits on spaces and underscores (e.g. "DRY_RUN" -> "dry", "run"). */
export function extractSearchKeywords(message: string): string[] {
  const t = message.trim().toLowerCase();
  const rawWords = t.split(/\s+/).filter((w) => w.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of rawWords) {
    const clean = w.replace(/[^\w.-]/g, "");
    const parts = clean.split("_").filter((p) => p.length >= 2 && !STOP_WORDS.has(p));
    if (parts.length === 0 && clean.length >= 2 && !STOP_WORDS.has(clean)) parts.push(clean);
    for (const p of parts) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out.slice(0, 10);
}

export interface SearchCandidate {
  path: string;
  confidence: number;
}

function filenameStem(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

/**
 * Search for the most likely file(s) for an edit request.
 * Prefers files named runner, index, main, send, email, ses, provider, mailbox, throttle, etc.
 * Returns up to 5 candidates sorted by confidence (0..1). Strong candidates get higher confidence.
 * If runId + token are provided, each search is raced with cancellation so Stop aborts within ~1s.
 */
export async function searchFilesForEdit(
  message: string,
  workspaceRoot: string,
  searchFilesByName: (workspaceRoot: string, fileName: string) => Promise<string[]>,
  fileList?: string[],
  runId?: string,
  token?: CancellationToken
): Promise<SearchCandidate[]> {
  const keywords = extractSearchKeywords(message);
  const pathScores = new Map<string, number>();

  const addScore = (path: string, delta: number) => {
    pathScores.set(path, (pathScores.get(path) ?? 0) + delta);
  };

  for (const kw of keywords) {
    const searchPromise = searchFilesByName(workspaceRoot, kw);
    const list =
      runId && token
        ? await raceWithCancel(runId, token, searchPromise)
        : await searchPromise;
    for (const p of list) {
      const pathLower = p.toLowerCase();
      const name = pathLower.split(/[/\\]/).pop() ?? "";
      const stem = filenameStem(p);
      if (name.includes(kw)) addScore(p, 1.0);
      else if (stem === kw) addScore(p, 1.0);
      else addScore(p, 0.5);
    }
  }

  if (fileList && keywords.length > 0) {
    for (const p of fileList) {
      const pathLower = p.toLowerCase();
      let matches = 0;
      for (const kw of keywords) {
        if (pathLower.includes(kw)) matches++;
      }
      if (matches > 0) addScore(p, matches * 0.6);
    }
  }

  // Boost preferred filename stems (runner, index, main, send, email, ses, provider, ...)
  for (const [path] of pathScores.entries()) {
    const stem = filenameStem(path);
    if (PREFERRED_FILENAME_STEMS.has(stem)) {
      addScore(path, 0.8);
    }
  }

  const sorted = [...pathScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxScore = sorted[0]?.[1] ?? 1;
  const candidates: SearchCandidate[] = sorted.map(([path, score]) => ({
    path,
    confidence: Math.min(1, score / Math.max(2, maxScore)),
  }));
  if (candidates.length > 0 && maxScore >= 2) {
    candidates[0].confidence = Math.min(1, 0.5 + (maxScore - 1) * 0.25);
  }
  return candidates;
}

/** Confidence threshold above which we auto-proceed with single-file edit. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;
