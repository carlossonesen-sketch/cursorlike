import {
  assertProjectIdentityReady,
  inferProjectNameFromSavePath,
  isUnresolvedProjectName,
  ProjectCreationBlockedError,
  projectNameRequestMessage,
  UNRESOLVED_PROJECT_NAME,
} from "./projectIdentity";
import { createProjectCreationState } from "./projectCreationState";
import { runProjectCreationPlanningPipeline } from "./projectCreationPipeline";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(isUnresolvedProjectName(UNRESOLVED_PROJECT_NAME), "untitled sentinel should be unresolved");
assert(!isUnresolvedProjectName("NF Web Developer"), "real names should be resolved");
assert(
  inferProjectNameFromSavePath("D:\\dev\\nf-projects\\nf-web-developer") === "NF Web Developer",
  "save path folder should infer a readable project name"
);

const websiteSpecWithoutName = [
  "Save path: D:\\dev\\nf-projects\\nf-web-developer",
  "Project Type: Web development/website hosting platform",
  "Required MVP: website projects, industry templates, layout templates, publishing, preview, AWS, domains.",
].join("\n");

const inferredNameState = createProjectCreationState({ founderPrompt: websiteSpecWithoutName, source: "prompt" });
assert(inferredNameState.projectName === "NF Web Developer", "explicit save path should infer project name when label is missing");
assert(!inferredNameState.needsProjectName, "inferred name from save path should resolve identity");

const unresolvedWebsiteSpec = [
  "Project Type: Web development/website hosting platform",
  "Required MVP: website projects, industry templates, layout templates, publishing, preview, AWS, domains.",
].join("\n");
const unresolvedState = createProjectCreationState({ founderPrompt: unresolvedWebsiteSpec, source: "prompt" });
assert(unresolvedState.needsProjectName, "website platform spec without name should mark identity as unresolved");
assert(
  unresolvedState.conflicts.some((blocker) => blocker.includes("NF needs a project name")),
  "unresolved identity should surface a founder-friendly blocker"
);

let blockedMessage = "";
try {
  runProjectCreationPlanningPipeline(unresolvedState, { persistBlueprint: false });
} catch (error) {
  blockedMessage = error instanceof Error ? error.message : String(error);
}
assert(blockedMessage.includes("NF needs a project name"), "planning should block with a name request instead of generic placeholder rejection");
assert(
  !blockedMessage.includes("Website Platform planning rejected generic placeholders"),
  "planning should not throw the old generic placeholder rejection for missing names"
);

let identityError: unknown;
try {
  assertProjectIdentityReady(UNRESOLVED_PROJECT_NAME);
} catch (error) {
  identityError = error;
}
assert(identityError instanceof ProjectCreationBlockedError, "identity guard should throw a blocked error type");
assert(
  (identityError as ProjectCreationBlockedError).message === projectNameRequestMessage(),
  "identity guard should use the founder-facing name request copy"
);

console.log("project identity regression passed");
