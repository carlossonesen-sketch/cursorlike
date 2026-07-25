import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  ContextBuilder,
  generateChatResponse,
  generatePlanAndPatch,
  hasDiffRequest,
  KnowledgeStore,
  MemoryStore,
  readGlobalMemory,
  PatchEngine,
  ProjectInspector,
  readProjectFile,
  routeUserMessage,
  applySimpleEdit,
} from "../index";
import {
  createProjectCreationStateFromPrompt,
  generateFounderSpecificationPlan,
  generateProjectCreationErrorResponse,
  parseProjectNameSupply,
  routeNewProjectWorkflow,
  shouldHandleNewProjectMessage,
  updateProjectCreationState,
  applyProjectNameToCreationState,
  detectFounderSpecificationIntent,
  detectNewProjectDetails,
} from "../projectCreation/newProjectIntent";
import { detectStartFoundationIntent } from "../phase/phaseExecutionController";
import {
  detectChangeApprovalChatIntent,
  type ChangeApprovalPresentation,
} from "../phase/changeApprovalController";
import {
  detectPhaseGateChatIntent,
  formatPhaseGateSummaryForChat,
  type PhaseGatePresentation,
} from "../phase/phaseGateController";
import type { ProjectCreationState } from "../projectCreation/projectCreationState";
import { createNextTaskFallbackPatch } from "../projectCreation/nextTaskPatchFallback";
import { resolveBuildPlanTaskPatch } from "../projectCreation/buildPlanTaskPatch";
import { formatModelProviderError, isModelProviderUnavailableError } from "../model/modelProviderErrors";
import { detectImportExistingProjectIntent } from "../projectImport/projectImportIntent";
import { detectProjectOpenIntent, resolveProjectOpenMatch } from "../project/projectOpenIntent";
import {
  hasReadableProjectStatus,
  type ActiveProjectContext,
  isEstablishedProjectWorkspace,
  isExplicitCreateNewProjectIntent,
} from "../project/activeProjectContext";
import { buildScaffoldCompleteContinuationReply, detectContinueBuildIntent, getNextActionableBuildTask, isStatusOnlyProjectPrompt } from "../project/continueIntent";
import {
  applyFounderMvpPhase,
  applyPhase2BuildPlan,
  buildScaffoldPhaseOptionReply,
  detectProjectPlanContinuationIntent,
  detectScaffoldPhaseOptionIntent,
  isScaffoldPhaseComplete,
  resolveDisplayNextStep,
  shouldAutoStartFounderMvp,
} from "../project/scaffoldPhase";
import { hasImplementationScaffold, isImplementationMilestone } from "../project/implementationMilestone";
import { buildCodeAuditReport, buildProjectAuditReport, detectAuditMode, isAuditSaveRequest, selectCodeAuditFiles } from "../project/auditIntent";
import type { CodeAuditSourceFile } from "../project/auditIntent";
import {
  detectBuildCheckIntent,
  detectBuildCommand,
  detectBuildFailureFixIntent,
  runApprovedBuildCheck,
  summarizeBuildCheck,
  validateBuildCheckWorkspace,
  workspacePathsMatch,
  type BuildCheckRequest,
  type BuildCheckResult,
} from "../project/buildCheck";
import {
  createFullFileReplacementPatch,
  buildFailureOutput,
  formatBuildFailureReferences,
  repairReferencedBuildFailure,
  storeBuildFailure,
  type BuildFailureReference,
  type StoredBuildFailure,
} from "../project/buildRepair";
import { createNewFilePatch, detectCreateFileIntent, generateNewFileContent } from "../intent/createFileIntent";
import { pathsFromPatch } from "../patch/PatchEngine";
import { appendActionLogEntry, readActionLog } from "../memory/actionLogStore";
import { readFounderManifest } from "../memory/founderManifestStore";
import { readLivingBuildPlan } from "../memory/buildPlanStore";
import { readProjectMemory } from "../memory/projectMemoryStore";
import {
  formatProjectRegistry,
  isProjectRegistryListPrompt,
  validateActiveProjectMemoryPath,
} from "../memory/memoryIsolation";
import { repairScaffoldCompletionIfNeeded } from "../memory/scaffoldRepair";
import { auditWebsitePlatformMvp, formatDiskTruthSummary } from "../project/mvpDiskAudit";
import { reconcileBuildPlanWithDisk } from "../project/diskReconciliation";
import { persistReconciledBuildPlan } from "../project/scaffoldPhase";
import type {
  ActionLogEntry,
  FounderManifest,
  KnownProject,
  LivingBuildPlan,
  ModelContext,
  PlanAndPatch,
  ProjectMemory,
  PlannerOutput,
  ProjectManifest,
  ProjectSnapshot,
  ReviewerOutput,
  SessionRecord,
} from "../types";
import type { WorkspaceService } from "../workspace/WorkspaceService";
import type { ThinkingLine } from "../../components/ThinkingPane";

const CODING_CHANGE_WORDS = /\b(make|change|fix|add|update|remove|delete|replace|rename|move|refactor|implement|create|build|wire|hook up|adjust|improve)\b/i;
const AMBIGUOUS_THIS_FILE = /\b(this|current)\s+file\b/i;
const BUILD_TIME_PROMPT = /\b(what(?:'s| is)\s+(?:the\s+)?build\s+time|how\s+long\s+(?:will|would)\s+(?:this|the)\s+(?:project|mvp|build)\s+take|build\s+time\s+(?:estimate|on\s+this\s+project)|estimated\s+(?:build|mvp)\s+time)\b/i;
const STALE_PLANNING_STEP = /\b(review and approve|preview the initial files|before anything is written|generate .*build plan|approve this plan)\b/i;
const BUILD_FIX_DIAGNOSTICS = import.meta.env.DEV;

function logBuildFixDiagnostic(message: string, data?: unknown): void {
  if (!BUILD_FIX_DIAGNOSTICS) return;
  if (data === undefined) {
    console.info(`[build-fix] ${message}`);
  } else {
    console.info(`[build-fix] ${message}`, data);
  }
}

function warnBuildFixDiagnostic(message: string, data?: unknown): void {
  if (!BUILD_FIX_DIAGNOSTICS) return;
  if (data === undefined) {
    console.warn(`[build-fix] ${message}`);
  } else {
    console.warn(`[build-fix] ${message}`, data);
  }
}

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type FileEditSaveStatus = "idle" | "saving" | "saved" | "error";

export interface FileEditVerifyInfo {
  absolutePath: string;
  fileSizeBytes: number;
  contentHashPrefix: string;
}

export interface FileEditState {
  relativePath: string;
  baselineText: string;
  baselineUpdatedAt: number;
  originalText: string;
  editedText: string;
  dirty: boolean;
  lastSaveStatus: FileEditSaveStatus;
  savedAt?: number;
  saveError?: string;
  verifyInfo?: FileEditVerifyInfo;
}

function isCodingChangePrompt(prompt: string): boolean {
  return CODING_CHANGE_WORDS.test(prompt);
}

function tokenizeTask(prompt: string): string[] {
  const stop = new Set([
    "the", "and", "for", "with", "from", "this", "that", "file", "code", "make", "change",
    "fix", "add", "update", "remove", "delete", "replace", "rename", "move", "refactor",
    "implement", "create", "build", "wire", "hook", "adjust", "improve", "please",
  ]);
  return [...new Set(
    prompt
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 3 && !stop.has(token))
  )];
}

function inferRelevantPaths(prompt: string, manifest: ProjectManifest | null, projectSnapshot: ProjectSnapshot | null): string[] {
  const files = manifest?.fileList ?? [];
  const sourceFiles = files.filter((path) =>
    /\.(tsx?|jsx?|rs|py|go|cs|java|kt|swift|vue|svelte|css|scss|html|json|toml|yaml|yml|md)$/i.test(path)
  );
  const tokens = tokenizeTask(prompt);
  const scored = sourceFiles
    .map((path) => {
      const lower = path.toLowerCase();
      const name = lower.split("/").pop() ?? lower;
      const score = tokens.reduce((sum, token) => {
        if (name.includes(token)) return sum + 5;
        if (lower.includes(token)) return sum + 2;
        return sum;
      }, 0);
      return { path, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.split("/").length - b.path.split("/").length || a.path.length - b.path.length);

  const matched = scored.slice(0, 6).map((entry) => entry.path);
  if (matched.length > 0) return matched;

  const preferred = [
    ...(projectSnapshot?.importantFiles ?? []),
    "src/App.tsx",
    "src/App.ts",
    "src/main.tsx",
    "src/main.ts",
    "src/index.tsx",
    "src/index.ts",
    "app/src/App.tsx",
    "package.json",
    "README.md",
  ];
  const preferredFound = preferred.filter((path) => files.includes(path));
  if (preferredFound.length > 0) return [...new Set(preferredFound)].slice(0, 6);

  return sourceFiles
    .filter((path) => !path.includes(".lock") && !path.toLowerCase().includes("package-lock"))
    .slice(0, 6);
}

function describePendingPatch(session: SessionRecord | null): string {
  if (!session) return "";
  const files = session.filesChanged.map((file) => file.path).filter(Boolean);
  if (files.length === 1) {
    return `There is a pending patch for ${files[0]} that has not been applied yet.`;
  }
  if (files.length > 1) {
    return `There is a pending patch for ${files.join(", ")} that has not been applied yet.`;
  }
  return "There is a pending patch that has not been applied yet.";
}

function pendingPatchNextStep(session: SessionRecord | null): string | null {
  if (!session) return null;
  const files = session.filesChanged.map((file) => file.path).filter(Boolean);
  if (files.length === 1) return `Apply pending patch for ${files[0]}.`;
  if (files.length > 1) return `Apply pending patch for ${files.join(", ")}.`;
  return "Review and apply the pending patch.";
}

function pendingBuildFixPatchMessage(session: SessionRecord | null): string | null {
  if (!session) return null;
  const files = session.filesChanged.map((file) => file.path).filter(Boolean);
  const context = [
    session.userPrompt,
    session.explanation,
    session.patch,
    files.join(" "),
  ].join(" ").toLowerCase();
  if (!/\b(build|tsconfig|typescript|vite|config)\b/.test(context)) return null;
  const target = files.length === 1 ? files[0] : files.length > 1 ? files.join(", ") : "the pending patch";
  return `There is already a pending build-fix patch for ${target}. Apply that first, then rerun the build check.`;
}

async function isStaleNewFileBuildFixPatch(session: SessionRecord | null, workspace: WorkspaceService): Promise<boolean> {
  if (!session || !/---\s+\/dev\/null\b/.test(session.patch)) return false;
  const files = session.filesChanged.map((file) => file.path).filter(Boolean);
  const patchPaths = pathsFromPatch(session.patch);
  const targets = files.length ? files : patchPaths;
  if (!targets.length) return false;
  const existing = await Promise.all(targets.map((path) => workspace.exists(path).catch(() => false)));
  return existing.some(Boolean);
}

function safeNextRecommendedStep(
  rawStep: string | undefined,
  activeTaskTitle: string | undefined,
  pendingPatch: SessionRecord | null,
  projectMemory?: ProjectMemory | null,
  livingBuildPlan?: LivingBuildPlan | null
): string {
  const pending = pendingPatchNextStep(pendingPatch);
  if (pending) return pending;
  if (livingBuildPlan) {
    const resolved = resolveDisplayNextStep(livingBuildPlan, projectMemory);
    const trimmed = rawStep?.trim() ?? "";
    if (!trimmed || STALE_PLANNING_STEP.test(trimmed) || (isScaffoldPhaseComplete(livingBuildPlan) && trimmed !== resolved)) {
      return resolved;
    }
  }
  const trimmed = rawStep?.trim() ?? "";
  if (!trimmed || STALE_PLANNING_STEP.test(trimmed)) {
    if (activeTaskTitle && !/scaffold/i.test(activeTaskTitle)) return activeTaskTitle;
    return projectMemory?.generatedFiles?.length
      ? "Run build check or continue the first working interaction."
      : activeTaskTitle || "Run build check or continue the first working interaction.";
  }
  return trimmed;
}

function countTasks(milestone: LivingBuildPlan["milestones"][number] | undefined): { completed: number; total: number } {
  const tasks = milestone?.tasks ?? [];
  return {
    completed: tasks.filter((task) => task.status === "done").length,
    total: tasks.length,
  };
}

function summarizeCompletedTasks(plan: LivingBuildPlan | null): string {
  const completed = plan?.milestones
    .flatMap((milestone) => milestone.tasks.map((task) => ({ milestone: milestone.name, task })))
    .filter((entry) => entry.task.status === "done")
    .slice(-5) ?? [];
  if (!completed.length) return "No build-plan tasks are marked complete yet.";
  return completed.map((entry) => `${entry.task.title} (${entry.milestone})`).join("; ");
}

function latestActionSummary(actionLog: ActionLogEntry[]): string {
  const latest = [...actionLog].reverse().find((entry) => entry.summary?.trim());
  return latest?.summary ?? "";
}

async function buildFailureFileContext(workspace: WorkspaceService, refs: BuildFailureReference[]): Promise<string> {
  const paths = [...new Set(refs.map((ref) => ref.path))];
  const sections: string[] = [];
  for (const path of paths) {
    try {
      const content = await workspace.readFile(path);
      const lines = content.split(/\r?\n/);
      const refLines = refs.filter((ref) => ref.path === path);
      const snippets = refLines.map((ref) => {
        const start = Math.max(1, ref.line - 4);
        const end = Math.min(lines.length, ref.line + 4);
        const body = lines
          .slice(start - 1, end)
          .map((line, index) => {
            const lineNumber = start + index;
            const marker = lineNumber === ref.line ? ">" : " ";
            return `${marker} ${lineNumber}: ${line}`;
          })
          .join("\n");
        return `${path}:${ref.line}:${ref.column} ${ref.message}\n${body}`;
      });
      sections.push([
        `Failing file: ${path}`,
        "Error line snippets:",
        snippets.join("\n\n"),
        "File content:",
        content.slice(0, 12000),
      ].join("\n"));
    } catch {
      /* ignore unreadable failure path */
    }
  }
  return sections.join("\n\n");
}

async function selectBuildDebugFiles(workspace: WorkspaceService, refs: BuildFailureReference[] = []): Promise<string[]> {
  const candidates = refs.length
    ? refs.map((ref) => ref.path)
    : [
        "package.json",
        "tsconfig.json",
        "tsconfig.app.json",
        "vite.config.ts",
        "vite.config.js",
        "src/main.ts",
        "src/main.tsx",
      ];
  const existing = await Promise.all(
    candidates.map(async (path) => (await workspace.exists(path).catch(() => false)) ? path : null)
  );
  return [...new Set(existing.filter((path): path is string => Boolean(path)))];
}

async function readJsonValidationError(workspace: WorkspaceService, path: string): Promise<string | null> {
  const exists = await workspace.exists(path).catch(() => false);
  if (!exists) return null;
  try {
    const content = await workspace.readFile(path);
    const parsed = JSON.parse(content);
    if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") {
      return `${path}: JSON root value must be an object`;
    }
    return null;
  } catch (e) {
    return `${path}: invalid JSON (${e instanceof Error ? e.message : String(e)})`;
  }
}

async function previewPatchOrThrow(
  engine: PatchEngine,
  patch: string,
  requiredPaths: string[] = []
): Promise<Map<string, { old: string; new: string }>> {
  const patchPaths = pathsFromPatch(patch);
  if (patchPaths.length === 0) {
    throw new Error("No valid patch generated. The proposal did not name any files to edit.");
  }
  const preview = await engine.preview(patch);
  if (preview.size === 0) {
    throw new Error("No valid patch generated. The proposal did not contain any writable file edits.");
  }
  const map = new Map<string, { old: string; new: string }>();
  preview.forEach((value, key) => map.set(key, value));
  const missingPatchPaths = patchPaths.filter((path) => !map.has(path));
  if (missingPatchPaths.length > 0) {
    throw new Error(`No valid patch generated. Could not preview edits for: ${missingPatchPaths.join(", ")}.`);
  }
  const missingRequiredPaths = requiredPaths.filter((path) => !map.has(path));
  if (missingRequiredPaths.length > 0) {
    throw new Error(`No valid patch generated for required file(s): ${missingRequiredPaths.join(", ")}.`);
  }
  return map;
}

function formatPatchProposalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no patch was generated|no valid patch generated/i.test(message)) {
    return "No valid patch generated. I need concrete writable file edits before this can be applied.";
  }
  return message;
}

