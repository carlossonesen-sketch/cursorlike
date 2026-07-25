import {
  assertDeveloperCommandApproval,
  assertDeveloperPatchApproval,
  createDeveloperSessionState,
  isolateDeveloperSession,
} from "./developerState";
import {
  MockModelProvider,
  getModelProviderInfo,
  setModelProvider,
} from "../model/ModelGateway";
import { PatchEngine, pathsFromPatch, selectPatchFiles } from "../patch/PatchEngine";

const assert = {
  equal(actual: unknown, expected: unknown, message = "values differ") {
    if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  },
  deepEqual(actual: unknown, expected: unknown, message = "values differ") {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
    }
  },
  throws(run: () => unknown, expected: RegExp) {
    try {
      run();
    } catch (error) {
      if (expected.test(String(error))) return;
      throw error;
    }
    throw new Error("expected function to throw");
  },
  doesNotThrow(run: () => unknown) {
    run();
  },
  match(actual: string, expected: RegExp) {
    if (!expected.test(actual)) throw new Error(`${JSON.stringify(actual)} does not match ${expected}`);
  },
};

const builderState = {
  currentPhaseId: "foundation",
  completedTaskIds: ["builder-task"],
};
const initial = createDeveloperSessionState("2026-01-01T00:00:00.000Z");
const opened = isolateDeveloperSession(initial, "D:\\work\\repo", "2026-01-02T00:00:00.000Z");
assert.equal(opened.workspacePath, "D:\\work\\repo");
assert.deepEqual(opened.selectedContextPaths, []);
assert.equal(builderState.currentPhaseId, "foundation", "Developer state must not mutate Automated Builder state");
assert.deepEqual(builderState.completedTaskIds, ["builder-task"]);

assert.throws(() => assertDeveloperPatchApproval(false, { explanation: "x", patch: "patch" }), /explicit patch approval/);
assert.throws(() => assertDeveloperCommandApproval(false, "npm run build"), /explicit command approval/);
assert.doesNotThrow(() => assertDeveloperCommandApproval(true, "npm run build"));

const twoFilePatch = [
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,1 +1,1 @@",
  "-old a",
  "+new a",
  "--- a/b.ts",
  "+++ b/b.ts",
  "@@ -1,1 +1,1 @@",
  "-old b",
  "+new b",
  "",
].join("\n");
const selectedPatch = selectPatchFiles(twoFilePatch, ["b.ts"]);
assert.deepEqual(pathsFromPatch(selectedPatch), ["b.ts"]);
assert.equal(selectedPatch.includes("a.ts"), false, "Partial patch must exclude unselected files");

const files = new Map<string, string>();
const invoked: string[] = [];
const fakeInvoke = (async (command: string, args: Record<string, unknown>) => {
  invoked.push(command);
  const path = String(args.path);
  if (command === "workspace_write_file") files.set(path, String(args.content));
  if (command === "workspace_delete_file") files.delete(path);
}) as never;
const engine = new PatchEngine(
  "D:\\work\\repo",
  async (path) => {
    if (!files.has(path)) throw new Error("missing");
    return files.get(path)!;
  },
  fakeInvoke
);
const newFilePatch = [
  "--- /dev/null",
  "+++ b/new.ts",
  "@@ -0,0 +1,1 @@",
  "+export const ready = true;",
  "",
].join("\n");
const applied = await engine.apply(newFilePatch);
assert.deepEqual(applied.applied, ["new.ts"]);
assert.equal(applied.beforeSnapshots[0]?.existed, false);
assert.equal(files.has("new.ts"), true);
const reverted = await engine.revert(applied.beforeSnapshots);
assert.deepEqual(reverted.applied, ["new.ts"]);
assert.equal(files.has("new.ts"), false, "Revert must delete a file created by the applied patch");
assert.equal(invoked.includes("workspace_delete_file"), true);

setModelProvider(new MockModelProvider(), {
  kind: "mock",
  label: "Mock (test)",
  isReal: false,
  available: true,
  reason: "Mock cannot create Developer Mode changes.",
});
const provider = getModelProviderInfo();
assert.equal(provider.isReal, false);
assert.match(provider.reason ?? "", /cannot create Developer Mode changes/);

console.log("developer mode phase 1 regression passed");
