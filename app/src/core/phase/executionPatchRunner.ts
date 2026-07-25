import type { ApplyResult } from "../patch/PatchEngine";
import { pathsFromPatch } from "../patch/PatchEngine";
import type { PhaseBuildPlan, PhaseExecutionState, ProjectBlueprint } from "../types";
import { planNextExecutionStep } from "./executionLoop";
import {
  markPhaseTaskBlocked,
  markPhaseTaskComplete,
  recordPhaseCheckStatus,
} from "./phaseExecutionState";

export interface ExecutionPatchEngine {
  validatePatch(patch: string): { valid: boolean; paths: string[]; error?: string };
  preview(patch: string): Promise<Map<string, { old: string; new: string }>>;
  apply(patch: string): Promise<ApplyResult>;
}

export type ExecutionPatchRunnerStatus = "applied" | "needsApproval" | "blocked" | "failed";

export interface ExecutionPatchRunnerResult {
  status: ExecutionPatchRunnerStatus;
  reason: string;
  appliedFiles: string[];
  failed: { path: string; error: string }[];
  state: PhaseExecutionState;
}

export interface ExecutionPatchRunnerRequest {
  blueprint?: ProjectBlueprint;
  plan: PhaseBuildPlan;
  state: PhaseExecutionState;
  patch: string;
  patchEngine: ExecutionPatchEngine;
  now?: string;
  founderApprovedChange?: boolean;
}

const APPROVAL_TEXT_PATTERNS = [
  /\bcredential(s)?\b/i,
  /\bapi[\s_-]?key(s)?\b/i,
  /\baccount(s)?\b/i,
  /\bpaid\b/i,
  /\bpayment(s)?\b/i,
  /\bbilling\b/i,
  /\bdeployment\b/i,
  /\blegal\b/i,
  /\bprivacy\b/i,
  /\bscope change\b/i,
];

const DESTRUCTIVE_TEXT_PATTERNS = [
  /\bdelete\b/i,
  /\bremove existing\b/i,
  /\bdrop\b/i,
  /\bdestroy\b/i,
  /\brewrite\b/i,
  /\bredesign\b/i,
  /\brestructure\b/i,
];

function phaseIsApproved(plan: PhaseBuildPlan, phaseId: string): boolean {
  const phase = plan.phases.find((item) => item.id === phaseId);
  return phase?.status === "approved" || phase?.status === "active";
}

function patchDeletesFile(patch: string): boolean {
  return /^---\s+a\/.+\r?\n\+\+\+\s+\/dev\/null/m.test(patch);
}

function patchLooksSensitive(patch: string): boolean {
  return APPROVAL_TEXT_PATTERNS.some((pattern) => pattern.test(patch));
}

function patchLooksDestructive(patch: string): boolean {
  return patchDeletesFile(patch) || DESTRUCTIVE_TEXT_PATTERNS.some((pattern) => pattern.test(patch));
}

function hasPreservationWarning(blueprint: ProjectBlueprint | undefined, constraints: string[]): boolean {
  if (blueprint?.identity.source !== "existingProject") return false;
  return constraints.some((constraint) =>
    /touch existing ui|routes|screens|widgets|workflows|rewrite|redesign|restructure/i.test(constraint)
  );
}

function approvalResult(
  request: ExecutionPatchRunnerRequest,
  reason: string,
  now: string
): ExecutionPatchRunnerResult {
  return {
    status: "needsApproval",
    reason,
    appliedFiles: [],
    failed: [],
    state: recordPhaseCheckStatus(
      request.state,
      "check",
      "blocked",
      { summary: reason },
      now
    ),
  };
}

function blockedResult(
  request: ExecutionPatchRunnerRequest,
  reason: string,
  now: string
): ExecutionPatchRunnerResult {
  return {
    status: "blocked",
    reason,
    appliedFiles: [],
    failed: [],
    state: markPhaseTaskBlocked(request.state, request.state.currentTaskId, reason, now),
  };
}

export async function runSafeExecutionPatch(
  request: ExecutionPatchRunnerRequest
): Promise<ExecutionPatchRunnerResult> {
  const now = request.now ?? new Date().toISOString();
  const step = planNextExecutionStep(request.plan, request.state);

  if (!phaseIsApproved(request.plan, request.state.currentPhaseId)) {
    return approvalResult(request, "Current phase is not approved for automatic execution.", now);
  }
  if (!request.founderApprovedChange && hasPreservationWarning(request.blueprint, step.constraints)) {
    return approvalResult(request, "Existing-product preservation warning requires manual approval before auto-apply.", now);
  }
  if (step.classification === "blocked") {
    return blockedResult(request, step.reason, now);
  }
  if (!request.founderApprovedChange && step.classification !== "safe") {
    return approvalResult(request, step.reason, now);
  }
  if (!request.founderApprovedChange && patchLooksSensitive(request.patch)) {
    return approvalResult(request, "Patch touches credentials, accounts, payments, deployment, legal/privacy, or scope-sensitive content.", now);
  }
  if (!request.founderApprovedChange && patchLooksDestructive(request.patch)) {
    return blockedResult(request, "Patch appears destructive or replaces existing work; auto-apply is blocked.", now);
  }

  const validation = request.patchEngine.validatePatch(request.patch);
  if (!validation.valid) {
    return blockedResult(request, validation.error ?? "Patch validation failed.", now);
  }
  const paths = pathsFromPatch(request.patch);
  if (paths.length === 0) {
    return blockedResult(request, "Patch does not contain any writable file paths.", now);
  }

  const preview = await request.patchEngine.preview(request.patch);
  const missingPreview = paths.filter((path) => !preview.has(path));
  if (preview.size === 0 || missingPreview.length > 0) {
    return blockedResult(
      request,
      missingPreview.length
        ? `Patch preview is missing writable edits for: ${missingPreview.join(", ")}.`
        : "Patch did not produce writable file previews.",
      now
    );
  }

  const applyResult = await request.patchEngine.apply(request.patch);
  if (applyResult.failed.length > 0 || applyResult.applied.length === 0) {
    return {
      status: "failed",
      reason: applyResult.failed[0]?.error ?? "Patch apply failed.",
      appliedFiles: applyResult.applied,
      failed: applyResult.failed,
      state: recordPhaseCheckStatus(
        request.state,
        "check",
        "failed",
        { summary: applyResult.failed[0]?.error ?? "Patch apply failed." },
        now
      ),
    };
  }

  return {
    status: "applied",
    reason: "Safe non-destructive patch applied.",
    appliedFiles: applyResult.applied,
    failed: [],
    state: markPhaseTaskComplete(request.state, request.plan, request.state.currentTaskId, now),
  };
}
