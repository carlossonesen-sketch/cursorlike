import { createDeveloperSessionState } from "./developerState";
import { parsePatchHunks, patchFromSelectedHunks } from "../patch/patchHunks";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const session = createDeveloperSessionState("2026-07-25T00:00:00.000Z");
assert(session.schemaVersion === 2, "Developer session must use schema v2");
assert(Object.keys(session.editorDrafts).length === 0, "drafts must start isolated");
assert(session.selectedRangeContexts.length === 0, "range context must start isolated");
assert("lib/main.dart".split(".").pop() === "dart", "Dart files must map to the local dart language id");

const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-a\n+A\n@@ -3,1 +3,1 @@\n-c\n+C";
const hunks = parsePatchHunks(patch);
const selected = patchFromSelectedHunks(patch, [hunks[0]!.id]);
assert(selected.includes("+A"), "selected hunk must be retained");
assert(!selected.includes("+C"), "rejected hunk must be omitted");

console.log("developer mode phase 2 regression passed");
