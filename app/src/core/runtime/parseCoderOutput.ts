/**
 * Parse Coder agent LLM output: extract explanation and unified diff.
 * Throws if no valid unified diff is found (required for proposed session).
 */

/** Extract unified diff from LLM output. Looks for --- a/ or --- "a/ and matching +++ b/ */
export function extractUnifiedDiff(raw: string): string | null {
  const trimmed = raw.trim();
  // Block: ```diff ... ``` or ``` ... ``` containing ---/+++
  const codeBlock = trimmed.match(/```(?:diff)?\s*([\s\S]*?)```/);
  const toSearch = codeBlock ? codeBlock[1] : trimmed;
  // Must have at least one hunk: --- a/path and +++ b/path
  const fileHeader = toSearch.match(/^---\s+(.+)\r?\n\+\+\+\s+(.+)(\r?\n[\s\S]*)/m);
  if (!fileHeader) return null;
  const start = toSearch.indexOf(fileHeader[0]);
  let diff = toSearch.slice(start);
  // Trim trailing non-diff lines (e.g. commentary after the diff)
  const lines = diff.split(/\r?\n/);
  const out: string[] = [];
  let inDiff = false;
  let seenHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^---\s+/.test(line) || /^\+\+\+\s+/.test(line) || /^@@\s+/.test(line) || /^[ +-]/.test(line) || line === "\\ No newline at end of file") {
      inDiff = true;
      if (/^@@\s+/.test(line)) seenHunk = true;
      out.push(line);
    } else if (inDiff && /^[ +-]/.test(line)) {
      out.push(line);
    } else if (inDiff && seenHunk && (line.trim() === "" || line.startsWith("```"))) {
      break;
    } else if (inDiff && !seenHunk && (line.trim() === "" || line.startsWith("```"))) {
      continue;
    } else if (!inDiff && (line.trim() === "" || line.startsWith("Explanation") || line.startsWith("Plan"))) {
      continue;
    } else if (inDiff) {
      break;
    }
  }
  const result = out.join("\n");
  if (!/^---\s+.+\r?\n\+\+\+\s+/.test(result)) return null;
  if (!result.includes("--- a/") || !result.includes("+++ b/")) return null;
  if (!/@@\s+-?\d+(?:,\d+)?\s+\+\d+(?:,\d+)?/.test(result)) return null;
  return result;
}

/** Extract a short explanation (text before the diff or first line of response). */
export function extractExplanation(raw: string, patch: string | null): string {
  const beforeDiff = patch
    ? raw.slice(0, raw.indexOf(patch)).trim()
    : raw.trim();
  const firstBlock = beforeDiff.split(/\n\n+/)[0] || beforeDiff;
  return firstBlock.slice(0, 500).trim() || "No explanation provided.";
}

/** Sanity test: sample diff with headers + blank line + @@ hunk must parse. Run on load (dev). */
function runParseCoderOutputSanityTest(): void {
  const sample = `Explanation first.

--- a/src/foo.ts
+++ b/src/foo.ts

@@ -1,3 +1,4 @@
 line1
+new
 line2
`;
  const got = extractUnifiedDiff(sample);
  if (!got || !got.includes("--- a/") || !got.includes("+++ b/") || !/@@\s+-?\d+(?:,\d+)?\s+\+\d+(?:,\d+)?/.test(got)) {
    throw new Error("parseCoderOutput sanity test failed: extractUnifiedDiff returned null or invalid diff.");
  }
}
runParseCoderOutputSanityTest();
