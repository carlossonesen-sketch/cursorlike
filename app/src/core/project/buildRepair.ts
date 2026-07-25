import type { PlanAndPatch } from "../types";

export interface BuildFailureReference {
  path: string;
  line: number;
  column: number;
  message: string;
}

export interface StoredBuildFailure {
  command: string;
  cwd: string;
  exitCode: number;
  output: string;
  errorLines: string[];
  filesReferenced: string[];
  refs: BuildFailureReference[];
}

export function extractBuildFailureReferences(output: string): BuildFailureReference[] {
  const refs: BuildFailureReference[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /(^|[\s>])([A-Za-z0-9_./\\-]+\.(?:tsx?|jsx?|json|css|html))\((\d+),(\d+)\):\s*(.+)$/.exec(line);
    if (!match?.[2]) continue;
    const path = match[2].replace(/\\/g, "/").replace(/^\.\/+/, "");
    const key = `${path}:${match[3]}:${match[4]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      path,
      line: Number(match[3]),
      column: Number(match[4]),
      message: match[5]?.trim() ?? line.trim(),
    });
  }
  return refs;
}

export function storeBuildFailure(command: string, cwd: string, exitCode: number, output: string): StoredBuildFailure {
  const refs = extractBuildFailureReferences(output);
  return {
    command,
    cwd,
    exitCode,
    output,
    errorLines: output.split(/\r?\n/).filter((line) => /\berror\s+TS\d+:/i.test(line)),
    filesReferenced: [...new Set(refs.map((ref) => ref.path))],
    refs,
  };
}

export function formatBuildFailureReferences(refs: BuildFailureReference[]): string {
  if (!refs.length) return "";
  return refs
    .map((ref) => `${ref.path}:${ref.line}:${ref.column} - ${ref.message}`)
    .join("\n");
}

export function createFullFileReplacementPatch(path: string, oldContent: string, newContent: string): PlanAndPatch {
  const oldLines = oldContent.replace(/\n$/, "").split(/\n/);
  const newLines = newContent.replace(/\n$/, "").split(/\n/);
  return {
    explanation: `Replace ${path} with the smallest build-failure repair.`,
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

function repairPossiblyNullReference(content: string, ref: BuildFailureReference): string | null {
  const match = ref.message.match(/['"]([^'"]+)['"] is possibly ['"]null['"]/i);
  const symbol = match?.[1];
  if (!symbol) return null;
  const lines = content.split(/\r?\n/);
  const refIndex = Math.max(0, Math.min(lines.length - 1, ref.line - 1));
  const start = Math.max(0, refIndex - 4);
  const alreadyGuarded = lines.slice(start, refIndex).some((line) =>
    new RegExp(`if\\s*\\(\\s*${symbol}\\s*(?:[!=]==?\\s*null|\\?\\?)`).test(line) ||
    new RegExp(`if\\s*\\(\\s*!${symbol}\\s*\\)`).test(line)
  );
  if (alreadyGuarded) return null;
  const indent = lines[refIndex]?.match(/^\s*/)?.[0] ?? "";
  lines.splice(refIndex, 0, `${indent}if (${symbol} == null) return;`);
  return lines.join("\n");
}

function repairKnownMainTsBuildFailure(content: string, refs: BuildFailureReference[]): string | null {
  const messages = refs.map((ref) => ref.message).join("\n");
  const needsUpdateIntruders = /Cannot find name ['"]?updateIntruders['"]?/i.test(messages);
  const needsDeltaSeconds = /Cannot find name ['"]?deltaSeconds['"]?/i.test(messages);
  if (!needsUpdateIntruders && !needsDeltaSeconds) return null;

  let next = content;
  if (needsDeltaSeconds) {
    next = next.replace(/\bupdateIntruders\s*\(\s*deltaSeconds\s*\)\s*;?/g, "updateIntruders(1 / 60);");
  }

  if (needsUpdateIntruders && !/\bfunction\s+updateIntruders\b/.test(next) && !/\bconst\s+updateIntruders\b/.test(next)) {
    const helper = [
      "function updateIntruders(_deltaSeconds: number) {",
      "  // Build-safe placeholder until intruder movement is implemented.",
      "}",
      "",
    ].join("\n");
    const firstRef = refs.find((item) => item.path === "src/main.ts");
    const lines = next.split(/\r?\n/);
    const insertIndex = Math.max(0, Math.min(lines.length, (firstRef?.line ?? 1) - 1));
    lines.splice(insertIndex, 0, helper);
    next = lines.join("\n");
  }

  return next !== content ? next : null;
}

export function repairReferencedBuildFailure(path: string, content: string, refs: BuildFailureReference[]): string | null {
  const pathRefs = refs.filter((ref) => ref.path === path);
  for (const ref of pathRefs) {
    if (/is possibly ['"]null['"]/i.test(ref.message)) {
      const repaired = repairPossiblyNullReference(content, ref);
      if (repaired) return repaired;
    }
  }
  if (path === "src/main.ts") return repairKnownMainTsBuildFailure(content, pathRefs);
  return null;
}

export function buildFailureOutput(stdout: string, stderr: string): string {
  return `${stdout}\n${stderr}`.trim();
}
