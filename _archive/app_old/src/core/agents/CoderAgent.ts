/**
 * CoderAgent: explanation + unified diff patch. ONLY agent that produces a patch.
 * Uses ModelGateway (MockModelProvider); pluggable for Ollama/llama.cpp later.
 */

import type { ModelContext, PlanAndPatch } from "../types";
import { generatePlanAndPatch } from "../model/ModelGateway";

export interface ICoderAgent {
  run(plan: string | null, context: ModelContext, targetFiles?: string[]): Promise<PlanAndPatch>;
}

export class CoderAgent implements ICoderAgent {
  async run(
    plan: string | null,
    context: ModelContext,
    targetFiles?: string[]
  ): Promise<PlanAndPatch> {
    const ctx: ModelContext = {
      ...context,
      plan: plan ?? undefined,
      targetFiles: plan && targetFiles?.length ? targetFiles : undefined,
    };
    return generatePlanAndPatch(ctx);
  }
}
