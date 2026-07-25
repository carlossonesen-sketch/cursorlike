import type {
  BlueprintSection,
  ControlLevel,
  ControlPreferences,
  ProductMode,
  ProjectBlueprint,
} from "../types";

export type ControlledAction =
  | "phaseProgression"
  | "patchApply"
  | "buildCheck"
  | "testRun"
  | "repair";

export interface ControlPolicyInput {
  controlLevel?: ControlLevel;
  preferences?: ControlPreferences | null;
  action: ControlledAction;
  isSafe?: boolean;
  isSensitive?: boolean;
  isDestructive?: boolean;
  isPhaseGate?: boolean;
}

export interface ControlPolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

function section<T>(data: T, now: string): BlueprintSection<T> {
  return { status: "draft", updatedAt: now, data };
}

export function createControlPreferences(
  controlLevel: ControlLevel = "assisted",
  preferredMode: ProductMode = controlLevel === "manual" || controlLevel === "assisted" ? "developer" : "founder"
): ControlPreferences {
  return {
    controlLevel,
    preferredMode,
    phaseGatesRequireApproval: true,
    patchesRequireApproval: controlLevel === "manual" || controlLevel === "assisted",
    allowAutomaticSafePatches: controlLevel === "guided" || controlLevel === "autonomous",
    allowAutomaticBuildChecks: controlLevel !== "manual",
    allowAutomaticTests: controlLevel === "guided" || controlLevel === "autonomous",
    allowAutomaticRepair: controlLevel === "guided" || controlLevel === "autonomous",
    stopForSensitiveActions: true,
    stopForDestructiveActions: true,
  };
}

export function founderModeControlPreferences(level: "guided" | "autonomous" = "guided"): ControlPreferences {
  return createControlPreferences(level, "founder");
}

export function developerModeControlPreferences(level: "manual" | "assisted" = "assisted"): ControlPreferences {
  return createControlPreferences(level, "developer");
}

export function controlPreferencesFromBlueprint(blueprint: ProjectBlueprint): ControlPreferences {
  return blueprint.controlPreferences?.data ?? createControlPreferences();
}

export function attachControlPreferences(
  blueprint: ProjectBlueprint,
  preferences: ControlPreferences,
  now = new Date().toISOString()
): ProjectBlueprint {
  return {
    ...blueprint,
    updatedAt: now,
    controlPreferences: section(preferences, now),
  };
}

export function evaluateControlPolicy(input: ControlPolicyInput): ControlPolicyDecision {
  const preferences = input.preferences ?? createControlPreferences(input.controlLevel ?? "assisted");
  const safe = input.isSafe !== false;

  if (input.isSensitive && preferences.stopForSensitiveActions) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "Sensitive work requires approval regardless of control level.",
    };
  }

  if (input.isDestructive && preferences.stopForDestructiveActions) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "Destructive work requires approval regardless of control level.",
    };
  }

  if (input.isPhaseGate || input.action === "phaseProgression") {
    return {
      allowed: !preferences.phaseGatesRequireApproval,
      requiresApproval: preferences.phaseGatesRequireApproval,
      reason: preferences.phaseGatesRequireApproval
        ? "Phase gates require user approval."
        : "Phase progression is allowed by the current control level.",
    };
  }

  if (!safe) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "Unsafe or uncertain work requires approval.",
    };
  }

  if (input.action === "patchApply") {
    return {
      allowed: preferences.allowAutomaticSafePatches,
      requiresApproval: preferences.patchesRequireApproval || !preferences.allowAutomaticSafePatches,
      reason: preferences.allowAutomaticSafePatches
        ? "Safe patch application is allowed by the current control level."
        : "Patch application requires approval at this control level.",
    };
  }

  if (input.action === "buildCheck") {
    return {
      allowed: preferences.allowAutomaticBuildChecks,
      requiresApproval: !preferences.allowAutomaticBuildChecks,
      reason: preferences.allowAutomaticBuildChecks
        ? "Build checks may run automatically at this control level."
        : "Build checks require manual approval at this control level.",
    };
  }

  if (input.action === "testRun") {
    return {
      allowed: preferences.allowAutomaticTests,
      requiresApproval: !preferences.allowAutomaticTests,
      reason: preferences.allowAutomaticTests
        ? "Tests may run automatically at this control level."
        : "Tests require approval at this control level.",
    };
  }

  if (input.action === "repair") {
    return {
      allowed: preferences.allowAutomaticRepair,
      requiresApproval: !preferences.allowAutomaticRepair,
      reason: preferences.allowAutomaticRepair
        ? "Bounded repair may run automatically at this control level."
        : "Repair requires approval at this control level.",
    };
  }

  return {
    allowed: false,
    requiresApproval: true,
    reason: "Unknown action requires approval.",
  };
}

export function canRunPhaseAutomatically(preferences: ControlPreferences): boolean {
  return preferences.controlLevel === "guided" || preferences.controlLevel === "autonomous";
}

export function patchesRequireApproval(preferences: ControlPreferences): boolean {
  return preferences.patchesRequireApproval;
}

export function canRunQualityChecksAutomatically(preferences: ControlPreferences): boolean {
  return preferences.allowAutomaticBuildChecks || preferences.allowAutomaticTests;
}

export function canAttemptRepairAutomatically(preferences: ControlPreferences): boolean {
  return preferences.allowAutomaticRepair;
}
