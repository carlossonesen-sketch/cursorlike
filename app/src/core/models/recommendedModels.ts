/**
 * Recommended model download URLs (config file; change without code changes).
 * Used by "Download recommended models" – if download fails, show manual steps.
 */

export interface RecommendedModelSpec {
  role: "coder" | "general" | "embeddings" | "reranker";
  label: string;
  /** Download URL (may support resume if server supports Range). */
  url: string;
  /** Expected filename after download (for manual steps). */
  filename: string;
}

/** Mid-size strategy: coder 14B, general 7B–14B, small embedding/reranker. */
export const RECOMMENDED_MODELS: RecommendedModelSpec[] = [
  {
    role: "coder",
    label: "Qwen2.5-Coder 14B Instruct Q4_K_M",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q4_k_m.gguf",
    filename: "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
  },
  {
    role: "general",
    label: "Qwen2.5 7B Instruct Q4_K_M",
    url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf",
    filename: "qwen2.5-7b-instruct-q4_k_m.gguf",
  },
  {
    role: "embeddings",
    label: "BGE-M3 small (embedding)",
    url: "https://huggingface.co/BAAI/bge-m3/resolve/main/bge-m3.gguf",
    filename: "bge-m3.gguf",
  },
  {
    role: "reranker",
    label: "BGE reranker (optional)",
    url: "https://huggingface.co/BAAI/bge-reranker-base/resolve/main/reranker.gguf",
    filename: "reranker.gguf",
  },
];

export const MANUAL_STEPS = `
Manual download steps (if automatic download fails):
1. Open the URL in a browser or use curl: curl -L -o <filename> <url>
2. Save the .gguf file to: %LOCALAPPDATA%\\DevAssistantCursorLite\\tools\\models
3. Create the folder if it does not exist.
4. Click "Refresh" in Settings > Models to detect the new model.
`.trim();
