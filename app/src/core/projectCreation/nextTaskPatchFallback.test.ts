import { PatchEngine, pathsFromPatch } from "../patch/PatchEngine";
import { createNextTaskFallbackPatch, type PatchFallbackWorkspace } from "./nextTaskPatchFallback";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const files = new Map<string, string>([
  ["package.json", JSON.stringify({ scripts: { build: "vite build" } })],
  ["tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } })],
]);

const workspace: PatchFallbackWorkspace = {
  async exists(path) {
    return files.has(path);
  },
  async readFile(path) {
    const content = files.get(path);
    if (content == null) throw new Error(`${path} not found`);
    return content;
  },
};

async function isActionablePatch(patch: string): Promise<boolean> {
  const engine = new PatchEngine("D:\\dev\\nf-projects\\foundry", (path) => workspace.readFile(path));
  const paths = pathsFromPatch(patch);
  const preview = await engine.preview(patch);
  return paths.length > 0 && preview.size > 0 && paths.every((path) => preview.has(path));
}

const successfulBuildBeforeContinue = true;
assert(successfulBuildBeforeContinue, "regression setup should represent continuing after a successful build");

const fallback = await createNextTaskFallbackPatch(
  workspace,
  "Continue from the active living build plan.\nTask to complete: Add primary API route",
  []
);

if (fallback == null) throw new Error("API route task should produce a fallback patch");
assert(pathsFromPatch(fallback.patch).includes("src/routes/primaryApi.ts"), "fallback should create a route file");
assert(await isActionablePatch(fallback.patch), "fallback patch should produce writable file edits");

const noOpPatch = "";
assert(!(await isActionablePatch(noOpPatch)), "invalid/no-op patch must not become actionable");

console.log("next task patch fallback regression passed");
