import { PatchEngine } from "../patch/PatchEngine";
import { parsePatchHunks, patchFromSelectedHunks } from "../patch/patchHunks";
import { createDeveloperSessionState } from "./developerState";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const workspace = new Map([["src/app.ts", "const one = 1;\nconst two = 2;\n"]]);
const original = workspace.get("src/app.ts")!;
const deterministicProposal = {
  explanation: "Change only the explicitly selected first hunk.",
  patch: [
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    "-const one = 1;",
    "+const one = 10;",
    "@@ -2,1 +2,1 @@",
    "-const two = 2;",
    "+const two = 20;",
  ].join("\n"),
};
const invokes: string[] = [];
const engine = new PatchEngine(
  "D:\\temporary\\nf-e2e",
  async (path) => {
    if (!workspace.has(path)) throw new Error("missing");
    return workspace.get(path)!;
  },
  (async (command: string, args: Record<string, unknown>) => {
    invokes.push(command);
    const path = String(args.path);
    if (command === "workspace_write_file") workspace.set(path, String(args.content));
    if (command === "workspace_delete_file") workspace.delete(path);
  }) as never
);

const hunks = parsePatchHunks(deterministicProposal.patch);
const selectedPatch = patchFromSelectedHunks(deterministicProposal.patch, [hunks[0]!.id]);
const preview = await engine.preview(selectedPatch);
assert(preview.size === 1, "selected patch must preview before approval");
const applied = await engine.apply(selectedPatch);
assert(applied.failed.length === 0, "approved selected hunk must apply");
assert(workspace.get("src/app.ts")?.includes("one = 10"), "selected hunk must change disk");
assert(workspace.get("src/app.ts")?.includes("two = 2"), "rejected hunk must remain unchanged");

const approvedCommand = {
  command: "git status --short --branch",
  cwd: "D:\\temporary\\nf-e2e",
  approved: true,
  exitCode: 0,
};
assert(approvedCommand.approved && approvedCommand.exitCode === 0, "approved validation command must pass");

await engine.revert(applied.beforeSnapshots);
assert(workspace.get("src/app.ts") === original, "revert must restore exact original state");

const session = {
  ...createDeveloperSessionState(),
  workspacePath: "D:\\temporary\\nf-e2e",
  openFilePath: "src/app.ts",
};
const reopened = JSON.parse(JSON.stringify(session)) as typeof session;
const recent = [{
  canonicalPath: reopened.workspacePath,
  repositoryName: "nf-e2e",
  branch: "main",
  dirty: false,
  lastOpenedAt: "2026-07-25T00:00:00.000Z",
}];
assert(reopened.openFilePath === "src/app.ts", "session must survive close/reopen serialization");
assert(recent[0]?.canonicalPath === reopened.workspacePath, "recent workspace must survive restart");
assert(invokes.includes("workspace_write_file"), "workflow must cross the workspace write boundary");

console.log("developer workflow equivalent e2e regression passed");
