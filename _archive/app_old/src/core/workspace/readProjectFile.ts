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
  "env", ".env", ".env.example", "package json", "main script",
]);

/** Plain-English aliases -> canonical hint for resolution (readProjectFile will try candidates). */
export const FILE_ALIASES: Record<string, string[]> = {
  readme: ["README.md", "readme.md", "README", "readme"],
  license: ["LICENSE", "LICENSE.md", "license", "license.md"],
  env: [".env.example", ".env", "env"],
  "package json": ["package.json"],
  "main script": ["src/index.ts", "index.ts", "src/main.ts", "main.ts", "src/index.js", "index.js", "src/main.js", "main.js"],
};

/** Canonical file names that should be detected even without extension. */
const BARE_FILE_PATTERN = /\b(readme|license|changelog|contributing|makefile|dockerfile|package\.json|tsconfig\.json|cargo\.toml|env)\b/i;

const HAS_EXTENSION = /\.([a-z0-9]{1,6})$/i;

function normPath(s: string): string | null {
  const p = s.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (p.includes("..") || p.length > 250) return null;
  return p || null;
}

/** Candidate is valid only if path-like, has extension, or is allowed bare; never a verb. */
function isValidFileCandidate(raw: string): boolean {
  const n = normPath(raw);
  if (!n) return false;
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
    let n = normPath(raw);
    if (!n) return;
    const lower = n.toLowerCase().replace(/\s+/g, " ");
    if (lower === "package json") n = "package.json";
    if (isValidFileCandidate(n)) hints.add(n);
  };

  const lower = t.toLowerCase();

  // PRIORITY 1: "Open the file: X" / "open the file: X" (deterministic OPEN)
  const openTheFileMatch = t.match(/\bopen\s+the\s+file\s*:\s*([^\s,]+)/i);
  if (openTheFileMatch?.[1]) add(openTheFileMatch[1].trim());

  // "open the main script" -> best match (e.g. src/index.ts)
  if (/\bopen\s+(?:the\s+)?main\s+script\b/i.test(t)) add("main script");

  // PRIORITY 2: "Edit X: ..." / "Edit README.md: add section" (path before colon)
  const editPathColonMatch = t.match(/\bedit\s+([^\s:]+(?:\.[a-z0-9]{1,6})?)\s*:\s*/i);
  if (editPathColonMatch?.[1]) add(editPathColonMatch[1].trim());

  // PRIORITY 3: "to the readme", "add X to the readme", "in the readme" (plain-English EDIT)
  const toTheFileRe = /(?:to|in)\s+(?:the\s+)?(readme|license|changelog|contributing|package\s*json|env)\b/gi;
  let toMatch: RegExpExecArray | null;
  while ((toMatch = toTheFileRe.exec(t)) !== null) {
    const name = (toMatch[1] || "").trim().toLowerCase().replace(/\s+/, " ");
    if (name === "package json") add("package.json");
    else if (name) add(name);
  }

  // PRIORITY 4: Detect bare file names anywhere in the message (readme, license, etc.)
  const bareMatch = BARE_FILE_PATTERN.exec(lower);
  if (bareMatch) {
    add(bareMatch[1]);
  }

  // PRIORITY 5: "Open: X" explicit syntax (no "the file")
  if (/open\s*:\s*([^\s]+)/.test(lower)) {
    const m = t.match(/open\s*:\s*([^\s]+)/i);
    if (m?.[1]) add(m[1]);
  }

  // PRIORITY 6: Backtick-quoted paths
  t.replace(/`([^`]+)`/g, (_, path) => {
    add(path);
    return "";
  });

  // PRIORITY 7: Paths with slashes
  const pathWithSlash = /[a-zA-Z0-9_.-]+[\/\\][a-zA-Z0-9/\\_.-]+/g;
  let pm: RegExpExecArray | null;
  while ((pm = pathWithSlash.exec(t)) !== null) if (pm[0]) add(pm[0]);

  // PRIORITY 8: Tokens with file extensions
  const withExtension = /\b([a-zA-Z0-9_.-]+\.[a-z0-9]{1,6})\b/gi;
  while ((pm = withExtension.exec(t)) !== null) if (pm[1]) add(pm[1]);

  // PRIORITY 9: Phrase patterns like "open X", "show me X", "read the readme", "in X add Y"
  const phraseRe = /(?:show\s+me|open|read|display|what'?s?\s+in)\s+(?:the\s+)?([^\s?,]+)|in\s+([^\s]+)\s+(?:add|remove|change|fix|update)/gi;
  let phraseMatch: RegExpExecArray | null;
  while ((phraseMatch = phraseRe.exec(t)) !== null) {
    const captured = phraseMatch[1] ?? phraseMatch[2];
    if (captured) add(captured.trim());
  }

  // PRIORITY 10: "X and add/remove/change Y" pattern - file followed by edit verb
  const fileAndEditRe = /\b([a-zA-Z0-9_.-]+)\s+and\s+(?:add|insert|remove|delete|change|update|replace|prepend|append)\b/gi;
  while ((phraseMatch = fileAndEditRe.exec(t)) !== null) {
    const captured = phraseMatch[1];
    if (captured) add(captured.trim());
  }

  // Fallback: entire prompt is a single path-like token
  if (hints.size === 0 && /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\s*$/.test(t)) add(t.trim());
  if (hints.size === 0 && ALLOWED_BARE_FILENAMES.has(lower)) add(t.trim());

  let result = [...hints];
  // Prefer path with extension when same file (e.g. keep README.md, drop readme)
  result = result.filter((p) => {
    if (!p.includes(".")) {
      const stem = p.toLowerCase();
      if (result.some((q) => q.includes(".") && q.replace(/\.[^.]+$/, "").toLowerCase() === stem))
        return false;
    }
    return true;
  });
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

function isExactMatch(relPath: string, hint: string): boolean {
  const name = (relPath.split(/[/\\]/).pop() ?? "").toLowerCase();
  const stem = (name.replace(/\.[^.]+$/, "") || name).toLowerCase();
  const hintLower = hint.toLowerCase().trim();
  const hintStem = (hintLower.replace(/\.[^.]+$/, "") || hintLower).toLowerCase();
  return name === hintLower || stem === hintStem || name === hintStem;
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
  const lower = normalized.toLowerCase().replace(/\s+/g, " ");
  if (FILE_ALIASES[lower]) {
    candidates.push(...FILE_ALIASES[lower]);
  } else if (normalized.includes("/") || HAS_EXTENSION.test(normalized) || normalized.startsWith(".")) {
    candidates.push(normalized);
  } else {
    if (lower === "readme" || lower === "readme.md") {
      candidates.push(...README_CANDIDATES);
    } else if (lower === "env") {
      candidates.push(".env.example", ".env", "env");
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
      const list = await searchFiles(workspaceRoot, hint);
      if (list.length === 0) {
        return { path: normalized.includes("/") ? normalized : hint, error: "not found" };
      }
      if (list.length === 1) {
        const content = await readFile(list[0]);
        return { path: list[0], content };
      }
      const exactMatches = list.filter((p) => isExactMatch(p, hint));
      if (exactMatches.length === 1) {
        const content = await readFile(exactMatches[0]);
        return { path: exactMatches[0], content };
      }
      return { path: hint, error: "multiple", candidates: list };
    } catch {
      /* fall through to not found */
    }
  }

  const displayName = normalized.includes("/") ? normalized : hint;
  return { path: displayName, error: "not found" };
}
