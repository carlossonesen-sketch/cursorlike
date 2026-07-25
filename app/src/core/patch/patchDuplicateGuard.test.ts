import { duplicateExportFunctionNames, validatePatchContent, wouldAppendDuplicateBlock } from "./patchDuplicateGuard";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const oldContent = `export function WorkspaceSetupPage() {\n  return <section>Industry templates and layout templates for founder setup flow.</section>;\n}\n`;
const duplicated = `${oldContent}\n${oldContent}`;

assert(
  duplicateExportFunctionNames(duplicated).includes("WorkspaceSetupPage"),
  "duplicate export detection"
);
assert(wouldAppendDuplicateBlock(oldContent, duplicated), "append duplicate block detection");
assert(
  validatePatchContent("src/workspace/pages/WorkspaceSetupPage.tsx", oldContent, duplicated) != null,
  "patch validation should reject duplicate content"
);
assert(
  validatePatchContent("src/workspace/pages/WorkspaceSetupPage.tsx", "", "export function NewPage() {}") == null,
  "clean new file patch should pass"
);

console.log("patch duplicate guard regression passed");
