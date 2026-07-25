import { PatchEngine, pathsFromPatch } from "../patch/PatchEngine";
import {
  createFullFileReplacementPatch,
  extractBuildFailureReferences,
  repairReferencedBuildFailure,
  storeBuildFailure,
} from "./buildRepair";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const output = "src/main.tsx(146,3): error TS18047: 'requestSummary' is possibly 'null'.";
const failure = storeBuildFailure("npm run build", "D:\\dev\\nf-projects\\foundry", 2, output);
assert(failure.command === "npm run build", "stored failure should keep command");
assert(failure.cwd.endsWith("foundry"), "stored failure should keep cwd");
assert(failure.exitCode === 2, "stored failure should keep exit code");
assert(failure.errorLines[0]?.includes("TS18047"), "stored failure should keep error lines");
assert(failure.filesReferenced.length === 1 && failure.filesReferenced[0] === "src/main.tsx", "stored failure should keep referenced file only");

const refs = extractBuildFailureReferences(output);
assert(refs.length === 1, "TS error should produce one referenced file");
assert(refs[0]?.path === "src/main.tsx", "repair should target src/main.tsx");

const lines = Array.from({ length: 160 }, (_, index) => `const filler${index + 1} = ${index + 1};`);
lines[145] = "  requestSummary.textContent = summary;";
const original = lines.join("\n");
const repaired = repairReferencedBuildFailure("src/main.tsx", original, refs);
if (repaired == null) throw new Error("nullability repair should be generated");
assert(repaired.includes("if (requestSummary == null) return;"), "repair should add a null guard");
assert(!repaired.includes("package.json"), "repair should not touch package.json");
assert(!repaired.includes("tsconfig"), "repair should not touch tsconfig");

const patch = createFullFileReplacementPatch("src/main.tsx", original, repaired);
assert(pathsFromPatch(patch.patch).length === 1, "repair patch should edit one file");
assert(pathsFromPatch(patch.patch)[0] === "src/main.tsx", "repair patch should target src/main.tsx only");

const files = new Map<string, string>([["src/main.tsx", original]]);
const engine = new PatchEngine("D:\\dev\\nf-projects\\foundry", async (path) => {
  const content = files.get(path);
  if (content == null) throw new Error(`${path} not found`);
  return content;
});
const preview = await engine.preview(patch.patch);
assert(preview.has("src/main.tsx"), "repair patch should produce a writable preview");

const malformedPatch = "Fixed requestSummary nullability.";
const malformedPreview = await engine.preview(malformedPatch);
assert(pathsFromPatch(malformedPatch).length === 0, "malformed patch should not name writable files");
assert(malformedPreview.size === 0, "malformed patch should not become actionable");

console.log("build repair regression passed");
