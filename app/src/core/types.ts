/** Shared types for DevAssistant core. */

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
}

export interface ProjectManifest {
  projectTypes: string[];
  configFiles: string[];
  lockfiles: string[];
  fileList: string[];
  dependencyIndicators: Record<string, string[]>;
}

/** Commands inferred from package.json scripts or common tooling defaults. */
export interface DetectedCommands {
  build?: string;
  test?: string;
  lint?: string;
  dev?: string;
}

/** Project snapshot stored at .devassistant/project_snapshot.json */
export interface ProjectSnapshot {
  detectedTypes: string[];
  recommendedPacks: string[];
  enabledPacks: string[];
  importantFiles: string[];
  detectedCommands: DetectedCommands;
  /** ISO timestamp when snapshot was generated */
  generatedAt?: string;
}

/** Model role paths (absolute or toolRoot-relative). Optional; fallback to modelPath for coder/general. */
export interface ModelRolePaths {
  coder?: string;
  general?: string;
  reviewer?: string;
  embeddings?: string;
  reranker?: string;
}

/** Workspace settings stored at .devassistant/settings.json */
export interface WorkspaceSettings {
  autoPacksEnabled: boolean;
  enabledPacks: string[];
  /** ToolRoot-relative path to GGUF (e.g. models/foo.gguf) for provider=local. Legacy; used when modelRoles not set. */
  modelPath?: string;
  /** Port for llama-server (default 11435). */
  port?: number;
  /** Per-role model paths (absolute or relative). When set, overrides modelPath for coder/general. */
  modelRoles?: ModelRolePaths;
}

export interface ModelContext {
  prompt: string;
  selectedFiles: { path: string; content: string }[];
  suggestedFiles?: { path: string; content: string }[];
  manifestSummary?: string;
  /** Set when running pipeline; Coder uses plan + targetFiles. */
  plan?: string;
  targetFiles?: string[];
  /** Retrieved knowledge chunks (title + sourcePath + chunkText). */
  knowledgeChunks?: KnowledgeChunkRef[];
}

/** One knowledge chunk reference for context (and UI display). */
export interface KnowledgeChunkRef {
  title: string;
  sourcePath: string;
  chunkText: string;
}

export interface PlanAndPatch {
  explanation: string;
  patch: string;
}

/** Planner agent output. NO patch. */
export interface PlannerOutput {
  plan: string;
  targetFiles: string[];
}

/** Reviewer agent output. NO patch. */
export interface ReviewerOutput {
  reviewNotes: string;
  recommendedChecks: string[];
}

export type AgentMode = "Coder" | "Planner" | "Reviewer";

export type SessionStatus = "proposed" | "pending" | "applied" | "reverted";

/** Check step record (Step 3 will populate). */
export interface CheckRecord {
  step: string;
  command: string;
  exitCode: number;
  outputPathRef?: string;
}

export interface TouchedFileRecord {
  path: string;
  beforeHash?: string;
  afterHash?: string;
  beforeContentRef?: string;
}

export interface SessionRecord {
  id: string;
  /** ISO timestamp; use as createdAt for display. */
  timestamp: string;
  createdAt?: string;
  status: SessionStatus;
  userPrompt: string;
  selectedContextFiles: string[];
  manifestHash?: string;
  explanation: string;
  patch: string;
  /** Touched files (paths from patch; hashes when applied). */
  filesChanged: TouchedFileRecord[];
  /** Persisted for applied sessions; used for timeline Revert. */
  beforeSnapshots?: { path: string; content: string }[];
  checks?: CheckRecord[];
}

/** Knowledge index chunk (stored in .devassistant/knowledge_index.json). */
export interface KnowledgeIndexChunk {
  id: string;
  sourcePath: string;
  title: string;
  chunkText: string;
  tags: string[];
  contentHash: string;
  updatedAt: string;
}

/** Knowledge index file shape. */
export interface KnowledgeIndex {
  fileHashes: Record<string, string>;
  chunks: KnowledgeIndexChunk[];
}

/** Retrieved chunk for API (includes score). */
export interface RetrievedChunk {
  title: string;
  sourcePath: string;
  chunkText: string;
  score: number;
}
