/**
 * File-intent helper: detect "show me the readme" style prompts and read project files.
 * Read-only, project root only; no shell, execution, or edits.
 */

/** Extract a file hint from prompts like "show me the readme", "open README.md", "what's in README". */
export function getRequestedFileHint(prompt: string): string | null {
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

/**
 * Resolve hint to a path under project root and read the file.
 * - hint: e.g. "readme", "README.md", "src/main.ts"
 * - readFile: (relPath: string) => Promise<string>
 * - exists: (relPath: string) => Promise<boolean>
 * Returns { path, content } or { path, error } for display. Path is relative to workspace root.
 */
export async function readProjectFile(
  _workspaceRoot: string,
  hint: string,
  readFile: (relPath: string) => Promise<string>,
  exists: (relPath: string) => Promise<boolean>
): Promise<{ path: string; content: string } | { path: string; error: string }> {
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

  const displayName = normalized.includes("/") ? normalized : hint;
  return { path: displayName, error: "not found" };
}
