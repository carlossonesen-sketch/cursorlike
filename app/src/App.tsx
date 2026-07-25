import { useState, useCallback, useRef, useMemo } from "react";
import {
  WorkspaceService,
  ProjectInspector,
  ProjectDetector,
  ContextBuilder,
  KnowledgeStore,
  writeProjectSnapshot,
  readWorkspaceSettings,
  writeWorkspaceSettings,
  runPipeline,
  LocalPlannerAgent,
  LocalReviewerAgent,
  PatchEngine,
  MemoryStore,
  resumeSuggestion,
  DEFAULT_LOCAL_SETTINGS,
} from "./core";
import type {
  FileTreeNode,
  FounderManifest,
  LivingBuildPlan,
  PlanAndPatch,
  PlannerOutput,
  ProjectMemory,
  ReviewerOutput,
  SessionRecord,
  AgentMode,
  ProjectSnapshot,
  ProjectBlueprint,
  ModelRolePaths,
  ExistingProjectImportEvaluation,
  BuildProgressApplySummary,
  NewProjectFilePreview,
  NewProjectPlanPreview,
} from "./core/types";
import type { Provider, LocalModelSettings } from "./core";
import type { FileSnapshot } from "./core/patch/PatchEngine";
import type { ResumeSuggestion } from "./core";
import { TopBar } from "./components/TopBar";
import type { NFMode } from "./components/TopMenu";
import { ConversationPane } from "./components/ConversationPane";
import { FilesPane } from "./components/FilesPane";
import { RuntimeStatusPanel } from "./components/RuntimeStatusPanel";
import { ThinkingPane, type ThinkingLine } from "./components/ThinkingPane";
import { useChatController, type ChatMessage, type FileEditState } from "./core/chat/useChatController";
import { useRuntimeController } from "./core/runtime/runtimeController";
import { openWorkspaceWithInitialization } from "./core/workspace/workspaceController";
import { projectNameRequestMessage } from "./core/projectCreation/projectIdentity";
import { createMenuProjectCreationState, projectCreationStateToDraft, type ProjectCreationState } from "./core/projectCreation/projectCreationState";
import { applyProjectNameToCreationState } from "./core/projectCreation/newProjectIntent";
import {
  generateProjectCreationFilePreview,
  runProjectCreationPlanningPipeline,
} from "./core/projectCreation/projectCreationPipeline";
import { commitNewProjectFiles } from "./core/projectCreation/projectCreationCommit";
import { evaluateExistingProjectImport } from "./core/projectImport/projectImportEvaluator";
import { commitExistingProjectImport } from "./core/projectImport/projectImportCommit";
import { updateBuildProgressAfterPatch } from "./core/memory/buildProgress";
import {
  canStartFoundationExecution,
  describePhaseExecutionResult,
  startFoundationPhaseExecution,
  type PhaseExecutionNarration,
} from "./core/phase/phaseExecutionController";
import {
  approvePendingChangeAndContinue,
  explainPendingChange,
  getChangeApprovalPresentation,
  rejectPendingChange,
} from "./core/phase/changeApprovalController";
import {
  approvePhaseAndContinue,
  getPhaseGatePresentation,
  holdPhaseGate,
  revisePhaseGatePlan,
} from "./core/phase/phaseGateController";
import { writeWorkspaceProjectBlueprint } from "./core/product/projectBlueprintStore";
import { readLivingBuildPlan } from "./core/memory/buildPlanStore";
import { readProjectMemory, writeProjectMemory } from "./core/memory/projectMemoryStore";
import { readGlobalMemory, writeGlobalMemory } from "./core/memory/globalMemoryStore";
import { projectPathsMatch } from "./core/memory/memoryIsolation";
import { pathsFromPatch } from "./core/patch/PatchEngine";
import {
  buildProjectDashboardModel,
  closeProjectDashboardView,
  openProjectDashboardView,
  shouldShowProjectDashboardButton,
  type ProjectDashboardAppView,
} from "./core/project/projectDashboard";
import { ProjectDashboard } from "./components/ProjectDashboard";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DeveloperWorkspace } from "./components/DeveloperWorkspace";
import type { PrimaryRoute } from "./core/developer/developerState";
import "./App.css";

const workspace = new WorkspaceService();

async function sha256Prefix(content: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 8);
}

function formatPatchApplyFailure(result: { applied: string[]; failed: { path: string; error: string }[] }): string {
  if (!result.applied.length && !result.failed.length) return "Patch did not produce any file writes.";
  return result.failed.map((failure) => `${failure.path}: ${failure.error}`).join("\n");
}

async function patchHasWritablePreview(root: string, patch: string): Promise<boolean> {
  const paths = pathsFromPatch(patch);
  if (!paths.length) return false;
  const engine = new PatchEngine(root, (path) => workspace.readFile(path));
  const preview = await engine.preview(patch);
  if (preview.size === 0) return false;
  return paths.every((path) => preview.has(path));
}

type AppState = "idle" | "patchProposed" | "patchApplied";

