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
  defaultPlanner,
  defaultCoder,
  defaultReviewer,
  setModelProvider,
  MockModelProvider,
  LocalModelProvider,
  LocalPlannerAgent,
  LocalReviewerAgent,
  PatchEngine,
  MemoryStore,
  resumeSuggestion,
  DEFAULT_LOCAL_SETTINGS,
  getRequestedFileHint,
  readProjectFile,
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
import type { Provider, LocalModelSettings } from "./core";
import type { FileSnapshot } from "./core/patch/PatchEngine";
import type { ResumeSuggestion } from "./core";
import { TopBar } from "./components/TopBar";
import { ConversationPane } from "./components/ConversationPane";
import { FilesPane } from "./components/FilesPane";
import "./App.css";

const workspace = new WorkspaceService();

type AppState = "idle" | "patchProposed" | "patchApplied";

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
  const [port, setPort] = useState<number>(11435);
  const [provider, setProvider] = useState<Provider>("mock");
  const [localSettings, setLocalSettings] = useState<LocalModelSettings>(() => ({
    ...DEFAULT_LOCAL_SETTINGS,
  }));
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
      const inspector = new ProjectInspector(workspace);
      const m = await inspector.buildManifest();
      setManifest(m);
      const tree = await workspace.readFileTree();
      setFileTree(tree);
      const root = workspace.root ?? path;
      const detector = new ProjectDetector(workspace);
      const detected = await detector.detect();
      const settings = await readWorkspaceSettings(root);
      const enabled =
        settings.autoPacksEnabled
          ? detected.recommendedPacks
          : (settings.enabledPacks?.length ? settings.enabledPacks : detected.recommendedPacks);
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
      };
      await writeWorkspaceSettings(root, newSettings);
      setModelPath(modelPathNext);
      setLocalSettings((prev) => ({
        ...prev,
        ggufPath: modelPathNext && tr ? resolveModelPath(tr, modelPathNext) : "",
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

      const fileHint = getRequestedFileHint(p);
      if (fileHint) {
        const result = await readProjectFile(root, fileHint, (path) => workspace.readFile(path), (path) => workspace.exists(path));
        if ("error" in result) {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: `${result.path} not found.` },
          ]);
          return;
        }
        const injectedPrompt = `--- FILE: ${result.path} ---\n${result.content}\n--- END FILE ---\n\nUser request: ${p}`;
        setStatusLine("Generating reply…");
        try {
          const inspector = new ProjectInspector(workspace);
          const m = manifest ?? (await inspector.buildManifest());
          if (!manifest) setManifest(m);
          const ctxBuilder = new ContextBuilder(workspace, m);
          const knowledgeStore = useKnowledgePacks ? new KnowledgeStore(root, workspace) : null;
          const ctx = await ctxBuilder.build(injectedPrompt, selectedPaths, {
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
        return;
      }

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
    [workspacePath, selectedPaths, manifest, useKnowledgePacks, projectSnapshot, enabledPacks]
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
        await writeWorkspaceSettings(root, { autoPacksEnabled, enabledPacks: next, modelPath, port }).catch(() => {});
      }
    },
    [projectSnapshot, autoPacksEnabled, modelPath, port]
  );

  const handleAutoPacksEnabledChange = useCallback(
    (value: boolean) => {
      setAutoPacksEnabled(value);
      const root = workspace.root;
      if (root) {
        writeWorkspaceSettings(root, { autoPacksEnabled: value, enabledPacks, modelPath, port }).catch(() => {});
      }
    },
    [enabledPacks, modelPath, port]
  );

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
    setShowDiffPanel((v) => !v);
  }, []);

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
        />
      </div>
    </div>
  );
}
