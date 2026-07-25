import type { PlanAndPatch } from "../types";
import { isModelProviderUnavailableError } from "../model/modelProviderErrors";
import { createNextTaskFallbackPatch, type PatchFallbackWorkspace } from "./nextTaskPatchFallback";

export async function resolveBuildPlanTaskPatch(
  workspace: PatchFallbackWorkspace,
  taskPrompt: string,
  inferredPaths: string[],
  buildPatch: (promptText: string) => Promise<PlanAndPatch>
): Promise<{ patch: PlanAndPatch; usedOfflineFallback: boolean }> {
  const tryOfflineFallback = async () => createNextTaskFallbackPatch(workspace, taskPrompt, inferredPaths);

  try {
    return { patch: await buildPatch(taskPrompt), usedOfflineFallback: false };
  } catch (primaryError) {
    const fallback = await tryOfflineFallback();
    if (fallback) {
      return { patch: fallback, usedOfflineFallback: true };
    }
    if (isModelProviderUnavailableError(primaryError)) {
      throw primaryError;
    }
  }

  const retryPrompt = [
    taskPrompt,
    "",
    "The previous response did not include concrete edits.",
    "Return a concrete unified diff or full-file replacement for the selected context files.",
    inferredPaths.length ? `The patch should edit one of: ${inferredPaths.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  try {
    return { patch: await buildPatch(retryPrompt), usedOfflineFallback: false };
  } catch (retryError) {
    const fallback = await tryOfflineFallback();
    if (fallback) {
      return { patch: fallback, usedOfflineFallback: true };
    }
    throw retryError;
  }
}
