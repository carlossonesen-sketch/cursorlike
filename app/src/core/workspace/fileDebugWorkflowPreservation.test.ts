import { FilesPane } from "../../components/FilesPane";
import {
  developerModeControlPreferences,
  founderModeControlPreferences,
} from "../control/controlLevel";
import {
  shouldRequireApprovalForRiskyDeveloperAction,
  shouldShowManualCommandControls,
  shouldShowRawTaskState,
} from "../control/developerModeTools";
import {
  buildFailureOutput,
  extractBuildFailureReferences,
  formatBuildFailureReferences,
  repairReferencedBuildFailure,
  storeBuildFailure,
} from "../project/buildRepair";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createGapAnalysis } from "../product/gapAnalysis";
import { createProjectBlueprintFromDiscoveryIntake } from "../product/projectBlueprint";
import { runExecutionRepair } from "../phase/executionRepairRunner";
import { createPhaseBuildPlan } from "../phase/phaseBuildPlan";
import { createPhaseExecutionState, recordPhaseCheckStatus } from "../phase/phaseExecutionState";
import type { PhaseBuildPlan } from "../types";
import { readProjectFile } from "./readProjectFile";
import { WorkspaceService } from "./WorkspaceService";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function approveCurrentPhase(plan: PhaseBuildPlan): PhaseBuildPlan {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === plan.currentPhaseId ? { ...phase, status: "approved" as const } : phase
    ),
  };
}

const workspace = new WorkspaceService();
assert(typeof WorkspaceService === "function", "workspace/file explorer service remains importable");
assert(typeof FilesPane === "function", "file explorer UI surface remains importable");
assert(workspace.root === null, "new workspace service starts without an active root");
assert(workspace.normalizeRel("\\src\\App.tsx") === "src/App.tsx", "workspace relative-path normalization remains available");
assert(await workspace.exists("package.json") === false, "workspace exists helper stays safe without an active root");

let readWithoutWorkspace = "";
try {
  await workspace.readFile("package.json");
} catch (error) {
  readWithoutWorkspace = error instanceof Error ? error.message : String(error);
}
assert(readWithoutWorkspace === "Open a workspace first.", "workspace read helper guards against missing active workspace");

const files = new Map<string, string>([
  ["README.md", "# NF"],
  ["src/main.tsx", "const requestSummary = document.querySelector('#summary');\nrequestSummary.textContent = 'Ready';"],
  ["src/App.tsx", "export function App() { return null; }"],
  ["docs/design.md", "# Design"],
]);
const reads: string[] = [];
const fakeRead = async (path: string): Promise<string> => {
  reads.push(path);
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!files.has(normalized)) {
    throw new Error(`missing file: ${normalized}`);
  }
  return files.get(normalized)!;
};
const fakeExists = async (path: string): Promise<boolean> =>
  files.has(path.replace(/\\/g, "/").replace(/^\/+/, ""));
const fakeSearch = async (_workspaceRoot: string, fileName: string): Promise<string[]> =>
  [...files.keys()].filter((path) => path.toLowerCase().includes(fileName.toLowerCase().replace(/\\/g, "/")));

const directRead = await readProjectFile("D:\\dev\\nf-projects\\preserve", "README.md", fakeRead, fakeExists, fakeSearch);
assert("content" in directRead && directRead.content === "# NF", "file read helper still resolves exact files");

const fuzzyRead = await readProjectFile("D:\\dev\\nf-projects\\preserve", "main.tsx", fakeRead, fakeExists, fakeSearch);
assert("content" in fuzzyRead && fuzzyRead.path === "src/main.tsx", "file read helper still resolves searched workspace files");

const traversalRead = await readProjectFile("D:\\dev\\nf-projects\\preserve", "../secrets.env", fakeRead, fakeExists, fakeSearch);
assert("error" in traversalRead && traversalRead.error === "not found", "file read helper rejects path traversal hints");
assert(!reads.some((path) => path.includes("..")), "path traversal hint is not passed to file reader");

const output = buildFailureOutput(
  "stdout line",
  "src/main.tsx(2,1): error TS18047: 'requestSummary' is possibly 'null'."
);
const storedFailure = storeBuildFailure("npm run build", "D:\\dev\\nf-projects\\preserve", 2, output);
assert(storedFailure.output.includes("stdout line"), "debug failure storage keeps raw stdout");
assert(storedFailure.output.includes("TS18047"), "debug failure storage keeps raw stderr/errors");
assert(storedFailure.filesReferenced.includes("src/main.tsx"), "debug failure storage keeps referenced files");
assert(storedFailure.errorLines.length === 1, "debug failure storage keeps parsed raw error lines");

const refs = extractBuildFailureReferences(output);
assert(refs.length === 1 && refs[0]?.path === "src/main.tsx", "manual debug parser remains importable");
assert(formatBuildFailureReferences(refs).includes("src/main.tsx:2:1"), "manual debug formatter remains importable");

const repaired = repairReferencedBuildFailure("src/main.tsx", files.get("src/main.tsx")!, refs);
assert(repaired?.includes("if (requestSummary == null) return;") === true, "manual repair helper remains importable");

const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a debugging dashboard"), {
  id: "blueprint-file-debug-preservation",
  projectId: "file-debug-preservation",
  now: "2026-06-28T13:00:00.000Z",
});
const gap = createGapAnalysis(blueprint, "2026-06-28T13:10:00.000Z");
const plan = approveCurrentPhase(createPhaseBuildPlan(blueprint, gap, "2026-06-28T13:20:00.000Z"));
const state = recordPhaseCheckStatus(
  createPhaseExecutionState(plan, "2026-06-28T13:30:00.000Z"),
  "build",
  "failed",
  { command: "npm run build", exitCode: 2, summary: output },
  "2026-06-28T13:40:00.000Z"
);
const repairResult = await runExecutionRepair({
  plan,
  state,
  workspaceRoot: "D:\\dev\\nf-projects\\preserve",
  failureOutput: output,
  readFile: fakeRead,
});
assert(repairResult.status === "needsApproval", "autonomous repair does not replace manual debug workflow without a safe applier");
assert(repairResult.patch?.patch.includes("src/main.tsx") === true, "autonomous repair can prepare a patch while preserving manual approval");

const developer = developerModeControlPreferences("assisted");
const founder = founderModeControlPreferences("guided");
assert(shouldShowRawTaskState({ preferences: developer }), "Developer Mode keeps raw task/debug state visible");
assert(shouldShowManualCommandControls({ preferences: developer }), "Developer Mode keeps manual workflow controls visible");
assert(!shouldShowRawTaskState({ preferences: founder }), "Founder Mode may hide raw task/debug details by default");
assert(!shouldShowManualCommandControls({ preferences: founder }), "Founder Mode may hide manual workflow controls by default");
assert(typeof WorkspaceService === "function", "Founder Mode simplification does not delete workspace tools internally");
assert(typeof repairReferencedBuildFailure === "function", "Founder Mode simplification does not delete debug/repair tools internally");

assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: developer, isSensitive: true }),
  "sensitive actions still require approval in Developer Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: founder, isSensitive: true }),
  "sensitive actions still require approval in Founder Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: developer, isDestructive: true }),
  "destructive actions still require approval in Developer Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: founder, isDestructive: true }),
  "destructive actions still require approval in Founder Mode"
);

console.log("file/debug workflow preservation regression passed");
