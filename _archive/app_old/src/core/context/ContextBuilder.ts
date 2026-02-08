/**
 * ContextBuilder: build model context from selected + suggested files.
 * Optionally include retrieved knowledge chunks (role-based limits).
 */

import type { ModelContext, ProjectManifest, KnowledgeChunkRef, ProjectSnapshot } from "../types";
import type { WorkspaceService } from "../workspace/WorkspaceService";
import type { KnowledgeStore } from "../knowledge/KnowledgeStore";

const KNOWLEDGE_LIMIT_PLANNER = 5;
const KNOWLEDGE_LIMIT_CODER = 8;
const KNOWLEDGE_LIMIT_REVIEWER = 5;

export type AgentRoleForKnowledge = "planner" | "coder" | "reviewer";

export interface BuildOptions {
  suggestedPaths?: string[];
  useKnowledge?: boolean;
  knowledgeStore?: KnowledgeStore | null;
  agentRole?: AgentRoleForKnowledge;
  /** When set, a PROJECT SNAPSHOT section is added to context for all agents. */
  projectSnapshot?: ProjectSnapshot | null;
  /** Packs to filter knowledge retrieval (chunk tags). */
  enabledPacks?: string[];
}

export class ContextBuilder {
  constructor(
    private workspace: WorkspaceService,
    private manifest: ProjectManifest | null
  ) {}

  /** Build context for model. Optionally include retrieved knowledge (role-based limits). */
  async build(
    prompt: string,
    selectedPaths: string[],
    suggestedPathsOrOptions?: string[] | BuildOptions
  ): Promise<ModelContext> {
    const options: BuildOptions =
      Array.isArray(suggestedPathsOrOptions)
        ? { suggestedPaths: suggestedPathsOrOptions }
        : suggestedPathsOrOptions ?? {};
    const { suggestedPaths, useKnowledge, knowledgeStore, agentRole, projectSnapshot, enabledPacks } = options;

    const read = async (path: string) => {
      try {
        const content = await this.workspace.readFile(path);
        return { path: this.workspace.normalizeRel(path), content };
      } catch {
        return null;
      }
    };

    const selected = (
      await Promise.all(selectedPaths.map((p) => read(p)))
    ).filter(Boolean) as { path: string; content: string }[];

    let suggested: { path: string; content: string }[] | undefined;
    const suggestedList = suggestedPaths ?? options.suggestedPaths;
    if (suggestedList?.length) {
      suggested = (
        await Promise.all(suggestedList.map((p) => read(p)))
      ).filter(Boolean) as { path: string; content: string }[];
    }

    let manifestSummary: string | undefined;
    if (this.manifest) {
      manifestSummary = [
        `Types: ${this.manifest.projectTypes.join(", ")}`,
        `Config: ${this.manifest.configFiles.slice(0, 10).join(", ")}`,
        `Lock: ${this.manifest.lockfiles.join(", ")}`,
        `Files (sample): ${this.manifest.fileList.slice(0, 50).join(", ")}`,
      ].join("\n");
    }
    if (projectSnapshot) {
      const snapshotLines = [
        "=== PROJECT SNAPSHOT ===",
        `Types: ${projectSnapshot.detectedTypes.join(", ") || "(none)"}`,
        `Packs: ${projectSnapshot.enabledPacks.join(", ") || "(none)"}`,
        "Commands: " + [
          projectSnapshot.detectedCommands.dev && `dev=${projectSnapshot.detectedCommands.dev}`,
          projectSnapshot.detectedCommands.build && `build=${projectSnapshot.detectedCommands.build}`,
          projectSnapshot.detectedCommands.test && `test=${projectSnapshot.detectedCommands.test}`,
          projectSnapshot.detectedCommands.lint && `lint=${projectSnapshot.detectedCommands.lint}`,
        ].filter(Boolean).join("; ") || "(none)",
        `Important files: ${projectSnapshot.importantFiles.slice(0, 20).join(", ")}`,
      ].join("\n");
      manifestSummary = manifestSummary
        ? `${manifestSummary}\n\n${snapshotLines}`
        : snapshotLines;
    }

    let knowledgeChunks: KnowledgeChunkRef[] | undefined;
    if (useKnowledge && knowledgeStore && enabledPacks && enabledPacks.length > 0) {
      const limit =
        agentRole === "planner"
          ? KNOWLEDGE_LIMIT_PLANNER
          : agentRole === "reviewer"
            ? KNOWLEDGE_LIMIT_REVIEWER
            : KNOWLEDGE_LIMIT_CODER;
      await knowledgeStore.ingestIfNeeded();
      const retrieved = await knowledgeStore.retrieve(prompt, {
        limit,
        enabledPacks,
      });
      knowledgeChunks = retrieved.map((c) => ({
        title: c.title,
        sourcePath: c.sourcePath,
        chunkText: c.chunkText,
      }));
    }

    return {
      prompt,
      selectedFiles: selected,
      suggestedFiles: suggested?.length ? suggested : undefined,
      manifestSummary,
      knowledgeChunks: knowledgeChunks?.length ? knowledgeChunks : undefined,
    };
  }
}
