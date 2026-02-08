/**
 * Model registry: discover GGUF from allowed dirs only; parse filename heuristics.
 * Roles: coder, general, reviewer, embeddings, reranker (vision later).
 */

import { invoke } from "@tauri-apps/api/core";

export type ModelRole = "coder" | "general" | "reviewer" | "embeddings" | "reranker";

export interface DiscoveredModelEntry {
  display_path: string;
  absolute_path: string;
  source: string;
}

export interface ModelMetadata {
  family: "qwen" | "llama" | "mistral" | "gemma" | "deepseek" | "unknown";
  size: string;
  quant: string;
  specialization: "coder" | "instruct" | "chat" | "review" | "embed" | "rerank" | "none";
}

const FAMILY_PATTERNS: [RegExp, ModelMetadata["family"]][] = [
  [/qwen/i, "qwen"],
  [/llama/i, "llama"],
  [/mistral/i, "mistral"],
  [/gemma/i, "gemma"],
  [/deepseek/i, "deepseek"],
];

const SIZE_PATTERN = /(\d+)\s*b/i;
const QUANT_PATTERN = /q([2-8])(?:_k_[a-z0-9]+)?|q4_k_m|q5_k_m/i;
const SPECIAL_PATTERNS: [RegExp, ModelMetadata["specialization"]][] = [
  [/coder|code/i, "coder"],
  [/instruct/i, "instruct"],
  [/chat/i, "chat"],
  [/review/i, "review"],
  [/embed/i, "embed"],
  [/rerank/i, "rerank"],
];

export function parseModelMetadata(filename: string): ModelMetadata {
  const lower = filename.toLowerCase();
  let family: ModelMetadata["family"] = "unknown";
  for (const [re, f] of FAMILY_PATTERNS) {
    if (re.test(filename)) {
      family = f;
      break;
    }
  }
  const sizeMatch = filename.match(SIZE_PATTERN);
  const size = sizeMatch ? `${sizeMatch[1]}b` : "";
  const quantMatch = lower.match(QUANT_PATTERN);
  const quant = quantMatch ? quantMatch[0] : "";
  let specialization: ModelMetadata["specialization"] = "none";
  for (const [re, s] of SPECIAL_PATTERNS) {
    if (re.test(filename)) {
      specialization = s;
      break;
    }
  }
  return { family, size, quant, specialization };
}

export async function getGlobalModelsDir(): Promise<string> {
  return invoke<string>("get_global_models_dir");
}

/** Download a file to destPath (must be under global models dir). Backend uses curl then PowerShell fallback on Windows. */
export async function downloadModelFile(url: string, destPath: string): Promise<void> {
  return invoke("download_file", { url, destPath });
}

export async function discoverModels(workspaceRoot: string): Promise<DiscoveredModelEntry[]> {
  const list = await invoke<DiscoveredModelEntry[]>("discover_gguf_models", { workspaceRoot });
  return list ?? [];
}

/** Auto-pick: coder prefers coder/code, general prefers instruct/chat, reviewer defaults to general. */
export function pickRecommended(
  entries: DiscoveredModelEntry[],
  withMetadata: Map<string, ModelMetadata>
): { coder: string | null; general: string | null; reviewer: string | null } {
  const bySpec = (s: ModelMetadata["specialization"]) =>
    entries.filter((e) => withMetadata.get(e.absolute_path)?.specialization === s);
  const coderCandidates = bySpec("coder").length ? bySpec("coder") : entries;
  const generalCandidates = bySpec("instruct").length
    ? bySpec("instruct")
    : bySpec("chat").length
      ? bySpec("chat")
      : entries;
  const coder = coderCandidates[0]?.absolute_path ?? null;
  const general = generalCandidates[0]?.absolute_path ?? null;
  const reviewerCandidates = bySpec("review").length ? bySpec("review") : generalCandidates;
  const reviewer = reviewerCandidates[0]?.absolute_path ?? general ?? null;
  return { coder, general, reviewer };
}
