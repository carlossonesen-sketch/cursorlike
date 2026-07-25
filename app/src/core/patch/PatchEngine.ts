/**
 * PatchEngine: parse unified diff, validate paths, apply, revert via snapshots.
 */

import * as diff from "diff";
import { invoke } from "@tauri-apps/api/core";

type TauriInvoke = typeof invoke;

export interface FileSnapshot {
  path: string;
  content: string;
  existed?: boolean;
}

export interface ApplyResult {
  applied: string[];
  failed: { path: string; error: string }[];
  beforeSnapshots: FileSnapshot[];
}

function validatePath(_root: string, path: string): boolean {
  const n = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (n.includes("..") || n.startsWith("/")) return false;
  return true;
}

export function pathsFromPatch(patch: string): string[] {
  const out = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const m = /^[-+]{3}\s+(?:[ab]\/(.+)|\/dev\/null)$/.exec(line);
    if (m?.[1]) out.add(m[1].replace(/\\/g, "/"));
  }
  return [...out];
}

export function selectPatchFiles(patch: string, selectedPaths: string[]): string {
  const selected = new Set(selectedPaths.map((path) => path.replace(/\\/g, "/")));
  return [...patchChunksByFile(patch)]
    .filter(([path]) => selected.has(path))
    .map(([, chunk]) => chunk)
    .join("\n");
}

function patchChunksByFile(patch: string): Map<string, string> {
  const map = new Map<string, string>();
  const chunks = patch.split(/\r?\n(?=---\s+(?:[ab]\/|\/dev\/null))/);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    const m = /---\s+(?:a\/(.+)|\/dev\/null)\r?\n\+\+\+\s+(?:b\/(.+)|\/dev\/null)\r?\n([\s\S]*)/.exec(trimmed);
    if (!m) continue;
    const path = (m[2] ?? m[1])?.replace(/\\/g, "/");
    if (path) map.set(path, trimmed.slice(m.index));
  }
  if (map.size === 0 && patch.trim()) {
    const m = /---\s+(?:a\/(.+)|\/dev\/null)\r?\n\+\+\+\s+(?:b\/(.+)|\/dev\/null)\r?\n([\s\S]*)/.exec(patch);
    const path = (m?.[2] ?? m?.[1])?.replace(/\\/g, "/");
    if (path && m) map.set(path, patch.trim().slice(m.index));
  }
  return map;
}

function deletedPathsFromPatch(patch: string): Set<string> {
  const paths = new Set<string>();
  const pattern = /---\s+a\/(.+)\r?\n\+\+\+\s+\/dev\/null(?:\r?\n|$)/g;
  for (const match of patch.matchAll(pattern)) {
    if (match[1]) paths.add(match[1].replace(/\\/g, "/"));
  }
  return paths;
}

import { validatePatchContent } from "./patchDuplicateGuard";

function validateStructuredContent(path: string, content: string): string | null {
  if (/\.json$/i.test(path)) {
    try {
      const parsed = JSON.parse(content);
      if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") {
        return "JSON root value must be an object";
      }
    } catch (e) {
      return `invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return null;
}

export class PatchEngine {
  constructor(
    private workspaceRoot: string,
    private getFileContent: (relPath: string) => Promise<string>,
    private invokeCommand: TauriInvoke = invoke
  ) {}

  validatePatch(patch: string): { valid: boolean; paths: string[]; error?: string } {
    const paths = pathsFromPatch(patch);
    for (const p of paths) {
      if (!validatePath(this.workspaceRoot, p))
        return { valid: false, paths, error: `Path escapes workspace: ${p}` };
    }
    return { valid: true, paths };
  }

  async preview(patch: string): Promise<Map<string, { old: string; new: string }>> {
    const out = new Map<string, { old: string; new: string }>();
    const byFile = patchChunksByFile(patch);
    for (const [path, chunk] of byFile) {
      let oldContent = "";
      try {
        oldContent = await this.getFileContent(path);
      } catch {
        /* new file */
      }
      const newContent = diff.applyPatch(oldContent, chunk, { fuzzFactor: 0 });
      if (newContent === false) continue;
      out.set(path, { old: oldContent, new: newContent as string });
    }
    return out;
  }

  async apply(patch: string): Promise<ApplyResult> {
    const { valid, error } = this.validatePatch(patch);
    if (!valid) {
      return {
        applied: [],
        failed: [{ path: "(patch)", error: error ?? "invalid" }],
        beforeSnapshots: [],
      };
    }
    const previewMap = await this.preview(patch);
    const applied: string[] = [];
    const failed: { path: string; error: string }[] = [];
    const beforeSnapshots: FileSnapshot[] = [];
    const expectedPaths = pathsFromPatch(patch);
    const deletedPaths = deletedPathsFromPatch(patch);

    for (const path of expectedPaths) {
      if (!previewMap.has(path)) {
        failed.push({ path, error: "patch did not produce a writable file preview" });
      }
    }

    for (const [path, { old: oldContent, new: content }] of previewMap) {
      let existed = true;
      try {
        await this.getFileContent(path);
      } catch {
        existed = false;
      }
      beforeSnapshots.push({ path, content: oldContent, existed });
      try {
        const validationError =
          validateStructuredContent(path, content) ?? validatePatchContent(path, oldContent, content);
        if (validationError) {
          throw new Error(validationError);
        }
        if (deletedPaths.has(path)) {
          await this.invokeCommand("workspace_delete_file", {
            workspaceRoot: this.workspaceRoot,
            path,
          });
          try {
            await this.getFileContent(path);
            throw new Error("disk verification failed after delete");
          } catch (error) {
            if (String(error).includes("disk verification failed")) throw error;
          }
        } else {
          await this.invokeCommand("workspace_write_file", {
            workspaceRoot: this.workspaceRoot,
            path,
            content,
          });
          const diskContent = await this.getFileContent(path);
          if (diskContent !== content) {
            throw new Error("disk verification failed after write");
          }
        }
        applied.push(path);
      } catch (e) {
        failed.push({ path, error: String(e) });
      }
    }
    return { applied, failed, beforeSnapshots };
  }

  async revert(snapshots: FileSnapshot[]): Promise<ApplyResult> {
    const applied: string[] = [];
    const failed: { path: string; error: string }[] = [];
    for (const { path, content, existed } of snapshots) {
      if (!validatePath(this.workspaceRoot, path)) {
        failed.push({ path, error: "path escapes workspace" });
        continue;
      }
      try {
        if (existed === false) {
          await this.invokeCommand("workspace_delete_file", {
            workspaceRoot: this.workspaceRoot,
            path,
          });
        } else {
          await this.invokeCommand("workspace_write_file", {
            workspaceRoot: this.workspaceRoot,
            path,
            content,
          });
        }
        applied.push(path);
      } catch (e) {
        failed.push({ path, error: String(e) });
      }
    }
    return { applied, failed, beforeSnapshots: [] };
  }
}