function patchHasDiffText(patch: string | undefined): boolean {
  return Boolean(patch && /(^|\n)---\s+(?:a\/|\/dev\/null)/.test(patch) && /(^|\n)\+\+\+\s+(?:b\/|\/dev\/null)/.test(patch) && /(^|\n)@@\s/.test(patch));
}

async function createBuildFixFallbackPatch(workspace: WorkspaceService): Promise<PlanAndPatch | null> {
  const tsconfigError = await readJsonValidationError(workspace, "tsconfig.json");
  if (!tsconfigError) return null;
  const oldContent = await workspace.readFile("tsconfig.json");
  return createFullFileReplacementPatch("tsconfig.json", oldContent, generateNewFileContent("tsconfig.json", "replace invalid tsconfig.json"));
}

async function createReferencedFileFallbackPatch(
  workspace: WorkspaceService,
  refs: BuildFailureReference[]
): Promise<PlanAndPatch | null> {
  const byPath = new Map<string, BuildFailureReference[]>();
  for (const ref of refs) {
    const list = byPath.get(ref.path) ?? [];
    list.push(ref);
    byPath.set(ref.path, list);
  }

  for (const [path, pathRefs] of byPath) {
    const oldContent = await workspace.readFile(path);
    const repaired = repairReferencedBuildFailure(path, oldContent, pathRefs);
    if (repaired) {
      return createFullFileReplacementPatch(path, oldContent, repaired);
    }
  }

  return null;
}

async function createCodingTaskFallbackPatch(
  workspace: WorkspaceService,
  prompt: string,
  contextPaths: string[]
): Promise<PlanAndPatch | null> {
  return createNextTaskFallbackPatch(workspace, prompt, contextPaths);
}

function sameProjectPath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase() ===
    b.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function buildProjectResumeReply(
  workspacePath: string,
  projectMemory: ProjectMemory | null,
  livingBuildPlan: LivingBuildPlan | null,
  founderManifest: FounderManifest | null,
  pendingPatch: SessionRecord | null,
  actionLog: ActionLogEntry[],
  diskTruthSection?: string | null
): string {
  const projectName = projectMemory?.name?.trim() || founderManifest?.projectId?.trim() || workspacePath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Current project";
  const activeMilestone = livingBuildPlan?.milestones.find((milestone) => milestone.id === livingBuildPlan.currentMilestoneId);
  const activeTask = activeMilestone?.tasks.find((task) => task.id === livingBuildPlan?.currentTaskId);
  const lastWork = projectMemory?.recentWork?.[0];
  const taskCounts = countTasks(activeMilestone);
  const nextStep = safeNextRecommendedStep(
    livingBuildPlan?.nextRecommendedStep || projectMemory?.resumeState?.resumePrompt,
    activeTask?.title,
    pendingPatch,
    projectMemory,
    livingBuildPlan
  );
  const pending = describePendingPatch(pendingPatch);
  const progress = livingBuildPlan?.progressSummary?.trim() ||
    `${activeMilestone?.name || "Current milestone"}: ${taskCounts.completed} / ${taskCounts.total} tasks complete.`;
  const lastCompleted = lastWork?.completed || latestActionSummary(actionLog) || "No completed work recorded yet.";
  return [
    `Project: ${projectName}`,
    `Path: ${workspacePath}`,
    `Current milestone: ${activeMilestone?.name || livingBuildPlan?.currentMilestoneId || "Not set"}`,
    `Progress: ${progress}`,
    `Completed tasks: ${summarizeCompletedTasks(livingBuildPlan)}`,
    `Last completed work: ${lastCompleted}`,
    pending,
    `Next recommended step: ${nextStep}`,
    diskTruthSection,
  ].filter(Boolean).join("\n");
}

async function buildProjectResumeReplyAsync(
  workspace: WorkspaceService,
  workspacePath: string,
  projectMemory: ProjectMemory | null,
  livingBuildPlan: LivingBuildPlan | null,
  founderManifest: FounderManifest | null,
  pendingPatch: SessionRecord | null,
  actionLog: ActionLogEntry[]
): Promise<string> {
  const audit = await auditWebsitePlatformMvp(workspace, livingBuildPlan, projectMemory);
  return buildProjectResumeReply(
    workspacePath,
    projectMemory,
    livingBuildPlan,
    founderManifest,
    pendingPatch,
    actionLog,
    formatDiskTruthSummary(audit)
  );
}

function buildTimeReply(
  projectMemory: ProjectMemory | null,
  livingBuildPlan: LivingBuildPlan | null,
  founderManifest: FounderManifest | null
): string {
  const projectName = projectMemory?.name?.trim() || founderManifest?.projectId?.trim() || livingBuildPlan?.projectId || "Current project";
  const timeline = livingBuildPlan?.timelineEstimate?.trim() || "No formal total timeline estimate is saved yet.";
  const mvpEstimate = /mvp/i.test(timeline)
    ? timeline
    : "MVP estimate: use the active build plan milestones as the source of truth; if no estimate is saved, create/approve the master build plan first.";
  const milestones = livingBuildPlan?.milestones.map((milestone, index) => `${index + 1}. ${milestone.name}: ${milestone.goal}`).join("\n") || "No milestones saved yet.";
  return [
    `Project: ${projectName}`,
    `Total estimated build time: ${timeline}`,
    `Estimated MVP time: ${mvpEstimate}`,
    "Phased build plan:",
    milestones,
    `Next recommended step: ${livingBuildPlan?.nextRecommendedStep || "Create or approve the master build plan."}`,
  ].join("\n");
}

function buildPlanTaskPrompt(
  userPrompt: string,
  plan: LivingBuildPlan,
  milestone: LivingBuildPlan["milestones"][number],
  task: LivingBuildPlan["milestones"][number]["tasks"][number]
): string {
  const lines = [
    userPrompt,
    "",
    "Continue from the active living build plan.",
    `Current milestone: ${milestone.name}`,
    `Task to complete: ${task.title}`,
    task.description ? `Task detail: ${task.description}` : "",
    `MVP definition: ${plan.mvpDefinition}`,
    "Implement only this task. Return a concrete unified diff or full-file replacement. Do not summarize only. Do not apply the patch.",
  ];
  if (isImplementationMilestone(milestone.id)) {
    lines.push(
      "This is an implementation task. Create or modify real application source files such as package.json, tsconfig.json, vite.config.ts, src/, and public/.",
      "Do not satisfy this task by editing docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md only."
    );
  }
  return lines.filter(Boolean).join("\n");
}

