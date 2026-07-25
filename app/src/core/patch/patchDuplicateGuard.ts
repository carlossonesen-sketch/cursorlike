const EXPORT_FUNCTION_PATTERN = /export\s+function\s+(\w+)\b/g;

export function duplicateExportFunctionNames(content: string): string[] {
  const counts = new Map<string, number>();
  for (const match of content.matchAll(EXPORT_FUNCTION_PATTERN)) {
    const name = match[1];
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

export function wouldAppendDuplicateBlock(oldContent: string, newContent: string): boolean {
  const trimmedOld = oldContent.trim();
  if (trimmedOld.length < 80) return false;
  const firstIndex = newContent.indexOf(trimmedOld);
  if (firstIndex < 0) return false;
  return newContent.indexOf(trimmedOld, firstIndex + trimmedOld.length) >= 0;
}

export function validatePatchContent(path: string, oldContent: string, newContent: string): string | null {
  if (!/\.(tsx?|jsx?)$/i.test(path)) return null;
  const duplicateNames = duplicateExportFunctionNames(newContent);
  if (duplicateNames.length) {
    return `Patch would create duplicate export function(s) in ${path}: ${duplicateNames.join(", ")}`;
  }
  if (wouldAppendDuplicateBlock(oldContent, newContent)) {
    return `Patch would concatenate duplicate content into ${path}`;
  }
  return null;
}
