// NOTE: temporary comment added for testing the file-edit flow.

import { useState, useCallback, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  WorkspaceService,
  ProjectInspector,
  ProjectDetector,
  ContextBuilder,
  KnowledgeStore,
  readProjectSnapshot,
  writeProjectSnapshot,
  readWorkspaceSettings,
  writeWorkspaceSettings,
  findToolRoot,
  getGlobalToolRoot,
  scanModelsForGGUF,
  scanGlobalModelsGGUF,
  toolRootExists,
  resolveModelPath,
  LLAMA_SERVER_REL,
  runtimeStart,
  runtimeStatus as getRuntimeStatus,
  runtimeStop,
  runtimeHealthCheckStatus,
  getRuntimeLog,
  generatePlanAndPatch,
  generateChatResponse,
  runPipeline,
  setModelProvider,
  MockModelProvider,
  LocalModelProvider,
  LocalPlannerAgent,
  LocalReviewerAgent,
  PatchEngine,
  MemoryStore,
  resumeSuggestion,
  DEFAULT_LOCAL_SETTINGS,
  readProjectFile,
  hasDiffRequest,
  impliesMultiFile,
  routeUserMessage,
  generateFileEdit,
  detectProjectRoot,
  getDefaultEnabledPackIds,
  generateSnapshotData,
  writeProjectSnapshotFile,
  getSnapshotOutputPath,
  runVerificationChecks,
  detectMissingPrereqs,
  getVerifyProfile,
  getPrereqById,
  getRecommendations,
  checkRecommendedPrereqs,
  generateMultiFileProposal,
  generateProposalSummary,
  validateAndFixSummary,
  buildProposalGroundTruth,
  pickVerifyProfileFromSignals,
  searchFilesForEdit,
  HIGH_CONFIDENCE_THRESHOLD,
  setCurrentRunId,
  emitStep,
  startProgressHeartbeat,
  createRun,
  registerRunToken,
  unregisterRunToken,
  raceWithCancel,
  raceWithTimeout,
  throwIfCancelled,
  isActiveRun,
  runtimeCancelRun,
  CancelledError,
  TimeoutError,
  PLANNING_TIMEOUT_MS,
  DIFF_GENERATION_TIMEOUT_MS,
  VALIDATION_TIMEOUT_MS,
  PLAN_AND_EDIT_PLAN_TIMEOUT_MS,
} from "./core";
import type {
  FileTreeNode,
  PlanAndPatch,
  PlannerOutput,
  ReviewerOutput,
  SessionRecord,
  AgentMode,
  ProjectSnapshot,
} from "./core/types";
import type { Provider, LocalModelSettings, Prereq, MissingPrereqResult, RecommendedPrereqResult, MultiFileProposal, DevMode, VerificationResult } from "./core";
import type { FileSnapshot } from "./core/patch/PatchEngine";
import { diffLines } from "diff";
import type { ResumeSuggestion } from "./core";
import { TopBar } from "./components/TopBar";
import { ConversationPane } from "./components/ConversationPane";
import { FilesPane } from "./components/FilesPane";
import { LivePane, type RuntimeStatus } from "./components/LivePane";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

const workspace = new WorkspaceService();

async function sha256Prefix(content: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 8);
}

type AppState = "idle" | "patchProposed" | "patchApplied";

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

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export type DiffLineType = "added" | "removed" | "context";

export interface DiffLine {
  type: DiffLineType;
  content: string;
}

export interface PendingEditFile {
  path: string;
  original: string;
  proposed: string;
  diff: DiffLine[];
}

export interface PendingEdit {
  id: string;
  files: PendingEditFile[];
  instructions: string;
  createdAt: number;
  selectedIndex: number;
  summary?: import("./core/types").ChangeSummary | null;
}

/** Proposal stack: max 5, one active at a time. */
export type ProposalStatus = "pending" | "applied" | "discarded" | "superseded";

export interface ProposalSummary {
  id: string;
  type: "single" | "multi";
  fileCount: number;
  createdAt: number;
  status: ProposalStatus;
}

export interface ProposalEntry extends ProposalSummary {
  pendingEdit?: PendingEdit | null;
  multiFileProposal?: MultiFileProposal | null;
  includedFilePaths?: Record<string, boolean>;
}

const MAX_PROPOSALS = 5;

/** Snapshot of files before apply; used for Revert last apply. */
export interface ApplySnapshotChange {
  path: string;
  existedBefore: boolean;
  previousContent: string;
  wasCreated: boolean;
}

export interface ApplySnapshot {
  id: string;
  createdAt: number;
  root: string;
  changes: ApplySnapshotChange[];
}

function computeDiffLines(original: string, proposed: string): DiffLine[] {
  const changes = diffLines(original, proposed);
  const lines: DiffLine[] = [];
  for (const change of changes) {
    const lineList = change.value.split(/\r?\n/);
    if (lineList.length > 1 && lineList[lineList.length - 1] === "") lineList.pop();
    const type: DiffLineType = change.removed ? "removed" : change.added ? "added" : "context";
    for (const line of lineList) {
      lines.push({ type, content: line });
    }
  }
  return lines;
}

