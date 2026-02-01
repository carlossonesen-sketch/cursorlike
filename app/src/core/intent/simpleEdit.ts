/**
 * Simple inline edit executor for trivial patterns.
 * Used when file_edit is detected but we don't want full diff/patch.
 */

/**
 * Apply a simple edit to content based on instructions.
 * Returns modified content or null if no pattern matched.
 */
export function applySimpleEdit(content: string, instructions: string): string | null {
  const ins = instructions.trim().toLowerCase();
  if (!ins) return null;

  const addToTopMatch = instructions.match(/(?:add|prepend|insert)\s+(.+?)\s+(?:to|at)\s+(?:the\s+)?top/i);
  if (addToTopMatch) {
    const toAdd = addToTopMatch[1].trim();
    const line = toAdd.endsWith("\n") ? toAdd : toAdd + "\n";
    return line + content;
  }

  const addToTopSimple = instructions.match(/^add\s+(.+)\s+to\s+top$/i);
  if (addToTopSimple) {
    const toAdd = addToTopSimple[1].trim();
    const line = toAdd.endsWith("\n") ? toAdd : toAdd + "\n";
    return line + content;
  }

  const prependMatch = instructions.match(/^prepend\s+(.+)$/i);
  if (prependMatch) {
    const toAdd = prependMatch[1].trim();
    const line = toAdd.endsWith("\n") ? toAdd : toAdd + "\n";
    return line + content;
  }

  return null;
}
