import { invoke } from "@tauri-apps/api/core";
import type { IModelProvider, ChatResponseOptions } from "../../core/model/ModelGateway";
import type { ModelContext, PlanAndPatch } from "../../core/types";

function getModel(model?: string): string {
  return (model || import.meta.env.VITE_OPENAI_MODEL || "gpt-5.4").trim();
}

export class OpenAIModelProvider implements IModelProvider {
  constructor(private readonly configuredModel?: string) {}

  async generateChatResponse(ctx: ModelContext, _options?: ChatResponseOptions): Promise<string> {
    return invoke<string>("openai_generate", {
      model: getModel(this.configuredModel),
      prompt: ctx.prompt,
    });
  }

  async generatePlanAndPatch(ctx: ModelContext): Promise<PlanAndPatch> {
    const selectedFilesText = (ctx.selectedFiles || [])
      .map((f) => `FILE: ${f.path}` + "\n```" + "\n" + f.content + "\n```")
      .join("\n\n");

    const targetFilesText = (ctx.targetFiles || []).length
      ? `Target files:\n${ctx.targetFiles!.map((p) => `- ${p}`).join("\n")}\n\n`
      : "";

    const planText = ctx.plan ? `Plan:\n${ctx.plan}\n\n` : "";
    const manifestText = ctx.manifestSummary ? `Manifest summary:\n${ctx.manifestSummary}\n\n` : "";

    const prompt =
`You are a coding assistant inside a local developer tool.

Return ONLY valid JSON with this exact shape:
{
  "explanation": "short plain-English summary",
  "patch": "full unified diff patch as a string"
}

Rules:
- Do not wrap JSON in markdown fences.
- patch must be a valid unified diff.
- Prefer editing the provided files.
- Do not include extra keys.

User request:
${ctx.prompt}

${planText}${targetFilesText}${manifestText}Selected files:
${selectedFilesText}`;

    const text = await invoke<string>("openai_generate", {
      model: getModel(this.configuredModel),
      prompt,
    });
    let parsed: any;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("OpenAI returned non-JSON plan/patch output");
    }

    if (!parsed || typeof parsed.explanation !== "string" || typeof parsed.patch !== "string") {
      throw new Error("OpenAI returned invalid plan/patch shape");
    }

    return {
      explanation: parsed.explanation.trim(),
      patch: parsed.patch,
    };
  }
}







