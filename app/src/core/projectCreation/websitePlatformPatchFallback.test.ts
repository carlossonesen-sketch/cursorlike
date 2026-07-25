import { PatchEngine, pathsFromPatch } from "../patch/PatchEngine";
import { createWebsitePlatformFallbackPatch } from "./websitePlatformPatchFallback";
import type { PatchFallbackWorkspace } from "./nextTaskPatchFallback";
import { isModelProviderUnavailableError } from "../model/modelProviderErrors";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  isModelProviderUnavailableError(new Error("429 You exceeded your current quota, please check your plan and billing details.")),
  "429 quota errors should be detected"
);

const files = new Map<string, string>();

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

const scaffoldPrompt =
  "Continue from the active living build plan.\nTask to complete: Set up website project workspace scaffold\nMVP definition: Website Platform";

const scaffoldPatch = await createWebsitePlatformFallbackPatch(workspace, scaffoldPrompt);
if (scaffoldPatch == null) throw new Error("website scaffold task should produce offline fallback patch");
const scaffoldPaths = pathsFromPatch(scaffoldPatch.patch);
assert(scaffoldPaths.includes("package.json"), "scaffold fallback should create package.json");
assert(scaffoldPaths.includes("src/main.tsx"), "scaffold fallback should create src/main.tsx");

const engine = new PatchEngine("D:\\dev\\nf-projects\\nf-web-developer", async (path) => {
  if (!files.has(path)) throw new Error(`${path} not found`);
  return files.get(path)!;
});
const preview = await engine.preview(scaffoldPatch.patch);
assert(preview.size > 0, "scaffold fallback patch should preview writable files");

const industryPatch = await createWebsitePlatformFallbackPatch(
  workspace,
  "Task to complete: Build industry template picker shell"
);
if (industryPatch == null) throw new Error("industry picker task should produce offline fallback patch");
assert(
  pathsFromPatch(industryPatch.patch).includes("src/pages/IndustryTemplatePicker.tsx"),
  "industry picker fallback should create picker page"
);

console.log("website platform patch fallback regression passed");
