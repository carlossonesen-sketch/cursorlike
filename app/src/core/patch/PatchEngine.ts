/**
 * PatchEngine: parse unified diff, validate paths, apply, revert via snapshots.
 */

import * as diff from "diff";
import { invoke } from "@tauri-apps/api/core";

export interface FileSnapshot {
  path: string;
  content: string;
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
    const m = /^[-+]{3}\s+[ab]\/(.+)$/.exec(line);
    if (m) out.add(m[1].replace(/\\/g, "/"));
  }
  return [...out];
}

function patchChunksByFile(patch: string): Map<string, string> {
  const map = new Map<string, string>();
  const chunks = patch.split(/\r?\n(?=--- [ab]\/)/);
  for (const chunk of chunks) {
    const m = /^--- [ab]\/(.+)\r?\n\+\+\+ [ab]\/(.+)\r?\n([\s\S]*)/.exec(chunk.trim());
    if (!m) continue;
    map.set(m[1].replace(/\\/g, "/"), chunk.trim());
  }
  if (map.size === 0 && patch.trim()) {
    const m = /^--- [ab]\/(.+)\r?\n\+\+\+ [ab]\/(.+)\r?\n([\s\S]*)/.exec(patch);
    if (m) map.set(m[1].replace(/\\/g, "/"), patch.trim());
  }
  return map;
}

export class PatchEngine {
  constructor(
    private workspaceRoot: string,
    private getFileContent: (relPath: string) => Promise<string>
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

    for (const [path, { old: oldContent, new: content }] of previewMap) {
      beforeSnapshots.push({ path, content: oldContent });
      try {
        await invoke("workspace_write_file", {
          workspaceRoot: this.workspaceRoot,
          path,
          content,
        });
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
    for (const { path, content } of snapshots) {
      if (!validatePath(this.workspaceRoot, path)) {
        failed.push({ path, error: "path escapes workspace" });
        continue;
      }
      try {
        await invoke("workspace_write_file", {
          workspaceRoot: this.workspaceRoot,
          path,
          content,
        });
        applied.push(path);
      } catch (e) {
        failed.push({ path, error: String(e) });
      }
    }
    return { applied, failed, beforeSnapshots: [] };
  }
}
