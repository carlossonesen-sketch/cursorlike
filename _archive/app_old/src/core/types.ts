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
  typecheck?: string;
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

/** Dev mode: Fast = no verify after apply, Safe = verify after apply. */
export type DevMode = "fast" | "safe";

/** Workspace settings stored at .devassistant/settings.json */
export interface WorkspaceSettings {
  autoPacksEnabled: boolean;
  enabledPacks: string[];
  /** Fast Dev (default) or Safe Dev (verify after apply). */
  devMode?: DevMode;
  /** ToolRoot-relative path to GGUF (e.g. models/foo.gguf) for provider=local. */
  modelPath?: string;
  /** Port for llama-server (default 8080, overridable by env LLAMA_PORT). */
  port?: number;
  /** Live pane open state (persisted per workspace). */
  livePaneOpen?: boolean;
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
  /** Optional run id for cancellation; passed to backend so runtime_cancel_run can abort in-flight request. */
  runId?: string;
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
  /** Optional incremental edit plan used for step-by-step preview/apply. */
  editPlan?: import("./patch/EditPlan").EditPlan;
  /** True when diff was built from direct file edit (model did not return valid unified diff). */
  fallbackDiff?: boolean;
  /** True when patch was capped for display (use full patch for apply). */
  partialDiff?: boolean;
  /** Capped patch for display when partialDiff (max 400 lines / 25k chars). */
  cappedPatch?: string;
}

/** Confidence of grounded summary after validation. */
export type SummaryConfidence = "high" | "medium" | "low";

/** Human-readable change summary for a proposal (single or multi). */
export interface ChangeSummary {
  title: string;
  whatChanged: string[];
  behaviorAfter: string[];
  files: Array<{ path: string; change: string }>;
  risks?: string[];
  /** Set by validator: high = most bullets unchanged, medium = some rewrites, low = heavy cleanup or fallback. */
  confidence?: SummaryConfidence;
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