interface UseChatControllerOptions {
  workspace: WorkspaceService;
  workspacePath: string | null;
  selectedPaths: string[];
  manifest: ProjectManifest | null;
  useKnowledgePacks: boolean;
  projectSnapshot: ProjectSnapshot | null;
  projectMemory: ProjectMemory | null;
  livingBuildPlan: LivingBuildPlan | null;
  founderManifest: FounderManifest | null;
  projectCreationState: ProjectCreationState | null;
  pendingPatchSession: SessionRecord | null;
  currentProposedSessionId: string | null;
  enabledPacks: string[];
  lastFileChoiceCandidates: string[] | null;
  abortControllerRef: MutableRefObject<AbortController | null>;
  activeRunIdRef: MutableRefObject<string | null>;
  fetchSessionsAndResume: () => Promise<void>;
  onImportExistingProject: () => Promise<void>;
  onOpenKnownProject: (projectPath: string) => Promise<void>;
  onStartFoundationPhase?: () => Promise<void>;
  onApprovePendingChange?: () => Promise<void>;
  onRejectPendingChange?: () => Promise<void>;
  onExplainPendingChange?: () => void;
  onApprovePhaseAndContinue?: (overrideBlockers?: boolean) => Promise<void>;
  onHoldPhase?: () => Promise<void>;
  onRevisePhasePlan?: () => Promise<void>;
  getPhaseGatePresentation?: () => PhaseGatePresentation | null;
  getChangeApprovalPresentation?: () => ChangeApprovalPresentation | null;
  setProjectCreationState: Dispatch<SetStateAction<ProjectCreationState | null>>;
  setManifest: Dispatch<SetStateAction<ProjectManifest | null>>;
  setSelectedPaths: Dispatch<SetStateAction<string[]>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setPlanAndPatch: Dispatch<SetStateAction<PlanAndPatch | null>>;
  setPreviewMap: Dispatch<SetStateAction<Map<string, { old: string; new: string }> | null>>;
  setSelectedDiffPath: Dispatch<SetStateAction<string | null>>;
  setCurrentProposedSessionId: Dispatch<SetStateAction<string | null>>;
  setViewingSessionId: Dispatch<SetStateAction<string | null>>;
  setAppState: Dispatch<SetStateAction<"idle" | "patchProposed" | "patchApplied">>;
  setStatusLine: Dispatch<SetStateAction<string | null>>;
  setShowDiffPanel: Dispatch<SetStateAction<boolean>>;
  setFileEditState: Dispatch<SetStateAction<FileEditState | null>>;
  setPlannerOutput: Dispatch<SetStateAction<PlannerOutput | null>>;
  setReviewerOutput: Dispatch<SetStateAction<ReviewerOutput | null>>;
  setLastRetrievedChunks: Dispatch<
    SetStateAction<{ title: string; sourcePath: string; chunkText: string }[]>
  >;
  setLastFileChoiceCandidates: Dispatch<SetStateAction<string[] | null>>;
  setThinkingLines: Dispatch<SetStateAction<ThinkingLine[]>>;
  setPipelineRunning: Dispatch<SetStateAction<boolean>>;
  setProjectMemory: Dispatch<SetStateAction<ProjectMemory | null>>;
  setLivingBuildPlan: Dispatch<SetStateAction<LivingBuildPlan | null>>;
  setFounderManifest: Dispatch<SetStateAction<FounderManifest | null>>;
}

