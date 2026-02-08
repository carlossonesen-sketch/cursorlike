/**
 * PlannerAgent: plan + target files. NO patch.
 * Mock implementation; pluggable for Ollama/llama.cpp later.
 */

import type { ModelContext } from "../types";
import type { PlannerOutput } from "../types";

export interface IPlannerAgent {
  run(prompt: string, context: ModelContext): Promise<PlannerOutput>;
}

/** Deterministic mock. */
export class MockPlannerAgent implements IPlannerAgent {
  async run(prompt: string, context: ModelContext): Promise<PlannerOutput> {
    const paths = context.selectedFiles.map((f) => f.path);
    const plan = `[MOCK Planner] For: "${prompt.slice(0, 80)}…". Steps: (1) Inspect selected files, (2) Add or modify as needed, (3) Keep changes minimal. Target files: ${paths.join(", ") || "(none)"}.`;
    const targetFiles = paths.length ? paths : ["README.md"];
    return { plan, targetFiles };
  }
}
