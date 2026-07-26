import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import type { FileTreeNode } from "../core/types";
import { WorkspaceService } from "../core/workspace/WorkspaceService";
import {
  PatchEngine,
  pathsFromPatch,
  selectPatchFiles,
} from "../core/patch/PatchEngine";
import {
  MockModelProvider,
  getModelProvider,
  getModelProviderInfo,
  setModelProvider,
  type ModelProviderInfo,
} from "../core/model/ModelGateway";
import { LocalModelProvider } from "../core/model/LocalModelProvider";
import { readWorkspaceSettings } from "../core/project/workspaceSettings";
import {
  DEFAULT_LOCAL_SETTINGS,
  findToolRoot,
  resolveModelPath,
} from "../core/runtime/runtimeApi";
import { OpenAIModelProvider } from "../lib/providers/openai";
import {
  assertDeveloperCommandApproval,
  assertDeveloperPatchApproval,
  createDeveloperSessionState,
  isolateDeveloperSession,
  type DeveloperCommandState,
  type DeveloperSection,
  type DeveloperSessionState,
} from "../core/developer/developerState";
import {
  cancelDeveloperCommand,
  inspectDeveloperWorkspace,
  runDeveloperCommand,
  searchRepository,
  type DeveloperWorkspaceInfo,
  type RepositorySearchMatch,
  listRecentWorkspaces,
  recordRecentWorkspace,
  removeRecentWorkspace,
  type RecentWorkspace,
  getProviderSettings,
  getProviderDiagnostics,
  listFrictionEntries,
  saveFrictionEntry,
  removeFrictionEntry,
  type FrictionEntry,
  approveDeveloperAgent,
  revertDeveloperAgent,
  startDeveloperAgent,
  stopDeveloperAgent,
  type AgentRunState,
  type DeveloperAgentMode,
  applyDeveloperChange,
  listDeveloperChanges,
  proposeDeveloperChange,
  rejectDeveloperChange,
  rejectDeveloperAgent,
  revertDeveloperChange,
  type DeveloperChangeRecord,
  groupDeveloperChanges,
} from "../core/developer/developerServices";
import {
  readDeveloperSession,
  writeDeveloperSession,
} from "../core/developer/developerSessionStore";
import {
  parsePatchHunks,
  patchFromSelectedHunks,
  selectedHunksPreserveFileSemantics,
} from "../core/patch/patchHunks";