export function useChatController({
  workspace,
  workspacePath,
  selectedPaths,
  manifest,
  useKnowledgePacks,
  projectSnapshot,
  projectMemory,
  livingBuildPlan,
  founderManifest,
  projectCreationState,
  pendingPatchSession,
  currentProposedSessionId,
  enabledPacks,
  lastFileChoiceCandidates,
  abortControllerRef,
  activeRunIdRef,
  fetchSessionsAndResume,
  onImportExistingProject,
  onOpenKnownProject,
  onStartFoundationPhase,
  onApprovePendingChange,
  onRejectPendingChange,
  onExplainPendingChange,
  onApprovePhaseAndContinue,
  onHoldPhase,
  onRevisePhasePlan,
  getPhaseGatePresentation,
  getChangeApprovalPresentation,
  setProjectCreationState,
  setManifest,
  setSelectedPaths,
  setMessages,
  setPlanAndPatch,
  setPreviewMap,
  setSelectedDiffPath,
  setCurrentProposedSessionId,
  setViewingSessionId,
  setAppState,
  setStatusLine,
  setShowDiffPanel,
  setFileEditState,
  setPlannerOutput,
  setReviewerOutput,
  setLastRetrievedChunks,
  setLastFileChoiceCandidates,
  setThinkingLines,
  setPipelineRunning,
  setProjectMemory,
  setLivingBuildPlan,
  setFounderManifest,
}: UseChatControllerOptions) {
  const processingMessageRef = useRef<string | null>(null);
  const lastHandledMessageIdRef = useRef<string | null>(null);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const lastProjectChoiceCandidatesRef = useRef<KnownProject[] | null>(null);
  const pendingBuildCheckRef = useRef<BuildCheckRequest | null>(null);
  const latestBuildResultRef = useRef<BuildCheckResult | null>(null);
  const lastBuildFailureRef = useRef<StoredBuildFailure | null>(null);

  const clearActionableProposal = useCallback(() => {
    setPlanAndPatch(null);
    setPreviewMap(null);
    setSelectedDiffPath(null);
    setCurrentProposedSessionId(null);
    setAppState("idle");
  }, [setAppState, setCurrentProposedSessionId, setPlanAndPatch, setPreviewMap, setSelectedDiffPath]);

  const loadFreshProjectState = useCallback(async (root: string) => {
    const [diskProjectMemory, diskLivingBuildPlan, diskFounderManifest, actionLog] = await Promise.all([
      readProjectMemory(root),
      readLivingBuildPlan(root),
      readFounderManifest(root),
      readActionLog(root).catch(() => []),
    ]);
    const repaired = await repairScaffoldCompletionIfNeeded(root, workspace, diskProjectMemory, diskLivingBuildPlan);
    const isolationError = validateActiveProjectMemoryPath(root, repaired.projectMemory);
    if (isolationError) throw new Error(isolationError);
    setProjectMemory(repaired.projectMemory);
    setLivingBuildPlan(repaired.livingBuildPlan);
    setFounderManifest(diskFounderManifest);
    const latestSessions = await new MemoryStore(root).listSessions().catch(() => []);
    const freshPendingPatch =
      [...latestSessions].reverse().find((session) =>
        (session.status === "pending" || (session.status === "proposed" && session.id === currentProposedSessionId))
      ) ?? null;
    return {
      projectMemory: repaired.projectMemory,
      livingBuildPlan: repaired.livingBuildPlan,
      founderManifest: diskFounderManifest,
      actionLog,
      pendingPatch: freshPendingPatch,
    };
  }, [currentProposedSessionId, setFounderManifest, setLivingBuildPlan, setProjectMemory, workspace]);

  const sendChatMessage = useCallback(
    async (prompt: string, messageId?: string) => {
      const p = (prompt || "").trim() || "(no prompt)";
      const id = messageId ?? `u-${Date.now()}`;
      if (lastHandledMessageIdRef.current !== null) return;
      lastHandledMessageIdRef.current = id;
      processingMessageRef.current = p;
      setMessages((prev) => [...prev, { id, role: "user", text: p }]);

      if (pendingBuildCheckRef.current && /^(yes|y|run|approve|approved|do it)$/i.test(p)) {
        const request = pendingBuildCheckRef.current;
        pendingBuildCheckRef.current = null;
        setStatusLine(`Running ${request.command}...`);
        try {
          const validationError = validateBuildCheckWorkspace(request);
          if (validationError) throw new Error(validationError);
          const result = await runApprovedBuildCheck(request);
          latestBuildResultRef.current = result;
          if (result.runId !== request.runId) {
            throw new Error(`Build check returned mismatched runId: expected ${request.runId}, got ${result.runId}`);
          }
          if (result.exitCode === 0) {
            lastBuildFailureRef.current = null;
          } else {
            lastBuildFailureRef.current = storeBuildFailure(
              result.command,
              result.workingDirectory,
              result.exitCode,
              buildFailureOutput(result.stdout, result.stderr)
            );
          }
          await appendActionLogEntry(request.workspaceRoot, {
            ts: new Date().toISOString(),
            projectId: projectMemory?.projectId ?? livingBuildPlan?.projectId ?? "",
            action: "run_command",
            summary: `Ran ${result.command} (${result.exitCode === 0 ? "passed" : "failed"})`,
            command: result.command,
            runId: result.runId,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            approved: true,
          }).catch(() => {});
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: summarizeBuildCheck(result) },
          ]);
        } catch (e) {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Build check could not run: ${String(e)}` },
          ]);
        } finally {
          setStatusLine(null);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
        }
        return;
      }

      const projectChoice = /^\s*(\d+)\s*$/.exec(p);
      if (lastProjectChoiceCandidatesRef.current && projectChoice) {
        const idx = parseInt(projectChoice[1], 10);
        const chosen = lastProjectChoiceCandidatesRef.current[idx - 1];
        if (chosen) {
          lastProjectChoiceCandidatesRef.current = null;
          if (sameProjectPath(workspacePath, chosen.path)) {
            let activeRoot = workspace.root;
            if ((!activeRoot || activeRoot === "") && workspacePath) {
              await workspace.setWorkspaceRoot(workspacePath);
              activeRoot = workspace.root ?? workspacePath;
            }
            const fresh = activeRoot ? await loadFreshProjectState(activeRoot) : {
              projectMemory,
              livingBuildPlan,
              founderManifest,
              pendingPatch: pendingPatchSession,
              actionLog: [],
            };
            const statusReply = await buildProjectResumeReplyAsync(
              workspace,
              workspacePath ?? chosen.path,
              fresh.projectMemory,
              fresh.livingBuildPlan,
              fresh.founderManifest,
              fresh.pendingPatch,
              fresh.actionLog
            );
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: statusReply,
              },
            ]);
          } else {
            await onOpenKnownProject(chosen.path);
            let openedRoot = workspace.root ?? chosen.path;
            if ((!openedRoot || openedRoot === "") && chosen.path) {
              await workspace.setWorkspaceRoot(chosen.path);
              openedRoot = workspace.root ?? chosen.path;
            }
            let openReply = `Opened ${chosen.name}.`;
            try {
              const fresh = await loadFreshProjectState(openedRoot);
              if (!hasReadableProjectStatus(fresh)) {
                throw new Error("No project memory or build plan was found in this workspace.");
              }
              setProjectMemory(fresh.projectMemory);
              setLivingBuildPlan(fresh.livingBuildPlan);
              setFounderManifest(fresh.founderManifest);
              openReply = [
                `Opened ${chosen.name}.`,
                "",
                await buildProjectResumeReplyAsync(
                  workspace,
                  chosen.path,
                  fresh.projectMemory,
                  fresh.livingBuildPlan,
                  fresh.founderManifest,
                  fresh.pendingPatch,
                  fresh.actionLog
                ),
              ].join("\n");
            } catch (error) {
              openReply = `Opened ${chosen.name}, but NF could not read project status: ${error instanceof Error ? error.message : String(error)}`;
            }
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: openReply },
            ]);
          }
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
      }
      lastProjectChoiceCandidatesRef.current = null;

      if (isProjectRegistryListPrompt(p)) {
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: formatProjectRegistry(readGlobalMemory()) },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      if (detectStartFoundationIntent(p) && onStartFoundationPhase) {
        clearActionableProposal();
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: "Starting Foundation phase." },
        ]);
        await onStartFoundationPhase();
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      const changeIntent = detectChangeApprovalChatIntent(p);
      if (changeIntent) {
        const changePresentation = getChangeApprovalPresentation?.() ?? null;
        if (changeIntent === "explain_change") {
          if (onExplainPendingChange && changePresentation?.isPending) {
            onExplainPendingChange();
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: "No file change is waiting for approval right now.",
              },
            ]);
          }
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        if (changeIntent === "reject_change" && onRejectPendingChange) {
          await onRejectPendingChange();
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        if (
          (changeIntent === "approve_change" || changeIntent === "continue_building") &&
          onApprovePendingChange &&
          changePresentation?.isPending
        ) {
          await onApprovePendingChange();
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        if (changeIntent === "continue_building" && onStartFoundationPhase && !changePresentation?.isPending) {
          await onStartFoundationPhase();
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
      }

      const phaseGateIntent = detectPhaseGateChatIntent(p);
      if (phaseGateIntent) {
        const presentation = getPhaseGatePresentation?.() ?? null;
        if (phaseGateIntent === "show_gate" || phaseGateIntent === "what_blocking") {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: presentation
                ? formatPhaseGateSummaryForChat(presentation)
                : "No phase gate is waiting for founder approval right now.",
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        if (phaseGateIntent === "hold" && onHoldPhase) {
          await onHoldPhase();
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        if (
          (phaseGateIntent === "approve_phase" || phaseGateIntent === "continue_next_phase") &&
          onApprovePhaseAndContinue
        ) {
          if (!presentation?.canApprove && !presentation?.canApproveWithOverride) {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: presentation?.blockers.length
                  ? `Cannot continue yet. Blockers: ${presentation.blockers.join("; ")}`
                  : "No phase gate is waiting for founder approval right now.",
              },
            ]);
          } else {
            await onApprovePhaseAndContinue(presentation.canApprove ? false : true);
          }
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
      }

      const activeProjectContext: ActiveProjectContext = {
        workspacePath,
        projectMemory,
        livingBuildPlan,
      };

      let root = workspace.root;
      if ((!root || root === "") && workspacePath) {
        await workspace.setWorkspaceRoot(workspacePath);
        root = workspace.root ?? workspacePath;
      }

      if (
        isEstablishedProjectWorkspace(activeProjectContext) &&
        !projectCreationState &&
        !isExplicitCreateNewProjectIntent(p) &&
        (isStatusOnlyProjectPrompt(p) ||
          detectProjectPlanContinuationIntent(p) ||
          detectFounderSpecificationIntent(p) ||
          detectNewProjectDetails(p) ||
          routeNewProjectWorkflow(p, null, activeProjectContext) !== "other")
      ) {
        if (!root) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: "A workspace path is set, but NF could not attach to it. Re-open the project from the project list or File > Open Project.",
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        try {
          const fresh = await loadFreshProjectState(root);
          if (!hasReadableProjectStatus(fresh)) {
            throw new Error("No project memory or build plan was found in this workspace.");
          }
          setProjectMemory(fresh.projectMemory);
          setLivingBuildPlan(fresh.livingBuildPlan);
          setFounderManifest(fresh.founderManifest);
          const statusReply = await buildProjectResumeReplyAsync(
            workspace,
            workspacePath ?? root ?? "",
            fresh.projectMemory,
            fresh.livingBuildPlan,
            fresh.founderManifest,
            fresh.pendingPatch,
            fresh.actionLog
          );
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: statusReply,
            },
          ]);
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: `Could not read project status for ${workspacePath ?? root}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ]);
        }
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      const newProjectRoute = routeNewProjectWorkflow(p, projectCreationState, activeProjectContext);
      if (newProjectRoute === "founder_specification") {
        const state = projectCreationState
          ? updateProjectCreationState(projectCreationState, p)
          : createProjectCreationStateFromPrompt(p, "prompt");
        if (projectCreationState || !workspacePath) setProjectCreationState(state);
        clearActionableProposal();
        let planningResponse: string;
        try {
          planningResponse = generateFounderSpecificationPlan(state, p);
        } catch (error) {
          planningResponse = generateProjectCreationErrorResponse(error);
        }
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: planningResponse },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      if (newProjectRoute === "project_creation" && projectCreationState) {
        const suppliedName = parseProjectNameSupply(p);
        const state = suppliedName
          ? applyProjectNameToCreationState(projectCreationState, suppliedName)
          : projectCreationState.needsProjectName && p.trim().length <= 80 && !/\n/.test(p)
            ? applyProjectNameToCreationState(projectCreationState, p.trim())
            : updateProjectCreationState(projectCreationState, p);
        setProjectCreationState(state);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: state.needsProjectName
              ? "NF still needs a project name before planning can continue. Use the Project name field below or send `Project Name: Your Project Name`."
              : suppliedName || (projectCreationState.needsProjectName && !state.needsProjectName)
                ? `Updated the project name to "${state.projectName}". Review the setup below. No files have been created yet.`
                : "Updated the new project setup below. No files have been created yet.",
          },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      if (shouldHandleNewProjectMessage(p, projectCreationState, activeProjectContext)) {
        const state = createProjectCreationStateFromPrompt(p, "prompt");
        setProjectCreationState(state);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: "I drafted the new project setup below. No files have been created yet." },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      const projectOpenIntent = detectProjectOpenIntent(p);
      if (projectOpenIntent) {
        const globalMemory = readGlobalMemory();
        const match = resolveProjectOpenMatch(projectOpenIntent.query, globalMemory.projects);
        if (match.status === "single") {
          if (sameProjectPath(workspacePath, match.project.path)) {
            let activeRoot = workspace.root;
            if ((!activeRoot || activeRoot === "") && workspacePath) {
              await workspace.setWorkspaceRoot(workspacePath);
              activeRoot = workspace.root ?? workspacePath;
            }
            const fresh = activeRoot ? await loadFreshProjectState(activeRoot) : {
              projectMemory,
              livingBuildPlan,
              founderManifest,
              pendingPatch: pendingPatchSession,
              actionLog: [],
            };
            const statusReply = await buildProjectResumeReplyAsync(
              workspace,
              workspacePath ?? match.project.path,
              fresh.projectMemory,
              fresh.livingBuildPlan,
              fresh.founderManifest,
              fresh.pendingPatch,
              fresh.actionLog
            );
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: statusReply,
              },
            ]);
          } else {
            await onOpenKnownProject(match.project.path);
            let openedRoot = workspace.root ?? match.project.path;
            if ((!openedRoot || openedRoot === "") && match.project.path) {
              await workspace.setWorkspaceRoot(match.project.path);
              openedRoot = workspace.root ?? match.project.path;
            }
            let openReply = `Opened ${match.project.name}.`;
            try {
              const fresh = await loadFreshProjectState(openedRoot);
              if (!hasReadableProjectStatus(fresh)) {
                throw new Error("No project memory or build plan was found in this workspace.");
              }
              setProjectMemory(fresh.projectMemory);
              setLivingBuildPlan(fresh.livingBuildPlan);
              setFounderManifest(fresh.founderManifest);
              openReply = [
                `Opened ${match.project.name}.`,
                "",
                await buildProjectResumeReplyAsync(
                  workspace,
                  match.project.path,
                  fresh.projectMemory,
                  fresh.livingBuildPlan,
                  fresh.founderManifest,
                  fresh.pendingPatch,
                  fresh.actionLog
                ),
              ].join("\n");
            } catch (error) {
              openReply = `Opened ${match.project.name}, but NF could not read project status: ${error instanceof Error ? error.message : String(error)}`;
            }
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: openReply },
            ]);
          }
        } else if (match.status === "multiple") {
          lastProjectChoiceCandidatesRef.current = match.projects;
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: `Which project?\n${match.projects.map((project, i) => `${i + 1}. ${project.name} - ${project.path}`).join("\n")}\n\nReply with a number.`,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: `I couldn't find "${projectOpenIntent.query}" in global memory. Use Import Existing Project to track it, or Create New Project if it does not exist yet.`,
            },
          ]);
        }
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      if (detectImportExistingProjectIntent(p)) {
        await onImportExistingProject();
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: "I drafted an import evaluation below. No memory files have been written yet." },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      root = workspace.root;
      if ((!root || root === "") && workspacePath) {
        await workspace.setWorkspaceRoot(workspacePath);
        root = workspace.root ?? workspacePath;
      }
      if (!workspacePath || root == null || root === "") {
        if (projectCreationState) {
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: projectCreationState.needsProjectName
                ? "NF is still setting up this new project. Add the project name in the Create New Project card or send `Project Name: Your Project Name`."
                : "Continue in the Create New Project card below. No workspace is required until files are approved for creation.",
            },
          ]);
          return;
        }
        console.warn("[App] sendChatMessage blocked: no workspace root.");
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: "Open a workspace first, or describe the new project you want to create.",
          },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      const nowIso = () => new Date().toISOString();
      const ts = Date.now();

      if (BUILD_TIME_PROMPT.test(p)) {
        const fresh = await loadFreshProjectState(root);
        clearActionableProposal();
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: buildTimeReply(fresh.projectMemory, fresh.livingBuildPlan, fresh.founderManifest),
          },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      if (detectContinueBuildIntent(p) || shouldAutoStartFounderMvp(p, livingBuildPlan)) {
        let fresh = await loadFreshProjectState(root);
        if (shouldAutoStartFounderMvp(p, fresh.livingBuildPlan) && fresh.projectMemory && fresh.livingBuildPlan) {
          const hasScaffold = await hasImplementationScaffold(workspace);
          const applied = await applyFounderMvpPhase(root, fresh.projectMemory, fresh.livingBuildPlan, hasScaffold);
          setProjectMemory(applied.projectMemory);
          setLivingBuildPlan(applied.livingBuildPlan);
          fresh = { ...fresh, projectMemory: applied.projectMemory, livingBuildPlan: applied.livingBuildPlan };
          if (!detectContinueBuildIntent(p)) {
            clearActionableProposal();
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: buildScaffoldPhaseOptionReply("founder_mvp", applied.livingBuildPlan),
              },
            ]);
            processingMessageRef.current = null;
            lastHandledMessageIdRef.current = null;
            return;
          }
        }
        let next = getNextActionableBuildTask(fresh.livingBuildPlan);
        if (!next && fresh.projectMemory && fresh.livingBuildPlan) {
          const diskFix = await reconcileBuildPlanWithDisk(workspace, fresh.livingBuildPlan, fresh.projectMemory);
          if (diskFix.changed) {
            const persisted = await persistReconciledBuildPlan(root, fresh.projectMemory, diskFix.plan);
            setProjectMemory(persisted.projectMemory);
            setLivingBuildPlan(persisted.livingBuildPlan);
            fresh = { ...fresh, projectMemory: persisted.projectMemory, livingBuildPlan: persisted.livingBuildPlan };
          }
          next = getNextActionableBuildTask(fresh.livingBuildPlan);
        }
        if (!next) {
          clearActionableProposal();
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: buildScaffoldCompleteContinuationReply(fresh.livingBuildPlan),
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        if (next.task.status === "blocked") {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: `The next task is blocked: ${next.task.title}\n\n${next.task.description || "No blocker details are recorded. Update the build plan with what is needed to unblock this task."}`,
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }

        const taskPrompt = buildPlanTaskPrompt(p, fresh.livingBuildPlan, next.milestone, next.task);
        const runId = `build-plan-task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        activeRunIdRef.current = runId;
        setPlanAndPatch(null);
        setPreviewMap(null);
        setSelectedDiffPath(null);
        setCurrentProposedSessionId(null);
        setAppState("idle");
        setStatusLine(`Building task: ${next.task.title}`);
        setPipelineRunning(true);
        setThinkingLines((prev) => [...prev, { id: `t-${ts}-build-plan-task`, text: `BUILD_PLAN_TASK: ${next.task.title}`, type: "status", timestamp: nowIso() }]);
        try {
          const inspector = new ProjectInspector(workspace);
          const m = manifest ?? (await inspector.buildManifest());
          if (!manifest) setManifest(m);
          const inferredPaths = selectedPaths.length ? selectedPaths : inferRelevantPaths(taskPrompt, m, projectSnapshot);
          setSelectedPaths(inferredPaths);
          const ctxBuilder = new ContextBuilder(workspace, m);
          const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
          const ctx = await ctxBuilder.build(taskPrompt, inferredPaths, {
            useKnowledge: useKnowledgePacks,
            knowledgeStore: knowledgeStore ?? undefined,
            agentRole: "coder",
            projectSnapshot: projectSnapshot ?? undefined,
            projectMemory: fresh.projectMemory,
            livingBuildPlan: fresh.livingBuildPlan,
            founderManifest: fresh.founderManifest,
            enabledPacks: enabledPacks.length ? enabledPacks : undefined,
          });
          setLastRetrievedChunks(
            ctx.knowledgeChunks?.map((chunk) => ({
              title: chunk.title,
              sourcePath: chunk.sourcePath,
              chunkText: chunk.chunkText,
            })) ?? []
          );
          const buildPatch = async (promptText: string) => {
            const nextCtx = promptText === taskPrompt
              ? ctx
              : await ctxBuilder.build(promptText, inferredPaths, {
                  useKnowledge: useKnowledgePacks,
                  knowledgeStore: knowledgeStore ?? undefined,
                  agentRole: "coder",
                  projectSnapshot: projectSnapshot ?? undefined,
                  projectMemory: fresh.projectMemory,
                  livingBuildPlan: fresh.livingBuildPlan,
                  founderManifest: fresh.founderManifest,
                  enabledPacks: enabledPacks.length ? enabledPacks : undefined,
                });
            return generatePlanAndPatch(nextCtx);
          };
          let patchResult: PlanAndPatch;
          let usedOfflineFallback = false;
          try {
            const resolved = await resolveBuildPlanTaskPatch(workspace, taskPrompt, inferredPaths, buildPatch);
            patchResult = resolved.patch;
            usedOfflineFallback = resolved.usedOfflineFallback;
          } catch (error) {
            const quotaMessage = isModelProviderUnavailableError(error)
              ? `${formatModelProviderError(error)}\n\nNo offline fallback patch was available for this task. Add billing/API quota, switch to a local model, or ask NF to scaffold the task manually.`
              : formatPatchProposalError(error);
            throw new Error(quotaMessage);
          }
          const engine = new PatchEngine(root, (path) => workspace.readFile(path));
          let map: Map<string, { old: string; new: string }>;
          try {
            map = await previewPatchOrThrow(engine, patchResult.patch);
          } catch {
            const fallback = await createCodingTaskFallbackPatch(workspace, taskPrompt, inferredPaths);
            if (!fallback) throw new Error(formatPatchProposalError(new Error("No valid patch generated.")));
            patchResult = fallback;
            usedOfflineFallback = true;
            map = await previewPatchOrThrow(engine, patchResult.patch);
          }
          setPlanAndPatch(patchResult);
          setPreviewMap(map);
          setSelectedDiffPath([...map.keys()][0] ?? null);
          setAppState("patchProposed");
          setShowDiffPanel(true);
          const store = new MemoryStore(root);
          const record = await store.addProposedSession(taskPrompt, inferredPaths, patchResult.explanation, patchResult.patch);
          setCurrentProposedSessionId(record.id);
          await fetchSessionsAndResume();
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: [
                `Next task: ${next.task.title}`,
                "",
                usedOfflineFallback
                  ? "Proposed patch (offline fallback — model provider unavailable):"
                  : "Proposed patch:",
                patchResult.explanation,
              ].join("\n"),
            },
          ]);
        } catch (e) {
          console.error("continue build plan task", e);
          clearActionableProposal();
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Could not generate the next task patch: ${formatPatchProposalError(e)}\n\nThe build-plan task was not advanced. Say "continue" to retry, or ask me to regenerate the patch for this task.` },
          ]);
        } finally {
          console.log("[gen] FALSE", runId, { action: "build_plan_task" });
          setStatusLine(null);
          setPipelineRunning(false);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
        }
        return;
      }

      const scaffoldOption = detectScaffoldPhaseOptionIntent(p);
      if (scaffoldOption && root) {
        const fresh = await loadFreshProjectState(root);
        if (scaffoldOption === "founder_mvp" && fresh.projectMemory && fresh.livingBuildPlan) {
          const hasScaffold = await hasImplementationScaffold(workspace);
          const applied = await applyFounderMvpPhase(root, fresh.projectMemory, fresh.livingBuildPlan, hasScaffold);
          setProjectMemory(applied.projectMemory);
          setLivingBuildPlan(applied.livingBuildPlan);
          clearActionableProposal();
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: buildScaffoldPhaseOptionReply("founder_mvp", applied.livingBuildPlan),
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        if (scaffoldOption === "phase_2" && fresh.projectMemory && fresh.livingBuildPlan) {
          const hasScaffold = await hasImplementationScaffold(workspace);
          const applied = await applyPhase2BuildPlan(root, fresh.projectMemory, fresh.livingBuildPlan, hasScaffold);
          setProjectMemory(applied.projectMemory);
          setLivingBuildPlan(applied.livingBuildPlan);
          clearActionableProposal();
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: buildScaffoldPhaseOptionReply("phase_2", applied.livingBuildPlan),
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        clearActionableProposal();
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: buildScaffoldPhaseOptionReply(scaffoldOption, fresh.livingBuildPlan),
          },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      if (isStatusOnlyProjectPrompt(p) || detectProjectPlanContinuationIntent(p)) {
        const fresh = await loadFreshProjectState(root);
        if (shouldAutoStartFounderMvp(p, fresh.livingBuildPlan) && fresh.projectMemory && fresh.livingBuildPlan) {
          const hasScaffold = await hasImplementationScaffold(workspace);
          const applied = await applyFounderMvpPhase(root, fresh.projectMemory, fresh.livingBuildPlan, hasScaffold);
          setProjectMemory(applied.projectMemory);
          setLivingBuildPlan(applied.livingBuildPlan);
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: buildScaffoldPhaseOptionReply("founder_mvp", applied.livingBuildPlan),
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        const statusReply = await buildProjectResumeReplyAsync(
          workspace,
          workspacePath,
          fresh.projectMemory,
          fresh.livingBuildPlan,
          fresh.founderManifest,
          fresh.pendingPatch,
          fresh.actionLog
        );
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: statusReply,
          },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      if (detectBuildFailureFixIntent(p)) {
        const fresh = await loadFreshProjectState(root);
        const pendingBuildFixSession = fresh.pendingPatch ?? pendingPatchSession;
        const pendingBuildFix = await isStaleNewFileBuildFixPatch(pendingBuildFixSession, workspace)
          ? null
          : pendingBuildFixPatchMessage(pendingBuildFixSession);
        if (pendingBuildFix) {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: pendingBuildFix },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        const failure = lastBuildFailureRef.current;
        const diskJsonError = failure ? null : await readJsonValidationError(workspace, "tsconfig.json");
        if (!failure && !diskJsonError) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: "I do not have a failed build output yet. Run the build check first, then I can inspect the failure and propose a focused patch.",
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        const failureContext = failure
          ? [
              `Command: ${failure.command}`,
              `Working directory: ${failure.cwd}`,
              `Exit code: ${failure.exitCode}`,
              failure.errorLines.length ? `Error lines:\n${failure.errorLines.join("\n")}` : "",
              failure.output ? `Output:\n${failure.output.slice(-8000)}` : "Output: (none)",
            ].filter(Boolean).join("\n\n")
          : `Current disk validation error:\n${diskJsonError}`;
        const failureRefs = failure ? failure.refs : [];
        const requiredPatchPaths = failureRefs.map((ref) => ref.path);
        const debugFiles = failureRefs.length
          ? await selectBuildDebugFiles(workspace, failureRefs)
          : await selectBuildDebugFiles(workspace, []);
        const failureFileContext = await buildFailureFileContext(workspace, failureRefs);
        const srcMainRead = debugFiles.includes("src/main.ts") && (await workspace.exists("src/main.ts").catch(() => false));
        logBuildFixDiagnostic("diagnostics", {
          detectedBuildErrors: failureRefs,
          selectedFiles: debugFiles,
          srcMainRead,
          requiredPatchPaths,
        });
        setSelectedPaths(debugFiles);
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await inspector.buildManifest());
        if (!manifest) setManifest(m);
        const ctxBuilder = new ContextBuilder(workspace, m);
        const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
        const debugPrompt = [
          p,
          "",
            "Use this failed build output as primary context. Inspect the selected config/source files and propose the smallest patch. Do not rerun the build.",
            failureRefs.length ? `Failing file references:\n${formatBuildFailureReferences(failureRefs)}` : "",
            failureFileContext,
            failureContext,
            "Return a concrete unified diff OR full-file replacement for the failing files. Do not summarize only.",
          ].join("\n");
        setPlanAndPatch(null);
        setPreviewMap(null);
        setSelectedDiffPath(null);
        setCurrentProposedSessionId(null);
        setAppState("idle");
        setStatusLine("Diagnosing build failure...");
        setPipelineRunning(true);
        try {
          const buildPatch = async (promptText: string) => {
            const ctx = await ctxBuilder.build(promptText, debugFiles, {
              useKnowledge: useKnowledgePacks,
              knowledgeStore: knowledgeStore ?? undefined,
              agentRole: "coder",
              projectSnapshot: projectSnapshot ?? undefined,
              projectMemory,
              livingBuildPlan,
              founderManifest,
              enabledPacks: enabledPacks.length ? enabledPacks : undefined,
            });
            return generatePlanAndPatch(ctx);
          };
          const retryPrompt = [
            debugPrompt,
            "",
            "The previous response did not include concrete edits.",
            "Return a concrete unified diff or full-file replacement for the failing files.",
            requiredPatchPaths.length ? `The patch must edit: ${requiredPatchPaths.join(", ")}` : "",
            "Do not summarize only. Do not ask to rerun the build.",
          ].filter(Boolean).join("\n");
          let patchResult: PlanAndPatch;
          try {
            patchResult = await buildPatch(debugPrompt);
            logBuildFixDiagnostic("model result", {
              hasDiffText: patchHasDiffText(patchResult.patch),
              patchLength: patchResult.patch?.length ?? 0,
              explanation: patchResult.explanation,
            });
          } catch (generationError) {
            warnBuildFixDiagnostic("initial generation failed", generationError);
            const fallback = await createReferencedFileFallbackPatch(workspace, failureRefs) ??
              (failureRefs.length ? null : await createBuildFixFallbackPatch(workspace));
            patchResult = fallback ?? await buildPatch(retryPrompt);
            logBuildFixDiagnostic("fallback/retry result", {
              hasDiffText: patchHasDiffText(patchResult.patch),
              patchLength: patchResult.patch?.length ?? 0,
              explanation: patchResult.explanation,
            });
          }
          const engine = new PatchEngine(root, (path) => workspace.readFile(path));
          let map: Map<string, { old: string; new: string }>;
          try {
            map = await previewPatchOrThrow(engine, patchResult.patch, requiredPatchPaths);
          } catch (previewError) {
            warnBuildFixDiagnostic("zero-write or missing-file preview", {
              reason: previewError instanceof Error ? previewError.message : String(previewError),
              hasDiffText: patchHasDiffText(patchResult.patch),
              patchLength: patchResult.patch?.length ?? 0,
            });
            const fallback = await createReferencedFileFallbackPatch(workspace, failureRefs) ??
              (failureRefs.length ? null : await createBuildFixFallbackPatch(workspace));
            if (fallback) {
              patchResult = fallback;
            } else {
              patchResult = await buildPatch(retryPrompt);
            }
            logBuildFixDiagnostic("retry/fallback preview candidate", {
              hasDiffText: patchHasDiffText(patchResult.patch),
              patchLength: patchResult.patch?.length ?? 0,
              explanation: patchResult.explanation,
            });
            try {
              map = await previewPatchOrThrow(engine, patchResult.patch, requiredPatchPaths);
            } catch (retryPreviewError) {
              const referencedFallback = await createReferencedFileFallbackPatch(workspace, failureRefs);
              if (!referencedFallback) throw retryPreviewError;
              patchResult = referencedFallback;
              map = await previewPatchOrThrow(engine, patchResult.patch, requiredPatchPaths);
            }
          }
          logBuildFixDiagnostic("preview writes", [...map.keys()]);
          setPlanAndPatch(patchResult);
          setPreviewMap(map);
          setSelectedDiffPath([...map.keys()][0] ?? null);
          setAppState("patchProposed");
          setShowDiffPanel(true);
          const store = new MemoryStore(root);
          const record = await store.addProposedSession(p, debugFiles, patchResult.explanation, patchResult.patch);
          setCurrentProposedSessionId(record.id);
          await fetchSessionsAndResume();
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Proposed build fix: ${patchResult.explanation}\n\nRequires build verification after apply: run build test.` },
          ]);
        } catch (e) {
          console.error("build failure debug", e);
          clearActionableProposal();
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Could not propose a build fix: ${formatPatchProposalError(e)}` },
          ]);
        } finally {
          setStatusLine(null);
          setPipelineRunning(false);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
        }
        return;
      }

      if (detectBuildCheckIntent(p)) {
        if (!workspacePath || !workspacePathsMatch(root, workspacePath)) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: [
                "Blocked build check: active project path drift detected.",
                `Active project path: ${workspacePath || "(none)"}`,
                `Command cwd: ${root || "(none)"}`,
                "CWD source: workspace service root before command approval",
                "NF will not run commands until the active project path and command cwd match.",
              ].join("\n"),
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }
        const command = await detectBuildCommand(workspacePath, projectMemory, projectSnapshot, (path) => workspace.readFile(path));
        const runId = `build-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        pendingBuildCheckRef.current = {
          runId,
          command,
          workspaceRoot: workspacePath,
          activeWorkspacePath: workspacePath,
          cwdSource: "active workspace path",
        };
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: [
              `I can run \`${command}\` in \`${workspacePath}\`.`,
              "",
              `Run ID: ${runId}`,
              `Active project path: ${workspacePath}`,
              `Command cwd: ${workspacePath}`,
              "CWD source: active workspace path",
              "",
              "Reply yes to approve running this build check.",
            ].join("\n"),
          },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      const auditMode = detectAuditMode(p);
      if (auditMode === "ProjectAudit") {
        clearActionableProposal();
        const fresh = await loadFreshProjectState(root);
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await inspector.buildManifest());
        if (!manifest) setManifest(m);
        const auditReport = buildProjectAuditReport({
          workspacePath,
          projectMemory: fresh.projectMemory,
          livingBuildPlan: fresh.livingBuildPlan,
          manifest: m,
          latestBuildResult: latestBuildResultRef.current,
          latestFailure: lastBuildFailureRef.current,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: isAuditSaveRequest(p)
              ? `${auditReport}\n\nI can save this as AUDIT_REPORT.md only after you explicitly confirm creating that file.`
              : auditReport,
          },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }
      if (auditMode === "CodeAudit") {
        clearActionableProposal();
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await inspector.buildManifest());
        if (!manifest) setManifest(m);
        const sourceFiles: CodeAuditSourceFile[] = [];
        for (const path of selectCodeAuditFiles(m)) {
          try {
            sourceFiles.push({ path, content: await workspace.readFile(path) });
          } catch {
            /* skip unreadable audit sample */
          }
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: buildCodeAuditReport({
              workspacePath,
              manifest: m,
              latestFailure: lastBuildFailureRef.current,
              sourceFiles,
            }),
          },
        ]);
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
        return;
      }

      try {
      const num = /^\s*(\d+)\s*$/.exec(p);
      if (lastFileChoiceCandidates && num) {
        const idx = parseInt(num[1], 10);
        if (idx >= 1 && idx <= lastFileChoiceCandidates.length) {
          const chosenPath = lastFileChoiceCandidates[idx - 1];
          setLastFileChoiceCandidates(null);
          try {
            const content = await workspace.readFile(chosenPath);
            setShowDiffPanel(true);
            setFileEditState({
              relativePath: chosenPath,
              baselineText: content,
              baselineUpdatedAt: Date.now(),
              originalText: content,
              editedText: content,
              dirty: false,
              lastSaveStatus: "idle",
            });
            console.log("OPEN_EDITOR", { relativePath: chosenPath, length: content.length });
            console.log("DIFF_PANEL_VISIBLE", true);
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Opened ${chosenPath} in editor.` },
            ]);
          } catch (e) {
            console.error("sendChatMessage file choice", e);
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
            ]);
          }
          return;
        }
      }
      setLastFileChoiceCandidates(null);

      if (p.startsWith("/")) {
        const cmd = p.slice(1).trim().toLowerCase().split(/\s+/)[0] || "";
        let reply: string;
        if (cmd === "help") {
          reply = "Commands: /help â€” this message; /snapshot â€” project snapshot.";
        } else if (cmd === "snapshot") {
          reply = projectSnapshot
            ? `Types: ${projectSnapshot.detectedTypes.join(", ")}. Packs: ${projectSnapshot.enabledPacks.join(", ")}.`
            : "No snapshot. Open workspace and refresh.";
        } else {
          reply = "Unknown command. Try /help";
        }
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: reply },
        ]);
        return;
      }

      const createFileIntent = detectCreateFileIntent(p);
      if (createFileIntent) {
        const targetPath = createFileIntent.targetPath;
        const exists = await workspace.exists(targetPath);
        if (exists) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: `${targetPath} already exists. Should I modify it, or replace it with new content?`,
            },
          ]);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
          return;
        }

        setPlanAndPatch(null);
        setPreviewMap(null);
        setSelectedDiffPath(null);
        setCurrentProposedSessionId(null);
        setAppState("idle");
        setStatusLine("Preparing file creation patch...");
        setPipelineRunning(true);
        setThinkingLines((prev) => [...prev, { id: `t-${ts}-create-file`, text: `CREATE_FILE: ${targetPath}`, type: "status", timestamp: nowIso() }]);
        try {
          const content = generateNewFileContent(targetPath, createFileIntent.instructions);
          const patchResult = createNewFilePatch(targetPath, content);
          const engine = new PatchEngine(root, (path) => workspace.readFile(path));
          const map = await previewPatchOrThrow(engine, patchResult.patch);
          if (!map.has(targetPath)) {
            throw new Error(`Could not prepare a file creation preview for ${targetPath}.`);
          }
          setPlanAndPatch(patchResult);
          setPreviewMap(map);
          setSelectedDiffPath(targetPath);
          setSelectedPaths([targetPath]);
          setAppState("patchProposed");
          setShowDiffPanel(true);
          const store = new MemoryStore(root);
          const record = await store.addProposedSession(p, [targetPath], patchResult.explanation, patchResult.patch);
          setCurrentProposedSessionId(record.id);
          await fetchSessionsAndResume();
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Proposed creating ${targetPath}. Review the patch preview, then apply it to write the file.` },
          ]);
        } catch (e) {
          console.error("create file intent", e);
          clearActionableProposal();
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Could not create a file proposal: ${formatPatchProposalError(e)}` },
          ]);
        } finally {
          setStatusLine(null);
          setPipelineRunning(false);
          processingMessageRef.current = null;
          lastHandledMessageIdRef.current = null;
        }
        return;
      }

      // ROUTING: File actions FIRST, before any chat logic (single router call per message)
      let route = routeUserMessage(p);
      if (route.action === "chat" && AMBIGUOUS_THIS_FILE.test(p)) {
        if (selectedPaths.length === 1) {
          route = { action: "file_read", targetPath: selectedPaths[0], instructions: p };
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: selectedPaths.length > 1
                ? `Which workspace file do you mean?\n${selectedPaths.map((path, i) => `${i + 1}. ${path}`).join("\n")}\n\nReply with a number.`
                : "Which workspace file should I use? Select a file in the workspace or mention its name/path.",
            },
          ]);
          if (selectedPaths.length > 1) setLastFileChoiceCandidates(selectedPaths);
          return;
        }
      }
      console.log("MESSAGE_ROUTING:", route);
      const routeTarget = "targetPath" in route ? route.targetPath : "";
      setThinkingLines((prev) => [...prev, { id: `t-${ts}-route`, text: `ROUTE: ${route.action} ${routeTarget}`.trim(), type: "status", timestamp: nowIso() }]);

      if (route.action === "file_read") {
        setThinkingLines((prev) => [...prev, { id: `t-${ts}-diff-false`, text: "DIFF_PANEL_VISIBLE: false", type: "status", timestamp: nowIso() }]);
        const fileHint = route.targetPath;
        setThinkingLines((prev) => [...prev, { id: `t-${ts}-read-1`, text: `Reading ${fileHint}`, type: "status", timestamp: nowIso() }]);
        const readResult = await readProjectFile(
          root,
          fileHint,
          (path) => workspace.readFile(path),
          (path) => workspace.exists(path),
          (wr, name) => workspace.searchFilesByName(wr, name)
        );
        if ("error" in readResult && readResult.error === "multiple") {
          const multi = readResult as { path: string; error: "multiple"; candidates: string[] };
          setLastFileChoiceCandidates(multi.candidates);
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Which file?\n${multi.candidates.map((path: string, i: number) => `${i + 1}. ${path}`).join("\n")}\n\nReply with a number.` },
          ]);
          return;
        }
        if ("error" in readResult) {
          setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: `${readResult.path} not found.` }]);
          return;
        }
        const resolvedPath = readResult.path;
        const fileContent = readResult.content;
        setThinkingLines((prev) => [...prev, { id: `t-${ts}-read-2`, text: "Summarizing", type: "status", timestamp: nowIso() }]);
        const runId = `file_read-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        activeRunIdRef.current = runId;
        console.log("[gen] TRUE", runId, { action: "file_read", targetPath: route.targetPath, messageId: id });
        setStatusLine("Generating replyâ€¦");
        setPipelineRunning(true);
        const readAc = new AbortController();
        abortControllerRef.current = readAc;
        const readAbortPromise = new Promise<never>((_, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
          if (readAc.signal.aborted) {
            onAbort();
            return;
          }
          readAc.signal.addEventListener("abort", onAbort);
        });
        try {
          const inspector = new ProjectInspector(workspace);
          const m = manifest ?? (await inspector.buildManifest());
          if (!manifest) setManifest(m);
          const ctxBuilder = new ContextBuilder(workspace, m);
          const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
          const ctx = await ctxBuilder.build(p, [resolvedPath], {
            useKnowledge: useKnowledgePacks,
            knowledgeStore: knowledgeStore ?? undefined,
            agentRole: "coder",
            projectSnapshot: projectSnapshot ?? undefined,
            projectMemory,
            livingBuildPlan,
            founderManifest,
            enabledPacks: enabledPacks.length ? enabledPacks : undefined,
          });
          const ctxWithContent: ModelContext = {
            ...ctx,
            selectedFiles: [{ path: resolvedPath, content: fileContent }],
          };
          const tBefore = Date.now();
          console.log("[gen] file_read before await generateChatResponse", tBefore);
          const text = await Promise.race([
            generateChatResponse(ctxWithContent),
            readAbortPromise,
          ]);
          console.log("[gen] file_read after resolve", { len: text?.length ?? 0, first80: (text ?? "").slice(0, 80), dt: Date.now() - tBefore });
          if (typeof text === "string" && text.length > 0) {
            setThinkingLines((prev) => [...prev, { id: `t-${ts}-response-ready`, text: `RESPONSE_READY (len=${text.length})`, type: "status", timestamp: nowIso() }]);
          }
          const assistantMsg = { id: `a-${Date.now()}`, role: "assistant" as const, text: text ?? "" };
          console.log("[gen] file_read before setMessages", assistantMsg.id);
          flushSync(() => {
            setMessages((prev) => {
              const next = [...prev, assistantMsg];
              console.log("[gen] file_read setMessages updater", { prevLen: prev.length, nextLen: next.length });
              return next;
            });
          });
          console.log("[gen] file_read after setMessages");
        } catch (e) {
          const isAbort = (e instanceof DOMException && e.name === "AbortError") || (e && (e as Error).name === "AbortError");
          if (isAbort) {
            setThinkingLines((prev) => [...prev, { id: `t-${ts}-read-cancel`, text: "Cancelled.", type: "status", timestamp: nowIso() }]);
          } else {
            console.error("sendChatMessage file_read", e);
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` }]);
          }
        } finally {
          console.log("[gen] file_read finally: statusLine/pipelineRunning cleared", runId);
          setStatusLine(null);
          setPipelineRunning(false);
          abortControllerRef.current = null;
        }
        return;
      }

      if (route.action === "file_open" || route.action === "file_edit") {
        const fileHint = route.targetPath;
        setThinkingLines((prev) => [...prev, { id: `t-${ts}-open-editor`, text: `OPEN_EDITOR: ${fileHint}`, type: "status", timestamp: nowIso() }]);
        setThinkingLines((prev) => [...prev, { id: `t-${ts}-diff-true`, text: "DIFF_PANEL_VISIBLE: true", type: "status", timestamp: nowIso() }]);
        const result = await readProjectFile(
          root,
          fileHint,
          (path) => workspace.readFile(path),
          (path) => workspace.exists(path),
          (wr, name) => workspace.searchFilesByName(wr, name)
        );
        if ("error" in result && result.error === "multiple") {
          const multi = result as { path: string; error: "multiple"; candidates: string[] };
          const candidates = multi.candidates;
          const list = candidates
            .map((path: string, i: number) => `${i + 1}. ${path}`)
            .join("\n");
          setLastFileChoiceCandidates(candidates);
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Which file?\n${list}\n\nReply with a number.` },
          ]);
          return;
        }
        if ("error" in result) {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `${result.path} not found.` },
          ]);
          return;
        }
        const resolvedPath = result.path;
        const originalText = result.content;
        const diffRequest = route.action === "file_edit" || hasDiffRequest(p);
        
        if (diffRequest) {
          const runId = `file_edit_patch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          activeRunIdRef.current = runId;
          console.log("[gen] TRUE", runId, { action: "file_edit_patch", targetPath: resolvedPath, messageId: id });
          setPlanAndPatch(null);
          setPreviewMap(null);
          setSelectedDiffPath(null);
          setCurrentProposedSessionId(null);
          setAppState("idle");
          setStatusLine("Generating patchâ€¦");
          setPipelineRunning(true);
          setThinkingLines((prev) => [...prev, { id: `t-${ts}-patch-start`, text: "Patch generation started", type: "status", timestamp: nowIso() }]);
          const ac = new AbortController();
          abortControllerRef.current = ac;
          const abortPromise = new Promise<never>((_, reject) => {
            const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
            if (ac.signal.aborted) {
              onAbort();
              return;
            }
            ac.signal.addEventListener("abort", onAbort);
          });
          try {
            setFileEditState(null);
            setSelectedPaths([resolvedPath]);
            const inspector = new ProjectInspector(workspace);
            const m = manifest ?? (await inspector.buildManifest());
            if (!manifest) setManifest(m);
            const ctxBuilder = new ContextBuilder(workspace, m);
            const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
            const ctx = await ctxBuilder.build(p, [resolvedPath], {
              useKnowledge: useKnowledgePacks,
              knowledgeStore: knowledgeStore ?? undefined,
              agentRole: "coder",
              projectSnapshot: projectSnapshot ?? undefined,
              projectMemory,
              livingBuildPlan,
              founderManifest,
              enabledPacks: enabledPacks.length ? enabledPacks : undefined,
            });
            const patchResult = await Promise.race([
              generatePlanAndPatch(ctx),
              abortPromise,
            ]);
            setPlanAndPatch(patchResult);
            setThinkingLines((prev) => [...prev, { id: `t-${ts}-patch-done`, text: "Patch generation finished", type: "status", timestamp: nowIso() }]);
            const engine = new PatchEngine(root, (path) => workspace.readFile(path));
            const map = await previewPatchOrThrow(engine, patchResult.patch);
            setPreviewMap(map);
            setSelectedDiffPath([...map.keys()][0] ?? null);
            setAppState("patchProposed");
            setShowDiffPanel(true);
            const store = new MemoryStore(root);
            const record = await store.addProposedSession(p, [resolvedPath], patchResult.explanation, patchResult.patch);
            setCurrentProposedSessionId(record.id);
            await fetchSessionsAndResume();
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Patch for ${resolvedPath}: ${patchResult.explanation}` },
            ]);
          } catch (e) {
            const isAbort = (e instanceof DOMException && e.name === "AbortError") || (e && (e as Error).name === "AbortError");
            if (isAbort) {
              setThinkingLines((prev) => [...prev, { id: `t-${ts}-patch-cancel`, text: "Cancelled.", type: "status", timestamp: nowIso() }]);
            } else {
              console.error("sendChatMessage patch", e);
              clearActionableProposal();
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${formatPatchProposalError(e)}` },
              ]);
            }
          } finally {
            console.log("[gen] FALSE", runId, { action: "file_edit_patch" });
            setStatusLine(null);
            setPipelineRunning(false);
            abortControllerRef.current = null;
          }
          return;
        }
        
        let editedText = originalText;
        let dirty = false;
        if (route.action === "file_edit" && route.instructions) {
          const applied = applySimpleEdit(originalText, route.instructions);
          if (applied !== null) {
            editedText = applied;
            dirty = true;
            console.log("router: applied simple edit");
          }
        }
        setShowDiffPanel(true);
        setFileEditState({
          relativePath: resolvedPath,
          baselineText: originalText,
          baselineUpdatedAt: Date.now(),
          originalText,
          editedText,
          dirty,
          lastSaveStatus: "idle",
        });
        console.log("OPEN_EDITOR", { relativePath: resolvedPath, length: originalText.length });
        console.log("DIFF_PANEL_VISIBLE", true);
        const appliedEdit = route.action === "file_edit" && dirty;
        const assistantMsg = appliedEdit
          ? `Opened ${resolvedPath}. Applied changes.`
          : route.action === "file_edit"
            ? `Opened ${resolvedPath} in editor. Make your changes in the right pane.`
            : `Opened ${resolvedPath}.`;
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: assistantMsg },
        ]);
        return;
      }

      // ROUTING: chat (no file action) â€” only when route.action === "chat"; file_* paths must have returned above
      if (route.action === "chat" && isCodingChangePrompt(p)) {
        const runId = `coding-task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        activeRunIdRef.current = runId;
        console.log("[gen] TRUE", runId, { action: "coding_task", targetPath: undefined, messageId: id });
        setPlanAndPatch(null);
        setPreviewMap(null);
        setSelectedDiffPath(null);
        setCurrentProposedSessionId(null);
        setAppState("idle");
        setStatusLine("Identifying relevant files...");
        setPipelineRunning(true);
        setThinkingLines((prev) => [...prev, { id: `t-${ts}-code-task`, text: "CODING_TASK", type: "status", timestamp: nowIso() }]);
        const ac = new AbortController();
        abortControllerRef.current = ac;
        const abortPromise = new Promise<never>((_, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
          if (ac.signal.aborted) {
            onAbort();
            return;
          }
          ac.signal.addEventListener("abort", onAbort);
        });
        try {
          const inspector = new ProjectInspector(workspace);
          const m = manifest ?? (await inspector.buildManifest());
          if (!manifest) setManifest(m);
          const inferredPaths = selectedPaths.length ? selectedPaths : inferRelevantPaths(p, m, projectSnapshot);
          setSelectedPaths(inferredPaths);
          setThinkingLines((prev) => [
            ...prev,
            { id: `t-${ts}-code-files`, text: `Relevant files: ${inferredPaths.join(", ") || "(project context)"}`, type: "status", timestamp: nowIso() },
          ]);
          setStatusLine("Generating patch...");
          const ctxBuilder = new ContextBuilder(workspace, m);
          const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
          const ctx = await ctxBuilder.build(p, inferredPaths, {
            useKnowledge: useKnowledgePacks,
            knowledgeStore: knowledgeStore ?? undefined,
            agentRole: "coder",
            projectSnapshot: projectSnapshot ?? undefined,
            projectMemory,
            livingBuildPlan,
            founderManifest,
            enabledPacks: enabledPacks.length ? enabledPacks : undefined,
          });
          setLastRetrievedChunks(
            ctx.knowledgeChunks?.map((c) => ({
              title: c.title,
              sourcePath: c.sourcePath,
              chunkText: c.chunkText,
            })) ?? []
          );
          const retryPrompt = [
            p,
            "",
            "The previous response did not include concrete edits.",
            "Return a concrete unified diff or full-file replacement for the selected context files.",
            inferredPaths.length ? `The patch should edit one of: ${inferredPaths.join(", ")}` : "",
            "Do not summarize only. Do not ask for more context.",
          ].filter(Boolean).join("\n");
          const buildPatch = async (promptText: string) => {
            const nextCtx = promptText === p
              ? ctx
              : await ctxBuilder.build(promptText, inferredPaths, {
                  useKnowledge: useKnowledgePacks,
                  knowledgeStore: knowledgeStore ?? undefined,
                  agentRole: "coder",
                  projectSnapshot: projectSnapshot ?? undefined,
                  projectMemory,
                  livingBuildPlan,
                  founderManifest,
                  enabledPacks: enabledPacks.length ? enabledPacks : undefined,
                });
            return Promise.race([
              generatePlanAndPatch(nextCtx),
              abortPromise,
            ]);
          };
          let patchResult: PlanAndPatch;
          try {
            patchResult = await buildPatch(p);
          } catch (generationError) {
            const fallback = await createCodingTaskFallbackPatch(workspace, p, inferredPaths);
            patchResult = fallback ?? await buildPatch(retryPrompt);
          }
          setPlanAndPatch(patchResult);
          const engine = new PatchEngine(root, (path) => workspace.readFile(path));
          let map: Map<string, { old: string; new: string }>;
          try {
            map = await previewPatchOrThrow(engine, patchResult.patch);
          } catch (previewError) {
            const fallback = await createCodingTaskFallbackPatch(workspace, p, inferredPaths);
            patchResult = fallback ?? await buildPatch(retryPrompt);
            setPlanAndPatch(patchResult);
            map = await previewPatchOrThrow(engine, patchResult.patch);
          }
          setPreviewMap(map);
          setSelectedDiffPath([...map.keys()][0] ?? null);
          setAppState("patchProposed");
          setShowDiffPanel(true);
          const store = new MemoryStore(root);
          const record = await store.addProposedSession(p, inferredPaths, patchResult.explanation, patchResult.patch);
          setCurrentProposedSessionId(record.id);
          await fetchSessionsAndResume();
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Proposed patch${inferredPaths.length ? ` using ${inferredPaths.join(", ")}` : ""}: ${patchResult.explanation}` },
          ]);
        } catch (e) {
          const isAbort = (e instanceof DOMException && e.name === "AbortError") || (e && (e as Error).name === "AbortError");
          if (isAbort) {
            setThinkingLines((prev) => [...prev, { id: `t-${ts}-code-cancel`, text: "Cancelled.", type: "status", timestamp: nowIso() }]);
          } else {
            console.error("sendChatMessage coding_task", e);
            clearActionableProposal();
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${formatPatchProposalError(e)}` },
            ]);
          }
        } finally {
          console.log("[gen] FALSE", runId, { action: "coding_task" });
          setStatusLine(null);
          setPipelineRunning(false);
          abortControllerRef.current = null;
        }
        return;
      }

      if (p === "(no prompt)") return;
      setThinkingLines((prev) => [...prev, { id: `t-${ts}-fallback-chat`, text: "FALLBACK_CHAT", type: "status", timestamp: nowIso() }]);
      console.log("MESSAGE_ROUTING: chat");
      const runId = `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      activeRunIdRef.current = runId;
      console.log("[gen] TRUE", runId, { action: "chat", targetPath: undefined, messageId: id });
      setStatusLine("Generating replyâ€¦");
      setPipelineRunning(true);
      const chatTs = Date.now();
      const chatAc = new AbortController();
      abortControllerRef.current = chatAc;
      const chatAbortPromise = new Promise<never>((_, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        if (chatAc.signal.aborted) {
          onAbort();
          return;
        }
        chatAc.signal.addEventListener("abort", onAbort);
      });
      try {
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await inspector.buildManifest());
        if (!manifest) setManifest(m);
        const ctxBuilder = new ContextBuilder(workspace, m);
        const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
        const ctx = await ctxBuilder.build(p, selectedPaths, {
          useKnowledge: useKnowledgePacks,
          knowledgeStore: knowledgeStore ?? undefined,
          agentRole: "coder",
          projectSnapshot: projectSnapshot ?? undefined,
          projectMemory,
          livingBuildPlan,
          founderManifest,
          enabledPacks: enabledPacks.length ? enabledPacks : undefined,
          includeFileProjectContext: true,
        });
        setLastRetrievedChunks(
          ctx.knowledgeChunks?.map((c) => ({
            title: c.title,
            sourcePath: c.sourcePath,
            chunkText: c.chunkText,
          })) ?? []
        );
        const assistantId = `a-${chatTs}`;
        streamingAssistantIdRef.current = assistantId;
        flushSync(() => {
          setMessages((prev) => [...prev, { id: assistantId, role: "assistant" as const, text: "" }]);
        });
        const tBefore = Date.now();
        console.log("[gen] chat before await generateChatResponse", tBefore);
        const text = await Promise.race([
          generateChatResponse(ctx, {
            onChunk: (chunk) => {
              const sid = streamingAssistantIdRef.current;
              if (!sid) return;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role !== "assistant" || last?.id !== sid) return prev;
                return [...prev.slice(0, -1), { ...last, text: last.text + chunk }];
              });
            },
          }),
          chatAbortPromise,
        ]);
        console.log("[gen] chat after resolve", { len: text?.length ?? 0, first80: (text ?? "").slice(0, 80), dt: Date.now() - tBefore });
        streamingAssistantIdRef.current = null;
        if (typeof text === "string" && text.length > 0) {
          setThinkingLines((prev) => [...prev, { id: `t-${chatTs}-response-ready`, text: `RESPONSE_READY (len=${text.length})`, type: "status", timestamp: nowIso() }]);
        }
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last?.id === assistantId) {
            next[next.length - 1] = { ...last, text: (text ?? "").trim() || last.text };
          }
          return next;
        });
        console.log("[gen] chat after setMessages");
      } catch (e) {
        const isAbort = (e instanceof DOMException && e.name === "AbortError") || (e && (e as Error).name === "AbortError");
        if (isAbort) {
          setThinkingLines((prev) => [...prev, { id: `t-${chatTs}-chat-cancel`, text: "Cancelled.", type: "status", timestamp: nowIso() }]);
        } else {
          console.error("sendChatMessage", e);
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${formatPatchProposalError(e)}` },
          ]);
        }
      } finally {
        console.log("[gen] chat finally: statusLine/pipelineRunning cleared", runId);
        setStatusLine(null);
        setPipelineRunning(false);
        abortControllerRef.current = null;
      }
      } finally {
        processingMessageRef.current = null;
        lastHandledMessageIdRef.current = null;
      }
    },
    [workspacePath, selectedPaths, manifest, useKnowledgePacks, projectSnapshot, projectMemory, livingBuildPlan, founderManifest, projectCreationState, pendingPatchSession, enabledPacks, lastFileChoiceCandidates, fetchSessionsAndResume, setProjectCreationState, onImportExistingProject, onOpenKnownProject, onStartFoundationPhase, onApprovePendingChange, onRejectPendingChange, onExplainPendingChange, onApprovePhaseAndContinue, onHoldPhase, onRevisePhasePlan, getPhaseGatePresentation, getChangeApprovalPresentation, clearActionableProposal]
  );

  const proposePatch = useCallback(
    async (prompt: string) => {
      let root = workspace.root;
      if ((!root || root === "") && workspacePath) {
        await workspace.setWorkspaceRoot(workspacePath);
        root = workspace.root ?? workspacePath;
      }
      if (!workspacePath || root == null || root === "") {
        console.warn("[App] proposePatch blocked: no workspace root.");
        return;
      }
      setViewingSessionId(null);
      setPlannerOutput(null);
      setReviewerOutput(null);
      const p = (prompt || "").trim() || "(no prompt)";
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: p }]);
      setStatusLine("Scanning selected filesâ€¦");
      const propTs = Date.now();
      const propNowIso = () => new Date().toISOString();
      const runId = `proposePatch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await inspector.buildManifest());
        if (!manifest) setManifest(m);
        const ctxBuilder = new ContextBuilder(workspace, m);
        const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
        activeRunIdRef.current = runId;
        console.log("[gen] TRUE", runId, { action: "proposePatch", targetPath: undefined, messageId: undefined });
        setPlanAndPatch(null);
        setPreviewMap(null);
        setSelectedDiffPath(null);
        setCurrentProposedSessionId(null);
        setAppState("idle");
        setStatusLine("Generating patchâ€¦");
        setPipelineRunning(true);
        setThinkingLines((prev) => [...prev, { id: `t-${propTs}-prop-start`, text: "Patch generation started", type: "status", timestamp: propNowIso() }]);
        const propAc = new AbortController();
        abortControllerRef.current = propAc;
        const propAbortPromise = new Promise<never>((_, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
          if (propAc.signal.aborted) {
            onAbort();
            return;
          }
          propAc.signal.addEventListener("abort", onAbort);
        });
        const ctx = await ctxBuilder.build(p, selectedPaths, {
          useKnowledge: useKnowledgePacks,
          knowledgeStore: knowledgeStore ?? undefined,
          agentRole: "coder",
          projectSnapshot: projectSnapshot ?? undefined,
          projectMemory,
          livingBuildPlan,
          founderManifest,
          enabledPacks: enabledPacks.length ? enabledPacks : undefined,
        });
        setLastRetrievedChunks(
          ctx.knowledgeChunks?.map((c) => ({
            title: c.title,
            sourcePath: c.sourcePath,
            chunkText: c.chunkText,
          })) ?? []
        );
        const result = await Promise.race([
          generatePlanAndPatch(ctx),
          propAbortPromise,
        ]);
        setPlanAndPatch(result);
        setThinkingLines((prev) => [...prev, { id: `t-${propTs}-prop-done`, text: "Patch generation finished", type: "status", timestamp: propNowIso() }]);
        const engine = new PatchEngine(root, (path) =>
          workspace.readFile(path)
        );
        const map = await previewPatchOrThrow(engine, result.patch);
        setPreviewMap(map);
        const paths = [...map.keys()];
        setSelectedDiffPath(paths[0] ?? null);
        setAppState("patchProposed");
        const store = new MemoryStore(root);
        const record = await store.addProposedSession(p, selectedPaths, result.explanation, result.patch);
        setCurrentProposedSessionId(record.id);
        await fetchSessionsAndResume();
      } catch (e) {
        const isAbort = (e instanceof DOMException && e.name === "AbortError") || (e && (e as Error).name === "AbortError");
        if (isAbort) {
          setThinkingLines((prev) => [...prev, { id: `t-${propTs}-prop-cancel`, text: "Cancelled.", type: "status", timestamp: propNowIso() }]);
        } else {
          console.error("proposePatch", e);
          clearActionableProposal();
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${formatPatchProposalError(e)}` },
          ]);
        }
      } finally {
        console.log("[gen] FALSE", runId, { action: "proposePatch" });
        setStatusLine(null);
        setPipelineRunning(false);
        abortControllerRef.current = null;
      }
    },
    [workspacePath, selectedPaths, manifest, fetchSessionsAndResume, useKnowledgePacks, projectSnapshot, projectMemory, livingBuildPlan, founderManifest, enabledPacks, clearActionableProposal]
  );

  return { sendChatMessage, proposePatch };
}
