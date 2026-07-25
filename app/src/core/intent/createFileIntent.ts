import type { PlanAndPatch } from "../types";
import { extractFileMentions } from "../workspace/readProjectFile";

export interface CreateFileIntent {
  targetPath: string;
  instructions: string;
}

const CREATE_FILE_WORDING = /\bcreate\b|\bnew\s+(?:file|config|document)\b|\badd\s+(?:a\s+)?new\s+file\b/i;

function normalizeTargetPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.length > 250) return null;
  if (!/\.([a-z0-9]{1,8})$/i.test(normalized)) return null;
  return normalized;
}

export function detectCreateFileIntent(prompt: string): CreateFileIntent | null {
  const text = prompt.trim();
  if (!text || !CREATE_FILE_WORDING.test(text)) return null;
  const targetPath = normalizeTargetPath(extractFileMentions(text)[0] ?? "");
  if (!targetPath) return null;
  return {
    targetPath,
    instructions: text,
  };
}

function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function generateNewFileContent(targetPath: string, prompt: string): string {
  const lower = targetPath.toLowerCase();
  if (lower === "tsconfig.json") {
    return JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        useDefineForClassFields: true,
        module: "ESNext",
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        skipLibCheck: true,
        moduleResolution: "Bundler",
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
        strict: true,
      },
      include: ["src"],
      references: [],
    }, null, 2) + "\n";
  }
  if (lower === "vite.config.ts") {
    return "import { defineConfig } from \"vite\";\nimport react from \"@vitejs/plugin-react\";\n\nexport default defineConfig({\n  plugins: [react()],\n});\n";
  }
  if (lower.endsWith("readme.md")) {
    return `# ${titleFromPath(targetPath)}\n\nProject notes and setup instructions.\n`;
  }
  if (lower.endsWith(".md")) {
    return `# ${titleFromPath(targetPath)}\n\n${prompt}\n`;
  }
  if (lower.endsWith(".json")) {
    return "{\n}\n";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    const name = titleFromPath(targetPath).replace(/\s+/g, "");
    return `export function ${name}() {\n  return null;\n}\n`;
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) {
    return "export default function main() {\n  return null;\n}\n";
  }
  if (lower.endsWith(".css")) {
    return ":root {\n  color-scheme: light;\n}\n";
  }
  return "";
}

export function createNewFilePatch(targetPath: string, content: string): PlanAndPatch {
  const lines = content.length ? content.replace(/\n$/, "").split(/\n/) : [""];
  const added = lines.map((line) => `+${line}`).join("\n");
  return {
    explanation: `Create ${targetPath}.`,
    patch: [
      "--- /dev/null",
      `+++ b/${targetPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      added,
      "",
    ].join("\n"),
  };
}
