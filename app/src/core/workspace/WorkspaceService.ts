/**
 * Workspace service: open folder (dialog), read file tree.
 * Respects .gitignore + hard ignores. All writes go via PatchEngine.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { DirEntry, FileTreeNode } from "../types";

const HARD_IGNORES = new Set([
  "node_modules", "dist", "build", "out", ".git", ".next", ".nuxt",
  "target", "bin", "obj", ".devassistant",
]);
const MAX_TREE_DEPTH = 20;

const NO_WORKSPACE = "Open a workspace first.";

export class WorkspaceService {
  private _root: string | null = null;
  private _gitignorePatterns: string[] = [];

  get root(): string | null {
    return this._root;
  }

  /** Throws if no root; use before any workspace invoke. */
  private _ensureRoot(): string {
    if (this._root == null || this._root === "") {
      console.warn("[WorkspaceService] workspace_read_dir/read_file blocked: no workspace root.");
      throw new Error(NO_WORKSPACE);
    }
    return this._root;
  }

  async openWorkspace(): Promise<string | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open workspace folder",
    });
    if (typeof selected !== "string") return null;
    this._root = selected;
    await this._loadGitignore();
    return selected;
  }

  private async _loadGitignore(): Promise<void> {
    this._gitignorePatterns = [];
    if (!this._root) return;
    try {
      const workspaceRoot = this._ensureRoot();
      const raw = await invoke<string>("workspace_read_file", {
        workspaceRoot,
        path: ".gitignore",
      });
      this._gitignorePatterns = raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("#"));
    } catch {
      /* no .gitignore */
    }
  }

  private _ignored(name: string, path: string): boolean {
    if (HARD_IGNORES.has(name)) return true;
    for (const p of this._gitignorePatterns) {
      if (!p) continue;
      const negate = p.startsWith("!");
      const pat = negate ? p.slice(1) : p;
      if (pat.includes("/")) {
        if (path === pat || path.endsWith("/" + pat) || path.includes("/" + pat + "/"))
          return !negate;
      } else {
        if (name === pat || path.endsWith("/" + pat)) return !negate;
      }
    }
    return false;
  }

  async readDir(relPath: string): Promise<DirEntry[]> {
    const workspaceRoot = this._ensureRoot();
    const entries = await invoke<DirEntry[]>("workspace_read_dir", {
      workspaceRoot,
      path: relPath || ".",
    });
    return entries.filter((e) =>
      !this._ignored(e.name, relPath ? `${relPath}/${e.name}` : e.name)
    );
  }

  async readFileTree(relPath = "", depth = 0): Promise<FileTreeNode[]> {
    if (depth > MAX_TREE_DEPTH) return [];
    const entries = await this.readDir(relPath);
    const nodes: FileTreeNode[] = [];
    for (const e of entries) {
      const path = relPath ? `${relPath}/${e.name}` : e.name;
      const n: FileTreeNode = { name: e.name, path, isDir: e.is_dir };
      if (e.is_dir) n.children = await this.readFileTree(path, depth + 1);
      nodes.push(n);
    }
    return nodes;
  }

  async readFile(relPath: string): Promise<string> {
    const workspaceRoot = this._ensureRoot();
    return invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: relPath,
    });
  }

  async exists(relPath: string): Promise<boolean> {
    if (this._root == null || this._root === "") {
      console.warn("[WorkspaceService] workspace_exists blocked: no workspace root.");
      return false;
    }
    try {
      return await invoke<boolean>("workspace_exists", {
        workspaceRoot: this._root,
        path: relPath,
      });
    } catch {
      return false;
    }
  }

  normalizeRel(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  /** Pick multiple files for context. Returns relative paths or []. */
  async pickContextFiles(): Promise<string[]> {
    if (!this._root) {
      console.warn("[WorkspaceService] pickContextFiles blocked: no workspace root.");
      return [];
    }
    const selected = await open({
      directory: false,
      multiple: true,
      title: "Select files for context",
      defaultPath: this._root,
    });
    const arr = Array.isArray(selected) ? selected : selected ? [selected] : [];
    const root = this._root.replace(/\\/g, "/").replace(/\/+$/, "");
    const out: string[] = [];
    for (const p of arr) {
      const n = String(p).replace(/\\/g, "/");
      if (!n.startsWith(root)) continue;
      const rel = n.slice(root.length).replace(/^\/+/, "");
      if (rel) out.push(rel);
    }
    return out;
  }
}
