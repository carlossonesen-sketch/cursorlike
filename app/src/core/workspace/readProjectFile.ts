/**
 * File-intent helper: detect "show me the readme" style prompts and read project files.
 * Read-only, project root only; no shell, execution, or edits.
 */

const EDIT_INTENT_WORDS = /\b(change|update|add|remove|fix|refactor|edit|modify)\b/i;

/** True if the prompt suggests editing/changing a file (e.g. "change X", "fix Y"). */
export function hasEditIntent(prompt: string): boolean {
  return EDIT_INTENT_WORDS.test(prompt.trim());
}

const DIFF_REQUEST_WORDS = /\b(propose|proposal|diff|patch|unified\s*diff|create\s*a?\s*diff|generate\s*a?\s*patch)\b/i;

/** True ONLY if user explicitly requests a diff/patch/proposal. */
export function hasDiffRequest(prompt: string): boolean {
  return DIFF_REQUEST_WORDS.test(prompt.trim());
}

/** Edit verbs that indicate file modification intent. */
const FILE_EDIT_VERBS = /\b(add|insert|remove|delete|change|update|replace|rename|move|prepend|append)\b/i;

/**
 * Determines if the message should be routed to file editor workflow.
 * Returns { route: "file", hint: string } if file workflow, or { route: "chat" } otherwise.
 */
export function routeMessage(prompt: string): { route: "file"; hint: string } | { route: "chat" } {
  const mentions = extractFileMentions(prompt);
  if (mentions.length > 0) {
    // File mention found - route to file workflow regardless of edit intent
    return { route: "file", hint: mentions[0] };
  }
  // No file mention - route to general chat
  return { route: "chat" };
}

/**
 * Check if message has file edit intent (for UI hints, not routing).
 */
export function hasFileEditIntent(prompt: string): boolean {
  return FILE_EDIT_VERBS.test(prompt.trim());
}

const FILE_VERBS = new Set<string>([
  "show", "open", "edit", "change", "fix", "update", "add", "remove", "explain", "summarize", "read", "display",
]);

const ALLOWED_BARE_FILENAMES = new Set<string>([
  "readme", "readme.md", "license", "license.md", "package.json", "tsconfig.json", "cargo.toml",
  "changelog", "changelog.md", "contributing", "contributing.md", "makefile", "dockerfile",
]);

/** Canonical file names that should be detected even without extension. */
const BARE_FILE_PATTERN = /\b(readme|license|changelog|contributing|makefile|dockerfile|package\.json|tsconfig\.json|cargo\.toml)\b/i;

const HAS_EXTENSION = /\.([a-z0-9]{1,6})$/i;

function normPath(s: string): string | null {
  const p = s.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (p.includes("..") || p.length > 250) return null;
  return p || null;
}

/** Candidate is valid only if path-like, has extension, or is allowed bare; never a verb or project directory. */
function isLikelyProjectDirectory(raw: string): boolean {
  const n = normPath(raw);
  if (!n) return false;
  const lower = n.toLowerCase();
  if (/^[a-z]:[\\/]/.test(lower)) return true;
  if (/(?:^|\/)(?:nf-projects|projects)(?:\/|$)/.test(lower) && !HAS_EXTENSION.test(n)) return true;
  const segments = lower.split("/").filter(Boolean);
  return !HAS_EXTENSION.test(n) && segments.length >= 2 && !segments.some((segment) => segment.includes("."));
}

function isValidFileCandidate(raw: string): boolean {
  const n = normPath(raw);
  if (!n) return false;
  if (isLikelyProjectDirectory(n)) return false;
  const lower = n.toLowerCase();
  if (FILE_VERBS.has(lower)) return false;
  if (n.includes("/") || n.includes("\\")) return true;
  if (HAS_EXTENSION.test(n)) return true;
  if (ALLOWED_BARE_FILENAMES.has(lower)) return true;
  return false;
}

/**
 * Extract file references from a message. Only returns candidates that:
 * A) Look like a path (contain / or \), or
 * B) Have an extension (e.g. .tsx, .md), or
 * C) Are allowed bare names: README, LICENSE, package.json, tsconfig.json, Cargo.toml.
 * Verbs (show, open, fix, etc.) are never returned.
 */
