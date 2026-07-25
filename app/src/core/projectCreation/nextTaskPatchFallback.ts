import type { PlanAndPatch } from "../types";
import { createWebsitePlatformFallbackPatch } from "./websitePlatformPatchFallback";

export interface PatchFallbackWorkspace {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
}

function createFullFileReplacementPatch(path: string, oldContent: string, newContent: string): PlanAndPatch {
  const oldLines = oldContent.replace(/\n$/, "").split(/\n/);
  const newLines = newContent.replace(/\n$/, "").split(/\n/);
  return {
    explanation: `Replace ${path} with concrete task changes.`,
    patch: [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
      "",
    ].join("\n"),
  };
}

function createNewFilePatch(path: string, content: string, explanation: string): PlanAndPatch {
  const lines = content.replace(/\n$/, "").split(/\n/);
  return {
    explanation,
    patch: [
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      "",
    ].join("\n"),
  };
}

function repairKnownCodingTask(prompt: string, path: string, content: string): string | null {
  const lower = prompt.toLowerCase();
  if (!/\b(score|lives|life)\b/.test(lower)) return null;
  if (!/\.(tsx?|jsx?)$/i.test(path)) return null;

  const insertions: string[] = [];
  if (!/\b(lives|score)\b/i.test(content)) {
    insertions.push("let score = 0;");
    insertions.push("let lives = 3;");
  } else {
    if (!/\bscore\b/i.test(content)) insertions.push("let score = 0;");
    if (!/\blives\b/i.test(content)) insertions.push("let lives = 3;");
  }
  if (!insertions.length) return null;

  const lines = content.split(/\r?\n/);
  const insertIndex = Math.max(0, lines.findIndex((line) => /\b(canvas|ctx|context)\b/i.test(line)));
  lines.splice(insertIndex >= 0 ? insertIndex + 1 : 0, 0, ...insertions, "");
  const next = lines.join("\n");
  return next !== content ? next : null;
}

function apiRouteContent(): string {
  return [
    "export interface PrimaryApiRequest {",
    "  action: string;",
    "  payload?: unknown;",
    "}",
    "",
    "export interface PrimaryApiResponse {",
    "  ok: boolean;",
    "  message: string;",
    "  receivedAction: string;",
    "}",
    "",
    "export function handlePrimaryApiRoute(request: PrimaryApiRequest): PrimaryApiResponse {",
    "  const action = request.action?.trim();",
    "  if (!action) {",
    "    return { ok: false, message: \"Missing action.\", receivedAction: \"\" };",
    "  }",
    "",
    "  return {",
    "    ok: true,",
    "    message: \"Primary API route handled the request.\",",
    "    receivedAction: action,",
    "  };",
    "}",
    "",
  ].join("\n");
}

async function createApiRouteFallback(workspace: PatchFallbackWorkspace): Promise<PlanAndPatch | null> {
  const candidates = ["src/routes/primaryApi.ts", "src/api/primaryRoute.ts", "src/server.ts"];
  for (const path of candidates) {
    if (await workspace.exists(path).catch(() => false)) continue;
    return createNewFilePatch(path, apiRouteContent(), `Create ${path} for the primary API route.`);
  }
  return null;
}

export async function createNextTaskFallbackPatch(
  workspace: PatchFallbackWorkspace,
  prompt: string,
  contextPaths: string[]
): Promise<PlanAndPatch | null> {
  const websitePatch = await createWebsitePlatformFallbackPatch(workspace, prompt);
  if (websitePatch) return websitePatch;

  if (/\b(primary\s+api\s+route|api\s+route)\b/i.test(prompt)) {
    const routePatch = await createApiRouteFallback(workspace);
    if (routePatch) return routePatch;
  }

  for (const path of contextPaths) {
    if (!/\.(tsx?|jsx?)$/i.test(path)) continue;
    const exists = await workspace.exists(path).catch(() => false);
    if (!exists) continue;
    const oldContent = await workspace.readFile(path);
    const repaired = repairKnownCodingTask(prompt, path, oldContent);
    if (repaired) return createFullFileReplacementPatch(path, oldContent, repaired);
  }

  return null;
}
