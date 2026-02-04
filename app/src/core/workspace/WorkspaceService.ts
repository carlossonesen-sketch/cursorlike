import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DirEntry, FileTreeNode } from "../types";

const HARD_IGNORES = new Set([
  "node_modules", "dist", "build", "out", ".git", ".next", ".nuxt",
  "target", "bin", "obj", ".devassistant",
]);
const MAX_TREE_DEPTH = 20;
const NO_WORKSPACE = "Open a workspace first.";

export class WorkspaceService {
  async getGlobalToolRoot(): Promise<string> {
    return await invoke<string>("get_global_tool_root");
  }

  /** Create runtime/llama and models under global tool root. Returns the root path. */
  async ensureGlobalToolDirs(): Promise<string> {
    return await invoke<string>("ensure_global_tool_dirs");
  }

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

  async writeFile(workspaceRoot: string, relPath: string, content: string): Promise<void> {
    await invoke("write_project_file", {
      workspaceRoot,
      relativePath: relPath,
      content,
    });
  }

  /** Delete a file under workspace root. No-op if missing. Does not delete directories. */
  async deleteFile(workspaceRoot: string, relPath: string): Promise<void> {
    await invoke("delete_project_file", {
      workspaceRoot,
      relativePath: relPath,
    });
  }

  /** Resolve relative path under workspace root; returns absolute path. */
  async resolvePath(workspaceRoot: string, relPath: string): Promise<string> {
    return invoke<string>("workspace_resolve_path", {
      workspaceRoot,
      path: relPath,
    });
  }

  /** File size in bytes for a path under workspace root. */
  async getFileSize(workspaceRoot: string, relPath: string): Promise<number> {
    return invoke<number>("workspace_file_size", {
      workspaceRoot,
      path: relPath,
    });
  }

  /** Search files by name under workspace root. Returns relative paths (max 20). */
  async searchFilesByName(workspaceRoot: string, fileName: string): Promise<string[]> {
    const result = await invoke<string[]>("workspace_search_files_by_name", {
      workspaceRoot,
      fileName: fileName.trim(),
    });
    return Array.isArray(result) ? result : [];
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

  /** Run a system command (prereq check, install). No workspace required. */
  async runSystemCommand(command: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    return invoke<{ exitCode: number; stdout: string; stderr: string }>(
      "run_system_command",
      { command }
    );
  }

  /** Download a file from URL to path (must be under global tool root). No shell; avoids URL parsing issues. */
  async downloadFileToPath(url: string, outputPath: string): Promise<{ bytesWritten: number }> {
    return invoke<{ bytesWritten: number }>("download_file_to_path", { url, outputPath });
  }

  /** Run a command in the workspace directory. Returns exit code, stdout, stderr. */
  async runCommand(workspaceRoot: string, command: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const result = await invoke<{ exitCode: number; stdout: string; stderr: string }>(
      "workspace_run_command",
      { workspaceRoot, command }
    );
    return result;
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
