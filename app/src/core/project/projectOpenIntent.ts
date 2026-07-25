import type { KnownProject } from "../types";

export interface ProjectOpenIntent {
  query: string;
}

export type ProjectOpenMatch =
  | { status: "none"; query: string }
  | { status: "single"; query: string; project: KnownProject }
  | { status: "multiple"; query: string; projects: KnownProject[] };

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function compact(value: string): string {
  return normalize(value).replace(/\s+/g, "");
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "-");
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 0; i < a.length; i += 1) {
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

function looksLikeFileOrPath(query: string): boolean {
  return /[\\/]/.test(query) || /\.[a-z0-9]{1,8}$/i.test(query.trim());
}

export function detectProjectOpenIntent(prompt: string): ProjectOpenIntent | null {
  const text = prompt.trim();
  const match = /^(?:let'?s\s+)?(?:work\s+on|open)\s+(.+?)\s*$/i.exec(text);
  const query = match?.[1]?.replace(/[.?!]+$/g, "").trim();
  if (!query || looksLikeFileOrPath(query)) return null;
  return { query };
}

function projectTerms(project: KnownProject): string[] {
  return [
    project.name,
    ...project.aliases,
    slug(project.name),
    slug(basename(project.path)),
    basename(project.path),
  ].filter((term): term is string => Boolean(term?.trim()));
}

function scoreProject(query: string, project: KnownProject): number {
  const q = normalize(query);
  const qc = compact(query);
  let best = 0;
  for (const term of projectTerms(project)) {
    const t = normalize(term);
    const tc = compact(term);
    if (q === t || qc === tc) best = Math.max(best, 100);
    else if (t.startsWith(q) || q.startsWith(t) || t.includes(q) || q.includes(t)) best = Math.max(best, 75);
    else {
      const distance = levenshtein(qc, tc);
      const threshold = Math.max(1, Math.floor(Math.min(qc.length, tc.length) / 4));
      if (distance <= threshold) best = Math.max(best, 60 - distance);
    }
  }
  return best;
}

export function resolveProjectOpenMatch(query: string, projects: KnownProject[]): ProjectOpenMatch {
  const scored = projects
    .filter((project) => !project.archived)
    .map((project) => ({ project, score: scoreProject(query, project) }))
    .filter((entry) => entry.score >= 50)
    .sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name));
  if (!scored.length) return { status: "none", query };
  const topScore = scored[0].score;
  const top = scored.filter((entry) => entry.score >= topScore - 8);
  if (top.length === 1) return { status: "single", query, project: top[0].project };
  return { status: "multiple", query, projects: top.map((entry) => entry.project) };
}