const developerWorkspace = new WorkspaceService();
loader.config({ monaco });
if (!monaco.languages.getLanguages().some((language) => language.id === "dart")) {
  monaco.languages.register({ id: "dart", extensions: [".dart"], aliases: ["Dart"] });
  monaco.languages.setLanguageConfiguration("dart", {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'" },
      { open: "\"", close: "\"" },
    ],
  });
  monaco.languages.setMonarchTokensProvider("dart", {
    keywords: [
      "abstract", "as", "assert", "async", "await", "break", "case", "catch", "class",
      "const", "continue", "default", "deferred", "do", "dynamic", "else", "enum",
      "export", "extends", "extension", "external", "factory", "false", "final",
      "finally", "for", "Function", "get", "hide", "if", "implements", "import", "in",
      "interface", "is", "late", "library", "mixin", "new", "null", "on", "operator",
      "part", "required", "rethrow", "return", "sealed", "set", "show", "static",
      "super", "switch", "sync", "this", "throw", "true", "try", "typedef", "var",
      "void", "when", "while", "with", "yield",
    ],
    tokenizer: {
      root: [
        [/[a-zA-Z_$][\w$]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@doubleString"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/'/, "string", "@singleString"],
        [/\d+(\.\d+)?/, "number"],
        [/[{}()[\]]/, "@brackets"],
      ],
      comment: [[/[^*/]+/, "comment"], [/\*\//, "comment", "@pop"], [/[*/]/, "comment"]],
      doubleString: [[/[^\\"]+/, "string"], [/\\./, "string.escape"], [/"/, "string", "@pop"]],
      singleString: [[/[^\\']+/, "string"], [/\\./, "string.escape"], [/'/, "string", "@pop"]],
    },
  });
}
const SECTIONS: { id: DeveloperSection; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "files", label: "Files" },
  { id: "assistant", label: "AI Assistant" },
  { id: "changes", label: "Changes" },
  { id: "terminal", label: "Terminal" },
  { id: "build-tests", label: "Build & Tests" },
  { id: "git", label: "Git" },
  { id: "memory", label: "Project Memory" },
];

interface OutputEvent {
  runId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

function FileTree({
  nodes,
  selected,
  onOpen,
  onToggleContext,
}: {
  nodes: FileTreeNode[];
  selected: string[];
  onOpen: (path: string) => void;
  onToggleContext: (path: string) => void;
}) {
  return (
    <ul className="developer-file-tree">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.isDir ? (
            <details>
              <summary>{node.name}</summary>
              <FileTree nodes={node.children ?? []} selected={selected} onOpen={onOpen} onToggleContext={onToggleContext} />
            </details>
          ) : (
            <div className="developer-file-row">
              <input
                type="checkbox"
                checked={selected.includes(node.path)}
                aria-label={`Use ${node.path} as AI context`}
                onChange={() => onToggleContext(node.path)}
              />
              <button type="button" onClick={() => onOpen(node.path)}>{node.name}</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function patchKind(oldText: string, newText: string): string {
  if (!oldText && newText) return "created";
  if (oldText && !newText) return "deleted";
  return "modified";
}

const EDITABLE_FILE_LIMIT = 2 * 1024 * 1024;
const EDITABLE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "json", "css", "scss", "html", "md", "rs", "toml",
  "yml", "yaml", "dart", "py", "ps1", "sh", "java", "cs", "cpp", "c", "h", "go", "sql", "txt",
]);

export function editorLanguage(path: string | null): string {
  const extension = path?.split(".").pop()?.toLowerCase() ?? "plaintext";
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", rs: "rust", py: "python", ps1: "powershell", md: "markdown", yml: "yaml" } as Record<string, string>)[extension] ?? extension;
}

export default function DeveloperWorkspace() {
  const [session, setSession] = useState<DeveloperSessionState>(() => createDeveloperSessionState());
  const [workspaceInfo, setWorkspaceInfo] = useState<DeveloperWorkspaceInfo | null>(null);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [openContent, setOpenContent] = useState("");
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  const [selectedHunkIds, setSelectedHunkIds] = useState<string[]>([]);
  const [patchConflicts, setPatchConflicts] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"filename" | "text">("filename");
  const [searchResults, setSearchResults] = useState<RepositorySearchMatch[]>([]);
  const [prompt, setPrompt] = useState("");
  const [agentMode, setAgentMode] = useState<DeveloperAgentMode>("ask");
  const [agentRun, setAgentRun] = useState<AgentRunState | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [changeRecords, setChangeRecords] = useState<DeveloperChangeRecord[]>([]);
  const [manualPatchId, setManualPatchId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Map<string, { old: string; new: string }> | null>(null);
  const [command, setCommand] = useState("git status --short --branch");
  const [commandPurpose, setCommandPurpose] = useState("Inspect the current repository state.");
  const [commandRisk, setCommandRisk] = useState("Read-only repository inspection.");
  const [commandState, setCommandState] = useState<DeveloperCommandState | null>(null);
  const [status, setStatus] = useState("Open an existing repository to begin.");
  const [providerInfo, setProviderInfo] = useState<ModelProviderInfo>(() => getModelProviderInfo());
  const [frictionEntries, setFrictionEntries] = useState<FrictionEntry[]>([]);
  const [frictionArea, setFrictionArea] = useState<FrictionEntry["area"]>("Other");
  const [frictionSeverity, setFrictionSeverity] = useState<FrictionEntry["severity"]>("Minor");
  const [frictionDescription, setFrictionDescription] = useState("");
  const [frictionNotes, setFrictionNotes] = useState("");
  const workspaceRoot = session.workspacePath;
  const pendingHunks = useMemo(
    () => parsePatchHunks(session.pendingPatch?.patch ?? ""),
    [session.pendingPatch]
  );
  const changeGroups = useMemo(() => groupDeveloperChanges(changeRecords), [changeRecords]);

  const runAgent = useCallback(async () => {
    if (!workspaceRoot || !prompt.trim() || !providerInfo.isReal) return;
    const runId = crypto.randomUUID();
    setAgentBusy(true);
    setStatus(`${agentMode.toUpperCase()} task started.`);
    try {
      const result = await startDeveloperAgent({
        runId,
        workspaceRoot,
        mode: agentMode,
        prompt,
        scope: session.selectedContextPaths.join(", ") || undefined,
        openFile: session.openFilePath ?? undefined,
        selectedCode: session.selectedRangeContexts.length
          ? session.selectedRangeContexts[session.selectedRangeContexts.length - 1]
          : undefined,
        trustedChanges: false,
      });
      setAgentRun(result);
      setChangeRecords(await listDeveloperChanges(workspaceRoot));
      setStatus(`Developer agent: ${result.status}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentBusy(false);
    }
  }, [agentMode, prompt, providerInfo.isReal, session.openFilePath, session.selectedContextPaths, session.selectedRangeContexts, workspaceRoot]);

  const approveAgent = useCallback(async () => {
    if (!agentRun || !window.confirm("Apply this displayed agent patch to the current workspace?")) return;
    setAgentBusy(true);
    try {
      setAgentRun(await approveDeveloperAgent(agentRun.runId));
      if (workspaceRoot) setChangeRecords(await listDeveloperChanges(workspaceRoot));
    } finally {
      setAgentBusy(false);
    }
  }, [agentRun, workspaceRoot]);

  const stopAgent = useCallback(async () => {
    if (!agentRun) return;
    setAgentRun(await stopDeveloperAgent(agentRun.runId));
  }, [agentRun]);

  const rejectAgent = useCallback(async () => {
    if (!agentRun || !window.confirm("Reject this pending Agent write and return that decision to the agent?")) return;
    setAgentBusy(true);
    try {
      setAgentRun(await rejectDeveloperAgent(agentRun.runId));
      if (workspaceRoot) setChangeRecords(await listDeveloperChanges(workspaceRoot));
    } finally {
      setAgentBusy(false);
    }
  }, [agentRun, workspaceRoot]);

  const revertAgent = useCallback(async () => {
    if (!agentRun || !window.confirm("Revert every file changed by this NF task?")) return;
    setAgentRun(await revertDeveloperAgent(agentRun.runId, true));
    if (workspaceRoot) setChangeRecords(await listDeveloperChanges(workspaceRoot));
  }, [agentRun, workspaceRoot]);

  const persist = useCallback(async (next: DeveloperSessionState) => {
    setSession(next);
    if (next.workspacePath) await writeDeveloperSession(next.workspacePath, next);
  }, []);

  const refreshWorkspace = useCallback(async (root: string) => {
    const info = await inspectDeveloperWorkspace(root);
    await developerWorkspace.setWorkspaceRoot(info.canonicalPath);
    setWorkspaceInfo(info);
    setTree(await developerWorkspace.readFileTree());
    setChangeRecords(await listDeveloperChanges(info.canonicalPath));
  }, []);

  const openWorkspace = useCallback(async () => {
    const selected = await developerWorkspace.openWorkspace();
    if (!selected) return;
    const info = await inspectDeveloperWorkspace(selected);
    await developerWorkspace.setWorkspaceRoot(info.canonicalPath);
    const stored = await readDeveloperSession(info.canonicalPath);
    const next = isolateDeveloperSession(stored, info.canonicalPath);
    const settings = await readWorkspaceSettings(info.canonicalPath);
    const appProvider = await getProviderSettings();
    const diagnostics = await getProviderDiagnostics();
    if (appProvider.provider === "openai") {
      const provider = new OpenAIModelProvider(appProvider.openaiModel);
      const providerState: ModelProviderInfo = {
        kind: "openai",
        label: `OpenAI (${appProvider.openaiModel || "configured model"})`,
        isReal: true,
        available: diagnostics.credentialAvailable,
        reason: diagnostics.message,
      };
      setModelProvider(provider, providerState);
      setProviderInfo(providerState);
    } else if (appProvider.provider === "local") {
      const toolRoot = await findToolRoot(info.canonicalPath);
      const configuredPath =
        appProvider.localModelPath || settings.modelRoles?.coder || settings.modelPath;
      if (toolRoot && configuredPath) {
        const localSettings = {
          ...DEFAULT_LOCAL_SETTINGS,
          ggufPath: resolveModelPath(toolRoot, configuredPath),
        };
        const provider = new LocalModelProvider(
          () => localSettings,
          () => toolRoot,
          () => settings.port
        );
        const providerState: ModelProviderInfo = {
          kind: "local",
          label: "Local model",
          isReal: true,
          available: true,
        };
        setModelProvider(provider, providerState);
        setProviderInfo(providerState);
      } else {
        const providerState: ModelProviderInfo = {
          kind: "mock",
          label: "Mock — not applyable",
          isReal: false,
          available: false,
          reason: "No configured local model was found. Configure a real provider before requesting changes.",
        };
        setModelProvider(new MockModelProvider(), providerState);
        setProviderInfo(providerState);
      }
    } else {
      const providerState: ModelProviderInfo = {
        kind: "mock",
        label: "Mock — explicitly selected",
        isReal: false,
        available: true,
        reason: "Mock output is never applyable in Developer Mode.",
      };
      setModelProvider(new MockModelProvider(), providerState);
      setProviderInfo(providerState);
    }
    setSession(next);
    setWorkspaceInfo(info);
    setTree(await developerWorkspace.readFileTree());
    setStatus(`Opened canonical workspace: ${info.canonicalPath}`);
    setRecentWorkspaces(await recordRecentWorkspace({
      canonicalPath: info.canonicalPath,
      repositoryName: info.canonicalPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? info.canonicalPath,
      branch: info.branch,
      dirty: info.dirty,
      lastOpenedAt: new Date().toISOString(),
    }));
  }, []);

  const openRecentWorkspace = useCallback(async (path: string) => {
    const info = await inspectDeveloperWorkspace(path);
    await developerWorkspace.setWorkspaceRoot(info.canonicalPath);
    const stored = await readDeveloperSession(info.canonicalPath);
    setSession(isolateDeveloperSession(stored, info.canonicalPath));
    setWorkspaceInfo(info);
    setTree(await developerWorkspace.readFileTree());
    setRecentWorkspaces(await recordRecentWorkspace({
      canonicalPath: info.canonicalPath,
      repositoryName: info.canonicalPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? info.canonicalPath,
      branch: info.branch,
      dirty: info.dirty,
      lastOpenedAt: new Date().toISOString(),
    }));
    setStatus(`Restored workspace after explicit selection: ${info.canonicalPath}`);
  }, []);

  const openFile = useCallback(async (path: string) => {
    if (!workspaceRoot) return;
    try {
      const content = await developerWorkspace.readFile(path);
      const size = await invoke<number>("workspace_file_size", { workspaceRoot, path });
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      setEditorReadOnly(size > EDITABLE_FILE_LIMIT || !EDITABLE_EXTENSIONS.has(extension));
      setOpenContent(session.editorDrafts[path] ?? content);
      await persist({ ...session, openFilePath: path });
    } catch (error) {
      setStatus(`Could not open text file: ${String(error)}`);
    }
  }, [persist, session, workspaceRoot]);

  const onEditorMount: OnMount = useCallback((editor) => {
    editor.onDidChangeCursorSelection((event) => {
      if (!session.openFilePath || event.selection.isEmpty()) return;
      const model = editor.getModel();
      const content = model?.getValueInRange(event.selection) ?? "";
      const range = {
        path: session.openFilePath,
        startLine: event.selection.startLineNumber,
        endLine: event.selection.endLineNumber,
        content,
      };
      setSession((current) => {
        const next = {
          ...current,
          selectedRangeContexts: [
            ...current.selectedRangeContexts.filter((item) => item.path !== range.path),
            range,
          ],
        };
        if (next.workspacePath) void writeDeveloperSession(next.workspacePath, next);
        return next;
      });
    });
  }, [session.openFilePath]);

  const saveEditorDraft = useCallback(async () => {
    if (!workspaceRoot || !session.openFilePath || editorReadOnly) return;
    if (!window.confirm(`Save this exact editor content?\n\n${session.openFilePath}`)) return;
    await developerWorkspace.writeFile(workspaceRoot, session.openFilePath, openContent);
    const editorDrafts = { ...session.editorDrafts };
    delete editorDrafts[session.openFilePath];
    await persist({ ...session, editorDrafts });
    await refreshWorkspace(workspaceRoot);
    setStatus(`Saved ${session.openFilePath} after explicit approval.`);
  }, [editorReadOnly, openContent, persist, refreshWorkspace, session, workspaceRoot]);

  const toggleContext = useCallback(async (path: string) => {
    const selectedContextPaths = session.selectedContextPaths.includes(path)
      ? session.selectedContextPaths.filter((item) => item !== path)
      : [...session.selectedContextPaths, path];
    await persist({ ...session, selectedContextPaths });
  }, [persist, session]);

  const runSearch = useCallback(async () => {
    if (!workspaceRoot || !searchQuery.trim()) return;
    setSearchResults(await searchRepository(workspaceRoot, searchQuery.trim(), searchMode));
  }, [searchMode, searchQuery, workspaceRoot]);

  const proposePatch = useCallback(async () => {
    if (!workspaceRoot || !prompt.trim()) return;
    const currentProvider = getModelProviderInfo();
    if (!currentProvider.isReal || !currentProvider.available) {
      setStatus(`Provider unavailable: ${currentProvider.reason ?? currentProvider.label}. Mock output cannot become a patch.`);
      return;
    }
    setStatus("Requesting a manual patch proposal...");
    try {
      const selectedFiles = await Promise.all(
        session.selectedContextPaths.map(async (path) => ({ path, content: await developerWorkspace.readFile(path) }))
      );
      selectedFiles.push(...session.selectedRangeContexts.map((range) => ({
        path: `${range.path}:${range.startLine}-${range.endLine}`,
        content: range.content,
      })));
      const proposal = await getModelProvider().generatePlanAndPatch({
        prompt,
        selectedFiles,
        targetFiles: session.selectedContextPaths,
        includeFileProjectContext: true,
      });
      const engine = new PatchEngine(workspaceRoot, (path) => developerWorkspace.readFile(path));
      const validation = engine.validatePatch(proposal.patch);
      if (!validation.valid || validation.paths.length === 0) {
        throw new Error(validation.error ?? "The model did not return a valid patch.");
      }
      const nextPreview = await engine.preview(proposal.patch);
      if (nextPreview.size !== validation.paths.length) throw new Error("Patch preview is incomplete.");
      setPreview(nextPreview);
      setPatchConflicts(validation.paths.filter((path) => !nextPreview.has(path)));
      const hunks = parsePatchHunks(proposal.patch);
      const patchId = `manual-${crypto.randomUUID()}`;
      await proposeDeveloperChange(workspaceRoot, "manual", null, patchId, proposal.patch);
      setManualPatchId(patchId);
      setChangeRecords(await listDeveloperChanges(workspaceRoot));
      setSelectedHunkIds(hunks.map((hunk) => hunk.id));
      await persist({
        ...session,
        lastPrompt: prompt,
        pendingPatch: proposal,
        pendingSelectedPaths: validation.paths,
        activeSection: "changes",
      });
      setStatus("Patch proposal ready. No files have been changed.");
    } catch (error) {
      setStatus(`Patch proposal failed: ${String(error)}`);
    }
  }, [persist, prompt, session, workspaceRoot]);

  const rejectPatch = useCallback(async () => {
    if (manualPatchId) {
      await rejectDeveloperChange(manualPatchId);
      if (workspaceRoot) setChangeRecords(await listDeveloperChanges(workspaceRoot));
    }
    setPreview(null);
    await persist({ ...session, pendingPatch: null, pendingSelectedPaths: [] });
    setStatus("Patch rejected. No files were changed.");
  }, [manualPatchId, persist, session, workspaceRoot]);

  const applyPatch = useCallback(async (selectedOnly: boolean) => {
    if (!workspaceRoot) return;
    const approved = window.confirm(
      selectedOnly
        ? `Apply only the selected files?\n\n${session.pendingSelectedPaths.join("\n")}`
        : `Apply this entire patch?\n\n${pathsFromPatch(session.pendingPatch?.patch ?? "").join("\n")}`
    );
    try {
      assertDeveloperPatchApproval(approved, session.pendingPatch);
      const patch = selectedOnly
        ? selectPatchFiles(session.pendingPatch!.patch, session.pendingSelectedPaths)
        : session.pendingPatch!.patch;
      if (!patch.trim()) throw new Error("Select at least one file to apply.");
      if (!manualPatchId) throw new Error("Backend patch record is unavailable.");
      await applyDeveloperChange(manualPatchId, true, patch);
      setPreview(null);
      await persist({
        ...session,
        pendingPatch: null,
        pendingSelectedPaths: [],
        lastAppliedSnapshots: [],
      });
      await refreshWorkspace(workspaceRoot);
      setStatus(`Applied ${pathsFromPatch(patch).length} explicitly approved file change(s).`);
    } catch (error) {
      setStatus(String(error));
    }
  }, [manualPatchId, persist, refreshWorkspace, session, workspaceRoot]);

  const applySelectedHunks = useCallback(async () => {
    if (!workspaceRoot || !session.pendingPatch) return;
    const semanticCheck = selectedHunksPreserveFileSemantics(
      session.pendingPatch.patch,
      selectedHunkIds
    );
    if (!semanticCheck.valid) {
      setStatus(semanticCheck.error ?? "Selected hunks are invalid.");
      return;
    }
    const patch = patchFromSelectedHunks(session.pendingPatch.patch, selectedHunkIds);
    if (!patch.trim()) {
      setStatus("Select at least one hunk.");
      return;
    }
    const engine = new PatchEngine(workspaceRoot, (path) => developerWorkspace.readFile(path));
    const candidatePreview = await engine.preview(patch);
    const expected = pathsFromPatch(patch);
    const conflicts = expected.filter((path) => !candidatePreview.has(path));
    setPatchConflicts(conflicts);
    if (conflicts.length) {
      setStatus(`Patch conflicts must be resolved before application: ${conflicts.join(", ")}`);
      return;
    }
    if (!window.confirm(`Apply ${selectedHunkIds.length} explicitly selected hunk(s)?`)) return;
    if (!manualPatchId) { setStatus("Backend patch record is unavailable."); return; }
    await applyDeveloperChange(manualPatchId, true, patch);
    setPreview(null);
    await persist({
      ...session,
      pendingPatch: null,
      pendingSelectedPaths: [],
      lastAppliedSnapshots: [],
    });
    await refreshWorkspace(workspaceRoot);
    setStatus(`Applied ${selectedHunkIds.length} approved hunk(s).`);
  }, [manualPatchId, persist, refreshWorkspace, selectedHunkIds, session, workspaceRoot]);

  const revertLastPatch = useCallback(async () => {
    if (!workspaceRoot || !manualPatchId) return;
    if (!window.confirm("Revert the most recent NF-applied Developer Mode patch?")) return;
    await revertDeveloperChange(manualPatchId, true);
    await persist({ ...session, lastAppliedSnapshots: [] });
    await refreshWorkspace(workspaceRoot);
    setStatus("Most recent NF-applied patch reverted.");
  }, [manualPatchId, persist, refreshWorkspace, session, workspaceRoot]);

  const executeExactCommand = useCallback(async (
    exactCommand: string,
    purpose: string,
    risk: string,
    timeoutMs = 120_000
  ) => {
    if (!workspaceRoot) return;
    const approved = window.confirm(
      `Approve this exact command?\n\nCommand: ${exactCommand}\nCWD: ${workspaceRoot}\nPurpose: ${purpose}\nRisk: ${risk}`
    );
    try {
      assertDeveloperCommandApproval(approved, exactCommand);
      const runId = `developer-${Date.now()}`;
      setCommandState({
        runId,
        command: exactCommand,
        cwd: workspaceRoot,
        purpose,
        risk,
        status: "running",
        output: "",
        startedAt: new Date().toISOString(),
      });
      const result = await runDeveloperCommand({
        runId,
        workspaceRoot,
        command: exactCommand,
        purpose,
        risk,
        timeoutMs,
        approved: true,
      });
      setCommandState((current) => current ? {
        ...current,
        status: result.cancelled ? "cancelled" : result.timedOut ? "timedOut" : result.exitCode === 0 ? "passed" : "failed",
        output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`,
        completedAt: new Date().toISOString(),
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        truncated: result.truncated,
      } : current);
      await refreshWorkspace(workspaceRoot);
    } catch (error) {
      setStatus(`Command blocked or failed: ${String(error)}`);
    }
  }, [refreshWorkspace, workspaceRoot]);

  const executeCommand = useCallback(
    () => executeExactCommand(command, commandPurpose, commandRisk),
    [command, commandPurpose, commandRisk, executeExactCommand]
  );

  const recordFriction = useCallback(async () => {
    if (!workspaceInfo || !frictionDescription.trim()) return;
    const entry: FrictionEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      repositoryCanonicalPath: workspaceInfo.canonicalPath,
      repositoryName: workspaceInfo.repositoryName,
      branch: workspaceInfo.branch,
      area: frictionArea,
      description: frictionDescription.trim(),
      severity: frictionSeverity,
      status: "Open",
      notes: frictionNotes.trim() || undefined,
    };
    setFrictionEntries(await saveFrictionEntry(entry));
    setFrictionDescription("");
    setFrictionNotes("");
    setStatus("Friction point recorded in NF application data.");
  }, [frictionArea, frictionDescription, frictionNotes, frictionSeverity, workspaceInfo]);

  useEffect(() => {
    void listRecentWorkspaces().then(setRecentWorkspaces).catch(() => setRecentWorkspaces([]));
    void listFrictionEntries().then(setFrictionEntries).catch(() => setFrictionEntries([]));
  }, []);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    listen<OutputEvent>("developer-command-output", (event) => {
      setCommandState((current) => {
        if (!current || current.runId !== event.payload.runId) return current;
        return { ...current, output: current.output + event.payload.chunk };
      });
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  const changeRows = useMemo(() => {
    if (!preview) return [];
    return [...preview].map(([path, value]) => ({
      path,
      kind: patchKind(value.old, value.new),
      selected: session.pendingSelectedPaths.includes(path),
    }));
  }, [preview, session.pendingSelectedPaths]);

  const setSection = (activeSection: DeveloperSection) => {
    const next = { ...session, activeSection };
    setSession(next);
    if (workspaceRoot) void writeDeveloperSession(workspaceRoot, next);
  };

  return (
    <div className="developer-workspace">
      <header className="developer-status-strip">
        <span><strong>Workspace:</strong> {workspaceRoot ?? "None"}</span>
        <span><strong>Branch:</strong> {workspaceInfo?.branch || "—"}</span>
        <span><strong>Tree:</strong> {workspaceInfo ? (workspaceInfo.dirty ? "Dirty" : "Clean") : "—"}</span>
        <span><strong>Context:</strong> {session.selectedContextPaths.length} file(s)</span>
        <span><strong>Patch:</strong> {session.pendingPatch ? "Pending approval" : "None"}</span>
        <span><strong>Command:</strong> {commandState?.status ?? "Idle"}</span>
        <span className={providerInfo.isReal ? "provider-real" : "provider-mock"}>
          <strong>Provider:</strong> {providerInfo.label} ({providerInfo.isReal ? "real" : "mock"})
        </span>
      </header>
      <div className="developer-layout">
        <nav className="developer-sidebar" aria-label="Developer Mode sections">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" className={session.activeSection === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <main className="developer-main">
          <p className="developer-status">{status}</p>
          {(session.activeSection === "workspace" || session.activeSection === "files") && (
            <section>
              <h2>{session.activeSection === "workspace" ? "Workspace" : "Files"}</h2>
              <button type="button" className="btn primary" onClick={openWorkspace}>Open existing repository</button>
              {!workspaceRoot && recentWorkspaces.length > 0 && (
                <div className="developer-recents">
                  <h3>Recent repositories</h3>
                  {recentWorkspaces.map((recent) => (
                    <div key={recent.canonicalPath}>
                      <button type="button" onClick={() => void openRecentWorkspace(recent.canonicalPath)}>
                        {recent.repositoryName} — {recent.branch || "detached"} — {recent.dirty ? "dirty" : "clean"}
                      </button>
                      <small>{recent.canonicalPath} · {new Date(recent.lastOpenedAt).toLocaleString()}</small>
                      <button type="button" onClick={() => void removeRecentWorkspace(recent.canonicalPath).then(setRecentWorkspaces)}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
              {workspaceInfo && (
                <>
                  <dl>
                    <dt>Canonical path</dt><dd>{workspaceInfo.canonicalPath}</dd>
                    <dt>Repository</dt><dd>{workspaceInfo.repositoryName}</dd>
                    <dt>Git branch</dt><dd>{workspaceInfo.branch || "(detached or unavailable)"}</dd>
                    <dt>HEAD</dt><dd><code>{workspaceInfo.head}</code></dd>
                    <dt>Working tree</dt><dd>{workspaceInfo.dirty ? "Dirty" : "Clean"}</dd>
                  </dl>
                  <aside className="developer-profile" aria-label="Workspace profile">
                    <h3>Workspace profile</h3>
                    <p><strong>Project type:</strong> {workspaceInfo.profile.projectType}</p>
                    <p><strong>Project name:</strong> {workspaceInfo.profile.projectName ?? "Unavailable"}</p>
                    <p><strong>Flutter SDK:</strong> {workspaceInfo.profile.flutterSdkAvailable ? "Available" : "Unavailable"}</p>
                    <p><strong>Dart SDK:</strong> {workspaceInfo.profile.dartSdkAvailable ? "Available" : "Unavailable"}</p>
                    <ul>{workspaceInfo.profile.suggestedCommands.map((suggestion) => (
                      <li key={suggestion.command}><code>{suggestion.command}</code> — {suggestion.permitted ? "permitted" : "blocked"}</li>
                    ))}</ul>
                    <p>Suggested commands never run automatically.</p>
                  </aside>
                </>
              )}
              <div className="developer-file-grid">
                <FileTree nodes={tree} selected={session.selectedContextPaths} onOpen={openFile} onToggleContext={toggleContext} />
                <article>
                  <h3>{session.openFilePath ?? "Select a text file"}</h3>
                  <Editor
                    height="55vh"
                    language={editorLanguage(session.openFilePath)}
                    value={openContent}
                    onMount={onEditorMount}
                    onChange={(value) => {
                      const content = value ?? "";
                      setOpenContent(content);
                      if (session.openFilePath) {
                        const next = {
                          ...session,
                          editorDrafts: { ...session.editorDrafts, [session.openFilePath]: content },
                        };
                        setSession(next);
                        if (workspaceRoot) void writeDeveloperSession(workspaceRoot, next);
                      }
                    }}
                    options={{ readOnly: editorReadOnly, minimap: { enabled: true }, automaticLayout: true }}
                  />
                  <button
                    type="button"
                    disabled={editorReadOnly || !session.openFilePath}
                    onClick={() => void saveEditorDraft()}
                  >
                    Review and save file…
                  </button>
                  {editorReadOnly && <p>Read-only: unsupported type or file exceeds 2 MiB.</p>}
                </article>
              </div>
              <div className="developer-search">
                <select value={searchMode} onChange={(event) => setSearchMode(event.target.value as "filename" | "text")}>
                  <option value="filename">Filename</option>
                  <option value="text">Text</option>
                </select>
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search repository" />
                <button type="button" onClick={runSearch}>Search</button>
              </div>
              <ul>{searchResults.map((item, index) => <li key={`${item.path}-${item.line ?? 0}-${index}`}><button type="button" onClick={() => openFile(item.path)}>{item.path}{item.line ? `:${item.line}` : ""}</button> {item.preview}</li>)}</ul>
            </section>
          )}
          {session.activeSection === "assistant" && (
            <section>
              <h2>AI Assistant</h2>
              <div className="developer-actions" role="group" aria-label="Developer agent mode">
                {(["ask", "agent", "auto"] as DeveloperAgentMode[]).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    aria-pressed={agentMode === mode}
                    onClick={() => setAgentMode(mode)}
                  >
                    {mode === "ask" ? "Ask" : mode === "agent" ? "Agent" : "Auto"}
                  </button>
                ))}
              </div>
              <p>
                {agentMode === "ask" && "Read-only repository reasoning. No patches or commands."}
                {agentMode === "agent" && "Plans and proposes a patch; the first write requires your approval."}
                {agentMode === "auto" && "May apply ordinary scoped edits and curated validations. Risky actions still stop for approval."}
              </p>
              <p>Selected files: {session.selectedContextPaths.join(", ") || "None"}</p>
              <ul>{session.selectedRangeContexts.map((range) => (
                <li key={range.path}>{range.path}:{range.startLine}-{range.endLine}</li>
              ))}</ul>
              {!providerInfo.isReal && <div className="developer-warning">Mock provider is active. It cannot generate applyable Developer Mode changes.</div>}
              <textarea rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask about the repository or describe a development task." />
              <div className="developer-actions">
                <button type="button" disabled={!providerInfo.isReal || !workspaceRoot || agentBusy} onClick={() => void runAgent()}>
                  {agentBusy ? "Working…" : `Run ${agentMode === "ask" ? "Ask" : agentMode === "agent" ? "Agent" : "Auto"}`}
                </button>
                <button type="button" disabled={!agentRun || agentRun.status === "completed"} onClick={() => void stopAgent()}>Stop</button>
                <button type="button" onClick={() => { setAgentRun(null); setPrompt(""); }}>New task</button>
              </div>
              {agentRun && (
                <article className="developer-agent-run">
                  <h3>{agentRun.mode.toUpperCase()} · {agentRun.status}</h3>
                  <p>Risk: {agentRun.risk} · Limits: {agentRun.maxFiles} files / {agentRun.maxChangedLines} changed lines</p>
                  {agentRun.approvalReason && <div className="developer-warning">{agentRun.approvalReason}</div>}
                  {agentRun.plan.length > 0 && <ol>{agentRun.plan.map((step) => <li key={step}>{step}</li>)}</ol>}
                  {agentRun.response && <pre className="developer-agent-response">{agentRun.response}</pre>}
                  {agentRun.pendingPatch && <pre className="developer-diff">{agentRun.pendingPatch}</pre>}
                  <div className="developer-actions">
                    <button type="button" disabled={agentRun.status !== "awaitingApproval" || agentBusy} onClick={() => void approveAgent()}>Approve first write…</button>
                    <button type="button" disabled={agentRun.status !== "awaitingApproval" || agentBusy} onClick={() => void rejectAgent()}>Reject write</button>
                    <button type="button" disabled={!agentRun.changedFiles.length} onClick={() => void revertAgent()}>Revert full task…</button>
                  </div>
                  <h4>Activity</h4>
                  <ul>{agentRun.audit.map((entry, index) => <li key={`${entry.timestamp}-${index}`}><strong>{entry.status}</strong> {entry.message}</li>)}</ul>
                  {agentRun.validationResults.map((result) => (
                    <details key={result.command}><summary>{result.status}: {result.command}</summary><pre>{result.output}</pre></details>
                  ))}
                </article>
              )}
              <hr />
              <p>Manual patch-only workflow</p>
              <button type="button" disabled={!providerInfo.isReal || !workspaceRoot} onClick={proposePatch}>Generate patch proposal only</button>
            </section>
          )}
          {session.activeSection === "changes" && (
            <section>
              <h2>Changes</h2>
              <div className="developer-change-records">
                {changeRecords.length === 0 ? <p>No backend change records.</p> : (
                  <ul>{changeGroups.map((group) => (
                    <li key={group.filePath}>
                      <strong>{group.filePath}</strong>
                      <ul>{group.records.map((record) => (
                        <li key={record.changeId}>
                          {record.source} · {record.operation} · {record.status}
                          {record.taskId ? ` · task ${record.taskId}` : ""}
                          <ul>{record.hunks.map((hunk) => (
                            <li key={hunk.hunkId}>{hunk.originalRange} → {hunk.replacementRange} · {hunk.status}</li>
                          ))}</ul>
                        </li>
                      ))}</ul>
                    </li>
                  ))}</ul>
                )}
              </div>
              {!session.pendingPatch ? <p>No patch is pending.</p> : (
                <>
                  <p>{session.pendingPatch.explanation}</p>
                  <ul>{changeRows.map((row) => <li key={row.path}><label><input type="checkbox" checked={row.selected} onChange={() => setSession((current) => ({ ...current, pendingSelectedPaths: row.selected ? current.pendingSelectedPaths.filter((path) => path !== row.path) : [...current.pendingSelectedPaths, row.path] }))} /> {row.kind}: {row.path}</label></li>)}</ul>
                  <pre className="developer-diff">{session.pendingPatch.patch}</pre>
                  {patchConflicts.length > 0 && <div className="developer-warning">Conflicts: {patchConflicts.join(", ")}</div>}
                  <h3>Patch hunks</h3>
                  {pendingHunks.map((hunk) => (
                    <label className="developer-hunk" key={hunk.id}>
                      <input
                        type="checkbox"
                        checked={selectedHunkIds.includes(hunk.id)}
                        onChange={() => setSelectedHunkIds((current) =>
                          current.includes(hunk.id)
                            ? current.filter((id) => id !== hunk.id)
                            : [...current, hunk.id]
                        )}
                      />
                      <strong>{hunk.kind}: {hunk.filePath}</strong> {hunk.header}
                      <pre>{hunk.body}</pre>
                    </label>
                  ))}
                  <div className="developer-actions">
                    <button type="button" onClick={() => void applySelectedHunks()}>Apply selected hunks…</button>
                    <button type="button" onClick={() => applyPatch(false)}>Apply all…</button>
                    <button type="button" onClick={() => applyPatch(true)}>Apply selected files…</button>
                    <button type="button" onClick={rejectPatch}>Reject</button>
                    <button type="button" onClick={proposePatch}>Regenerate</button>
                  </div>
                </>
              )}
              <button type="button" disabled={!manualPatchId} onClick={revertLastPatch}>Revert most recent NF patch…</button>
            </section>
          )}
          {(session.activeSection === "terminal" || session.activeSection === "build-tests") && (
            <section>
              <h2>{session.activeSection === "terminal" ? "Terminal" : "Build & Tests"}</h2>
              {session.activeSection === "build-tests" && workspaceInfo?.profile.projectType === "Flutter" && (
                <div className="developer-validation-panel">
                  <h3>Curated Flutter validation</h3>
                  <p>Every action shows its exact command and requires separate approval. Nothing runs after a patch automatically.</p>
                  {workspaceInfo.profile.suggestedCommands.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion.command}
                      disabled={!suggestion.permitted || commandState?.status === "running"}
                      onClick={() => void executeExactCommand(
                        suggestion.command,
                        suggestion.label,
                        suggestion.command.includes("pub get")
                          ? "May update repository dependency metadata or generated package state."
                          : "Validation may consume time and produce bounded output."
                      )}
                    >
                      {suggestion.label} — {suggestion.command}
                    </button>
                  ))}
                </div>
              )}
              {session.activeSection === "terminal" && (
                <>
                  <label>Exact approved command<input value={command} onChange={(event) => setCommand(event.target.value)} /></label>
                  <label>Purpose<input value={commandPurpose} onChange={(event) => setCommandPurpose(event.target.value)} /></label>
                  <label>Risk<input value={commandRisk} onChange={(event) => setCommandRisk(event.target.value)} /></label>
                </>
              )}
              <p>CWD: {workspaceRoot ?? "No workspace"}</p>
              {session.activeSection === "terminal" && <button type="button" disabled={!workspaceRoot || commandState?.status === "running"} onClick={executeCommand}>Review and approve command…</button>}
              <button type="button" disabled={commandState?.status !== "running"} onClick={() => commandState && cancelDeveloperCommand(commandState.runId)}>Cancel</button>
              {commandState && <pre className="developer-terminal">{`Command: ${commandState.command}\nCWD: ${commandState.cwd}\nPurpose: ${commandState.purpose}\nRisk: ${commandState.risk}\nStatus: ${commandState.status}\nStarted: ${commandState.startedAt ?? "—"}\nCompleted: ${commandState.completedAt ?? "—"}\nDuration: ${commandState.durationMs === undefined ? "—" : `${commandState.durationMs} ms`}\nExit: ${commandState.exitCode ?? "—"}\nTruncated: ${commandState.truncated ? "yes" : "no"}\n\n${commandState.output}`}</pre>}
            </section>
          )}
          {session.activeSection === "git" && (
            <section>
              <h2>Git</h2>
              <button type="button" disabled={!workspaceRoot} onClick={() => workspaceRoot && refreshWorkspace(workspaceRoot)}>Refresh Git status</button>
              <h3>Status</h3><pre>{workspaceInfo?.status || "(not available)"}</pre>
              <h3>Diff</h3><pre className="developer-diff">{workspaceInfo?.diff || "(no diff)"}</pre>
              <p>Developer Mode does not commit or push automatically.</p>
            </section>
          )}
          {session.activeSection === "memory" && (
            <section>
              <h2>Project Memory</h2>
              <p>Developer session and drafts are stored separately in Tauri application data.</p>
              <pre>{JSON.stringify(session, null, 2)}</pre>
              <div className="developer-friction-log">
                <h3>Dogfooding friction log</h3>
                <p>Stores metadata only in NF application data. Do not enter code, file contents, command output, credentials, or secrets.</p>
                <select value={frictionArea} onChange={(event) => setFrictionArea(event.target.value as FrictionEntry["area"])}>
                  {["Workspace", "File browser", "Editor", "AI context", "Provider", "Patch review", "Commands", "Tests", "Session persistence", "Performance", "Other"].map((area) => <option key={area}>{area}</option>)}
                </select>
                <select value={frictionSeverity} onChange={(event) => setFrictionSeverity(event.target.value as FrictionEntry["severity"])}>
                  {["Minor", "Moderate", "Blocking"].map((severity) => <option key={severity}>{severity}</option>)}
                </select>
                <input maxLength={500} value={frictionDescription} onChange={(event) => setFrictionDescription(event.target.value)} placeholder="Short description (metadata only)" />
                <textarea maxLength={2000} value={frictionNotes} onChange={(event) => setFrictionNotes(event.target.value)} placeholder="Optional notes (no code, output, or secrets)" />
                <button type="button" disabled={!workspaceInfo || !frictionDescription.trim()} onClick={() => void recordFriction()}>Record friction point</button>
                {frictionEntries.map((entry) => (
                  <article key={entry.id}>
                    <strong>{entry.severity}: {entry.area}</strong> — {entry.status}
                    <p>{entry.description}</p>
                    <textarea
                      maxLength={2000}
                      value={entry.notes ?? ""}
                      aria-label={`Notes for ${entry.description}`}
                      onChange={(event) => setFrictionEntries((current) => current.map((item) =>
                        item.id === entry.id ? { ...item, notes: event.target.value } : item
                      ))}
                    />
                    <button type="button" onClick={() => void saveFrictionEntry(entry).then(setFrictionEntries)}>Save notes</button>
                    <button type="button" disabled={entry.status === "Resolved"} onClick={() => void saveFrictionEntry({ ...entry, status: "Resolved" }).then(setFrictionEntries)}>Mark resolved</button>
                    <button type="button" onClick={() => {
                      if (window.confirm("Remove this friction-log entry? This does not delete repository files.")) {
                        void removeFrictionEntry(entry.id).then(setFrictionEntries);
                      }
                    }}>Remove…</button>
                  </article>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
