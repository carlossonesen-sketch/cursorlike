import { validateBuildCheckWorkspace, workspacePathsMatch, type BuildCheckRequest } from "./buildCheck";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const activePath = "D:\\dev\\nf-projects\\get-off-my-fence";
const matchingRequest: BuildCheckRequest = {
  runId: "build-test",
  command: "npm run build",
  workspaceRoot: activePath,
  activeWorkspacePath: activePath,
  cwdSource: "active workspace path",
};

assert(workspacePathsMatch(activePath, "D:/dev/nf-projects/get-off-my-fence"), "path comparison should normalize slashes");
assert(validateBuildCheckWorkspace(matchingRequest) === null, "matching active path/cwd should be allowed");

const driftedRequest: BuildCheckRequest = {
  ...matchingRequest,
  workspaceRoot: "D:\\dev\\nf-projects\\foundry",
};
const error = validateBuildCheckWorkspace(driftedRequest);
if (error == null) throw new Error("mismatched command cwd should be blocked");
assert(error.includes("active project path drift"), "guard error should explain path drift");
assert(error.includes(activePath), "guard error should include active project path");
assert(error.includes("D:\\dev\\nf-projects\\foundry"), "guard error should include command cwd");

console.log("build check workspace guard regression passed");
