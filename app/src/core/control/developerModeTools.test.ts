import { PatchEngine } from "../patch/PatchEngine";
import { detectAuditMode, buildProjectAuditReport } from "../project/auditIntent";
import { detectBuildCheckIntent, runApprovedBuildCheck } from "../project/buildCheck";
import { repairReferencedBuildFailure, storeBuildFailure } from "../project/buildRepair";
import { buildProjectDashboardModel } from "../project/projectDashboard";
import { detectContinueBuildIntent } from "../project/continueIntent";
import { WorkspaceService } from "../workspace/WorkspaceService";
import {
  createControlPreferences,
  developerModeControlPreferences,
  founderModeControlPreferences,
} from "./controlLevel";
import {
  shouldRequireApprovalForRiskyDeveloperAction,
  shouldShowAuditControls,
  shouldShowBuildControls,
  shouldShowDeveloperTools,
  shouldShowManualCommandControls,
  shouldShowPatchControls,
  shouldShowRawTaskState,
} from "./developerModeTools";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const developerManual = developerModeControlPreferences("manual");
const developerAssisted = developerModeControlPreferences("assisted");
const founderGuided = founderModeControlPreferences("guided");
const founderAutonomous = founderModeControlPreferences("autonomous");

for (const preferences of [developerManual, developerAssisted]) {
  assert(shouldShowDeveloperTools({ preferences }), "Developer Mode shows manual developer tools");
  assert(shouldShowRawTaskState({ preferences }), "Developer Mode shows detailed phase/task state");
  assert(shouldShowPatchControls({ preferences }), "Developer Mode shows patch preview/apply/revert controls");
  assert(shouldShowBuildControls({ preferences }), "Developer Mode shows build/test controls");
  assert(shouldShowAuditControls({ preferences }), "Developer Mode shows audit controls");
  assert(shouldShowManualCommandControls({ preferences }), "Developer Mode shows manual command controls");
}

for (const preferences of [founderGuided, founderAutonomous]) {
  assert(!shouldShowDeveloperTools({ preferences }), "Founder Mode hides developer-heavy tools by default");
  assert(!shouldShowRawTaskState({ preferences }), "Founder Mode hides raw task state by default");
  assert(!shouldShowPatchControls({ preferences }), "Founder Mode hides patch controls by default");
  assert(!shouldShowBuildControls({ preferences }), "Founder Mode hides build controls by default");
  assert(!shouldShowAuditControls({ preferences }), "Founder Mode hides audit controls by default");
  assert(!shouldShowManualCommandControls({ preferences }), "Founder Mode hides manual command controls by default");
}

const manualFounderOverride = createControlPreferences("manual", "founder");
assert(shouldShowDeveloperTools({ preferences: manualFounderOverride }), "manual control level keeps tools visible even with founder preference");

assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: developerManual, isSensitive: true }),
  "Sensitive actions require approval in Developer Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: founderAutonomous, isSensitive: true }),
  "Sensitive actions require approval in Founder Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: developerAssisted, isDestructive: true }),
  "Destructive actions require approval in Developer Mode"
);
assert(
  shouldRequireApprovalForRiskyDeveloperAction({ preferences: founderGuided, isDestructive: true }),
  "Destructive actions require approval in Founder Mode"
);

assert(typeof PatchEngine === "function", "manual patch helper remains importable");
assert(typeof detectBuildCheckIntent === "function", "manual build-check intent helper remains importable");
assert(typeof runApprovedBuildCheck === "function", "manual build-check runner remains importable");
assert(typeof repairReferencedBuildFailure === "function", "manual repair helper remains importable");
assert(typeof storeBuildFailure === "function", "manual debug helper remains importable");
assert(typeof detectAuditMode === "function", "project audit helper remains importable");
assert(typeof buildProjectAuditReport === "function", "project audit report helper remains importable");
assert(typeof buildProjectDashboardModel === "function", "project dashboard helper remains importable");
assert(typeof WorkspaceService === "function", "file explorer/workspace tool remains importable");
assert(detectContinueBuildIntent("continue"), "manual continue command helper remains available");
assert(detectBuildCheckIntent("run build test"), "manual build/test command helper remains available");

console.log("developer mode tools regression passed");
