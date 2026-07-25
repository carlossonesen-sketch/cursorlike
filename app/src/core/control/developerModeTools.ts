import type { ControlPreferences } from "../types";
import { evaluateControlPolicy } from "./controlLevel";

export interface DeveloperToolVisibilityInput {
  preferences: ControlPreferences;
}

export interface RiskyActionInput {
  preferences: ControlPreferences;
  isSensitive?: boolean;
  isDestructive?: boolean;
}

function isDeveloperMode(preferences: ControlPreferences): boolean {
  return preferences.preferredMode === "developer" ||
    preferences.controlLevel === "manual" ||
    preferences.controlLevel === "assisted";
}

export function shouldShowDeveloperTools(input: DeveloperToolVisibilityInput): boolean {
  return isDeveloperMode(input.preferences);
}

export function shouldShowRawTaskState(input: DeveloperToolVisibilityInput): boolean {
  return isDeveloperMode(input.preferences);
}

export function shouldShowPatchControls(input: DeveloperToolVisibilityInput): boolean {
  return isDeveloperMode(input.preferences);
}

export function shouldShowBuildControls(input: DeveloperToolVisibilityInput): boolean {
  return isDeveloperMode(input.preferences);
}

export function shouldShowAuditControls(input: DeveloperToolVisibilityInput): boolean {
  return isDeveloperMode(input.preferences);
}

export function shouldShowManualCommandControls(input: DeveloperToolVisibilityInput): boolean {
  return isDeveloperMode(input.preferences);
}

export function shouldRequireApprovalForRiskyDeveloperAction(input: RiskyActionInput): boolean {
  return evaluateControlPolicy({
    preferences: input.preferences,
    action: "patchApply",
    isSensitive: input.isSensitive,
    isDestructive: input.isDestructive,
  }).requiresApproval;
}
