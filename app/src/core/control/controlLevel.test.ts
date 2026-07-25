import { PatchEngine } from "../patch/PatchEngine";
import { detectBuildCheckIntent } from "../project/buildCheck";
import { createDiscoveryIntake } from "../product/discoveryIntake";
import { createProjectBlueprintFromDiscoveryIntake } from "../product/projectBlueprint";
import {
  attachControlPreferences,
  canAttemptRepairAutomatically,
  canRunPhaseAutomatically,
  canRunQualityChecksAutomatically,
  controlPreferencesFromBlueprint,
  createControlPreferences,
  developerModeControlPreferences,
  evaluateControlPolicy,
  founderModeControlPreferences,
  patchesRequireApproval,
} from "./controlLevel";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const manual = createControlPreferences("manual", "developer");
assert(patchesRequireApproval(manual), "manual requires approval for patches");
assert(
  evaluateControlPolicy({ preferences: manual, action: "patchApply", isSafe: true }).requiresApproval,
  "manual requires approval for patch application"
);
assert(
  evaluateControlPolicy({ preferences: manual, action: "phaseProgression", isPhaseGate: true }).requiresApproval,
  "manual requires approval for phase progression"
);
assert(!canRunPhaseAutomatically(manual), "manual should not run phases automatically");

const assisted = createControlPreferences("assisted", "developer");
assert(
  evaluateControlPolicy({ preferences: assisted, action: "buildCheck", isSafe: true }).allowed,
  "assisted allows checks/suggestions"
);
assert(
  !evaluateControlPolicy({ preferences: assisted, action: "patchApply", isSafe: true }).allowed,
  "assisted does not auto-apply patches"
);
assert(!canAttemptRepairAutomatically(assisted), "assisted should not auto-repair");

const guided = founderModeControlPreferences("guided");
assert(canRunPhaseAutomatically(guided), "guided allows safe in-phase automation");
assert(
  evaluateControlPolicy({ preferences: guided, action: "patchApply", isSafe: true }).allowed,
  "guided allows safe patch automation"
);
assert(
  evaluateControlPolicy({ preferences: guided, action: "phaseProgression", isPhaseGate: true }).requiresApproval,
  "guided keeps phase gates"
);
assert(canRunQualityChecksAutomatically(guided), "guided allows quality checks");

const autonomous = founderModeControlPreferences("autonomous");
assert(
  evaluateControlPolicy({ preferences: autonomous, action: "repair", isSafe: true }).allowed,
  "autonomous allows bounded safe repair"
);
assert(
  evaluateControlPolicy({ preferences: autonomous, action: "patchApply", isSensitive: true }).requiresApproval,
  "sensitive actions require approval regardless of level"
);
assert(
  evaluateControlPolicy({ preferences: autonomous, action: "patchApply", isDestructive: true }).requiresApproval,
  "destructive actions require approval regardless of level"
);
assert(
  !evaluateControlPolicy({ preferences: autonomous, action: "patchApply", isDestructive: true }).allowed,
  "destructive actions are not automatically allowed"
);

const developer = developerModeControlPreferences("assisted");
assert(developer.preferredMode === "developer", "Developer Mode maps to developer preference");
assert(developer.controlLevel === "assisted", "Developer Mode can map to assisted");

const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-control",
  projectId: "control",
  now: "2026-06-27T00:00:00.000Z",
});
assert(
  blueprint.controlPreferences.data.controlLevel === "assisted",
  "control preferences can be stored in Blueprint defaults"
);
const guidedBlueprint = attachControlPreferences(blueprint, guided, "2026-06-27T01:00:00.000Z");
assert(
  controlPreferencesFromBlueprint(guidedBlueprint).controlLevel === "guided",
  "control preferences can be stored in Blueprint/settings"
);
assert(
  guidedBlueprint.controlPreferences.status === "draft",
  "Blueprint control preferences should be a structured section"
);

assert(typeof PatchEngine === "function", "manual patch tools remain importable");
assert(typeof detectBuildCheckIntent === "function", "manual build-check tools remain importable");

console.log("control level regression passed");
