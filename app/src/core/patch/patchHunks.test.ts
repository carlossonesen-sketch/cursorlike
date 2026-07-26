import {
  parsePatchHunks,
  patchFromSelectedHunks,
  selectedHunksPreserveFileSemantics,
} from "./patchHunks";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const patch = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,1 +1,1 @@",
  "-one",
  "+ONE",
  "@@ -4,1 +4,1 @@",
  "-four",
  "+FOUR",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+first",
  "+second",
].join("\n");

const hunks = parsePatchHunks(patch);
assert(hunks.length === 3, "must parse individual hunks");
const selected = patchFromSelectedHunks(patch, [hunks[1]!.id]);
assert(selected.includes("@@ -4,1 +4,1 @@"), "must include selected hunk");
assert(!selected.includes("@@ -1,1 +1,1 @@"), "must omit rejected hunk");
assert(selected.startsWith("--- a/src/a.ts\n+++ b/src/a.ts"), "must retain file headers");
assert(
  selectedHunksPreserveFileSemantics(patch, [hunks[2]!.id]).valid,
  "single-hunk create patch preserves create semantics"
);

console.log("patch hunk regression passed");
