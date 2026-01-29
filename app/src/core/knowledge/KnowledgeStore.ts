/**
 * KnowledgeStore: local ingestion from /knowledge and keyword-based retrieval.
 * Index stored at .devassistant/knowledge_index.json. Offline, portable.
 */

import { invoke } from "@tauri-apps/api/core";
import type { FileTreeNode } from "../types";
import type {
  KnowledgeIndex,
  KnowledgeIndexChunk,
  RetrievedChunk,
} from "../types";
import type { WorkspaceService } from "../workspace/WorkspaceService";

const KNOWLEDGE_DIR = "knowledge";
const INDEX_PATH = ".devassistant/knowledge_index.json";
const MIN_CHUNK = 800;
const MAX_CHUNK = 1200;
const EXTENSIONS = new Set([".md", ".txt"]);

/** Infer tags from path: knowledge/languages/python/foo.md -> ["languages", "python"] */
function tagsFromPath(sourcePath: string): string[] {
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^knowledge\/?/i, "");
  const withoutExt = normalized.replace(/\.[^.]+$/, "");
  return withoutExt.split("/").filter(Boolean);
}

/** Simple content hash for change detection. */
function contentHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16);
}

/** Extract title from first markdown heading or filename. */
function titleFromContent(content: string, sourcePath: string): string {
  const match = content.match(/^#{1,6}\s+(.+)$/m);
  if (match) return match[1].trim();
  const base = sourcePath.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  return base || "Untitled";
}

/** Chunk content: split by headings then by size (~800-1200 chars). */
function chunkContent(content: string, sourcePath: string): { title: string; text: string }[] {
  const segments: string[] = [];
  const byHeading = content.split(/\n(?=#{1,6}\s)/);
  for (const seg of byHeading) {
    const t = seg.trim();
    if (!t) continue;
    if (t.length <= MAX_CHUNK) {
      segments.push(t);
    } else {
      const lines = t.split("\n");
      let acc = "";
      for (const line of lines) {
        if (acc.length + line.length + 1 > MAX_CHUNK && acc.length >= MIN_CHUNK) {
          segments.push(acc.trim());
          acc = line;
        } else {
          acc = acc ? acc + "\n" + line : line;
        }
      }
      if (acc.trim()) segments.push(acc.trim());
    }
  }
  return segments.map((text, i) => ({
    title: i === 0 ? titleFromContent(content, sourcePath) : titleFromContent(text, sourcePath),
    text,
  }));
}

/** Tokenize for keyword scoring (lowercase, non-word split). */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(/\W+/)
    .filter((t) => t.length > 1);
}

/** Simple keyword overlap score (TF-ish: count matches / (1 + chunk length)). */
function scoreChunk(queryTokens: string[], chunkText: string): number {
  const chunkTokens = tokenize(chunkText);
  const chunkSet = new Set(chunkTokens);
  let matches = 0;
  for (const t of queryTokens) {
    if (chunkSet.has(t)) matches += 1;
  }
  return matches / (1 + chunkTokens.length * 0.001);
}

export class KnowledgeStore {
  constructor(
    private workspaceRoot: string,
    private workspace: WorkspaceService
  ) {}

  private async ensureDir(): Promise<void> {
    try {
      await invoke("workspace_mkdir_all", {
        workspaceRoot: this.workspaceRoot,
        path: ".devassistant",
      });
    } catch {
      /* already exists */
    }
  }

  private async readIndex(): Promise<KnowledgeIndex | null> {
    try {
      const raw = await invoke<string>("workspace_read_file", {
        workspaceRoot: this.workspaceRoot,
        path: INDEX_PATH,
      });
      const data = JSON.parse(raw) as KnowledgeIndex;
      if (!data.chunks || !data.fileHashes) return null;
      return data;
    } catch {
      return null;
    }
  }

  private async writeIndex(index: KnowledgeIndex): Promise<void> {
    await this.ensureDir();
    await invoke("workspace_write_file", {
      workspaceRoot: this.workspaceRoot,
      path: INDEX_PATH,
      content: JSON.stringify(index, null, 2),
    });
  }

  /** Collect all .md/.txt paths under knowledge/. */
  private async collectPaths(): Promise<string[]> {
    const exists = await this.workspace.exists(KNOWLEDGE_DIR);
    if (!exists) return [];
    const tree = await this.workspace.readFileTree(KNOWLEDGE_DIR);
    const paths: string[] = [];
    function walk(nodes: FileTreeNode[]) {
      for (const n of nodes) {
        if (n.isDir && n.children) walk(n.children);
        else if (!n.isDir) {
          const ext = n.name.replace(/^.*\./, ".").toLowerCase();
          if (EXTENSIONS.has(ext)) paths.push(n.path);
        }
      }
    }
    walk(tree);
    return paths;
  }

  /** Rebuild index from knowledge/ and save. */
  async ingestIfNeeded(): Promise<void> {
    if (this.workspaceRoot == null || this.workspaceRoot === "") return;
    const paths = await this.collectPaths();
    const fileHashes: Record<string, string> = {};
    for (const p of paths) {
      try {
        const content = await this.workspace.readFile(p);
        fileHashes[p] = contentHash(content);
      } catch {
        /* skip unreadable */
      }
    }
    const current = await this.readIndex();
    const same =
      current &&
      Object.keys(current.fileHashes).length === Object.keys(fileHashes).length &&
      Object.entries(fileHashes).every(
        ([path, hash]) => current.fileHashes[path] === hash
      );
    if (same) return;

    const chunks: KnowledgeIndexChunk[] = [];
    const now = new Date().toISOString();
    for (const p of paths) {
      try {
        const content = await this.workspace.readFile(p);
        const hash = contentHash(content);
        const parts = chunkContent(content, p);
        const tags = tagsFromPath(p);
        parts.forEach((part, i) => {
          chunks.push({
            id: `k-${p}-${i}-${hash.slice(0, 8)}`,
            sourcePath: p,
            title: part.title,
            chunkText: part.text,
            tags,
            contentHash: hash,
            updatedAt: now,
          });
        });
      } catch {
        /* skip */
      }
    }
    await this.writeIndex({ fileHashes, chunks });
  }

  /**
   * Retrieve top N chunks by keyword overlap.
   * If enabledPacks is non-empty, only chunks whose tags intersect enabledPacks are considered.
   */
  async retrieve(
    query: string,
    options: { limit: number; enabledPacks?: string[] }
  ): Promise<RetrievedChunk[]> {
    const index = await this.readIndex();
    if (!index || index.chunks.length === 0) return [];
    let chunks = index.chunks;
    const packs = options.enabledPacks;
    if (packs?.length) {
      const packSet = new Set(packs.map((p) => p.toLowerCase()));
      chunks = chunks.filter((c) =>
        c.tags.some((t) => packSet.has(t.toLowerCase()))
      );
    }
    if (chunks.length === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return chunks.slice(0, options.limit).map((c) => ({
      title: c.title,
      sourcePath: c.sourcePath,
      chunkText: c.chunkText,
      score: 0,
    }));

    const scored = chunks.map((c) => ({
      ...c,
      score: scoreChunk(queryTokens, c.chunkText),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, options.limit).map((c) => ({
      title: c.title,
      sourcePath: c.sourcePath,
      chunkText: c.chunkText,
      score: c.score,
    }));
  }
}
