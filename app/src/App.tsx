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
  scanModelsForGGUF,
  toolRootExists,
  resolveModelPath,
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
  routeUserMessage,
  applySimpleEdit,
  detectProjectRoot,
  getDefaultEnabledPackIds,
  generateSnapshotData,
  writeProjectSnapshotFile,
  getSnapshotOutputPath,
} from "./core";
import type {
  FileTreeNode,
  PlanAndPatch,
  PlannerOutput,
  ReviewerOutput,
  SessionRecord,
  AgentMode,
  ProjectSnapshot,
  ModelRolePaths,
} from "./core/types";
import type { Provider, LocalModelSettings } from "./core";
import type { FileSnapshot } from "./core/patch/PatchEngine";
import type { ResumeSuggestion } from "./core";
import { TopBar } from "./components/TopBar";
import { ConversationPane } from "./components/ConversationPane";
import { FilesPane } from "./components/FilesPane";
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
  const [modelRoles, setModelRoles] = useState<ModelRolePaths | undefined>(undefined);
  const [toolRoot, setToolRoot] = useState<string | null>(null);
  const [port, setPort] = useState<number>(11435);
  const [provider, setProvider] = useState<Provider>("local");
  const [localSettings, setLocalSettings] = useState<LocalModelSettings>(() => ({
    ...DEFAULT_LOCAL_SETTINGS,
  }));
  const [lastFileChoiceCandidates, setLastFileChoiceCandidates] = useState<string[] | null>(null);
  const localSettingsRef = useRef(localSettings);
  const toolRootRef = useRef<string | null>(null);
  const portRef = useRef<number>(11435);
  localSettingsRef.current = localSettings;
  toolRootRef.current = toolRoot;
  portRef.current = port;

  useEffect(() => {
    if (provider === "local") {
      setModelProvider(
        new LocalModelProvider(
          () => localSettingsRef.current,
          () => toolRootRef.current,
          () => portRef.current ?? 11435,
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
      return;
    }
    setToolRoot(tr);
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

  useEffect(() => {
    if (provider !== "local" || !workspacePath) return;
    runLocalModelAutoScan();
  }, [provider, workspacePath, runLocalModelAutoScan]);

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
    setStatusLine("Refreshing snapshot…");
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
    setStatusLine("Scanning workspace…");
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
      setPort(settings.port ?? 11435);
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
        modelPath: modelPathNext,
        port: settings.port ?? 11435,
        modelRoles: settings.modelRoles,
      };
      await writeWorkspaceSettings(root, newSettings);
      setModelPath(modelPathNext);
      setModelRoles(settings.modelRoles ?? undefined);
      const ggufPathFromRoles = settings.modelRoles?.coder ?? settings.modelRoles?.general;
      const ggufPath = ggufPathFromRoles ?? (modelPathNext && tr ? resolveModelPath(tr, modelPathNext) : "");
      setLocalSettings((prev) => ({
        ...prev,
        ggufPath: ggufPath || "",
      }));
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
          reply = "Commands: /help — this message; /snapshot — project snapshot.";
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
      const route = routeUserMessage(p);
      console.log("MESSAGE_ROUTING:", route);

      if (route.action === "file_open" || route.action === "file_edit") {
        const fileHint = route.targetPath;
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
        const diffRequest = hasDiffRequest(p);
        
        if (diffRequest) {
          setStatusLine("Generating patch…");
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
              enabledPacks: enabledPacks.length ? enabledPacks : undefined,
            });
            const patchResult = await generatePlanAndPatch(ctx);
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
            const record = await store.addProposedSession(p, [resolvedPath], patchResult.explanation, patchResult.patch);
            setCurrentProposedSessionId(record.id);
            await fetchSessionsAndResume();
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Patch for ${resolvedPath}: ${patchResult.explanation}` },
            ]);
          } catch (e) {
            console.error("sendChatMessage patch", e);
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
            ]);
          } finally {
            setStatusLine(null);
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

      // ROUTING: chat (no file action)
      console.log("MESSAGE_ROUTING: chat");
      setStatusLine("Generating reply…");
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
          enabledPacks: enabledPacks.length ? enabledPacks : undefined,
        });
        setLastRetrievedChunks(
          ctx.knowledgeChunks?.map((c) => ({
            title: c.title,
            sourcePath: c.sourcePath,
            chunkText: c.chunkText,
          })) ?? []
        );
        const text = await generateChatResponse(ctx);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text },
        ]);
      } catch (e) {
        console.error("sendChatMessage", e);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: `Error: ${String(e)}` },
        ]);
      } finally {
        setStatusLine(null);
      }
    },
    [workspacePath, selectedPaths, manifest, useKnowledgePacks, projectSnapshot, enabledPacks, lastFileChoiceCandidates, fetchSessionsAndResume]
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
      setStatusLine("Scanning selected files…");
      try {
        const inspector = new ProjectInspector(workspace);
        const m = manifest ?? (await inspector.buildManifest());
        if (!manifest) setManifest(m);
        const ctxBuilder = new ContextBuilder(workspace, m);
        const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
        setStatusLine("Generating patch…");
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
        setStatusLine("Running pipeline…");
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
                    () => portRef.current ?? 11435,
                    () => ({})
                  ),
                  reviewer: new LocalReviewerAgent(
                    () => localSettingsRef.current,
                    () => toolRootRef.current,
                    () => portRef.current ?? 11435,
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

  const onModelRolesChange = useCallback(
    async (roles: ModelRolePaths) => {
      setModelRoles(roles);
      const root = workspace.root;
      if (root) {
        const settings = await readWorkspaceSettings(root).catch(() => ({} as import("./core/types").WorkspaceSettings));
        await writeWorkspaceSettings(root, { ...settings, modelRoles: roles }).catch(() => {});
      }
      const ggufPath = roles.coder ?? roles.general ?? "";
      if (ggufPath) {
        setLocalSettings((prev) => ({ ...prev, ggufPath }));
      }
    },
    []
  );

  const rescanModels = useCallback(async () => {
    const root = workspace.root;
    if (!root || !toolRoot) return;
    const scanned = await scanModelsForGGUF(toolRoot);
    if (!scanned) return;
    const settings = await readWorkspaceSettings(root);
    const next = { ...settings, modelPath: scanned, modelRoles: settings.modelRoles };
    await writeWorkspaceSettings(root, next).catch(() => {});
    setModelPath(scanned);
    setLocalSettings((prev) => ({ ...prev, ggufPath: resolveModelPath(toolRoot, scanned) }));
  }, [toolRoot]);

  const applyPatch = useCallback(async () => {
    if (!workspacePath || !workspace.root || !planAndPatch || !currentProposedSessionId) return;
    setApplyInProgress(true);
    setStatusLine("Applying patch…");
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
      setStatusLine("Reverting…");
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
    setStatusLine("Running checks…");
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
      setStatusLine("Applying patch…");
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
      setStatusLine("Reverting…");
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
      <div className="main-two-pane">
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
      </div>
    </div>
  );
}