export function extractFileMentions(prompt: string): string[] {
  const t = prompt.trim();
  if (!t) return [];
  const hints = new Set<string>();

  const add = (raw: string) => {
    const n = normPath(raw);
    if (n && isValidFileCandidate(n)) hints.add(n);
  };

  const lower = t.toLowerCase();

  // PRIORITY 1: Detect bare file names anywhere in the message (readme, license, etc.)
  const bareMatch = BARE_FILE_PATTERN.exec(lower);
  if (bareMatch) {
    add(bareMatch[1]);
  }

  // PRIORITY 2: "Open: X" explicit syntax
  if (/open\s*:\s*([^\s]+)/.test(lower)) {
    const m = t.match(/open\s*:\s*([^\s]+)/i);
    if (m?.[1]) add(m[1]);
  }

  // PRIORITY 3: Backtick-quoted paths
  t.replace(/`([^`]+)`/g, (_, path) => {
    add(path);
    return "";
  });

  // PRIORITY 4: Paths with slashes
  const pathWithSlash = /[a-zA-Z0-9_.-]+[\/\\][a-zA-Z0-9/\\_.-]+/g;
  let pm: RegExpExecArray | null;
  while ((pm = pathWithSlash.exec(t)) !== null) if (pm[0]) add(pm[0]);

  // PRIORITY 5: Tokens with file extensions
  const withExtension = /\b([a-zA-Z0-9_.-]+\.[a-z0-9]{1,6})\b/gi;
  while ((pm = withExtension.exec(t)) !== null) if (pm[1]) add(pm[1]);

  // PRIORITY 6: Phrase patterns like "open X", "show me X", "in X add Y"
  const phraseRe = /(?:show\s+me|open|read|display|what'?s?\s+in)\s+(?:the\s+)?([^\s?,]+)|in\s+([^\s]+)\s+(?:add|remove|change|fix|update)/gi;
  let phraseMatch: RegExpExecArray | null;
  while ((phraseMatch = phraseRe.exec(t)) !== null) {
    const captured = phraseMatch[1] ?? phraseMatch[2];
    if (captured) add(captured.trim());
  }

  // PRIORITY 7: "X and add/remove/change Y" pattern - file followed by edit verb
  const fileAndEditRe = /\b([a-zA-Z0-9_.-]+)\s+and\s+(?:add|insert|remove|delete|change|update|replace|prepend|append)\b/gi;
  while ((phraseMatch = fileAndEditRe.exec(t)) !== null) {
    const captured = phraseMatch[1];
    if (captured) add(captured.trim());
  }

  // Fallback: entire prompt is a single path-like token
  if (hints.size === 0 && /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\s*$/.test(t)) add(t.trim());
  if (hints.size === 0 && ALLOWED_BARE_FILENAMES.has(lower)) add(t.trim());

  const result = [...hints];
  if (result.length > 0) console.log("fileMentionsDetected:", result);
  return result;
}

/** Extract a single file hint (first from extractFileMentions, or getRequestedFileHint). */
export function getRequestedFileHint(prompt: string): string | null {
  const mentions = extractFileMentions(prompt);
  if (mentions.length > 0) return mentions[0];
  const t = prompt.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const match = lower.match(
    /(?:show\s+me\s+the|open|read|display|what'?s?\s+in)\s+(?:the\s+)?([^\s?]+)|^([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*)\s*$/
  );
  const hint = match ? (match[1] ?? match[2] ?? "").trim() : null;
  if (!hint || hint.length > 200) return null;
  if (hint.includes("..")) return null;
  return hint.replace(/\\/g, "/").replace(/^\/+/, "");
}

const README_CANDIDATES = ["README.md", "readme.md", "README", "Readme.md", "readme"];

function normalizePath(hint: string): string | null {
  const p = hint.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (p.includes("..") || p.length > 300) return null;
  return p || null;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function typoThreshold(value: string): number {
  if (value.length <= 4) return 1;
  if (value.length <= 8) return 2;
  return 3;
}

function sortByPreference(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const aSegments = a.split("/").length;
    const bSegments = b.split("/").length;
    return aSegments - bSegments || a.length - b.length || a.localeCompare(b);
  });
}

function pickUniqueByTier(paths: string[], hint: string): string | string[] | null {
  const normalizedHint = hint.replace(/\\/g, "/").replace(/^\/+/, "");
  const hintLower = normalizedHint.toLowerCase();
  const hintName = basename(normalizedHint);
  const hintNameLower = hintName.toLowerCase();
  const hintStemLower = stem(hintNameLower);

  const tiers: Array<(path: string) => boolean> = [
    // 1. Exact path.
    (path) => path === normalizedHint,
    // 2. Exact filename.
    (path) => basename(path) === hintName,
    // 3. Case-insensitive path or filename match.
    (path) => path.toLowerCase() === hintLower || basename(path).toLowerCase() === hintNameLower,
    // 4. Partial path match.
    (path) => path.toLowerCase().includes(hintLower),
    // 5. Fuzzy filename/stem match.
    (path) => {
      const name = basename(path).toLowerCase();
      const fileStem = stem(name);
      return name.includes(hintNameLower) || fileStem.includes(hintStemLower) || hintNameLower.includes(fileStem);
    },
    // 6. Levenshtein distance for minor typos.
    (path) => {
      const name = basename(path).toLowerCase();
      const fileStem = stem(name);
      const threshold = typoThreshold(hintStemLower);
      return levenshtein(name, hintNameLower) <= threshold || levenshtein(fileStem, hintStemLower) <= threshold;
    },
  ];

  for (const tier of tiers) {
    const matches = sortByPreference(paths.filter(tier));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return matches;
  }
  return null;
}

export type ReadProjectFileResult =
  | { path: string; content: string }
  | { path: string; error: string }
  | { path: string; error: "multiple"; candidates: string[] };

/**
 * Resolve hint to a path under project root and read the file.
 * If direct open fails or hint is fuzzy (e.g. "readme"), uses searchFiles when provided.
 * Returns { path, content }, { path, error }, or { path, error: "multiple", candidates }.
 */
export async function readProjectFile(
  workspaceRoot: string,
  hint: string,
  readFile: (relPath: string) => Promise<string>,
  exists: (relPath: string) => Promise<boolean>,
  searchFiles?: (workspaceRoot: string, fileName: string) => Promise<string[]>
): Promise<ReadProjectFileResult> {
  const normalized = normalizePath(hint);
  if (!normalized) return { path: hint, error: "not found" };

  const candidates: string[] = [];
  if (normalized.includes("/") || normalized.includes(".")) {
    candidates.push(normalized);
  } else {
    const lower = normalized.toLowerCase();
    if (lower === "readme" || lower === "readme.md") {
      candidates.push(...README_CANDIDATES);
    } else {
      candidates.push(normalized, `${normalized}.md`, `${normalized}.txt`);
    }
  }

  for (const relPath of candidates) {
    if (relPath.includes("..")) continue;
    try {
      const ok = await exists(relPath);
      if (ok) {
        const content = await readFile(relPath);
        return { path: relPath, content };
      }
    } catch {
      /* try next */
    }
  }

  if (searchFiles) {
    try {
      const searchTerms = [
        normalized,
        basename(normalized),
        stem(basename(normalized)),
        hint,
      ].filter((term) => term.trim().length > 0);
      const list = dedupePaths(
        (
          await Promise.all(
            [...new Set(searchTerms)].map((term) => searchFiles(workspaceRoot, term))
          )
        ).flat()
      );
      if (list.length === 0) {
        return { path: normalized.includes("/") ? normalized : hint, error: "not found" };
      }
      const resolved = pickUniqueByTier(list, normalized);
      if (typeof resolved === "string") {
        const content = await readFile(resolved);
        return { path: resolved, content };
      }
      if (Array.isArray(resolved)) {
        return { path: normalized, error: "multiple", candidates: resolved };
      }
    } catch {
      /* fall through to not found */
    }
  }

  const displayName = normalized.includes("/") ? normalized : hint;
  return { path: displayName, error: "not found" };
}

