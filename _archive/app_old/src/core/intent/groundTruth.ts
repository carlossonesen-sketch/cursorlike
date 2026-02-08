/**
 * Build deterministic "ground truth" from proposal content for grounded summaries.
 */

export interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
}

export interface FileGroundTruth {
  path: string;
  kind: "new" | "modified";
  diffStats: DiffStats;
  anchors: string[];
}

export interface ProposalGroundTruth {
  files: FileGroundTruth[];
  globalAnchors: string[];
  totals: { linesAdded: number; linesRemoved: number; fileCount: number };
}

/** Proposal file shape accepted by buildProposalGroundTruth (matches ProposedFileChange / PendingEditFile). */
export interface ProposalFileLike {
  path: string;
  exists?: boolean;
  originalContent?: string;
  proposedContent?: string;
  original?: string;
  proposed?: string;
}

const MAX_ANCHORS_PER_FILE = 12;
const MAX_GLOBAL_ANCHORS = 50;

function getOriginal(f: ProposalFileLike): string {
  return (f.originalContent ?? f.original ?? "").replace(/\r\n/g, "\n");
}

function getProposed(f: ProposalFileLike): string {
  return (f.proposedContent ?? f.proposed ?? "").replace(/\r\n/g, "\n");
}

function getKind(f: ProposalFileLike): "new" | "modified" {
  const orig = getOriginal(f);
  if (f.exists === false || orig === "") return "new";
  return "modified";
}

function diffStats(original: string, proposed: string): DiffStats {
  const a = original.split("\n");
  const b = proposed.split("\n");
  let added = 0;
  let removed = 0;
  const setB = new Set(b);
  for (const line of a) {
    if (!setB.has(line)) removed++;
  }
  const setA = new Set(a);
  for (const line of b) {
    if (!setA.has(line)) added++;
  }
  return { linesAdded: added, linesRemoved: removed };
}

/** Extract tokens that appear in changed lines (added or removed). */
function extractAnchorsFromLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (token: string) => {
    const t = token.trim();
    if (t.length < 2 || t.length > 80) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  const text = lines.join("\n");

  // Identifiers: camelCase, snake_case
  const idents = text.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b|\b[a-z][a-z0-9_]+\b|\b[A-Z][A-Z0-9_]+\b/g);
  if (idents) idents.slice(0, 5).forEach(add);

  // export function/class/const Name
  const exportedMatches = text.matchAll(/export\s+(?:async\s+)?(?:function|class|const)\s+(\w+)/g);
  for (const m of exportedMatches) {
    if (out.length >= MAX_ANCHORS_PER_FILE) break;
    add(m[1]);
  }

  // Route-like strings
  const routes = text.match(/["'`](\/api\/[^"'`]*|https?:\/\/[^"'`]*)["'`]/g);
  if (routes) routes.slice(0, 3).forEach((r) => add(r.replace(/["'`]/g, "")));

  // Env keys
  const envKeys = text.match(/\b(STRIPE_|FIREBASE_|AWS_|VITE_|NEXT_|NODE_)[A-Z0-9_]*\b/g);
  if (envKeys) envKeys.slice(0, 3).forEach(add);

  return out.slice(0, MAX_ANCHORS_PER_FILE);
}

function getChangedLines(original: string, proposed: string): string[] {
  const a = original.split("\n");
  const b = proposed.split("\n");
  const setA = new Set(a);
  const setB = new Set(b);
  const lines: string[] = [];
  for (const line of a) {
    if (!setB.has(line)) lines.push(line);
  }
  for (const line of b) {
    if (!setA.has(line)) lines.push(line);
  }
  return lines;
}

/**
 * Build ground truth from proposal files. Deterministic; no LLM.
 */
export function buildProposalGroundTruth(
  proposalFiles: ProposalFileLike[]
): ProposalGroundTruth {
  const files: FileGroundTruth[] = [];
  const allAnchors = new Set<string>();
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const f of proposalFiles) {
    const original = getOriginal(f);
    const proposed = getProposed(f);
    const kind = getKind(f);
    const stats = diffStats(original, proposed);
    totalAdded += stats.linesAdded;
    totalRemoved += stats.linesRemoved;

    const changedLines = getChangedLines(original, proposed);
    const anchors = extractAnchorsFromLines(changedLines);
    anchors.forEach((a) => allAnchors.add(a));

    files.push({
      path: f.path,
      kind,
      diffStats: stats,
      anchors,
    });
  }

  const globalAnchors = [...allAnchors].slice(0, MAX_GLOBAL_ANCHORS);

  return {
    files,
    globalAnchors,
    totals: { linesAdded: totalAdded, linesRemoved: totalRemoved, fileCount: files.length },
  };
}
