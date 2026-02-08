// app/src/core/patch/EditPlanEngine.ts
// Deterministic preview/apply for EditPlan steps.
// Uses WorkspaceService so all writes go through the existing Tauri command path.

import type { EditOperation, EditPlan, EditStep } from "./EditPlan";
import { normalizeRelPath } from "./EditPlan";
import type { FileSnapshot } from "../patch/PatchEngine";
import type { WorkspaceService } from "../workspace/WorkspaceService";

export interface StepPreview {
  filePath: string;
  oldText: string;
  newText: string;
}

export interface StepApplyResult {
  applied: boolean;
  filePath: string;
  error?: string;
  beforeSnapshot?: FileSnapshot;
}

function splitLines(s: string): string[] {
  return s.split(/\r?\n/);
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

function applyReplaceRange(content: string, startLine: number, endLine: number, newText: string): string {
  const lines = splitLines(content);
  const startIdx = Math.max(0, startLine - 1);
  const endExclusive = Math.min(lines.length, endLine); // endLine is inclusive, so slice end is endLine
  const newLines = splitLines(newText);
  const out = lines.slice(0, startIdx).concat(newLines).concat(lines.slice(endExclusive));
  return joinLines(out);
}

function applySearchAndReplace(content: string, search: string, replace: string, all?: boolean): string {
  if (!search) return content;
  if (!content.includes(search)) {
    // Guard: deterministic failure by throwing so caller can stop.
    throw new Error(`search_and_replace: search string not found`);
  }
  if (all) return content.split(search).join(replace);
  const idx = content.indexOf(search);
  return content.slice(0, idx) + replace + content.slice(idx + search.length);
}

export function applyOperations(content: string, operations: EditOperation[]): string {
  let out = content ?? "";
  for (const op of operations) {
    switch (op.kind) {
      case "prepend":
        out = op.newText + (out ? "\n" + out : "");
        break;
      case "append":
        out = (out ? out + "\n" : "") + op.newText;
        break;
      case "replace_range":
        out = applyReplaceRange(out, op.startLine, op.endLine, op.newText);
        break;
      case "search_and_replace":
        out = applySearchAndReplace(out, op.search, op.replace, op.all);
        break;
      default: {
        const _exhaustive: never = op;
        void _exhaustive;
        return out;
      }
    }
  }
  return out;
}

export class EditPlanEngine {
  constructor(
    private workspace: WorkspaceService,
    private workspaceRoot: string,
    private getFileContent: (relPath: string) => Promise<string>
  ) {}

  /** Preview a single step without writing. Throws on deterministic guard failures. */
  async previewStep(step: EditStep): Promise<StepPreview> {
    const filePath = normalizeRelPath(step.filePath);

    let oldText = "";
    try {
      oldText = await this.getFileContent(filePath);
    } catch {
      oldText = "";
    }

    if (step.operation === "delete") {
      return { filePath, oldText, newText: "" };
    }

    // create/modify use operations
    const newText = applyOperations(oldText, step.operations);
    return { filePath, oldText, newText };
  }

  /** Apply a single step. Stops on error (caller should stop sequencing). */
  async applyStep(step: EditStep): Promise<StepApplyResult> {
    const filePath = normalizeRelPath(step.filePath);

    let oldText = "";
    try {
      oldText = await this.getFileContent(filePath);
    } catch {
      oldText = "";
    }

    const beforeSnapshot: FileSnapshot = { path: filePath, content: oldText };

    try {
      if (step.operation === "delete") {
        // Delete through workspace service
        await this.workspace.deleteFile(this.workspaceRoot, filePath);
        return { applied: true, filePath, beforeSnapshot };
      }

      const newText = applyOperations(oldText, step.operations);

      // create/modify both write
      await this.workspace.writeFile(this.workspaceRoot, filePath, newText);
      return { applied: true, filePath, beforeSnapshot };
    } catch (e) {
      return { applied: false, filePath, error: String(e), beforeSnapshot };
    }
  }

  /** Apply a plan sequentially; stops on first failure. */
  async applyPlan(plan: EditPlan): Promise<{
    applied: string[];
    failed?: { filePath: string; error: string };
    beforeSnapshots: FileSnapshot[];
  }> {
    const applied: string[] = [];
    const beforeSnapshots: FileSnapshot[] = [];

    for (const step of plan.steps) {
      const r = await this.applyStep(step);
      if (r.beforeSnapshot) beforeSnapshots.push(r.beforeSnapshot);

      if (!r.applied) {
        return {
          applied,
          failed: { filePath: r.filePath, error: r.error ?? "unknown" },
          beforeSnapshots,
        };
      }

      applied.push(r.filePath);
    }

    return { applied, beforeSnapshots };
  }
}