export default function App() {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [manifest, setManifest] = useState<import("./core/types").ProjectManifest | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
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
  const [plannerOutput, setPlannerOutput] = useState<PlannerOutput | null>(null);
  const [reviewerOutput, setReviewerOutput] = useState<ReviewerOutput | null>(null);
  const [useKnowledgePacks, setUseKnowledgePacks] = useState(true);
  const [lastRetrievedChunks, setLastRetrievedChunks] = useState<
    { title: string; sourcePath: string; chunkText: string }[]
  >([]);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectSnapshot | null>(null);
  const [enabledPacks, setEnabledPacks] = useState<string[]>([]);
  const [autoPacksEnabled, setAutoPacksEnabled] = useState(true);
  const [modelPath, setModelPath] = useState<string | undefined>(undefined);
  const [toolRoot, setToolRoot] = useState<string | null>(null);
  const [hasLlamaAtToolRoot, setHasLlamaAtToolRoot] = useState(false);
  const [port, setPort] = useState<number>(8080);
  const [provider, setProvider] = useState<Provider>("local");
  const [localSettings, setLocalSettings] = useState<LocalModelSettings>(() => ({
    ...DEFAULT_LOCAL_SETTINGS,
  }));
  const [lastFileChoiceCandidates, setLastFileChoiceCandidates] = useState<string[] | null>(null);
  const [livePaneOpen, setLivePaneOpen] = useState(true);
  const [lastRunFailed, setLastRunFailed] = useState(false);
  const [proposalStack, setProposalStack] = useState<ProposalEntry[]>([]);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [selectedMultiFileIndex, setSelectedMultiFileIndex] = useState(0);

  const activeEntry = proposalStack.find((p) => p.id === activeProposalId) ?? null;
  const pendingEdit = activeEntry?.type === "single" ? (activeEntry.pendingEdit ?? null) : null;
  const multiFileProposal = activeEntry?.type === "multi" ? (activeEntry.multiFileProposal ?? null) : null;
  const includedFilePaths = activeEntry?.includedFilePaths ?? {};

  const addProposalToStackWithConfirm = useCallback((entry: ProposalEntry): boolean => {
    if (proposalStack.length < MAX_PROPOSALS) {
      setProposalStack((prev) => [...prev, entry]);
      setActiveProposalId(entry.id);
      return true;
    }
    const ok = window.confirm(
      `You have ${MAX_PROPOSALS} proposals. Discard the oldest pending proposal to make room?`
    );
    if (!ok) return false;
    const pendingByAge = [...proposalStack].filter((e) => e.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
    const toRemove = pendingByAge[0] ?? [...proposalStack].sort((a, b) => a.createdAt - b.createdAt)[0];
    const withoutOldest = toRemove ? proposalStack.filter((e) => e.id !== toRemove.id) : proposalStack.slice(1);
    setProposalStack([...withoutOldest, entry]);
    setActiveProposalId(entry.id);
    return true;
  }, [proposalStack]);

  const [lastApplySnapshot, setLastApplySnapshot] = useState<ApplySnapshot | null>(null);
  const [verificationResults, setVerificationResults] = useState<VerificationResult | null>(null);
  const [missingPrereqs, setMissingPrereqs] = useState<MissingPrereqResult[]>([]);
  const [recommendedPrereqs, setRecommendedPrereqs] = useState<RecommendedPrereqResult[]>([]);
  const [recommendedReasoning, setRecommendedReasoning] = useState<Record<string, string>>({});
  const [includeRecommendations, setIncludeRecommendations] = useState(false);
  const [devMode, setDevMode] = useState<DevMode>("fast");
  const [installLog, setInstallLog] = useState<string | null>(null);
  const [installInProgress, setInstallInProgress] = useState(false);
  const [runtimeHealthStatus, setRuntimeHealthStatus] = useState<"ok" | "missing_runtime" | "missing_model" | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("Down");
  const [runtimePort, setRuntimePort] = useState<number | null>(null);
  const [runtimeHealthStatusText, setRuntimeHealthStatusText] = useState<string | null>(null);
  const [runtimeSpawnError, setRuntimeSpawnError] = useState<string | null>(null);
  const [runtimeLogLines, setRuntimeLogLines] = useState<string[]>([]);
  const [providerFallbackMessage, setProviderFallbackMessage] = useState<string | null>(null);
  const [downloadLog, setDownloadLog] = useState<string | null>(null);
  const [downloadInProgress, setDownloadInProgress] = useState(false);
  const localSettingsRef = useRef(localSettings);
  const toolRootRef = useRef<string | null>(null);
  const portRef = useRef<number>(8080);
  localSettingsRef.current = localSettings;
  toolRootRef.current = toolRoot;
  portRef.current = port;

  const streamingMessageIdRef = useRef<string | null>(null);
  const currentStreamRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ run_id?: string; content: string }>("llama-stream-token", (event) => {
      const runId = event.payload?.run_id ?? null;
      const content = event.payload?.content ?? "";
      if (runId !== null && runId === currentStreamRunIdRef.current && streamingMessageIdRef.current) {
        const msgId = streamingMessageIdRef.current;
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, text: m.text + content } : m))
        );
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (provider === "local") {
      setModelProvider(
        new LocalModelProvider(
          () => localSettingsRef.current,
          () => toolRootRef.current,
          () => portRef.current ?? 8080,
          () => ({})
        )
      );
    } else {
      setModelProvider(new MockModelProvider());
    }
  }, [provider]);

  const runLocalModelAutoScan = useCallback(async () => {
    const root = workspace.root;
    if (!root) return;
    const tr = await findToolRoot(root);
    if (!tr) {
      setToolRoot(null);
      setHasLlamaAtToolRoot(false);
      return;
    }
    setToolRoot(tr);
    setHasLlamaAtToolRoot(await toolRootExists(tr, LLAMA_SERVER_REL));
    const settings = await readWorkspaceSettings(root);
    const mp = settings.modelPath?.trim();
    if (mp && (await toolRootExists(tr, mp))) return;
    const scanned = await scanModelsForGGUF(tr);
    if (!scanned) return;
    const next = { ...settings, modelPath: scanned };
    await writeWorkspaceSettings(root, next).catch(() => {});
    setModelPath(scanned);
    setLocalSettings((prev) => ({ ...prev, ggufPath: resolveModelPath(tr, scanned) }));
  }, []);

  const onInitializeTools = useCallback(async () => {
    try {
      await workspace.ensureGlobalToolDirs();
      await runLocalModelAutoScan();
    } catch (e) {
      console.error("Initialize Tools failed:", e);
    }
  }, [runLocalModelAutoScan]);

  useEffect(() => {
    if (provider !== "local" || !workspacePath) return;
    runLocalModelAutoScan();
  }, [provider, workspacePath, runLocalModelAutoScan]);

  // Provider fallback: if local is selected but runtime is missing, switch to mock so app stays usable
  useEffect(() => {
    if (provider !== "local" || !workspacePath) return;
    if (runtimeHealthStatus === "missing_runtime" || runtimeHealthStatus === "missing_model") {
      setProvider("mock");
      setProviderFallbackMessage("Local runtime missing. Switched to internal provider until you install llama-server + GGUF.");
    }
  }, [runtimeHealthStatus, provider, workspacePath]);

  const runGlobalRuntimeHealthCheck = useCallback(async () => {
    const root = workspace.root;
    if (!root) return;
    const tr = await findToolRoot(root);
    setToolRoot(tr);
    const hasLlama = tr ? await toolRootExists(tr, LLAMA_SERVER_REL) : false;
    setHasLlamaAtToolRoot(hasLlama);
    let modelPathNext: string | undefined;
    if (tr) {
      const scanned = await scanModelsForGGUF(tr);
      if (scanned) {
        modelPathNext = scanned;
        const settings = await readWorkspaceSettings(root);
        await writeWorkspaceSettings(root, { ...settings, modelPath: scanned }).catch(() => {});
        setModelPath(scanned);
        setLocalSettings((prev) => ({ ...prev, ggufPath: resolveModelPath(tr!, scanned) }));
      }
    }
    const status: "ok" | "missing_runtime" | "missing_model" | null = !tr ? null : !hasLlama ? "missing_runtime" : !modelPathNext ? "missing_model" : "ok";
    setRuntimeHealthStatus(status);
    if (status === "ok") {
      setProviderFallbackMessage(null);
      setProvider("local");
    }
  }, []);

  const onOpenToolsFolder = useCallback(async () => {
    try {
      const path = await workspace.getGlobalToolRoot();
      const escaped = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      await workspace.runSystemCommand(`explorer "${escaped}"`);
    } catch (e) {
      console.error("onOpenToolsFolder", e);
    }
  }, []);

  const RECOMMENDED_GGUF_URL = "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf";
  const RECOMMENDED_GGUF_NAME = "qwen2.5-coder-7b-instruct-q4_k_m.gguf";
  const MIN_GGUF_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

  const onDownloadRecommendedModel = useCallback(async () => {
    setDownloadInProgress(true);
    setDownloadLog("Preparing downloadâ€¦");
    let tr = toolRoot;
    if (!tr) {
      try {
        await workspace.ensureGlobalToolDirs();
        tr = await workspace.getGlobalToolRoot();
        setToolRoot(tr);
      } catch (e) {
        setDownloadLog(`Error: could not create tools folder. ${String(e)}`);
        setDownloadInProgress(false);
        return;
      }
    }
    if (!tr) {
      setDownloadLog("Error: could not get tools folder.");
      setDownloadInProgress(false);
      return;
    }
    const trBackslash = tr.replace(/\//g, "\\").replace(/\\+$/, "");
    const modelsDir = `${trBackslash}\\models`;
    const outPath = `${modelsDir}\\${RECOMMENDED_GGUF_NAME}`;
    try {
      setDownloadLog(`Downloading to: ${outPath}\n\nStartingâ€¦`);
      const r = await workspace.downloadFileToPath(RECOMMENDED_GGUF_URL, outPath);
      const sizeBytes = r.bytesWritten;
      let log = `Out path: ${outPath}\n\nBytes written: ${sizeBytes} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`;
      setDownloadLog(log);
      if (sizeBytes < MIN_GGUF_SIZE_BYTES) {
        setDownloadLog(log + `\n\nError: Download too small (need > 50MB). Do not switch to local provider.`);
        setDownloadInProgress(false);
        return;
      }
      const scanned = await scanModelsForGGUF(tr);
      if (scanned) {
        const root = workspace.root;
        if (root) {
          const settings = await readWorkspaceSettings(root);
          await writeWorkspaceSettings(root, { ...settings, modelPath: scanned }).catch(() => {});
        }
        setModelPath(scanned);
        setLocalSettings((prev) => ({ ...prev, ggufPath: resolveModelPath(tr!, scanned) }));
        setRuntimeHealthStatus("ok");
        setProviderFallbackMessage(null);
        const hasLlama = await toolRootExists(tr!, LLAMA_SERVER_REL);
        if (hasLlama) setProvider("local");
      }
    } catch (e) {
      setDownloadLog(`Error: ${String(e)}`);
    } finally {
      setDownloadInProgress(false);
    }
  }, [toolRoot]);

  const onRecheckRuntime = useCallback(async () => {
    setStatusLine("Checking runtimeâ€¦");
    try {
      await runGlobalRuntimeHealthCheck();
    } finally {
      setStatusLine(null);
    }
  }, [runGlobalRuntimeHealthCheck]);

  const pickGGUFFile = useCallback(async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Select GGUF model file",
      filters: [{ name: "GGUF model", extensions: ["gguf"] }],
    });
    if (typeof selected === "string") {
      setLocalSettings((prev) => ({ ...prev, ggufPath: selected }));
    }
  }, []);

  const fetchSessionsAndResume = useCallback(async () => {
    const root = workspace.root;
    if (root == null || root === "") {
      console.warn("[App] fetchSessionsAndResume blocked: no workspace root.");
      return;
    }
    const store = new MemoryStore(root);
    const list = await store.listSessions();
    setSessions(list);
    const last = await store.getLastSession();
    setResume(resumeSuggestion(last));
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const root = workspace.root;
    if (!root) return;
    setStatusLine("Refreshing snapshotÃ¢â‚¬Â¦");
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
    const path = await workspace.openWorkspace();
    if (!path) return;
    setWorkspacePath(path);
    setProjectSnapshot(null);
    setEnabledPacks([]);
    setToolRoot(null);
    setHasLlamaAtToolRoot(false);
    setStatusLine("Scanning workspaceâ€¦");
    try {
      const root = workspace.root ?? path;

      const projectRootResult = await detectProjectRoot(root);
      console.log("[init] project root:", projectRootResult.rootPath, "type:", projectRootResult.detectedType, "signals:", projectRootResult.signalsFound);

      const inspector = new ProjectInspector(workspace);
      const m = await inspector.buildManifest();
      setManifest(m);
      const tree = await workspace.readFileTree();
      setFileTree(tree);
      const detector = new ProjectDetector(workspace);
      const detected = await detector.detect();
      const settings = await readWorkspaceSettings(root);

      const availablePacks = [
        ...new Set([...detected.recommendedPacks, "powershell", "python", "typescript", "javascript", "node", "rust"]),
      ];
      const defaultPacks = !settings.enabledPacks?.length
        ? getDefaultEnabledPackIds(projectRootResult, availablePacks)
        : settings.enabledPacks;
      const enabled =
        settings.autoPacksEnabled
          ? (settings.enabledPacks?.length ? settings.enabledPacks : defaultPacks)
          : (settings.enabledPacks?.length ? settings.enabledPacks : defaultPacks);
      console.log("[init] enabled packs:", enabled);

      const existingSnapshot = await readProjectSnapshot(root);
      const snapshotPath = getSnapshotOutputPath(root);
      const existingAge = existingSnapshot?.generatedAt
        ? (Date.now() - new Date(existingSnapshot.generatedAt).getTime()) / 3600000
        : Infinity;
      const needsSnapshot = !existingSnapshot || existingAge > 24;
      if (needsSnapshot) {
        console.log("[init] generating snapshot (missing or >24h old), path:", snapshotPath);
        const fullSnapshot = await generateSnapshotData(
          root,
          projectRootResult.detectedType,
          projectRootResult.signalsFound,
          {
            detectedTypes: detected.detectedTypes,
            recommendedPacks: detected.recommendedPacks,
            importantFiles: detected.importantFiles,
            detectedCommands: detected.detectedCommands,
            enabledPacks: enabled,
          }
        );
        await writeProjectSnapshotFile(root, fullSnapshot);
      } else {
        console.log("[init] snapshot fresh, path:", snapshotPath);
      }

      const tr = await findToolRoot(root);
      setToolRoot(tr);
      const hasLlama = tr ? await toolRootExists(tr, LLAMA_SERVER_REL) : false;
      setHasLlamaAtToolRoot(hasLlama);
      setPort(settings.port ?? 8080);
      let modelPathNext = settings.modelPath?.trim() || undefined;
      if (tr) {
        const missing = !modelPathNext || !(await toolRootExists(tr, modelPathNext));
        if (missing) {
          const scanned = await scanModelsForGGUF(tr);
          if (scanned) modelPathNext = scanned;
        }
      }
          const newSettings = {
        autoPacksEnabled: settings.autoPacksEnabled,
        enabledPacks: enabled,
        devMode: settings.devMode ?? "fast",
        modelPath: modelPathNext,
        port: settings.port ?? 8080,
        livePaneOpen: settings.livePaneOpen ?? true,
      };
      await writeWorkspaceSettings(root, newSettings).catch(() => {});
      setLivePaneOpen(newSettings.livePaneOpen);
      setModelPath(modelPathNext);
      setLocalSettings((prev) => ({
        ...prev,
        ggufPath: modelPathNext && tr ? resolveModelPath(tr, modelPathNext) : "",
      }));
      const healthStatus: "ok" | "missing_runtime" | "missing_model" | null = !tr ? null : !hasLlama ? "missing_runtime" : !modelPathNext ? "missing_model" : "ok";
      setRuntimeHealthStatus(healthStatus);
      if (healthStatus === "ok") setProviderFallbackMessage(null);
      const snapshot: ProjectSnapshot = {
        detectedTypes: detected.detectedTypes,
        recommendedPacks: detected.recommendedPacks,
        enabledPacks: enabled,
        importantFiles: detected.importantFiles,
        detectedCommands: detected.detectedCommands,
      };
      await writeProjectSnapshot(root, snapshot);
      setProjectSnapshot(snapshot);
      setEnabledPacks(enabled);
      setAutoPacksEnabled(settings.autoPacksEnabled);
      setDevMode(settings.devMode ?? "fast");
      await fetchSessionsAndResume();
    } catch (e) {
      console.error("openWorkspace", e);
    } finally {
      setStatusLine(null);
    }
    setPlanAndPatch(null);
    setPreviewMap(null);
    setPlannerOutput(null);
    setReviewerOutput(null);
    setLastRetrievedChunks([]);
    setSelectedPaths([]);
    setSelectedDiffPath(null);
    setLastBeforeSnapshots(null);
    setLastAppliedSessionId(null);
    setCurrentProposedSessionId(null);
    setViewingSessionId(null);
    setAppState("idle");
    setShowDiffPanel(false);
  }, [fetchSessionsAndResume]);

  const sendChatMessage = useCallback(
    async (prompt: string) => {
      const root = workspace.root;
      if (!workspacePath || root == null || root === "") {
        console.warn("[App] sendChatMessage blocked: no workspace root.");
        return;
      }
      const p = (prompt || "").trim() || "(no prompt)";
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: p }]);

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
          reply = "Commands: /help Ã¢â‚¬â€ this message; /snapshot Ã¢â‚¬â€ project snapshot.";
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

      // ROUTING: File actions FIRST, before any chat logic
      const activeFilePath = fileEditState?.relativePath ?? undefined;
      const route = routeUserMessage(p, { activeFilePath, currentOpenFilePath: activeFilePath, workspaceRoot: root });
      console.log("ROUTE_DEBUG", {
        action: route.action,
        preview: p?.slice(0, 120) ?? "(no input)",
      });      
      const initialRoute = route;
      console.log("MESSAGE_ROUTING chosenRoute:", route);

      const isEditRoute =
        route.action === "multi_file_edit" ||
        route.action === "file_edit_auto_search" ||
        route.action === "file_open" ||
        route.action === "file_edit";
      if (provider === "local" && isEditRoute) {
        try {
          const status = await getRuntimeStatus();
          if (!status.running) {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: "Local model not running. Click Start Runtime.",
              },
            ]);
            return;
          }
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: "Local model not running. Click Start Runtime.",
            },
          ]);
          return;
        }
      }

      const runId = `run-${Date.now()}`;
      const { token } = createRun(runId);
      setCurrentRunId(runId);
      registerRunToken(runId, token);
      setLastRunFailed(false);
      emitStep("intent", `Route: ${route.action}`, { action: route.action });

      // Multi-file edit: generate proposal via LLM (with explicit targetFiles when from route.targetHints)
      if (route.action === "multi_file_edit") {
        setStatusLine("Generating multi-file proposalâ€¦");
        emitStep("plan", "Generating multi-file proposalâ€¦");
        let stopHeartbeat: (() => void) | undefined;
        try {
          throwIfCancelled(runId, token);
          setFileEditState(null);
          const inspector = new ProjectInspector(workspace);
          const m = manifest ?? (await raceWithCancel(runId, token, inspector.buildManifest()));
          throwIfCancelled(runId, token);
          if (!manifest) setManifest(m);
          const manifestSummary = m
            ? `Types: ${m.projectTypes.join(", ")}; Config: ${m.configFiles.slice(0, 8).join(", ")}; Files: ${m.fileList.slice(0, 30).join(", ")}`
            : undefined;
          // Resolve targetHints relative to workspace root (explicit targetFiles from intent)
          const rawHints = "targetHints" in route && route.targetHints ? route.targetHints : [];
          const hintPaths = rawHints.map((h: string) => (h.startsWith("/") || /^[a-zA-Z]:/.test(h) ? h : h.replace(/^\.\/+/, "")));
          console.log("MESSAGE_ROUTING multi_file_edit targetFiles (resolved)", hintPaths);
          const contextPaths = hintPaths.length > 0
            ? hintPaths.slice(0, 5)
            : selectedPaths.length > 0
              ? selectedPaths.slice(0, 5)
              : (projectSnapshot?.importantFiles ?? m?.fileList ?? []).slice(0, 5);
          const contextFiles: { path: string; content: string }[] = [];
          for (const path of contextPaths) {
            try {
              const content = await raceWithCancel(runId, token, workspace.readFile(path));
              contextFiles.push({ path, content });
            } catch {
              /* skip */
            }
          }
          throwIfCancelled(runId, token);
          stopHeartbeat = startProgressHeartbeat("plan", "Generating multi-file proposalâ€¦");
          let proposal: Awaited<ReturnType<typeof generateMultiFileProposal>> | null = null;
          try {
            proposal = await raceWithCancel(
              runId,
              token,
              raceWithTimeout("plan", PLANNING_TIMEOUT_MS, generateMultiFileProposal({
                userPrompt: route.instructions,
                contextFiles,
                manifestSummary,
              }), token)
            );
          } finally {
            stopHeartbeat?.();
            stopHeartbeat = undefined;
          }
          if (proposal && proposal.files.length > 0) {
            const included: Record<string, boolean> = {};
            const verifiedFiles = await Promise.all(
              proposal.files.map(async (f) => {
                const exists = await workspace.exists(f.path);
                if (exists) {
                  try {
                    const actual = await workspace.readFile(f.path);
                    return { ...f, exists: true, originalContent: actual };
                  } catch {
                    return { ...f, exists: true, originalContent: f.originalContent };
                  }
                }
                return { ...f, exists: false, originalContent: "" };
              })
            );
            const verifiedProposal = { ...proposal, files: verifiedFiles };
            for (const f of verifiedProposal.files) {
              included[f.path] = true; // default ON
            }
            setStatusLine("Generating summaryÃ¢â‚¬Â¦");
            const multiGroundTruth = buildProposalGroundTruth(verifiedProposal.files);
            const multiSummaryRaw = await generateProposalSummary({
              type: "grounded",
              groundTruth: multiGroundTruth,
              plan: verifiedProposal.plan,
            });
            const getMultiProposed = (path: string) =>
              verifiedProposal.files.find((f) => f.path === path)?.proposedContent ?? "";
            const multiSummary = multiSummaryRaw
              ? validateAndFixSummary(multiSummaryRaw, {
                  groundTruth: multiGroundTruth,
                  getProposedContent: getMultiProposed,
                })
              : null;
            if (multiSummary) verifiedProposal.summary = multiSummary;
            setStatusLine(null);
            const multiId = `multi-${Date.now()}`;
            const multiEntry: ProposalEntry = {
              id: multiId,
              type: "multi",
              fileCount: verifiedProposal.files.length,
              createdAt: Date.now(),
              status: "pending",
              multiFileProposal: verifiedProposal,
              includedFilePaths: included,
            };
            if (!addProposalToStackWithConfirm(multiEntry)) {
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: "Proposal not added (stack full). Discard one to make room." },
              ]);
              return;
            }
            emitStep("diff", "Multi-file proposal ready.");
            emitStep("ready", "Ready.");
            unregisterRunToken();
            setCurrentRunId(null);
            setShowDiffPanel(true);
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: `Proposal for ${proposal.files.length} file(s). Review and Apply Selected or Cancel.`,
              },
            ]);
          } else {
            emitStep("search", "Searching for candidate filesâ€¦");
            throwIfCancelled(runId, token);
            stopHeartbeat = startProgressHeartbeat("search", "Searching for candidate filesâ€¦");
            let bestMatches: { path: string; confidence: number }[] = [];
            try {
              bestMatches = await searchFilesForEdit(
                route.instructions,
                root,
                (wr, name) => workspace.searchFilesByName(wr, name),
                m?.fileList,
                runId,
                token
              );
            } finally {
              stopHeartbeat?.();
            }
            const top3 = bestMatches.slice(0, 3).map((c) => c.path);
            setLastFileChoiceCandidates(top3);
            const intro = "I can do that â€” I just need to know where to make the change.";
            const body = top3.length > 0
              ? "\n\n" + top3.map((path, i) => `${i + 1}. ${path}`).join("\n") + "\n\nReply with 1, 2, or 3."
              : "\n\nWhich file should I change? You can open the file and tell me what to edit.";
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: intro + body,
              },
            ]);
          }
        } catch (e) {
          runtimeCancelRun(runId);
          if (e instanceof CancelledError) {
            setStatusLine(null);
            unregisterRunToken();
            return;
          }
          if (e instanceof TimeoutError) {
            setLastRunFailed(true);
            emitStep("fail", `${e.phase} timed out (${e.ms}ms)`, {}, "error");
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: "Multi-file proposal timed out. Retry?" },
            ]);
          } else {
            console.error("generateMultiFileProposal error:", e);
            setLastRunFailed(true);
            emitStep("fail", `Error: ${String(e)}`, {}, "error");
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
            ]);
          }
          unregisterRunToken();
          setCurrentRunId(null);
          setStatusLine(null);
          return;
        } finally {
          stopHeartbeat?.();
          setStatusLine(null);
        }
      }

      // Plain-English: edit intent but no file named -> auto-search, then high confidence = diff, low = ask to pick
      if (route.action === "file_edit_auto_search") {
        setStatusLine("Searching for relevant fileâ€¦");
        emitStep("search", "Searching repoâ€¦");
        let stopHeartbeatSearch: (() => void) | undefined;
        try {
          throwIfCancelled(runId, token);
          const inspector = new ProjectInspector(workspace);
          const m = manifest ?? (await raceWithCancel(runId, token, inspector.buildManifest()));
          throwIfCancelled(runId, token);
          if (!manifest) setManifest(m);
          stopHeartbeatSearch = startProgressHeartbeat("search", "Searching repoâ€¦");
          let candidates: { path: string; confidence: number }[];
          try {
            candidates = await searchFilesForEdit(
              route.instructions,
              root,
              (wr, name) => workspace.searchFilesByName(wr, name),
              m?.fileList,
              runId,
              token
            );
          } finally {
            stopHeartbeatSearch?.();
          }
          throwIfCancelled(runId, token);
          const resolvedTargets = candidates.map((c) => c.path);
          const topConfidence = candidates[0]?.confidence ?? 0;
          emitStep("targets", `Candidates: ${resolvedTargets.slice(0, 3).join(", ")}`, {
            paths: resolvedTargets.slice(0, 5),
            confidence: topConfidence,
          });
          console.log("MESSAGE_ROUTING file_edit_auto_search", {
            detectedIntent: "file_edit_search",
            resolvedTargets,
            confidence: topConfidence,
            finalRoute: "file_edit_auto_search",
          });
          if (candidates.length === 0) {
            emitStep("fail", "No matching files found.");
            unregisterRunToken();
            setCurrentRunId(null);
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: "I couldn't find any files that match. Try naming the file (e.g. \"edit README.md: add a section\")." },
            ]);
            setStatusLine(null);
            return;
          }
          const top = candidates[0];
          const second = candidates[1];
          const highConfidence =
            top.confidence >= HIGH_CONFIDENCE_THRESHOLD &&
            (!second || top.confidence - second.confidence >= 0.2);
          if (highConfidence) {
            const resolveOne = async (hint: string) =>
              readProjectFile(
                root,
                hint,
                (path) => workspace.readFile(path),
                (path) => workspace.exists(path),
                (wr, name) => workspace.searchFilesByName(wr, name)
              );
            const result = await raceWithCancel(runId, token, resolveOne(top.path));
            throwIfCancelled(runId, token);
            if ("error" in result && result.error !== "multiple") {
              emitStep("fail", `${top.path} not found.`);
              unregisterRunToken();
              setCurrentRunId(null);
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: `${result.path} not found.` },
              ]);
              setStatusLine(null);
              return;
            }
            const resolvedPath = "content" in result ? result.path : (result as { path: string }).path;
            const originalContent = "content" in result ? result.content : "";
            emitStep("diff", "Generating edit proposalâ€¦", { path: resolvedPath });
            setStatusLine("Generating edit proposalâ€¦");
            throwIfCancelled(runId, token);
            let stopHeartbeatDiff: (() => void) | undefined;
            let editResult: { proposedContent: string; plan: string[]; usedModel: boolean };
            try {
              stopHeartbeatDiff = startProgressHeartbeat("diff", "Generating edit proposalâ€¦");
              editResult = await raceWithCancel(
                runId,
                token,
                raceWithTimeout("diff", DIFF_GENERATION_TIMEOUT_MS, generateFileEdit({
                  filePath: resolvedPath,
                  originalContent,
                  instructions: route.instructions,
                  isNewFile: false,
                  runId,
                }), token)
              );
            } finally {
              stopHeartbeatDiff?.();
            }
            const diff = computeDiffLines(originalContent, editResult.proposedContent);
            const files: PendingEditFile[] = [
              { path: resolvedPath, original: originalContent, proposed: editResult.proposedContent, diff },
            ];
            throwIfCancelled(runId, token);
            let stopHeartbeatValidate: (() => void) | undefined = startProgressHeartbeat("validate", "Validating proposalâ€¦");
            try {
              const singleGroundTruth = buildProposalGroundTruth(
                files.map((f) => ({ path: f.path, original: f.original, proposed: f.proposed, exists: true }))
              );
              const summaryRaw = await raceWithCancel(
                runId,
                token,
                raceWithTimeout("validate", VALIDATION_TIMEOUT_MS, generateProposalSummary({
                  type: "grounded",
                  groundTruth: singleGroundTruth,
                  plan: [route.instructions.slice(0, 200)],
                }), token)
              );
              const getSingleProposed = (path: string) => files.find((f) => f.path === path)?.proposed ?? "";
              const summary = summaryRaw
                ? validateAndFixSummary(summaryRaw, {
                    groundTruth: singleGroundTruth,
                    getProposedContent: getSingleProposed,
                  })
                : null;
              const pending: PendingEdit = {
                id: `pe-${Date.now()}`,
                files,
                instructions: route.instructions,
                createdAt: Date.now(),
                selectedIndex: 0,
                summary: summary ?? undefined,
              };
              const singleEntry: ProposalEntry = {
                id: pending.id,
                type: "single",
                fileCount: 1,
                createdAt: Date.now(),
                status: "pending",
                pendingEdit: pending,
              };
              if (addProposalToStackWithConfirm(singleEntry)) {
                emitStep("validate", "Proposal ready.");
                emitStep("ready", "Ready.");
                unregisterRunToken();
                setCurrentRunId(null);
                setFileEditState(null);
                setMessages((prev) => [
                  ...prev,
                  { id: `a-${Date.now()}`, role: "assistant", text: "Edit plan for 1 file. Review diff and Apply or Cancel." },
                ]);
                setShowDiffPanel(true);
              }
            } catch (e) {
              runtimeCancelRun(runId);
              if (e instanceof CancelledError) {
                setStatusLine(null);
                unregisterRunToken();
                return;
              }
              if (e instanceof TimeoutError) {
                setLastRunFailed(true);
                emitStep("fail", `${e.phase} timed out`, {}, "error");
                setMessages((prev) => [
                  ...prev,
                  { id: `a-${Date.now()}`, role: "assistant", text: "Patch generation timed out. Retry?" },
                ]);
              } else {
                console.error("generateFileEdit error (auto-search)", e);
                setLastRunFailed(true);
                emitStep("fail", `Error: ${String(e)}`, {}, "error");
                setMessages((prev) => [
                  ...prev,
                  { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
                ]);
              }
              unregisterRunToken();
              setCurrentRunId(null);
              setStatusLine(null);
              return;
            } finally {
              stopHeartbeatValidate?.();
            }
            if (!isActiveRun(runId, token)) return;
            setStatusLine(null);
            return;
          }
          if (!isActiveRun(runId, token)) return;
          emitStep("targets", "Asking which file (low confidence).", {
            paths: candidates.slice(0, 3).map((c) => c.path),
          });
          unregisterRunToken();
          const top3 = candidates.slice(0, 3).map((c) => c.path);
          setLastFileChoiceCandidates(top3);
          const intro = "I can do that â€” I just need to know where to make the change.";
          const body = top3.length > 0
            ? "\n\n" + top3.map((path, i) => `${i + 1}. ${path}`).join("\n") + "\n\nReply with 1, 2, or 3."
            : "\n\nWhich file should I change? You can open the file and tell me what to edit.";
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: intro + body,
            },
          ]);
        } catch (e) {
          runtimeCancelRun(runId);
          if (e instanceof CancelledError) {
            setStatusLine(null);
            unregisterRunToken();
            return;
          }
          console.error("file_edit_auto_search", e);
          setLastRunFailed(true);
          emitStep("fail", `Error: ${String(e)}`, {}, "error");
          unregisterRunToken();
          setCurrentRunId(null);
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Error searching: ${String(e)}` },
          ]);
        } finally {
          setStatusLine(null);
        }
        return;
      }

      // OPEN intent: directly open the requested file (bypass proposal generation). EDIT intent: resolve targetFiles then generate edit proposal.
      if (route.action === "file_open" || route.action === "file_edit") {
        const isEdit = route.action === "file_edit";
        emitStep("targets", `Resolving: ${isEdit ? route.targets?.join(", ") : route.targetPath ?? ""}`);
        const hints = isEdit ? route.targets : [route.targetPath];

        const resolveOne = async (hint: string) =>
          readProjectFile(
            root,
            hint,
            (path) => workspace.readFile(path),
            (path) => workspace.exists(path),
            (wr, name) => workspace.searchFilesByName(wr, name)
          );

        // Check if this is a create-file request
        const isCreateRequest = /\b(create|write|make|new)\b/i.test(p);
        
        const resolved: { path: string; content: string; isNewFile: boolean }[] = [];
        for (const hint of hints) {
          const result = await resolveOne(hint);
          if ("error" in result && result.error === "multiple" && "candidates" in result) {
            const list = result.candidates.map((path: string, i: number) => `${i + 1}. ${path}`).join("\n");
            setLastFileChoiceCandidates(result.candidates);
            unregisterRunToken();
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Which file for "${hint}"?\n${list}\n\nReply with a number.` },
            ]);
            return;
          }
          if ("error" in result) {
            // For create requests, allow creating a new file
            if (isCreateRequest) {
              resolved.push({ path: result.path, content: "", isNewFile: true });
            } else {
              unregisterRunToken();
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: `${result.path} not found.` },
              ]);
              return;
            }
          } else {
            resolved.push({ path: result.path, content: result.content, isNewFile: false });
          }
        }

        const resolvedFiles = resolved.map((r) => r.path);
        console.log("MESSAGE_ROUTING resolvedTargets:", resolvedFiles, isEdit ? "(edit)" : "(open)");
        emitStep("targets", `Resolved: ${resolvedFiles.join(", ")}`);
        const first = resolved[0];
        const resolvedPath = first.path;
        const originalText = first.content;
        const diffRequest = hasDiffRequest(p);
        const resolvedForPatch =
          diffRequest && !impliesMultiFile(p) ? resolved.slice(0, 1) : resolved;

        if (diffRequest) {
          setStatusLine("Generating patchâ€¦");
          emitStep("plan", "Generating patchâ€¦");
          let stopHeartbeatPlan: (() => void) | undefined;
          try {
            throwIfCancelled(runId, token);
            setFileEditState(null);
            setSelectedPaths(resolvedForPatch.map((r) => r.path));
            const inspector = new ProjectInspector(workspace);
            const m = manifest ?? (await raceWithCancel(runId, token, inspector.buildManifest()));
            throwIfCancelled(runId, token);
            if (!manifest) setManifest(m);
            const ctxBuilder = new ContextBuilder(workspace, m);
            const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
            const ctx = await raceWithCancel(
              runId,
              token,
              ctxBuilder.build(p, resolvedForPatch.map((r) => r.path), {
                useKnowledge: useKnowledgePacks,
                knowledgeStore: knowledgeStore ?? undefined,
                agentRole: "coder",
                projectSnapshot: projectSnapshot ?? undefined,
                enabledPacks: enabledPacks.length ? enabledPacks : undefined,
              })
            );
            throwIfCancelled(runId, token);
            if (!isActiveRun(runId, token)) return;
            const patchCtx = { ...ctx, runId };
            stopHeartbeatPlan = startProgressHeartbeat("diff", "Generating patchâ€¦");
            const runPatch = () =>
              raceWithTimeout("diff", PLAN_AND_EDIT_PLAN_TIMEOUT_MS, generatePlanAndPatch(patchCtx), token);
            let patchResult: PlanAndPatch;
            try {
              patchResult = await raceWithCancel(runId, token, runPatch());
            } catch (firstErr) {
              if (firstErr instanceof TimeoutError && isActiveRun(runId, token)) {
                try {
                  patchResult = await raceWithCancel(runId, token, runPatch());
                } catch {
                  throw firstErr;
                }
              } else {
                throw firstErr;
              }
            } finally {
              stopHeartbeatPlan?.();
            }
            if (!isActiveRun(runId, token)) return;
            const MAX_DIFF_LINES = 400;
            const MAX_DIFF_CHARS = 25_000;
            const patchLines = patchResult.patch.split(/\r?\n/);
            if (patchLines.length > MAX_DIFF_LINES || patchResult.patch.length > MAX_DIFF_CHARS) {
              const capped =
                patchLines.length > MAX_DIFF_LINES
                  ? patchLines.slice(0, MAX_DIFF_LINES).join("\n")
                  : patchResult.patch.slice(0, MAX_DIFF_CHARS);
              patchResult = {
                ...patchResult,
                partialDiff: true,
                cappedPatch: capped,
              };
            }
            setPlanAndPatch(patchResult);
            const engine = new PatchEngine(root, (path) => workspace.readFile(path));
            const preview = await engine.preview(patchResult.patch);
            const map = new Map<string, { old: string; new: string }>();
            preview.forEach((v, k) => map.set(k, v));
            setPreviewMap(map);
            setSelectedDiffPath([...preview.keys()][0] ?? null);
            setAppState("patchProposed");
            setShowDiffPanel(true);
            const store = new MemoryStore(root);
            const record = await store.addProposedSession(p, resolvedForPatch.map((r) => r.path), patchResult.explanation, patchResult.patch);
            setCurrentProposedSessionId(record.id);
            await fetchSessionsAndResume();
            emitStep("diff", "Patch ready.");
            emitStep("ready", "Ready.");
            unregisterRunToken();
            setCurrentRunId(null);
            const partialNote = patchResult.partialDiff
              ? "\n\nChange is large; showing partial diff. Use 'apply' to write full change."
              : "";
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: patchResult.fallbackDiff
                  ? "I couldn't format the diff correctly, but I can still apply the change safely. Here's the preview."
                  : `Patch for ${resolvedPath}: ${patchResult.explanation}${partialNote}`,
              },
            ]);
          } catch (e) {
            runtimeCancelRun(runId);
            if (e instanceof CancelledError) {
              setStatusLine(null);
              unregisterRunToken();
              return;
            }
            if (e instanceof TimeoutError) {
              setLastRunFailed(true);
              emitStep("fail", "Patch timed out.", {}, "error");
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: "Patch timed out (plan + edit plan: 120s). Try smaller change or Stop and retry." },
              ]);
            } else {
              console.error("sendChatMessage patch", e);
              setLastRunFailed(true);
              emitStep("fail", `Error: ${String(e)}`, {}, "error");
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
              ]);
            }
            unregisterRunToken();
            setCurrentRunId(null);
            setStatusLine(null);
            return;
          } finally {
            stopHeartbeatPlan?.();
            setStatusLine(null);
          }
          return;
        }

        const targets = resolved.map((r) => r.path);
        if (isEdit && route.instructions) {
          setStatusLine("Generating edit proposalÃ¢â‚¬Â¦");
          emitStep("diff", "Generating edit proposalâ€¦");
          let stopHeartbeatEdit: (() => void) | undefined;
          try {
            throwIfCancelled(runId, token);
            const files: PendingEditFile[] = [];
            for (const r of resolved) {
              throwIfCancelled(runId, token);
              stopHeartbeatEdit = startProgressHeartbeat("diff", "Generating edit proposalâ€¦");
              try {
              const editResult = await raceWithCancel(
                runId,
                token,
                raceWithTimeout("diff", DIFF_GENERATION_TIMEOUT_MS, generateFileEdit({
                  filePath: r.path,
                  originalContent: r.content,
                  instructions: route.instructions,
                  isNewFile: r.isNewFile,
                  runId,
                }), token)
              );
              const diff = computeDiffLines(r.content, editResult.proposedContent);
              files.push({ path: r.path, original: r.content, proposed: editResult.proposedContent, diff });
              } finally {
                stopHeartbeatEdit?.();
              }
            }
            const peId = `pe-${Date.now()}`;
            setStatusLine("Generating summaryÃ¢â‚¬Â¦");
            const singleGroundTruth = buildProposalGroundTruth(
              files.map((f, i) => ({
                path: f.path,
                original: f.original,
                proposed: f.proposed,
                exists: !resolved[i]?.isNewFile,
              }))
            );
            throwIfCancelled(runId, token);
            const summaryRaw = await raceWithCancel(
              runId,
              token,
              raceWithTimeout("validate", VALIDATION_TIMEOUT_MS, generateProposalSummary({
                type: "grounded",
                groundTruth: singleGroundTruth,
                plan: [route.instructions.slice(0, 200)],
              }), token)
            );
            const getSingleProposed = (path: string) => files.find((f) => f.path === path)?.proposed ?? "";
            const summary = summaryRaw
              ? validateAndFixSummary(summaryRaw, {
                  groundTruth: singleGroundTruth,
                  getProposedContent: getSingleProposed,
                })
              : null;
            const pending: PendingEdit = {
              id: peId,
              files,
              instructions: route.instructions,
              createdAt: Date.now(),
              selectedIndex: 0,
              summary: summary ?? undefined,
            };
            setStatusLine(null);
            const singleEntry: ProposalEntry = {
              id: peId,
              type: "single",
              fileCount: files.length,
              createdAt: Date.now(),
              status: "pending",
              pendingEdit: pending,
            };
            if (!addProposalToStackWithConfirm(singleEntry)) {
              unregisterRunToken();
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: "Proposal not added (stack full). Discard one to make room." },
              ]);
              return;
            }
            setFileEditState(null);
            const newFileNote = resolved.some((r) => r.isNewFile) ? " (new file)" : "";
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: `Edit plan for ${files.length} file(s)${newFileNote}. Review diff and Apply or Cancel.`,
              },
            ]);
            emitStep("ready", "Ready.");
            unregisterRunToken();
            setCurrentRunId(null);
            setShowDiffPanel(true);
            console.log("OPEN_EDITOR", { pendingFiles: files.length });
          } catch (e) {
            runtimeCancelRun(runId);
            if (e instanceof CancelledError) {
              setStatusLine(null);
              unregisterRunToken();
              return;
            }
            if (e instanceof TimeoutError) {
              setLastRunFailed(true);
              emitStep("fail", `${e.phase} timed out`, {}, "error");
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: "Patch generation timed out. Retry?" },
              ]);
            } else {
              console.error("generateFileEdit error:", e);
              setLastRunFailed(true);
              emitStep("fail", `Error: ${String(e)}`, {}, "error");
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
              ]);
            }
            unregisterRunToken();
            setCurrentRunId(null);
            setStatusLine(null);
            return;
          } finally {
            stopHeartbeatEdit?.();
            setStatusLine(null);
          }
        } else {
          emitStep("ready", "Opened file(s).");
          unregisterRunToken();
          setCurrentRunId(null);
          const assistantMsg =
            targets.length > 1 ? `Opened: ${targets.join(", ")}` : `Opened: ${resolvedPath}`;
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: assistantMsg },
          ]);
          setShowDiffPanel(true);
          setFileEditState({
            relativePath: resolvedPath,
            baselineText: originalText,
            baselineUpdatedAt: Date.now(),
            originalText,
            editedText: originalText,
            dirty: false,
            lastSaveStatus: "idle",
          });
          console.log("OPEN_EDITOR", { relativePath: resolvedPath, length: originalText.length });
        }
        console.log("DIFF_PANEL_VISIBLE", true);
        return;
      }

      // ROUTING: chat only when initial intent was chat (never fallback from EDIT)
      if (initialRoute.action !== "chat") {
        return;
      }
      console.log("MESSAGE_ROUTING: chat");
      setStatusLine("Generating replyâ€¦");
      emitStep("plan", "Generating replyâ€¦");
      let stopHeartbeatChat: (() => void) | undefined;
      let streamMsgId: string | null = null;
      try {
        throwIfCancelled(runId, token);
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await raceWithCancel(runId, token, inspector.buildManifest()));
        throwIfCancelled(runId, token);
        if (!manifest) setManifest(m);
        const ctxBuilder = new ContextBuilder(workspace, m);
        const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
        const ctx = await raceWithCancel(
          runId,
          token,
          ctxBuilder.build(p, selectedPaths, {
            useKnowledge: useKnowledgePacks,
            knowledgeStore: knowledgeStore ?? undefined,
            agentRole: "coder",
            projectSnapshot: projectSnapshot ?? undefined,
            enabledPacks: enabledPacks.length ? enabledPacks : undefined,
          })
        );
        throwIfCancelled(runId, token);
        if (!isActiveRun(runId, token)) return;
        const chatCtx = { ...ctx, runId };
        setLastRetrievedChunks(
          chatCtx.knowledgeChunks?.map((c) => ({
            title: c.title,
            sourcePath: c.sourcePath,
            chunkText: c.chunkText,
          })) ?? []
        );
        stopHeartbeatChat = startProgressHeartbeat("plan", "Generating replyâ€¦");
        streamMsgId = `a-${Date.now()}`;
        streamingMessageIdRef.current = streamMsgId;
        currentStreamRunIdRef.current = runId;
        setMessages((prev) => [...prev, { id: streamMsgId!, role: "assistant", text: "" }]);
        let text: string;
        try {
          text = await raceWithCancel(
            runId,
            token,
            raceWithTimeout("plan", PLANNING_TIMEOUT_MS, generateChatResponse(chatCtx), token)
          );
        } finally {
          stopHeartbeatChat?.();
          streamingMessageIdRef.current = null;
          currentStreamRunIdRef.current = null;
        }
        if (!isActiveRun(runId, token)) return;
        emitStep("ready", "Reply ready.");
        unregisterRunToken();
        setCurrentRunId(null);
        setMessages((prev) =>
          prev.map((m) => (m.id === streamMsgId ? { ...m, text: text || m.text } : m))
        );
      } catch (e) {
        runtimeCancelRun(runId);
        streamingMessageIdRef.current = null;
        currentStreamRunIdRef.current = null;
        if (e instanceof CancelledError) {
          setStatusLine(null);
          unregisterRunToken();
          if (streamMsgId) {
            setMessages((prev) =>
              prev.map((m) => (m.id === streamMsgId ? { ...m, text: "Cancelled" } : m))
            );
          }
          return;
        }
        if (e instanceof TimeoutError) {
          setLastRunFailed(true);
          emitStep("fail", `${e.phase} timed out`, {}, "error");
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: "Reply timed out. Retry?" },
          ]);
        } else {
          console.error("sendChatMessage", e);
          setLastRunFailed(true);
          emitStep("fail", `Error: ${String(e)}`, {}, "error");
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
          ]);
        }
        unregisterRunToken();
        setCurrentRunId(null);
        setStatusLine(null);
      } finally {
        stopHeartbeatChat?.();
        setStatusLine(null);
      }
    },
    [workspacePath, selectedPaths, manifest, useKnowledgePacks, projectSnapshot, enabledPacks, lastFileChoiceCandidates, fetchSessionsAndResume, pendingEdit, fileEditState]
  );

  const proposePatch = useCallback(
    async (prompt: string) => {
      const root = workspace.root;
      if (!workspacePath || root == null || root === "") {
        console.warn("[App] proposePatch blocked: no workspace root.");
        return;
      }
      setViewingSessionId(null);
      setPlannerOutput(null);
      setReviewerOutput(null);
      const p = (prompt || "").trim() || "(no prompt)";
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: p }]);
      setStatusLine("Scanning selected filesÃ¢â‚¬Â¦");
      try {
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await inspector.buildManifest());
        if (!manifest) setManifest(m);
        const ctxBuilder = new ContextBuilder(workspace, m);
        const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
        setStatusLine("Generating patchÃ¢â‚¬Â¦");
        const ctx = await ctxBuilder.build(p, selectedPaths, {
          useKnowledge: useKnowledgePacks,
          knowledgeStore: knowledgeStore ?? undefined,
          agentRole: "coder",
          projectSnapshot: projectSnapshot ?? undefined,
          enabledPacks: enabledPacks.length ? enabledPacks : undefined,
        });
        setLastRetrievedChunks(
          ctx.knowledgeChunks?.map((c) => ({
            title: c.title,
            sourcePath: c.sourcePath,
            chunkText: c.chunkText,
          })) ?? []
        );
        const result = await generatePlanAndPatch(ctx);
        setPlanAndPatch(result);
        const engine = new PatchEngine(root, (path) =>
          workspace.readFile(path)
        );
        const preview = await engine.preview(result.patch);
        const map = new Map<string, { old: string; new: string }>();
        preview.forEach((v, k) => map.set(k, v));
        setPreviewMap(map);
        const paths = [...preview.keys()];
        setSelectedDiffPath(paths[0] ?? null);
        setAppState("patchProposed");
        const store = new MemoryStore(root);
        const record = await store.addProposedSession(p, selectedPaths, result.explanation, result.patch);
        setCurrentProposedSessionId(record.id);
        await fetchSessionsAndResume();
      } catch (e) {
        console.error("proposePatch", e);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
        ]);
      } finally {
        setStatusLine(null);
      }
    },
    [workspacePath, selectedPaths, manifest, fetchSessionsAndResume, useKnowledgePacks, projectSnapshot, enabledPacks]
  );

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
        setStatusLine("Running pipelineÃ¢â‚¬Â¦");
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
                    () => portRef.current ?? 8080,
                    () => ({})
                  ),
                  reviewer: new LocalReviewerAgent(
                    () => localSettingsRef.current,
                    () => toolRootRef.current,
                    () => portRef.current ?? 8080,
                    () => ({})
                  ),
                }
              : undefined;
          const ctx = await ctxBuilder.build(p, selectedPaths, buildOpt("coder"));
          const result = await runPipeline(p, ctx, pipelineOverrides);
        const pl = result.planner;
        const cod = result.coder;
        setPlannerOutput(pl);
        setPlanAndPatch(cod);
        setReviewerOutput(result.reviewer);
        setLastRetrievedChunks(
          ctx.knowledgeChunks?.map((c) => ({
            title: c.title,
            sourcePath: c.sourcePath,
            chunkText: c.chunkText,
          })) ?? []
        );
        const engine = new PatchEngine(root, (path) => workspace.readFile(path));
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
        console.error("executePipeline", e);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
        ]);
      } finally {
        setStatusLine(null);
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
        readWorkspaceSettings(root).then((s) =>
          writeWorkspaceSettings(root, { ...s, autoPacksEnabled, enabledPacks: next, devMode, modelPath, port }).catch(() => {})
        );
      }
    },
    [projectSnapshot, autoPacksEnabled, devMode, modelPath, port]
  );

  const handleAutoPacksEnabledChange = useCallback(
    (value: boolean) => {
      setAutoPacksEnabled(value);
      const root = workspace.root;
      if (root) {
        readWorkspaceSettings(root).then((s) =>
          writeWorkspaceSettings(root, { ...s, autoPacksEnabled: value, enabledPacks, devMode, modelPath, port }).catch(() => {})
        );
      }
    },
    [enabledPacks, devMode, modelPath, port]
  );

  const handleDevModeChange = useCallback(
    (mode: DevMode) => {
      setDevMode(mode);
      const root = workspace.root;
      if (root) {
        readWorkspaceSettings(root).then((s) =>
          writeWorkspaceSettings(root, { ...s, autoPacksEnabled, enabledPacks, devMode: mode, modelPath, port }).catch(() => {})
        );
      }
    },
    [autoPacksEnabled, enabledPacks, modelPath, port]
  );

  const handleLivePaneToggle = useCallback(async () => {
    const root = workspace.root;
    setLivePaneOpen((prev) => {
      const next = !prev;
      if (root) {
        readWorkspaceSettings(root).then((s) =>
          writeWorkspaceSettings(root, { ...s, livePaneOpen: next }).catch(() => {})
        );
      }
      return next;
    });
  }, []);

  const handleRetry = useCallback(() => {
    const lastUser = messages.filter((m) => m.role === "user").pop();
    if (lastUser?.text) sendChatMessage(lastUser.text);
    setLastRunFailed(false);
  }, [messages, sendChatMessage]);

  const pollRuntimeStatus = useCallback(async () => {
    try {
      const status = await getRuntimeStatus();
      if (status.running && status.port != null) {
        setRuntimeStatus("Ready");
        setRuntimePort(status.port);
        setPort(status.port);
        try {
          const code = await runtimeHealthCheckStatus(status.port);
          setRuntimeHealthStatusText(String(code));
        } catch {
          setRuntimeHealthStatusText("connection failed");
        }
        try {
          const lines = await getRuntimeLog();
          setRuntimeLogLines(lines);
        } catch {
          /* ignore */
        }
      } else {
        setRuntimeStatus("Down");
        setRuntimePort(null);
        setRuntimeHealthStatusText(null);
        setRuntimeLogLines((prev) => (prev.length > 0 ? prev : []));
      }
    } catch {
      setRuntimeStatus("Down");
      setRuntimePort(null);
      setRuntimeHealthStatusText(null);
    }
  }, []);

  useEffect(() => {
    if (provider !== "local" || !livePaneOpen) return;
    const t = setInterval(pollRuntimeStatus, 2000);
    return () => clearInterval(t);
  }, [provider, livePaneOpen, pollRuntimeStatus]);

  const handleStartRuntime = useCallback(async () => {
    setRuntimeSpawnError(null);
    setRuntimeStatus("Starting");
    let toolRootGlobal = "";
    let modelPathAbs: string | null = null;
    try {
      await workspace.ensureGlobalToolDirs();
      toolRootGlobal = await getGlobalToolRoot();
      modelPathAbs = await scanGlobalModelsGGUF();
      if (!modelPathAbs?.trim()) {
        setRuntimeSpawnError("No .gguf model found in %LOCALAPPDATA%\\DevAssistantCursorLite\\tools\\models. Add a model (e.g. q4_k_m) or download one.");
        setRuntimeStatus("Down");
        return;
      }
      // Pass null so backend uses LLAMA_PORT/8080 or next free port if busy
      const result = await runtimeStart(
        modelPathAbs,
        toolRootGlobal,
        {
          temperature: localSettings.temperature,
          top_p: localSettings.top_p,
          max_tokens: localSettings.max_tokens,
          context_length: localSettings.context_length,
        },
        null,
        null
      );
      setRuntimePort(result.port);
      setPort(result.port);
      setRuntimeStatus("Ready");
      setRuntimeHealthStatusText("200");
      setToolRoot((prev) => prev || toolRootGlobal);
      setHasLlamaAtToolRoot(true);
      setLocalSettings((prev) => ({ ...prev, ggufPath: modelPathAbs! }));
      await pollRuntimeStatus();
    } catch (e) {
      const msg = String(e);
      const exePath = toolRootGlobal
        ? `${toolRootGlobal.replace(/\/+$/, "")}/runtime/llama/llama-server.exe`
        : "%LOCALAPPDATA%\\DevAssistantCursorLite\\tools\\runtime\\llama\\llama-server.exe";
      setRuntimeSpawnError(`exe: ${exePath}\nmodel: ${modelPathAbs ?? "?"}\nport: 8080 (or next free)\nerror: ${msg}`);
      setRuntimeStatus("Down");
    }
  }, [localSettings.temperature, localSettings.top_p, localSettings.max_tokens, localSettings.context_length, pollRuntimeStatus]);

  const handleStopRuntime = useCallback(async () => {
    try {
      await runtimeStop();
      setRuntimeStatus("Down");
      setRuntimePort(null);
      setRuntimeHealthStatusText(null);
    } catch {
      setRuntimeStatus("Down");
      setRuntimePort(null);
    }
  }, []);

  const handleRestartRuntime = useCallback(async () => {
    await handleStopRuntime();
    await new Promise((r) => setTimeout(r, 500));
    await handleStartRuntime();
  }, [handleStopRuntime, handleStartRuntime]);

  const rescanModels = useCallback(async () => {
    const root = workspace.root;
    if (!root || !toolRoot) return;
    const scanned = await scanModelsForGGUF(toolRoot);
    if (!scanned) return;
    const settings = await readWorkspaceSettings(root);
    const next = { ...settings, modelPath: scanned };
    await writeWorkspaceSettings(root, next).catch(() => {});
    setModelPath(scanned);
    setLocalSettings((prev) => ({ ...prev, ggufPath: resolveModelPath(toolRoot, scanned) }));
  }, [toolRoot]);

  const applyPatch = useCallback(async () => {
    if (!workspacePath || !workspace.root || !planAndPatch || !currentProposedSessionId) return;
    setApplyInProgress(true);
    setStatusLine("Applying patchÃ¢â‚¬Â¦");
    try {
      const engine = new PatchEngine(workspace.root, (p) =>
        workspace.readFile(p)
      );
      const result = await engine.apply(planAndPatch.patch);
      setLastBeforeSnapshots(result.beforeSnapshots);
      const store = new MemoryStore(workspace.root);
      await store.updateSessionToApplied(currentProposedSessionId, result.beforeSnapshots);
      setLastAppliedSessionId(currentProposedSessionId);
      setCurrentProposedSessionId(null);
      setAppState("patchApplied");
      await fetchSessionsAndResume();
    } catch (e) {
      console.error("applyPatch", e);
    } finally {
      setApplyInProgress(false);
      setStatusLine(null);
    }
  }, [workspacePath, planAndPatch, currentProposedSessionId, fetchSessionsAndResume]);

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
      setStatusLine("RevertingÃ¢â‚¬Â¦");
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

  const applyPendingEdit = useCallback(
    async () => {
      if (!workspace.root || !pendingEdit) return;
      const changes: ApplySnapshotChange[] = [];
      for (const f of pendingEdit.files) {
        const existedBefore = await workspace.exists(f.path);
        const previousContent = existedBefore
          ? await workspace.readFile(f.path)
          : "";
        changes.push({
          path: f.path,
          existedBefore,
          previousContent,
          wasCreated: !existedBefore,
        });
      }
      const appliedPaths: string[] = [];
      for (const f of pendingEdit.files) {
        try {
          await workspace.writeFile(workspace.root, f.path, f.proposed);
          appliedPaths.push(f.path);
        } catch (e) {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Error applying to ${f.path}: ${String(e)}` },
          ]);
          return;
        }
      }
      setLastApplySnapshot({
        id: `snap-${Date.now()}`,
        createdAt: Date.now(),
        root: workspace.root,
        changes,
      });
      setProposalStack((prev) =>
        prev.map((e) => (e.id === activeProposalId ? { ...e, status: "applied" as const } : e))
      );
      setActiveProposalId(null);
      setFileEditState(null);
      console.log("plan: applied");
      const appliedSummary = pendingEdit?.summary;
      const appliedMsg =
        appliedSummary != null
          ? `Applied Ã¢Å“â€œ\n\n**${appliedSummary.title}**\n\nWhat changed:\n${appliedSummary.whatChanged.map((b) => `Ã¢â‚¬Â¢ ${b}`).join("\n")}\n\nBehavior after:\n${appliedSummary.behaviorAfter.map((b) => `Ã¢â‚¬Â¢ ${b}`).join("\n")}\n\nFiles: ${appliedSummary.files.map((f) => `${f.path}: ${f.change}`).join("; ")}${appliedSummary.risks?.length ? `\n\nRisks: ${appliedSummary.risks.map((b) => `Ã¢â‚¬Â¢ ${b}`).join("\n")}` : ""}`
          : appliedPaths.length > 1
            ? `Applied changes to: ${appliedPaths.join(", ")}`
            : `Applied changes to: ${appliedPaths[0]}`;
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: appliedMsg },
      ]);
      if (devMode === "safe") {
        setStatusLine("Checking prerequisitesÃ¢â‚¬Â¦");
        const checkFile = (path: string) => workspace.exists(path);
        const readFileForProfile = (path: string) => workspace.readFile(path);
        const profile = await pickVerifyProfileFromSignals(checkFile, readFileForProfile);
        const runCmd = async (cmd: string) => {
          const r = await workspace.runSystemCommand(cmd);
          return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
        };
        const missing = await detectMissingPrereqs({
          profile,
          runCommand: runCmd,
          workspaceRoot: workspace.root ?? undefined,
          checkFileExists: checkFile,
          detectedTypes: projectSnapshot?.detectedTypes ?? [],
        });
        setMissingPrereqs(missing);
        await checkRecommendations();
        if (missing.length > 0) {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: "Prerequisites missing. Install them before verification runs." },
          ]);
          setStatusLine(null);
          return;
        }
        setStatusLine("Running verificationÃ¢â‚¬Â¦");
        try {
          let cmds = projectSnapshot?.detectedCommands ?? {};
          if (!cmds.typecheck && !cmds.lint) {
            const detector = new ProjectDetector(workspace);
            const detected = await detector.detect();
            cmds = detected.detectedCommands;
          }
          const res = await runVerificationChecks({
            workspaceRoot: workspace.root!,
            commands: cmds as import("./core/types").DetectedCommands,
            runTests: false,
            runCommand: (root, cmd) => workspace.runCommand(root, cmd),
          });
          setVerificationResults(res);
          if (!res.allPassed) {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: `Verification failed at ${res.stages[res.failedStageIndex!]?.name ?? "?"}. Use Revert or Auto-fix.`,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: "Verification passed." },
            ]);
          }
        } catch (e) {
          setVerificationResults(null);
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `Verification error: ${String(e)}` },
          ]);
        } finally {
          setStatusLine(null);
        }
      } else {
        setVerificationResults(null);
      }
    },
    [pendingEdit, projectSnapshot, devMode, checkRecommendations, activeProposalId]
  );

  const autoFixVerification = useCallback(
    async () => {
      if (!workspace.root || !lastApplySnapshot || !verificationResults || verificationResults.allPassed)
        return;
      const failed = verificationResults.stages[verificationResults.failedStageIndex!];
      if (!failed) return;
      const touchedPaths = lastApplySnapshot.changes.map((c) => c.path);
      const fixPrompt = `Fix the following ${failed.name} errors. Only modify the reported issues.\n\nSTDERR:\n${failed.stderr}\n\nSTDOUT:\n${failed.stdout}\n\nFiles that were changed: ${touchedPaths.join(", ")}`;
      setStatusLine("Auto-fix: generating patchÃ¢â‚¬Â¦");
      try {
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await inspector.buildManifest());
        if (!manifest) setManifest(m);
        const ctxBuilder = new ContextBuilder(workspace, m!);
        const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(workspace.root!, workspace) : null;
        const ctx = await ctxBuilder.build(fixPrompt, touchedPaths, {
          useKnowledge: useKnowledgePacks,
          knowledgeStore: knowledgeStore ?? undefined,
          agentRole: "coder",
          projectSnapshot: projectSnapshot ?? undefined,
          enabledPacks: enabledPacks.length ? enabledPacks : undefined,
        });
        const patchResult = await generatePlanAndPatch(ctx);
        const engine = new PatchEngine(workspace.root!, (p) => workspace.readFile(p));
        await engine.apply(patchResult.patch);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: "Auto-fix applied. Re-running verificationÃ¢â‚¬Â¦" },
        ]);
        const cmds = projectSnapshot?.detectedCommands ?? {};
        const res = await runVerificationChecks({
          workspaceRoot: workspace.root!,
          commands: cmds as import("./core/types").DetectedCommands,
          runTests: false,
          runCommand: (root, cmd) => workspace.runCommand(root, cmd),
        });
        setVerificationResults(res);
        if (res.allPassed) {
          setLastApplySnapshot(null);
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: "Verification passed after auto-fix." },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: "Auto-fix applied but verification still failing. Try manual fix or Revert." },
          ]);
        }
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: `Auto-fix error: ${String(e)}` },
        ]);
      } finally {
        setStatusLine(null);
      }
    },
    [lastApplySnapshot, verificationResults, manifest, useKnowledgePacks, projectSnapshot, enabledPacks]
  );

  const checkPrereqs = useCallback(async (): Promise<MissingPrereqResult[]> => {
    const types = projectSnapshot?.detectedTypes ?? ["Node/TS"];
    const profile = getVerifyProfile(types);
    const runCmd = async (cmd: string) => {
      const r = await workspace.runSystemCommand(cmd);
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    };
    const checkFile = workspace.root ? (path: string) => workspace.exists(path) : undefined;
    const missing = await detectMissingPrereqs({
      profile,
      runCommand: runCmd,
      workspaceRoot: workspace.root ?? undefined,
      checkFileExists: checkFile,
      detectedTypes: types,
    });
    setMissingPrereqs(missing);
    return missing;
  }, [projectSnapshot?.detectedTypes]);

  async function checkRecommendations() {
    if (!workspace.root) return;
    
    const runCmd = async (cmd: string) => {
      const r = await workspace.runSystemCommand(cmd);
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    };
    const checkFile = (path: string) => workspace.exists(path);
    const readFile = (path: string) => workspace.readFile(path);

    try {
      // Get recommendations based on project signals
      const result = await getRecommendations(workspace.root, checkFile, readFile);
      
      // Extract prereqs and build reasoning map
      const prereqs = result.recommended.map((r) => r.prereq);
      const reasoning: Record<string, string> = {};
      for (const r of result.recommended) {
        reasoning[r.prereq.id] = r.reason;
      }
      
      // Check status of each recommendation
      const statusResults = await checkRecommendedPrereqs(prereqs, runCmd);
      
      setRecommendedPrereqs(statusResults);
      setRecommendedReasoning(reasoning);
    } catch (e) {
      console.error("Failed to check recommendations:", e);
      setRecommendedPrereqs([]);
      setRecommendedReasoning({});
    }
  }

  const runInstallScript = useCallback(
    async (prereqId: string) => {
      const p = getPrereqById(prereqId);
      if (!p?.installCommandPowerShell) return;
      setInstallInProgress(true);
      setInstallLog(null);
      try {
        const r = await workspace.runSystemCommand(p.installCommandPowerShell);
        const log = `stdout:\n${r.stdout}\n\nstderr:\n${r.stderr}\n\nexit code: ${r.exitCode}`;
        setInstallLog(log);
        if (r.exitCode === 0) {
          const missing = await checkPrereqs();
          await checkRecommendations();
          if (missing.length === 0) {
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Installed ${p.displayName}. All prerequisites met.` },
            ]);
          }
        }
      } catch (e) {
        setInstallLog(`Error: ${String(e)}`);
      } finally {
        setInstallInProgress(false);
      }
  },
  [workspace, checkPrereqs, checkRecommendations]
  );

  const handleCopyPrereqCommand = useCallback((p: Prereq) => {
    if (p.installCommandPowerShell) {
      navigator.clipboard.writeText(p.installCommandPowerShell);
    }
  }, []);

  const handleOpenPrereqLink = useCallback((p: Prereq) => {
    if (p.installUrl) openUrl(p.installUrl);
  }, []);

  const handleInstallAllSafe = useCallback(async () => {
    // Only include non-blocked winget items (missing + optional recommendations)
    type InstallableItem = MissingPrereqResult | RecommendedPrereqResult;
    let wingetOnly: InstallableItem[] = missingPrereqs.filter(
      (r) => r.prereq.installMethod === "winget" && r.prereq.installCommandPowerShell && !r.blockedBy
    );
    
    // Include recommendations if toggle is on (exclude blocked)
    if (includeRecommendations) {
      const wingetRecommendations = recommendedPrereqs.filter(
        (r) => r.status === "missing" && r.prereq.installMethod === "winget" && r.prereq.installCommandPowerShell && !r.blockedBy
      );
      wingetOnly = [...wingetOnly, ...wingetRecommendations];
    }
    
    for (const r of wingetOnly) {
      await runInstallScript(r.prereq.id);
    }
  }, [missingPrereqs, recommendedPrereqs, includeRecommendations, runInstallScript]);

  const handleInstallAllAdvanced = useCallback(async () => {
    // Only include non-blocked items (missing + optional recommendations)
    type InstallableItem = MissingPrereqResult | RecommendedPrereqResult;
    let wingetOnly: InstallableItem[] = missingPrereqs.filter(
      (r) => r.prereq.installMethod === "winget" && r.prereq.installCommandPowerShell && !r.blockedBy
    );
    let chocoOnly: InstallableItem[] = missingPrereqs.filter(
      (r) => r.prereq.installMethod === "choco" && r.prereq.installCommandPowerShell && !r.blockedBy
    );
    
    // Include recommendations if toggle is on (exclude blocked)
    if (includeRecommendations) {
      const wingetRecommendations = recommendedPrereqs.filter(
        (r) => r.status === "missing" && r.prereq.installMethod === "winget" && r.prereq.installCommandPowerShell && !r.blockedBy
      );
      const chocoRecommendations = recommendedPrereqs.filter(
        (r) => r.status === "missing" && r.prereq.installMethod === "choco" && r.prereq.installCommandPowerShell && !r.blockedBy
      );
      wingetOnly = [...wingetOnly, ...wingetRecommendations];
      chocoOnly = [...chocoOnly, ...chocoRecommendations];
    }
    
    if (chocoOnly.length > 0) {
      const ok = window.confirm(
        "This will run Chocolatey installs via PowerShell. Continue?"
      );
      if (!ok) return;
    }
    for (const r of wingetOnly) {
      await runInstallScript(r.prereq.id);
    }
    for (const r of chocoOnly) {
      await runInstallScript(r.prereq.id);
    }
  }, [missingPrereqs, recommendedPrereqs, includeRecommendations, runInstallScript]);

  const handleRecheckPrereqs = useCallback(async () => {
    setStatusLine("Checking prerequisitesÃ¢â‚¬Â¦");
    await checkPrereqs();
    await checkRecommendations();
    setStatusLine(null);
  }, [checkPrereqs, checkRecommendations]);

  const revertFromSnapshot = useCallback(async () => {
    if (!workspace.root || !lastApplySnapshot) return;
    const count = lastApplySnapshot.changes.length;
    const ok = window.confirm(
      `Revert last apply? This will restore ${count} file(s) to their previous state.`
    );
    if (!ok) return;

    const revertLogs: string[] = [];
    for (const c of lastApplySnapshot.changes) {
      try {
        if (c.wasCreated) {
          await workspace.deleteFile(workspace.root, c.path);
        } else {
          await workspace.writeFile(workspace.root, c.path, c.previousContent);
        }
        revertLogs.push(`Reverted: ${c.path}`);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: `Revert error for ${c.path}: ${String(e)}` },
        ]);
        return;
      }
    }
    const revertLog = revertLogs.join("\n");
    setInstallLog((prev) => (prev ? prev + "\n\n" + revertLog : revertLog));
    setLastApplySnapshot(null);
    setVerificationResults(null);
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: "Reverted. All files restored to pre-apply state." },
    ]);
  }, [lastApplySnapshot]);

  const cancelPendingEdit = useCallback(() => {
    if (!activeProposalId || !pendingEdit) return;
    setProposalStack((prev) => prev.filter((e) => e.id !== activeProposalId));
    setActiveProposalId(null);
    setFileEditState(null);
    console.log("plan: canceled");
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: "Canceled. No changes applied." },
    ]);
  }, [activeProposalId, pendingEdit]);

  const cancelMultiFileProposal = useCallback(() => {
    if (!activeProposalId || !multiFileProposal) return;
    setProposalStack((prev) => prev.filter((e) => e.id !== activeProposalId));
    setActiveProposalId(null);
    setFileEditState(null);
    console.log("multi-file proposal: canceled");
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: "Canceled. No changes applied." },
    ]);
  }, [activeProposalId, multiFileProposal]);

  const setActiveProposalForReview = useCallback((id: string) => {
    setActiveProposalId(id);
    setShowDiffPanel(true);
  }, []);

  const discardProposalFromStack = useCallback((id: string) => {
    setProposalStack((prev) => prev.filter((e) => e.id !== id));
    setActiveProposalId((current) => (current === id ? null : current));
    if (activeProposalId === id) setFileEditState(null);
  }, [activeProposalId]);

  const toggleIncludedFile = useCallback(
    (path: string) => {
      if (!activeProposalId) return;
      setProposalStack((prev) =>
        prev.map((e) =>
          e.id === activeProposalId
            ? { ...e, includedFilePaths: { ...(e.includedFilePaths ?? {}), [path]: !(e.includedFilePaths ?? {})[path] } }
            : e
        )
      );
    },
    [activeProposalId]
  );

  const applyMultiFileProposalSelected = useCallback(async () => {
    if (!workspace.root || !multiFileProposal) return;
    const toApply = multiFileProposal.files.filter((f) => includedFilePaths[f.path] !== false);
    if (toApply.length === 0) return;

    const emptyExisting = toApply.filter((f) => f.exists && f.proposedContent === "");
    if (emptyExisting.length > 0) {
      const ok = window.confirm(
        `The following file(s) would be erased:\n${emptyExisting.map((f) => f.path).join("\n")}\n\nContinue?`
      );
      if (!ok) return;
    }

    const changes: ApplySnapshotChange[] = [];
    for (const f of toApply) {
      const existedBefore = await workspace.exists(f.path);
      const previousContent = existedBefore
        ? await workspace.readFile(f.path)
        : "";
      changes.push({
        path: f.path,
        existedBefore,
        previousContent,
        wasCreated: !existedBefore,
      });
    }

    const logs: string[] = [];
    for (const f of toApply) {
      try {
        await workspace.writeFile(workspace.root, f.path, f.proposedContent);
        logs.push(`Applied: ${f.path}`);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: `Error applying ${f.path}: ${String(e)}` },
        ]);
        return;
      }
    }
    setLastApplySnapshot({
      id: `snap-${Date.now()}`,
      createdAt: Date.now(),
      root: workspace.root,
      changes,
    });
    setProposalStack((prev) =>
      prev.map((e) => (e.id === activeProposalId ? { ...e, status: "applied" as const } : e))
    );
    const multiAppliedSummary = multiFileProposal?.summary;
    const multiAppliedMsg =
      multiAppliedSummary != null
        ? `Applied Ã¢Å“â€œ\n\n**${multiAppliedSummary.title}**\n\nWhat changed:\n${multiAppliedSummary.whatChanged.map((b) => `Ã¢â‚¬Â¢ ${b}`).join("\n")}\n\nBehavior after:\n${multiAppliedSummary.behaviorAfter.map((b) => `Ã¢â‚¬Â¢ ${b}`).join("\n")}\n\nFiles: ${multiAppliedSummary.files.map((f) => `${f.path}: ${f.change}`).join("; ")}${multiAppliedSummary.risks?.length ? `\n\nRisks: ${multiAppliedSummary.risks.map((b) => `Ã¢â‚¬Â¢ ${b}`).join("\n")}` : ""}`
        : `Applied ${toApply.length} file(s): ${toApply.map((f) => f.path).join(", ")}`;
    setActiveProposalId(null);
    setFileEditState(null);
    const applyLog = logs.join("\n");
    setInstallLog((prev) => (prev ? prev + "\n\n" + applyLog : applyLog));
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", text: multiAppliedMsg },
    ]);
    if (devMode === "safe") {
      setStatusLine("Checking prerequisitesÃ¢â‚¬Â¦");
      const checkFile = (path: string) => workspace.exists(path);
      const readFileForProfile = (path: string) => workspace.readFile(path);
      const profile = await pickVerifyProfileFromSignals(checkFile, readFileForProfile);
      const runCmd = async (cmd: string) => {
        const r = await workspace.runSystemCommand(cmd);
        return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
      };
      const missing = await detectMissingPrereqs({
        profile,
        runCommand: runCmd,
        workspaceRoot: workspace.root ?? undefined,
        checkFileExists: checkFile,
        detectedTypes: projectSnapshot?.detectedTypes ?? [],
      });
      setMissingPrereqs(missing);
      await checkRecommendations();
      if (missing.length > 0) {
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: "Prerequisites missing. Install them before verification runs." },
        ]);
        setStatusLine(null);
        return;
      }
      setStatusLine("Running verificationÃ¢â‚¬Â¦");
      try {
        let cmds = projectSnapshot?.detectedCommands ?? {};
        if (!cmds.typecheck && !cmds.lint) {
          const detector = new ProjectDetector(workspace);
          const detected = await detector.detect();
          cmds = detected.detectedCommands;
        }
        const res = await runVerificationChecks({
          workspaceRoot: workspace.root!,
          commands: cmds as import("./core/types").DetectedCommands,
          runTests: false,
          runCommand: (root, cmd) => workspace.runCommand(root, cmd),
        });
        setVerificationResults(res);
        if (!res.allPassed) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: `Verification failed at ${res.stages[res.failedStageIndex!]?.name ?? "?"}. Use Revert or Auto-fix.`,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: "Verification passed." },
          ]);
        }
      } catch (e) {
        setVerificationResults(null);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: `Verification error: ${String(e)}` },
        ]);
      } finally {
        setStatusLine(null);
      }
    } else {
      setVerificationResults(null);
    }
  }, [workspace.root, multiFileProposal, includedFilePaths, devMode, projectSnapshot, checkRecommendations, activeProposalId]);

  const selectPendingFile = useCallback(
    (index: number) => {
      if (!activeProposalId) return;
      setProposalStack((prev) =>
        prev.map((e) =>
          e.id === activeProposalId && e.pendingEdit
            ? { ...e, pendingEdit: { ...e.pendingEdit, selectedIndex: index } }
            : e
        )
      );
    },
    [activeProposalId]
  );

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
    setStatusLine("Running checksÃ¢â‚¬Â¦");
    setTimeout(() => setStatusLine(null), 800);
    /* TODO: TaskRunner; Sprint 3 */
  }, []);

  const viewSession = useCallback(
    async (s: SessionRecord) => {
      if (!workspace.root) return;
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
    []
  );

  const applySession = useCallback(
    async (s: SessionRecord) => {
      if (!workspace.root || s.status !== "pending") return;
      setApplyInProgress(true);
      setStatusLine("Applying patchÃ¢â‚¬Â¦");
      try {
        const engine = new PatchEngine(workspace.root, (p) =>
          workspace.readFile(p)
        );
        const result = await engine.apply(s.patch);
        const store = new MemoryStore(workspace.root);
        await store.updateSessionToApplied(s.id, result.beforeSnapshots);
        if (viewingSessionId === s.id) {
          setAppState("patchApplied");
          setLastBeforeSnapshots(result.beforeSnapshots);
          setLastAppliedSessionId(s.id);
        }
        await fetchSessionsAndResume();
      } catch (e) {
        console.error("applySession", e);
      } finally {
        setApplyInProgress(false);
        setStatusLine(null);
      }
    },
    [viewingSessionId, fetchSessionsAndResume]
  );

  const revertSession = useCallback(
    async (s: SessionRecord) => {
      if (!workspace.root || s.status !== "applied") return;
      const snapshots = s.beforeSnapshots;
      if (!snapshots?.length) return;
      setApplyInProgress(true);
      setStatusLine("RevertingÃ¢â‚¬Â¦");
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

  const readFile = useCallback(
    (path: string) => workspace.readFile(path),
    []
  );

  return (
    <div className="app app-single-flow">
      <TopBar workspacePath={workspacePath} onOpenWorkspace={openWorkspace} />
      <div className="main-three-pane">
        <ConversationPane
          messages={messages}
          planAndPatch={planAndPatch}
          plannerOutput={plannerOutput}
          reviewerOutput={reviewerOutput}
          changedFiles={changedFiles}
          appState={appState}
          applyInProgress={applyInProgress}
          statusLine={statusLine}
          workspaceRoot={workspacePath}
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
          hasLlamaAtToolRoot={hasLlamaAtToolRoot}
          runtimeHealthStatus={runtimeHealthStatus}
          providerFallbackMessage={providerFallbackMessage}
          downloadLog={downloadLog}
          downloadInProgress={downloadInProgress}
          onInitializeTools={onInitializeTools}
          onOpenToolsFolder={onOpenToolsFolder}
          onDownloadRecommendedModel={onDownloadRecommendedModel}
          onRecheckRuntime={onRecheckRuntime}
          onRetryLocalProvider={onRecheckRuntime}
          localSettings={localSettings}
          onLocalSettingsChange={setLocalSettings}
          onRescanModels={rescanModels}
          onPickGGUF={pickGGUFFile}
          onSendChatMessage={sendChatMessage}
          onProposePatch={proposePatch}
          onRunPipeline={executePipeline}
          onKeep={applyPatch}
          onRevert={revert}
          onSaveLater={saveLater}
          onViewDiff={toggleViewDiff}
          showingDiff={showDiffPanel}
          pendingEdit={pendingEdit}
          onApplyPendingEdit={applyPendingEdit}
          onCancelPendingEdit={cancelPendingEdit}
          multiFileProposal={multiFileProposal}
          includedFilePaths={includedFilePaths}
          onToggleIncludedFile={toggleIncludedFile}
          onApplyMultiFileSelected={applyMultiFileProposalSelected}
          onCancelMultiFileProposal={cancelMultiFileProposal}
          verificationResults={verificationResults}
          lastApplySnapshot={lastApplySnapshot}
          onRevertFromSnapshot={revertFromSnapshot}
          onAutoFixVerification={autoFixVerification}
          missingPrereqs={missingPrereqs}
          recommendedPrereqs={recommendedPrereqs}
          recommendedReasoning={recommendedReasoning}
          installLog={installLog}
          installInProgress={installInProgress}
          includeRecommendations={includeRecommendations}
          onIncludeRecommendationsChange={setIncludeRecommendations}
          onCopyPrereqCommand={handleCopyPrereqCommand}
          onInstallPrereq={runInstallScript}
          onOpenPrereqLink={handleOpenPrereqLink}
          onInstallAllSafe={handleInstallAllSafe}
          onInstallAllAdvanced={handleInstallAllAdvanced}
          onRecheckPrereqs={handleRecheckPrereqs}
          devMode={devMode}
          onDevModeChange={handleDevModeChange}
          proposalStack={proposalStack}
          activeProposalId={activeProposalId}
          activeProposalStatus={activeEntry?.status ?? null}
          onReviewProposal={setActiveProposalForReview}
          onDiscardProposal={discardProposalFromStack}
          lastFileChoiceCandidates={lastFileChoiceCandidates}
        />
        <div className="main-pane-middle">
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
          patch={(planAndPatch?.cappedPatch ?? planAndPatch?.patch) ?? null}
          previewMap={previewMap}
          selectedDiffPath={selectedDiffPath}
          onSelectDiffPath={setSelectedDiffPath}
          readFile={readFile}
          fileEditState={fileEditState}
          onFileEditChange={handleFileEditChange}
          onFileEditSave={handleFileEditSave}
          onSetBaseline={handleSetBaseline}
          onResetToBaseline={handleResetToBaseline}
          pendingEdit={pendingEdit}
          onSelectPendingFile={selectPendingFile}
          multiFileProposal={multiFileProposal}
          includedFilePaths={includedFilePaths}
          onToggleIncludedFile={toggleIncludedFile}
          selectedMultiFileIndex={selectedMultiFileIndex}
          onSelectMultiFileIndex={setSelectedMultiFileIndex}
          onApplyMultiFileSelected={applyMultiFileProposalSelected}
          onCancelMultiFileProposal={cancelMultiFileProposal}
        />
        </div>
        <LivePane
          isOpen={livePaneOpen}
          onToggleOpen={handleLivePaneToggle}
          hasFailed={lastRunFailed}
          onRetry={handleRetry}
          workspaceRoot={workspacePath}
          runtimeStatus={runtimeStatus}
          runtimePort={runtimePort}
          runtimeHealthStatus={runtimeHealthStatusText}
          runtimeSpawnError={runtimeSpawnError}
          runtimeLogLines={runtimeLogLines}
          onStartRuntime={handleStartRuntime}
          onStopRuntime={handleStopRuntime}
          onRestartRuntime={handleRestartRuntime}
        />
      </div>
    </div>
  );
}