function AutomatedBuilderApp() {
  const developerMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get("dev") === "1";
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [manifest, setManifest] = useState<import("./core/types").ProjectManifest | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [planAndPatch, setPlanAndPatch] = useState<PlanAndPatch | null>(null);
  const [previewMap, setPreviewMap] = useState<
    Map<string, { old: string; new: string }> | null
  >(null);
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [lastBeforeSnapshots, setLastBeforeSnapshots] = useState<
    FileSnapshot[] | null
  >(null);
  const [lastAppliedSessionId, setLastAppliedSessionId] = useState<string | null>(null);
  const [currentProposedSessionId, setCurrentProposedSessionId] = useState<string | null>(null);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppState>("idle");
  const [applyInProgress, setApplyInProgress] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [fileEditState, setFileEditState] = useState<FileEditState | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [resume, setResume] = useState<ResumeSuggestion | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>("Coder");
  const [activeMode, setActiveMode] = useState<NFMode>("Code");
  const [plannerOutput, setPlannerOutput] = useState<PlannerOutput | null>(null);
  const [reviewerOutput, setReviewerOutput] = useState<ReviewerOutput | null>(null);
  const [useKnowledgePacks, setUseKnowledgePacks] = useState(true);
  const [lastRetrievedChunks, setLastRetrievedChunks] = useState<
    { title: string; sourcePath: string; chunkText: string }[]
  >([]);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectSnapshot | null>(null);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(null);
  const [projectBlueprint, setProjectBlueprint] = useState<ProjectBlueprint | null>(null);
  const [livingBuildPlan, setLivingBuildPlan] = useState<LivingBuildPlan | null>(null);
  const [founderManifest, setFounderManifest] = useState<FounderManifest | null>(null);
  const [enabledPacks, setEnabledPacks] = useState<string[]>([]);
  const [autoPacksEnabled, setAutoPacksEnabled] = useState(true);
  const [modelPath, setModelPath] = useState<string | undefined>(undefined);
  const [modelRoles, setModelRoles] = useState<ModelRolePaths | undefined>(undefined);
  const [toolRoot, setToolRoot] = useState<string | null>(null);
  const [port, setPort] = useState<number>(11435);
  const [runtimePort, setRuntimePort] = useState<number | null>(null);
  const [ggufPathMissing, setGgufPathMissing] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>("openai");
  const [localSettings, setLocalSettings] = useState<LocalModelSettings>(() => ({
    ...DEFAULT_LOCAL_SETTINGS,
  }));
  const [lastFileChoiceCandidates, setLastFileChoiceCandidates] = useState<string[] | null>(null);
  const [thinkingLines, setThinkingLines] = useState<ThinkingLine[]>([]);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [projectCreationState, setProjectCreationState] = useState<ProjectCreationState | null>(null);
  const [creationBlueprint, setCreationBlueprint] = useState<ProjectBlueprint | null>(null);
  const [newProjectPlanPreview, setNewProjectPlanPreview] = useState<NewProjectPlanPreview | null>(null);
  const [newProjectFilePreview, setNewProjectFilePreview] = useState<NewProjectFilePreview | null>(null);
  const [importEvaluation, setImportEvaluation] = useState<ExistingProjectImportEvaluation | null>(null);
  const [buildProgressSummary, setBuildProgressSummary] = useState<BuildProgressApplySummary | null>(null);
  const [phaseExecutionNarration, setPhaseExecutionNarration] = useState<PhaseExecutionNarration | null>(null);
  const [phaseExecutionRunning, setPhaseExecutionRunning] = useState(false);
  const [activeView, setActiveView] = useState<ProjectDashboardAppView>("chat");
  const discoveryIntake = projectCreationState?.discoveryIntake ?? null;

  const clearProjectCreationFlow = useCallback(() => {
    setProjectCreationState(null);
    setCreationBlueprint(null);
    setNewProjectPlanPreview(null);
    setNewProjectFilePreview(null);
  }, []);

  const applyCreationPlanningPipeline = useCallback((state: ProjectCreationState, applyDiscoveryDefaults = false) => {
    const result = runProjectCreationPlanningPipeline(state, { applyDiscoveryDefaults });
    setCreationBlueprint(result.blueprint);
    setNewProjectPlanPreview(result.planPreview);
    setNewProjectFilePreview(null);
    return result;
  }, []);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const {
    localSettingsRef,
    toolRootRef,
    portRef,
    runtimePortRef,
    pickGGUFFile,
    rescanModels,
    onModelRolesChange,
  } = useRuntimeController({
    workspace,
    workspacePath,
    provider,
    localSettings,
    modelRoles,
    toolRoot,
    port,
    runtimePort,
    setModelPath,
    setModelRoles,
    setToolRoot,
    setRuntimePort,
    setGgufPathMissing,
    setLocalSettings,
  });

  const fetchSessionsAndResume = useCallback(async () => {
    const root = workspace.root;
    if (root == null || root === "") {
      console.warn("[App] fetchSessionsAndResume blocked: no workspace root.");
      return;
    }
    const store = new MemoryStore(root);
    let list = await store.listSessions();
    let repaired = false;
    for (const session of list) {
      if (session.status === "pending" || session.status === "proposed") {
        const validPreview = await patchHasWritablePreview(root, session.patch).catch(() => false);
        if (!validPreview) {
          await store.updateSessionStatus(session.id, "reverted");
          repaired = true;
        }
        continue;
      }
      if (session.status !== "applied") continue;
      const changedPaths = session.filesChanged.map((file) => file.path).filter(Boolean);
      const patchPaths = pathsFromPatch(session.patch);
      const paths = changedPaths.length ? changedPaths : patchPaths;
      if (!paths.length) continue;
      const exists = await Promise.all(paths.map((path) => workspace.exists(path)));
      if (exists.some((value) => !value)) {
        await store.updateSessionStatus(session.id, "pending");
        repaired = true;
      }
    }
    if (repaired) {
      list = await store.listSessions();
    }
    setSessions(list);
    const last = await store.getLastSession();
    setResume(resumeSuggestion(last));
  }, []);

  const refreshWorkspaceFiles = useCallback(async () => {
    if (!workspace.root) return;
    const inspector = new ProjectInspector(workspace);
    setManifest(await inspector.buildManifest());
    setFileTree(await workspace.readFileTree().catch(() => []));
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const root = workspace.root;
    if (!root) return;
    setStatusLine("Refreshing snapshotâ€¦");
    try {
      const detector = new ProjectDetector(workspace);
      const detected = await detector.detect();
      const settings = await readWorkspaceSettings(root);
      const enabled =
        settings.autoPacksEnabled
          ? detected.recommendedPacks
          : (settings.enabledPacks?.length ? settings.enabledPacks : detected.recommendedPacks);
      const snapshot: ProjectSnapshot = {
        detectedTypes: detected.detectedTypes,
        recommendedPacks: detected.recommendedPacks,
        enabledPacks: enabled,
        importantFiles: detected.importantFiles,
        detectedCommands: detected.detectedCommands,
      };
      await writeProjectSnapshot(root, snapshot);
      if (settings.autoPacksEnabled) {
        await writeWorkspaceSettings(root, { ...settings, enabledPacks: enabled, modelPath: settings.modelPath, port: settings.port }).catch(() => {});
      }
      setProjectSnapshot(snapshot);
      setEnabledPacks(enabled);
      setAutoPacksEnabled(settings.autoPacksEnabled);
    } catch (e) {
      console.error("refreshSnapshot", e);
    } finally {
      setStatusLine(null);
    }
  }, []);

  const openWorkspace = useCallback(async () => {
    setImportEvaluation(null);
    setActiveView("chat");
    clearProjectCreationFlow();
    await openWorkspaceWithInitialization({
      workspace,
      fetchSessionsAndResume,
      setWorkspacePath,
      setFileTree,
      setManifest,
      setPlanAndPatch,
      setPreviewMap,
      setSelectedDiffPath,
      setLastBeforeSnapshots,
      setLastAppliedSessionId,
      setCurrentProposedSessionId,
      setViewingSessionId,
      setAppState,
      setStatusLine,
      setShowDiffPanel,
      setPlannerOutput,
      setReviewerOutput,
      setLastRetrievedChunks,
      setProjectSnapshot,
      setProjectMemory,
      setProjectBlueprint,
      setLivingBuildPlan,
      setFounderManifest,
      setEnabledPacks,
      setAutoPacksEnabled,
      setModelPath,
      setModelRoles,
      setToolRoot,
      setPort,
      setLocalSettings,
      setSelectedPaths,
    });
  }, [clearProjectCreationFlow, fetchSessionsAndResume]);

  const openKnownProject = useCallback(async (projectPath: string) => {
    if (workspacePath && projectMemory && projectPathsMatch(workspacePath, projectMemory.path) && messages.length > 0) {
      const now = new Date().toISOString();
      const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.text;
      await writeProjectMemory(workspacePath, {
        ...projectMemory,
        updatedAt: now,
        recentWork: [
          {
            id: `switch-${Date.now()}`,
            date: now,
            completed: "Chat context summarized before switching projects.",
            filesChanged: [],
            worksNow: latestUserMessage ? [`Last user message: ${latestUserMessage.slice(0, 240)}`] : [],
            stillNeedsWork: [],
            nextRecommendedStep: projectMemory.resumeState.resumePrompt ?? "Resume from project memory.",
          },
          ...projectMemory.recentWork,
        ].slice(0, 20),
      }).catch((error) => console.warn("[App] project switch summary failed", error));
    }
    setMessages([]);
    setBuildProgressSummary(null);
    setActiveView("chat");
    setImportEvaluation(null);
    clearProjectCreationFlow();
    await openWorkspaceWithInitialization({
      workspace,
      workspacePathToOpen: projectPath,
      fetchSessionsAndResume,
      setWorkspacePath,
      setFileTree,
      setManifest,
      setPlanAndPatch,
      setPreviewMap,
      setSelectedDiffPath,
      setLastBeforeSnapshots,
      setLastAppliedSessionId,
      setCurrentProposedSessionId,
      setViewingSessionId,
      setAppState,
      setStatusLine,
      setShowDiffPanel,
      setPlannerOutput,
      setReviewerOutput,
      setLastRetrievedChunks,
      setProjectSnapshot,
      setProjectMemory,
      setProjectBlueprint,
      setLivingBuildPlan,
      setFounderManifest,
      setEnabledPacks,
      setAutoPacksEnabled,
      setModelPath,
      setModelRoles,
      setToolRoot,
      setPort,
      setLocalSettings,
      setSelectedPaths,
    });
    const memory = readGlobalMemory();
    const now = new Date().toISOString();
    writeGlobalMemory({
      ...memory,
      updatedAt: now,
      projects: memory.projects.map((project) =>
        project.path === projectPath ? { ...project, lastOpenedAt: now } : project
      ),
    });
    setActiveMode("Code");
  }, [fetchSessionsAndResume, messages, projectMemory, workspacePath]);

  const startNewProjectDraft = useCallback(() => {
    setProjectCreationState(createMenuProjectCreationState());
    setCreationBlueprint(null);
    setNewProjectPlanPreview(null);
    setNewProjectFilePreview(null);
    setImportEvaluation(null);
    setBuildProgressSummary(null);
    setActiveMode("Plan");
  }, []);

  const generateNewProjectPlan = useCallback(() => {
    if (!projectCreationState) return;
    if (projectCreationState.needsProjectName) {
      setStatusLine(projectNameRequestMessage());
      return;
    }
    try {
      setStatusLine(null);
      applyCreationPlanningPipeline(projectCreationState, false);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [applyCreationPlanningPipeline, projectCreationState]);

  const continueDiscoveryIntake = useCallback(() => {
    if (!projectCreationState) return;
    if (projectCreationState.needsProjectName) {
      setStatusLine(projectNameRequestMessage());
      return;
    }
    try {
      setStatusLine(null);
      applyCreationPlanningPipeline(projectCreationState, true);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [applyCreationPlanningPipeline, projectCreationState]);

  const applyProjectName = useCallback((projectName: string) => {
    if (!projectCreationState || !projectName.trim()) return;
    const state = applyProjectNameToCreationState(projectCreationState, projectName.trim());
    setProjectCreationState(state);
    setStatusLine(state.needsProjectName ? projectNameRequestMessage() : null);
  }, [projectCreationState]);

  const approveNewProjectPlan = useCallback(() => {
    if (!projectCreationState || !newProjectPlanPreview) return;
    const approvedPlan: NewProjectPlanPreview = { ...newProjectPlanPreview, status: "approved" };
    try {
      setStatusLine(null);
      setNewProjectPlanPreview(approvedPlan);
      setNewProjectFilePreview(
        generateProjectCreationFilePreview(projectCreationState, approvedPlan, creationBlueprint)
      );
    } catch (error) {
      setNewProjectPlanPreview(approvedPlan);
      setNewProjectFilePreview(null);
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [creationBlueprint, newProjectPlanPreview, projectCreationState]);

  const reviseNewProjectPlan = useCallback(() => {
    setNewProjectPlanPreview((plan) => plan ? { ...plan, status: "needsRevision" } : plan);
    setNewProjectFilePreview(null);
  }, []);

  const cancelNewProjectPlan = useCallback(() => {
    clearProjectCreationFlow();
  }, [clearProjectCreationFlow]);

  const backToNewProjectPlan = useCallback(() => {
    setNewProjectFilePreview(null);
    setNewProjectPlanPreview((plan) => plan ? { ...plan, status: "draft" } : plan);
  }, []);

  const createNewProjectFiles = useCallback(async () => {
    if (!projectCreationState || !newProjectPlanPreview || !newProjectFilePreview) return;
    const draft = projectCreationStateToDraft(projectCreationState);
    setStatusLine("Creating project files...");
    try {
      const result = await commitNewProjectFiles(draft, newProjectPlanPreview, newProjectFilePreview, {
        blueprint: creationBlueprint ?? undefined,
      });
      await workspace.setWorkspaceRoot(newProjectFilePreview.targetPath);
      setWorkspacePath(newProjectFilePreview.targetPath);
      setProjectMemory(result.projectMemory);
      setProjectBlueprint(creationBlueprint);
      setLivingBuildPlan(result.livingBuildPlan);
      setFounderManifest(result.founderManifest);
      const inspector = new ProjectInspector(workspace);
      const nextManifest = await inspector.buildManifest();
      setManifest(nextManifest);
      setFileTree(await workspace.readFileTree().catch(() => []));
      const detector = new ProjectDetector(workspace);
      const detected = await detector.detect();
      setProjectSnapshot({
        detectedTypes: detected.detectedTypes,
        recommendedPacks: detected.recommendedPacks,
        enabledPacks: detected.recommendedPacks,
        importantFiles: detected.importantFiles,
        detectedCommands: detected.detectedCommands,
      });
      setEnabledPacks(detected.recommendedPacks);
      setSelectedPaths([]);
      setPlanAndPatch(null);
      setPreviewMap(null);
      setSelectedDiffPath(null);
      setAppState("idle");
      setShowDiffPanel(false);
      clearProjectCreationFlow();
      setActiveView("chat");
      await fetchSessionsAndResume();
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: "Created the project files and opened the new workspace. No install or run commands were executed." },
      ]);
    } catch (e) {
      console.error("createNewProjectFiles", e);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: `Could not create project files: ${String(e)}` },
      ]);
    } finally {
      setStatusLine(null);
    }
  }, [clearProjectCreationFlow, creationBlueprint, fetchSessionsAndResume, newProjectFilePreview, newProjectPlanPreview, projectCreationState]);

  const evaluateImportForCurrentWorkspace = useCallback(async () => {
    let root = workspace.root;
    let currentManifest = manifest;
    if (!root) {
      const selected = await workspace.openWorkspace();
      if (!selected) return;
      root = selected;
      setWorkspacePath(selected);
      setFileTree(await workspace.readFileTree().catch(() => []));
      currentManifest = null;
    }

    setStatusLine("Evaluating project import...");
    try {
      const inspector = new ProjectInspector(workspace);
      const nextManifest = currentManifest ?? await inspector.buildManifest();
      if (!currentManifest) setManifest(nextManifest);
      const evaluation = await evaluateExistingProjectImport(workspace, root, nextManifest);
      setImportEvaluation(evaluation);
      setActiveView("chat");
      clearProjectCreationFlow();
      setActiveMode("Plan");
    } catch (e) {
      console.error("evaluateImportForCurrentWorkspace", e);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: `Could not evaluate import: ${String(e)}` },
      ]);
    } finally {
      setStatusLine(null);
    }
  }, [manifest]);

  const approveImportEvaluation = useCallback(async () => {
    if (!importEvaluation) return;
    setStatusLine("Saving import memory...");
    try {
      await commitExistingProjectImport(importEvaluation);
      setProjectMemory(importEvaluation.projectMemoryDraft);
      setProjectBlueprint(importEvaluation.projectBlueprintDraft ?? null);
      setLivingBuildPlan({
        ...importEvaluation.livingBuildPlanDraft,
        progressSummary: "Project imported into NF memory.",
      });
      setProjectSnapshot((snapshot) => snapshot ? {
        ...snapshot,
        detectedTypes: importEvaluation.detectedStack,
        importantFiles: importEvaluation.projectMemoryDraft.importantFiles.map((file) => file.path),
        detectedCommands: importEvaluation.detectedCommands,
      } : {
        detectedTypes: importEvaluation.detectedStack,
        recommendedPacks: [],
        enabledPacks: [],
        importantFiles: importEvaluation.projectMemoryDraft.importantFiles.map((file) => file.path),
        detectedCommands: importEvaluation.detectedCommands,
      });
      setImportEvaluation(null);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: "Imported this project into NF memory. Project source files were not changed." },
      ]);
    } catch (e) {
      console.error("approveImportEvaluation", e);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: `Could not approve import: ${String(e)}` },
      ]);
    } finally {
      setStatusLine(null);
    }
  }, [importEvaluation]);

  const recordBuildProgressAfterApply = useCallback(async (filesChanged: string[]) => {
    const root = workspace.root;
    if (!root || filesChanged.length === 0) return;
    const summary = await updateBuildProgressAfterPatch(root, filesChanged);
    if (!summary) return;
    setBuildProgressSummary(summary);
    const [nextProjectMemory, nextLivingBuildPlan] = await Promise.all([
      readProjectMemory(root),
      readLivingBuildPlan(root),
    ]);
    setProjectMemory(nextProjectMemory);
    setProjectBlueprint(null);
    setLivingBuildPlan(nextLivingBuildPlan);
  }, []);

  const answerImportQuestions = useCallback(() => {
    setActiveMode("Plan");
  }, []);

  const cancelImportEvaluation = useCallback(() => {
    setImportEvaluation(null);
  }, []);

  const markSessionAppliedInState = useCallback((sessionId: string, beforeSnapshots: FileSnapshot[]) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              status: "applied",
              beforeSnapshots,
              filesChanged: beforeSnapshots.map((snapshot) => ({ path: snapshot.path })),
            }
          : session
      )
    );
  }, []);

  const pendingPatchSession =
    [...sessions].reverse().find((session) =>
      session.id !== lastAppliedSessionId &&
      (session.status === "pending" || (session.status === "proposed" && session.id === currentProposedSessionId))
    ) ?? null;

  const startFoundationBuilding = useCallback(async () => {
    const gate = canStartFoundationExecution({
      workspacePath,
      projectBlueprint,
      creationFlowActive: !!projectCreationState,
    });
    if (!gate.ok) {
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: gate.reason },
      ]);
      setStatusLine(gate.reason);
      return;
    }
    if (!workspacePath || !projectBlueprint) return;

    setPhaseExecutionRunning(true);
    setStatusLine("Starting Foundation phase.");
    try {
      const result = await startFoundationPhaseExecution({
        workspaceRoot: workspacePath,
        projectBlueprint,
        projectMemory,
        livingBuildPlan,
        projectSnapshot,
        provider,
        modelPath,
        runtimePort,
        readFile: (path) => workspace.readFile(path),
      });
      setProjectBlueprint(result.blueprint);
      const updatedLivingPlan = await readLivingBuildPlan(workspacePath).catch(() => null);
      if (updatedLivingPlan) setLivingBuildPlan(updatedLivingPlan);
      const narration = describePhaseExecutionResult(result, developerMode);
      setPhaseExecutionNarration(narration);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: [
            "Starting Foundation phase.",
            narration.founderSummary,
            ...(developerMode ? narration.developerDetails : []),
          ].join("\n"),
        },
      ]);
      await refreshWorkspaceFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: message },
      ]);
      setStatusLine(message);
    } finally {
      setPhaseExecutionRunning(false);
      setTimeout(() => setStatusLine(null), 2400);
    }
  }, [
    developerMode,
    livingBuildPlan,
    modelPath,
    projectBlueprint,
    projectCreationState,
    projectMemory,
    projectSnapshot,
    provider,
    refreshWorkspaceFiles,
    runtimePort,
    workspace,
    workspacePath,
  ]);

  const phaseGatePresentation = useMemo(() => {
    if (!projectBlueprint) return null;
    return getPhaseGatePresentation(projectBlueprint, developerMode);
  }, [projectBlueprint, developerMode]);

  const changeApprovalPresentation = useMemo(() => {
    if (!projectBlueprint) return null;
    return getChangeApprovalPresentation(projectBlueprint, developerMode);
  }, [projectBlueprint, developerMode]);

  const approvePendingFileChange = useCallback(async () => {
    if (!workspacePath || !projectBlueprint) return;
    setPhaseExecutionRunning(true);
    setStatusLine("Applying approved change.");
    try {
      const { narration, blueprint } = await approvePendingChangeAndContinue({
        workspaceRoot: workspacePath,
        projectBlueprint,
        projectMemory,
        livingBuildPlan,
        projectSnapshot,
        provider,
        modelPath,
        runtimePort,
        readFile: (path) => workspace.readFile(path),
      });
      setProjectBlueprint(blueprint);
      const updatedLivingPlan = await readLivingBuildPlan(workspacePath).catch(() => null);
      if (updatedLivingPlan) setLivingBuildPlan(updatedLivingPlan);
      setPhaseExecutionNarration(narration);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: [
            narration.founderSummary,
            ...(developerMode ? narration.developerDetails : []),
          ].join("\n"),
        },
      ]);
      await refreshWorkspaceFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: message },
      ]);
      setStatusLine(message);
    } finally {
      setPhaseExecutionRunning(false);
      setTimeout(() => setStatusLine(null), 2400);
    }
  }, [
    developerMode,
    livingBuildPlan,
    modelPath,
    projectBlueprint,
    projectMemory,
    projectSnapshot,
    provider,
    refreshWorkspaceFiles,
    runtimePort,
    workspace,
    workspacePath,
  ]);

  const rejectPendingFileChange = useCallback(async () => {
    if (!workspacePath || !projectBlueprint) return;
    const next = rejectPendingChange(projectBlueprint);
    await writeWorkspaceProjectBlueprint(workspacePath, next);
    setProjectBlueprint(next);
    setPhaseExecutionNarration({
      status: "blocked",
      founderSummary: "Change rejected. NF stopped safely at the current task.",
      developerDetails: developerMode ? [`taskId=${next.phaseExecutionState.data?.currentTaskId ?? "(none)"}`] : [],
    });
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: "Change rejected. NF stopped safely at the current task." },
    ]);
  }, [developerMode, projectBlueprint, workspacePath]);

  const explainPendingFileChange = useCallback(() => {
    if (!projectBlueprint) return;
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: explainPendingChange(projectBlueprint) },
    ]);
  }, [projectBlueprint]);

  const approvePhaseGateAndContinue = useCallback(async (overrideBlockers = false) => {
    if (!workspacePath || !projectBlueprint) return;
    setPhaseExecutionRunning(true);
    setStatusLine(overrideBlockers ? "Approving phase with blocker override." : "Approving phase and continuing.");
    try {
      const result = await approvePhaseAndContinue({
        workspaceRoot: workspacePath,
        projectBlueprint,
        projectMemory,
        livingBuildPlan,
        projectSnapshot,
        provider,
        modelPath,
        runtimePort,
        readFile: (path) => workspace.readFile(path),
        overrideBlockers,
      });
      setProjectBlueprint(result.blueprint);
      const updatedLivingPlan = await readLivingBuildPlan(workspacePath).catch(() => null);
      if (updatedLivingPlan) setLivingBuildPlan(updatedLivingPlan);
      setPhaseExecutionNarration(result.narration);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: [
            `Approved ${result.approvedPhaseId} and activated ${result.activatedPhaseId}.`,
            result.narration.founderSummary,
            ...(developerMode ? result.narration.developerDetails : []),
            result.overrideLogged ? "Founder blocker override was recorded in the action log." : "",
          ].filter(Boolean).join("\n"),
        },
      ]);
      await refreshWorkspaceFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: message },
      ]);
      setStatusLine(message);
    } finally {
      setPhaseExecutionRunning(false);
      setTimeout(() => setStatusLine(null), 2400);
    }
  }, [
    developerMode,
    livingBuildPlan,
    modelPath,
    projectBlueprint,
    projectMemory,
    projectSnapshot,
    provider,
    refreshWorkspaceFiles,
    runtimePort,
    workspace,
    workspacePath,
  ]);

  const holdPhaseAtGate = useCallback(async () => {
    if (!workspacePath || !projectBlueprint) return;
    const next = holdPhaseGate(projectBlueprint);
    await writeWorkspaceProjectBlueprint(workspacePath, next);
    setProjectBlueprint(next);
    setPhaseExecutionNarration({
      status: "needsApproval",
      founderSummary: "Held at the current phase gate. Approve to continue or revise the plan.",
      developerDetails: developerMode ? [`phaseId=${next.phaseExecutionState.data?.currentPhaseId ?? "(none)"}`] : [],
    });
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: "Held at the current phase gate." },
    ]);
  }, [developerMode, projectBlueprint, workspacePath]);

  const revisePhasePlanAtGate = useCallback(async () => {
    if (!workspacePath || !projectBlueprint) return;
    const next = revisePhaseGatePlan(projectBlueprint);
    await writeWorkspaceProjectBlueprint(workspacePath, next);
    setProjectBlueprint(next);
    setPhaseExecutionNarration({
      status: "needsApproval",
      founderSummary: "Revise the plan, then approve the phase gate when ready.",
      developerDetails: developerMode ? [`phaseId=${next.phaseExecutionState.data?.currentPhaseId ?? "(none)"}`] : [],
    });
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: "Marked this phase for plan revision before continuing." },
    ]);
  }, [developerMode, projectBlueprint, workspacePath]);

  const { sendChatMessage, proposePatch } = useChatController({
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
    onImportExistingProject: evaluateImportForCurrentWorkspace,
    onOpenKnownProject: openKnownProject,
    onStartFoundationPhase: startFoundationBuilding,
    onApprovePendingChange: approvePendingFileChange,
    onRejectPendingChange: rejectPendingFileChange,
    onExplainPendingChange: explainPendingFileChange,
    onApprovePhaseAndContinue: approvePhaseGateAndContinue,
    onHoldPhase: holdPhaseAtGate,
    onRevisePhasePlan: revisePhasePlanAtGate,
    getPhaseGatePresentation: () => (projectBlueprint ? getPhaseGatePresentation(projectBlueprint, developerMode) : null),
    getChangeApprovalPresentation: () => (projectBlueprint ? getChangeApprovalPresentation(projectBlueprint, developerMode) : null),
    setProjectCreationState: (stateUpdate) => {
      if (typeof stateUpdate === "function") {
        setProjectCreationState((current) => {
          const next = stateUpdate(current);
          if (!next) return null;
          return next;
        });
        setCreationBlueprint(null);
        setNewProjectPlanPreview(null);
        setNewProjectFilePreview(null);
        return;
      }
      setProjectCreationState(stateUpdate);
      setCreationBlueprint(null);
      setNewProjectPlanPreview(null);
      setNewProjectFilePreview(null);
      setImportEvaluation(null);
      if (stateUpdate) setActiveMode("Plan");
    },
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
  });

  const handleStopPipeline = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const executePipeline = useCallback(
    async (prompt: string) => {
      const root = workspace.root;
      if (!workspacePath || root == null || root === "") {
        console.warn("[App] executePipeline blocked: no workspace root.");
        return;
      }
      setViewingSessionId(null);
      const p = (prompt || "").trim() || "(no prompt)";
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: p }]);
      const runId = `executePipeline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      activeRunIdRef.current = runId;
      console.log("[gen] TRUE", runId, { action: "executePipeline", targetPath: undefined, messageId: undefined });
      setStatusLine("Running pipelineâ€¦");
      const ac = new AbortController();
      abortControllerRef.current = ac;
      setPipelineRunning(true);
      const ts = Date.now();
      const nowIso = () => new Date().toISOString();
      setThinkingLines((prev) => [...prev, { id: `t-${ts}-0`, text: "Running pipelineâ€¦", type: "status", timestamp: nowIso() }]);
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
        const ctxBuilder = new ContextBuilder(workspace, m);
        const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
        const buildOpt = (role: "planner" | "coder" | "reviewer") => ({
          useKnowledge: useKnowledgePacks,
          knowledgeStore: knowledgeStore ?? undefined,
          agentRole: role,
          projectSnapshot: projectSnapshot ?? undefined,
          enabledPacks: enabledPacks.length ? enabledPacks : undefined,
        });
        const pipelineOverrides =
          provider === "local"
            ? {
                planner: new LocalPlannerAgent(
                  () => localSettingsRef.current,
                  () => toolRootRef.current,
                  () => runtimePortRef.current ?? portRef.current ?? 11435,
                  () => ({})
                ),
                reviewer: new LocalReviewerAgent(
                  () => localSettingsRef.current,
                  () => toolRootRef.current,
                  () => runtimePortRef.current ?? portRef.current ?? 11435,
                  () => ({})
                ),
              }
            : undefined;
        const ctx = await ctxBuilder.build(p, selectedPaths, buildOpt("coder"));
        const result = await Promise.race([
          runPipeline(p, ctx, pipelineOverrides),
          abortPromise,
        ]);
        const pl = result.planner;
        const cod = result.coder;
        setPlannerOutput(pl);
        setPlanAndPatch(cod);
        setReviewerOutput(result.reviewer);
        setThinkingLines((prev) => {
          const next = [...prev];
          next.push({ id: `t-${ts}-plan`, text: (pl.plan || "").trim(), type: "plan", timestamp: nowIso() });
          next.push({ id: `t-${ts}-coder`, text: "Proposed patch: " + (cod.explanation || "").split(/\n/)[0]?.slice(0, 120) || "â€”", type: "action", timestamp: nowIso() });
          next.push({ id: `t-${ts}-review`, text: (result.reviewer?.reviewNotes || "").trim().slice(0, 500) || "â€”", type: "review", timestamp: nowIso() });
          return next;
        });
        setLastRetrievedChunks(
          ctx.knowledgeChunks?.map((c) => ({
            title: c.title,
            sourcePath: c.sourcePath,
            chunkText: c.chunkText,
          })) ?? []
        );
        const engine = new PatchEngine(root, (path: string) => workspace.readFile(path));
        const preview = await engine.preview(cod.patch);
        const map = new Map<string, { old: string; new: string }>();
        preview.forEach((v, k) => map.set(k, v));
        setPreviewMap(map);
        const paths = [...preview.keys()];
        setSelectedDiffPath(paths[0] ?? null);
        setAppState("patchProposed");
        const store = new MemoryStore(root);
        const record = await store.addProposedSession(p, selectedPaths, cod.explanation, cod.patch);
        setCurrentProposedSessionId(record.id);
        await fetchSessionsAndResume();
      } catch (e) {
        const isAbort =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e && (e as Error).name === "AbortError");
        if (isAbort) {
          setThinkingLines((prev) => [...prev, { id: `t-${ts}-cancel`, text: "Cancelled.", type: "status", timestamp: nowIso() }]);
        } else {
          console.error("executePipeline", e);
          setThinkingLines((prev) => [...prev, { id: `t-${ts}-err`, text: "Error: " + String(e), type: "error", timestamp: nowIso() }]);
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
          ]);
        }
      } finally {
        console.log("[gen] FALSE", runId, { action: "executePipeline" });
        setStatusLine(null);
        setPipelineRunning(false);
        abortControllerRef.current = null;
      }
    },
    [workspacePath, selectedPaths, manifest, fetchSessionsAndResume, useKnowledgePacks, provider, projectSnapshot, enabledPacks]
  );

  const persistEnabledPacks = useCallback(
    async (next: string[]) => {
      setEnabledPacks(next);
      const root = workspace.root;
      if (root && projectSnapshot) {
        const snapshot: ProjectSnapshot = {
          ...projectSnapshot,
          enabledPacks: next,
        };
        await writeProjectSnapshot(root, snapshot).catch(() => {});
        setProjectSnapshot(snapshot);
        await writeWorkspaceSettings(root, { autoPacksEnabled, enabledPacks: next, modelPath, port, modelRoles }).catch(() => {});
      }
    },
    [projectSnapshot, autoPacksEnabled, modelPath, port]
  );

  const handleAutoPacksEnabledChange = useCallback(
    (value: boolean) => {
      setAutoPacksEnabled(value);
      const root = workspace.root;
      if (root) {
        writeWorkspaceSettings(root, { autoPacksEnabled: value, enabledPacks, modelPath, port, modelRoles }).catch(() => {});
      }
    },
    [enabledPacks, modelPath, port]
  );

  const applyPatch = useCallback(async () => {
    if (!workspacePath || !workspace.root || !planAndPatch || !currentProposedSessionId) return;
    setApplyInProgress(true);
    setStatusLine("Applying patchâ€¦");
    try {
      const engine = new PatchEngine(workspace.root, (p) =>
        workspace.readFile(p)
      );
      const result = await engine.apply(planAndPatch.patch);
      if (result.failed.length > 0 || result.applied.length === 0) {
        throw new Error(formatPatchApplyFailure(result));
      }
      setLastBeforeSnapshots(result.beforeSnapshots);
      const store = new MemoryStore(workspace.root);
      await store.updateSessionToApplied(currentProposedSessionId, result.beforeSnapshots);
      markSessionAppliedInState(currentProposedSessionId, result.beforeSnapshots);
      await recordBuildProgressAfterApply(result.applied);
      await refreshWorkspaceFiles();
      setLastAppliedSessionId(currentProposedSessionId);
      setCurrentProposedSessionId(null);
      setAppState("patchApplied");
      await fetchSessionsAndResume();
    } catch (e) {
      console.error("applyPatch", e);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: `Patch apply failed. The session was kept pending.\n\n${String(e)}` },
      ]);
    } finally {
      setApplyInProgress(false);
      setStatusLine(null);
    }
  }, [workspacePath, planAndPatch, currentProposedSessionId, fetchSessionsAndResume, recordBuildProgressAfterApply, markSessionAppliedInState, refreshWorkspaceFiles]);

  const revert = useCallback(async () => {
    if (appState === "patchProposed") {
      if (workspace.root && currentProposedSessionId) {
        const store = new MemoryStore(workspace.root);
        await store.updateSessionStatus(currentProposedSessionId, "reverted");
        await fetchSessionsAndResume();
      }
      setPlanAndPatch(null);
      setPreviewMap(null);
      setPlannerOutput(null);
      setReviewerOutput(null);
      setLastRetrievedChunks([]);
      setSelectedDiffPath(null);
      setShowDiffPanel(false);
      setViewingSessionId(null);
      setCurrentProposedSessionId(null);
      setAppState("idle");
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: "Proposal discarded." },
      ]);
      return;
    }
    if (appState === "patchApplied" && lastBeforeSnapshots?.length && workspace.root) {
      setApplyInProgress(true);
      setStatusLine("Revertingâ€¦");
      try {
        const store = new MemoryStore(workspace.root);
        if (lastAppliedSessionId) await store.updateSessionStatus(lastAppliedSessionId, "reverted");
        const engine = new PatchEngine(workspace.root, (p) =>
          workspace.readFile(p)
        );
        await engine.revert(lastBeforeSnapshots);
        setLastBeforeSnapshots(null);
        setLastAppliedSessionId(null);
        setPlanAndPatch(null);
        setPreviewMap(null);
        setPlannerOutput(null);
        setReviewerOutput(null);
        setLastRetrievedChunks([]);
        setSelectedDiffPath(null);
        setShowDiffPanel(false);
        setViewingSessionId(null);
        setAppState("idle");
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: "Reverted." },
        ]);
        await fetchSessionsAndResume();
      } catch (e) {
        console.error("revert", e);
      } finally {
        setApplyInProgress(false);
        setStatusLine(null);
      }
    }
  }, [appState, lastBeforeSnapshots, lastAppliedSessionId, currentProposedSessionId, fetchSessionsAndResume]);

  const saveLater = useCallback(async () => {
    if (!workspace.root || !planAndPatch || !currentProposedSessionId) return;
    const store = new MemoryStore(workspace.root);
    await store.updateSessionStatus(currentProposedSessionId, "pending");
    setPlanAndPatch(null);
    setPreviewMap(null);
    setPlannerOutput(null);
    setReviewerOutput(null);
    setLastRetrievedChunks([]);
    setSelectedDiffPath(null);
    setShowDiffPanel(false);
    setViewingSessionId(null);
    setCurrentProposedSessionId(null);
    setAppState("idle");
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: "Saved for later." },
    ]);
    await fetchSessionsAndResume();
  }, [workspacePath, planAndPatch, currentProposedSessionId, fetchSessionsAndResume]);

  const toggleViewDiff = useCallback(() => {
    setShowDiffPanel((v) => {
      if (v && fileEditState?.dirty && !window.confirm("Unsaved changes. Close anyway?")) return true;
      if (v) setFileEditState(null);
      return !v;
    });
  }, [fileEditState?.dirty]);

  const handleFileEditChange = useCallback((editedText: string) => {
    setFileEditState((prev) =>
      prev ? { ...prev, editedText, dirty: editedText !== prev.originalText } : null
    );
  }, []);

  const handleFileEditSave = useCallback(async () => {
    const root = workspace.root;
    if (!root || !fileEditState || !fileEditState.dirty) return;
    const { relativePath, editedText } = fileEditState;
    setFileEditState((prev) => (prev ? { ...prev, lastSaveStatus: "saving", saveError: undefined } : null));
    try {
      await workspace.writeFile(root, relativePath, editedText);
      const diskContent = await workspace.readFile(relativePath);
      const absolutePath = await workspace.resolvePath(root, relativePath);
      const fileSizeBytes = await workspace.getFileSize(root, relativePath);
      const contentHashPrefix = await sha256Prefix(editedText);
      setFileEditState((prev) =>
        prev
          ? {
              ...prev,
              originalText: diskContent,
              editedText: diskContent,
              dirty: false,
              lastSaveStatus: "saved",
              savedAt: Date.now(),
              saveError: undefined,
              verifyInfo: { absolutePath, fileSizeBytes, contentHashPrefix },
            }
          : null
      );
      setTimeout(() => {
        setFileEditState((prev) =>
          prev && prev.lastSaveStatus === "saved" ? { ...prev, lastSaveStatus: "idle" } : prev
        );
      }, 2000);
    } catch (e) {
      console.error("handleFileEditSave", e);
      setFileEditState((prev) =>
        prev ? { ...prev, lastSaveStatus: "error", saveError: String(e) } : null
      );
    }
  }, [fileEditState]);

  const handleSetBaseline = useCallback(async () => {
    const root = workspace.root;
    if (!root || !fileEditState) return;
    try {
      const diskContent = await workspace.readFile(fileEditState.relativePath);
      setFileEditState((prev) =>
        prev
          ? {
              ...prev,
              baselineText: diskContent,
              baselineUpdatedAt: Date.now(),
            }
          : null
      );
    } catch (e) {
      console.error("handleSetBaseline", e);
    }
  }, [fileEditState]);

  const handleResetToBaseline = useCallback(() => {
    if (!fileEditState) return;
    setFileEditState((prev) =>
      prev
        ? {
            ...prev,
            editedText: prev.baselineText,
            dirty: prev.baselineText !== prev.originalText,
          }
        : null
    );
  }, [fileEditState]);

  const runChecks = useCallback(() => {
    setStatusLine("Running checksâ€¦");
    setTimeout(() => setStatusLine(null), 800);
    /* TODO: TaskRunner; Sprint 3 */
  }, []);

  const viewSession = useCallback(
    async (s: SessionRecord) => {
      if (!workspace.root) return;
      if ((s.status === "pending" || s.status === "proposed") && !(await patchHasWritablePreview(workspace.root, s.patch).catch(() => false))) {
        const store = new MemoryStore(workspace.root);
        await store.updateSessionStatus(s.id, "reverted");
        await fetchSessionsAndResume();
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: "No valid patch generated. Regenerate the patch before applying." },
        ]);
        return;
      }
      const engine = new PatchEngine(workspace.root, (p) => workspace.readFile(p));
      const preview = await engine.preview(s.patch);
      const map = new Map<string, { old: string; new: string }>();
      preview.forEach((v, k) => map.set(k, v));
      setPlanAndPatch({ explanation: s.explanation, patch: s.patch });
      setPreviewMap(map);
      setPlannerOutput(null);
      setReviewerOutput(null);
      const paths = [...preview.keys()];
      setSelectedDiffPath(paths[0] ?? null);
      setShowDiffPanel(true);
      setViewingSessionId(s.id);
      setAppState(s.status === "pending" ? "patchProposed" : "idle");
    },
    [fetchSessionsAndResume]
  );

  const applySession = useCallback(
    async (s: SessionRecord) => {
      if (!workspace.root || s.status !== "pending") return;
      setApplyInProgress(true);
      setStatusLine("Applying patchâ€¦");
      try {
        const engine = new PatchEngine(workspace.root, (p) =>
          workspace.readFile(p)
        );
        const result = await engine.apply(s.patch);
        if (result.failed.length > 0 || result.applied.length === 0) {
          throw new Error(formatPatchApplyFailure(result));
        }
        const store = new MemoryStore(workspace.root);
        await store.updateSessionToApplied(s.id, result.beforeSnapshots);
        markSessionAppliedInState(s.id, result.beforeSnapshots);
        await recordBuildProgressAfterApply(result.applied);
        await refreshWorkspaceFiles();
        setLastAppliedSessionId(s.id);
        if (viewingSessionId === s.id) {
          setAppState("patchApplied");
          setLastBeforeSnapshots(result.beforeSnapshots);
        }
        await fetchSessionsAndResume();
      } catch (e) {
        console.error("applySession", e);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: `Patch apply failed. The session was kept pending.\n\n${String(e)}` },
        ]);
      } finally {
        setApplyInProgress(false);
        setStatusLine(null);
      }
    },
    [viewingSessionId, fetchSessionsAndResume, recordBuildProgressAfterApply, markSessionAppliedInState, refreshWorkspaceFiles]
  );

  const continueFromBuildProgress = useCallback(() => {
    setStatusLine(buildProgressSummary?.nextRecommendedStep ?? "Ready for the next build-plan step.");
    setTimeout(() => setStatusLine(null), 1800);
  }, [buildProgressSummary]);

  const pauseFromBuildProgress = useCallback(() => {
    setStatusLine("Paused here. Resume state remains in project memory.");
    setTimeout(() => setStatusLine(null), 1800);
  }, []);

  const viewBuildPlanFromProgress = useCallback(() => {
    const progress = livingBuildPlan?.progressSummary || buildProgressSummary?.nextRecommendedStep || "No build plan summary available.";
    setStatusLine(progress);
    setTimeout(() => setStatusLine(null), 2400);
  }, [buildProgressSummary, livingBuildPlan]);

  const revertSession = useCallback(
    async (s: SessionRecord) => {
      if (!workspace.root || s.status !== "applied") return;
      const snapshots = s.beforeSnapshots;
      if (!snapshots?.length) return;
      setApplyInProgress(true);
      setStatusLine("Revertingâ€¦");
      try {
        const engine = new PatchEngine(workspace.root, (p) =>
          workspace.readFile(p)
        );
        await engine.revert(snapshots as FileSnapshot[]);
        const store = new MemoryStore(workspace.root);
        await store.updateSessionStatus(s.id, "reverted");
        if (viewingSessionId === s.id) {
          setPlanAndPatch(null);
          setPreviewMap(null);
          setPlannerOutput(null);
          setReviewerOutput(null);
          setSelectedDiffPath(null);
          setShowDiffPanel(false);
          setViewingSessionId(null);
          setAppState("idle");
          setLastBeforeSnapshots(null);
          setLastAppliedSessionId(null);
        }
        await fetchSessionsAndResume();
      } catch (e) {
        console.error("revertSession", e);
      } finally {
        setApplyInProgress(false);
        setStatusLine(null);
      }
    },
    [viewingSessionId, fetchSessionsAndResume]
  );

  const selectFilesForContext = useCallback(async () => {
    const paths = await workspace.pickContextFiles();
    if (paths.length)
      setSelectedPaths((prev) => [...new Set([...prev, ...paths])]);
  }, []);

  const changedFiles = planAndPatch
    ? [...(previewMap?.keys() ?? [])]
    : [];
  const showRightPane = provider === "local" || developerMode;

  const readFile = useCallback(
    (path: string) => workspace.readFile(path),
    []
  );

  const openProjectDashboard = useCallback(() => {
    const transition = openProjectDashboardView(messages);
    setActiveView(transition.activeView);
  }, [messages]);

  const closeProjectDashboard = useCallback(() => {
    const transition = closeProjectDashboardView(messages);
    setActiveView(transition.activeView);
  }, [messages]);

  const projectDashboard = workspacePath
    ? buildProjectDashboardModel({
        workspacePath,
        projectBlueprint,
        projectMemory,
        livingBuildPlan,
        founderManifest,
        manifest,
        developerMode,
      })
    : null;

  const foundationStartGate = canStartFoundationExecution({
    workspacePath,
    projectBlueprint,
    creationFlowActive: !!projectCreationState,
  });

  return (
    <AppErrorBoundary>
    <div className="app app-single-flow">
      <TopBar
        workspacePath={workspacePath}
        onOpenWorkspace={openWorkspace}
        onCreateNewProject={startNewProjectDraft}
        onImportExistingProject={evaluateImportForCurrentWorkspace}
        activeMode={activeMode}
        onModeChange={setActiveMode}
      >
        {shouldShowProjectDashboardButton(workspacePath) && (
          <button
            type="button"
            className="btn secondary"
            onClick={openProjectDashboard}
          >
            Project Dashboard
          </button>
        )}
      </TopBar>
      {activeView === "projectDashboard" && projectDashboard ? (
        <main className="project-dashboard-view">
          <ProjectDashboard dashboard={projectDashboard} onClose={closeProjectDashboard} developerMode={developerMode} />
        </main>
      ) : (
      <div className={showRightPane ? "main-three-pane" : "main-three-pane main-two-pane"}>
        <ConversationPane
          messages={messages}
          planAndPatch={planAndPatch}
          plannerOutput={plannerOutput}
          reviewerOutput={reviewerOutput}
          developerMode={developerMode}
          changedFiles={changedFiles}
          appState={appState}
          applyInProgress={applyInProgress}
          statusLine={statusLine}
          workspaceRoot={workspacePath}
          projectMemory={projectMemory}
          livingBuildPlan={livingBuildPlan}
          founderManifest={founderManifest}
          projectCreationState={projectCreationState}
          creationBlueprint={creationBlueprint}
          discoveryIntake={discoveryIntake}
          newProjectPlanPreview={newProjectPlanPreview}
          newProjectFilePreview={newProjectFilePreview}
          importEvaluation={importEvaluation}
          buildProgressSummary={buildProgressSummary}
          canStartFoundationPhase={foundationStartGate.ok}
          phaseExecutionNarration={phaseExecutionNarration}
          phaseExecutionRunning={phaseExecutionRunning}
          changeApprovalPresentation={changeApprovalPresentation}
          phaseGatePresentation={phaseGatePresentation}
          onStartFoundationPhase={startFoundationBuilding}
          onApprovePendingChange={approvePendingFileChange}
          onRejectPendingChange={rejectPendingFileChange}
          onExplainPendingChange={explainPendingFileChange}
          onApprovePhaseAndContinue={approvePhaseGateAndContinue}
          onHoldPhase={holdPhaseAtGate}
          onRevisePhasePlan={revisePhasePlanAtGate}
          onGenerateNewProjectPlan={generateNewProjectPlan}
          onContinueDiscoveryIntake={continueDiscoveryIntake}
          onApplyProjectName={applyProjectName}
          onApproveNewProjectPlan={approveNewProjectPlan}
          onReviseNewProjectPlan={reviseNewProjectPlan}
          onCancelNewProjectPlan={cancelNewProjectPlan}
          onBackToNewProjectPlan={backToNewProjectPlan}
          onCreateNewProjectFiles={createNewProjectFiles}
          onApproveImportEvaluation={approveImportEvaluation}
          onAnswerImportQuestions={answerImportQuestions}
          onCancelImportEvaluation={cancelImportEvaluation}
          onContinueBuildProgress={continueFromBuildProgress}
          onPauseBuildProgress={pauseFromBuildProgress}
          onViewBuildPlan={viewBuildPlanFromProgress}
          resume={resume}
          viewingSessionId={viewingSessionId}
          agentMode={agentMode}
          onAgentModeChange={setAgentMode}
          useKnowledgePacks={useKnowledgePacks}
          onUseKnowledgePacksChange={setUseKnowledgePacks}
          lastRetrievedChunks={lastRetrievedChunks}
          projectSnapshot={projectSnapshot}
          enabledPacks={enabledPacks}
          onEnabledPacksChange={persistEnabledPacks}
          autoPacksEnabled={autoPacksEnabled}
          onAutoPacksEnabledChange={handleAutoPacksEnabledChange}
          onRefreshSnapshot={refreshSnapshot}
          provider={provider}
          onProviderChange={setProvider}
          toolRoot={toolRoot}
          localSettings={localSettings}
          onLocalSettingsChange={setLocalSettings}
          onRescanModels={rescanModels}
          onPickGGUF={pickGGUFFile}
          modelRoles={modelRoles}
          onModelRolesChange={onModelRolesChange}
          onSendChatMessage={sendChatMessage}
          onProposePatch={proposePatch}
          onRunPipeline={executePipeline}
          onKeep={applyPatch}
          onRevert={revert}
          onSaveLater={saveLater}
          onViewDiff={toggleViewDiff}
          showingDiff={showDiffPanel}
        />
        <FilesPane
          fileTree={fileTree}
          selectedPaths={selectedPaths}
          onSelectPathsChange={setSelectedPaths}
          onPickFiles={selectFilesForContext}
          onRunChecks={runChecks}
          sessions={sessions}
          workspaceRoot={workspacePath}
          applyInProgress={applyInProgress}
          onViewSession={viewSession}
          onApplySession={applySession}
          onRevertSession={revertSession}
          showDiffPanel={showDiffPanel}
          patch={planAndPatch?.patch ?? null}
          previewMap={previewMap}
          selectedDiffPath={selectedDiffPath}
          onSelectDiffPath={setSelectedDiffPath}
          readFile={readFile}
          fileEditState={fileEditState}
          onFileEditChange={handleFileEditChange}
          onFileEditSave={handleFileEditSave}
          onSetBaseline={handleSetBaseline}
          onResetToBaseline={handleResetToBaseline}
        />
        {showRightPane && (
        <div className="right-pane">
          {provider === "local" && (
            <div className="runtime-status-wrap">
              <RuntimeStatusPanel
                workspaceRoot={workspacePath}
                toolRoot={toolRoot}
                port={port}
                runtimePort={runtimePort}
                activeGgufPath={(modelRoles?.coder ?? localSettings.ggufPath ?? "").trim() || undefined}
                ggufPathMissing={ggufPathMissing ?? undefined}
                developerMode={developerMode}
              />
            </div>
          )}
          {developerMode && (
            <ThinkingPane
              lines={thinkingLines}
              isRunning={pipelineRunning}
              onStop={handleStopPipeline}
            />
          )}
        </div>
        )}
      </div>
      )}
    </div>
    </AppErrorBoundary>
  );
}

function SettingsRoute() {
  return (
    <main className="primary-settings">
      <h1>Settings</h1>
      <p>Provider and runtime settings remain managed by the shared NF model/runtime services.</p>
      <p>Open Automated Builder to configure local models. OpenAI credentials are read only by the Rust backend from <code>OPENAI_API_KEY</code>.</p>
    </main>
  );
}

export default function App() {
  const [primaryRoute, setPrimaryRoute] = useState<PrimaryRoute>("developer");
  return (
    <div className="nf-primary-shell">
      <nav className="primary-navigation" aria-label="Primary navigation">
        <button type="button" className={primaryRoute === "developer" ? "active" : ""} onClick={() => setPrimaryRoute("developer")}>Developer</button>
        <button type="button" className={primaryRoute === "builder" ? "active" : ""} onClick={() => setPrimaryRoute("builder")}>Automated Builder</button>
        <button type="button" className={primaryRoute === "settings" ? "active" : ""} onClick={() => setPrimaryRoute("settings")}>Settings</button>
      </nav>
      {primaryRoute === "developer" && <DeveloperWorkspace />}
      {primaryRoute === "builder" && <AutomatedBuilderApp />}
      {primaryRoute === "settings" && <SettingsRoute />}
    </div>
  );
}




