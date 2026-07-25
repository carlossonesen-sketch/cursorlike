import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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
} from "../core/developer/developerServices";
import {
  readDeveloperSession,
  writeDeveloperSession,
} from "../core/developer/developerSessionStore";

const developerWorkspace = new WorkspaceService();
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

export function DeveloperWorkspace() {
  const [session, setSession] = useState<DeveloperSessionState>(() => createDeveloperSessionState());
  const [workspaceInfo, setWorkspaceInfo] = useState<DeveloperWorkspaceInfo | null>(null);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [openContent, setOpenContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"filename" | "text">("filename");
  const [searchResults, setSearchResults] = useState<RepositorySearchMatch[]>([]);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<Map<string, { old: string; new: string }> | null>(null);
  const [command, setCommand] = useState("git status --short --branch");
  const [commandPurpose, setCommandPurpose] = useState("Inspect the current repository state.");
  const [commandRisk, setCommandRisk] = useState("Read-only repository inspection.");
  const [commandState, setCommandState] = useState<DeveloperCommandState | null>(null);
  const [status, setStatus] = useState("Open an existing repository to begin.");
  const [providerInfo, setProviderInfo] = useState<ModelProviderInfo>(() => getModelProviderInfo());
  const workspaceRoot = session.workspacePath;

  const persist = useCallback(async (next: DeveloperSessionState) => {
    setSession(next);
    if (next.workspacePath) await writeDeveloperSession(next.workspacePath, next);
  }, []);

  const refreshWorkspace = useCallback(async (root: string) => {
    const info = await inspectDeveloperWorkspace(root);
    await developerWorkspace.setWorkspaceRoot(info.canonicalPath);
    setWorkspaceInfo(info);
    setTree(await developerWorkspace.readFileTree());
  }, []);

  const openWorkspace = useCallback(async () => {
    const selected = await developerWorkspace.openWorkspace();
    if (!selected) return;
    const info = await inspectDeveloperWorkspace(selected);
    await developerWorkspace.setWorkspaceRoot(info.canonicalPath);
    const stored = await readDeveloperSession(info.canonicalPath);
    const next = isolateDeveloperSession(stored, info.canonicalPath);
    const settings = await readWorkspaceSettings(info.canonicalPath);
    if (settings.provider === "openai") {
      const provider = new OpenAIModelProvider(settings.openaiModel);
      const providerState: ModelProviderInfo = {
        kind: "openai",
        label: `OpenAI (${settings.openaiModel ?? "configured model"})`,
        isReal: true,
        available: true,
        reason: "Credentials are checked only by the Rust backend when a request is submitted.",
      };
      setModelProvider(provider, providerState);
      setProviderInfo(providerState);
    } else {
      const toolRoot = await findToolRoot(info.canonicalPath);
      const configuredPath = settings.modelRoles?.coder ?? settings.modelPath;
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
    }
    setSession(next);
    setWorkspaceInfo(info);
    setTree(await developerWorkspace.readFileTree());
    setStatus(`Opened canonical workspace: ${info.canonicalPath}`);
  }, []);

  const openFile = useCallback(async (path: string) => {
    if (!workspaceRoot) return;
    try {
      const content = await developerWorkspace.readFile(path);
      setOpenContent(content);
      await persist({ ...session, openFilePath: path });
    } catch (error) {
      setStatus(`Could not open text file: ${String(error)}`);
    }
  }, [persist, session, workspaceRoot]);

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
    setPreview(null);
    await persist({ ...session, pendingPatch: null, pendingSelectedPaths: [] });
    setStatus("Patch rejected. No files were changed.");
  }, [persist, session]);

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
      const engine = new PatchEngine(workspaceRoot, (path) => developerWorkspace.readFile(path));
      const result = await engine.apply(patch);
      if (result.failed.length) throw new Error(result.failed.map((item) => `${item.path}: ${item.error}`).join("\n"));
      setPreview(null);
      await persist({
        ...session,
        pendingPatch: null,
        pendingSelectedPaths: [],
        lastAppliedSnapshots: result.beforeSnapshots,
      });
      await refreshWorkspace(workspaceRoot);
      setStatus(`Applied ${result.applied.length} explicitly approved file change(s).`);
    } catch (error) {
      setStatus(String(error));
    }
  }, [persist, refreshWorkspace, session, workspaceRoot]);

  const revertLastPatch = useCallback(async () => {
    if (!workspaceRoot || !session.lastAppliedSnapshots.length) return;
    if (!window.confirm("Revert the most recent NF-applied Developer Mode patch?")) return;
    const engine = new PatchEngine(workspaceRoot, (path) => developerWorkspace.readFile(path));
    const result = await engine.revert(session.lastAppliedSnapshots);
    if (result.failed.length) {
      setStatus(result.failed.map((item) => `${item.path}: ${item.error}`).join("\n"));
      return;
    }
    await persist({ ...session, lastAppliedSnapshots: [] });
    await refreshWorkspace(workspaceRoot);
    setStatus("Most recent NF-applied patch reverted.");
  }, [persist, refreshWorkspace, session, workspaceRoot]);

  const executeCommand = useCallback(async () => {
    if (!workspaceRoot) return;
    const approved = window.confirm(
      `Approve this exact command?\n\nCommand: ${command}\nCWD: ${workspaceRoot}\nPurpose: ${commandPurpose}\nRisk: ${commandRisk}`
    );
    try {
      assertDeveloperCommandApproval(approved, command);
      const runId = `developer-${Date.now()}`;
      setCommandState({
        runId,
        command,
        cwd: workspaceRoot,
        purpose: commandPurpose,
        risk: commandRisk,
        status: "running",
        output: "",
      });
      const result = await runDeveloperCommand({
        runId,
        workspaceRoot,
        command,
        purpose: commandPurpose,
        risk: commandRisk,
        timeoutMs: 120_000,
        approved: true,
      });
      setCommandState((current) => current ? {
        ...current,
        status: result.cancelled ? "cancelled" : result.timedOut ? "timedOut" : result.exitCode === 0 ? "passed" : "failed",
        output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`,
        exitCode: result.exitCode,
        truncated: result.truncated,
      } : current);
      await refreshWorkspace(workspaceRoot);
    } catch (error) {
      setStatus(`Command blocked or failed: ${String(error)}`);
    }
  }, [command, commandPurpose, commandRisk, refreshWorkspace, workspaceRoot]);

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
              {workspaceInfo && (
                <dl>
                  <dt>Canonical path</dt><dd>{workspaceInfo.canonicalPath}</dd>
                  <dt>Git branch</dt><dd>{workspaceInfo.branch || "(detached or unavailable)"}</dd>
                  <dt>Working tree</dt><dd>{workspaceInfo.dirty ? "Dirty" : "Clean"}</dd>
                </dl>
              )}
              <div className="developer-file-grid">
                <FileTree nodes={tree} selected={session.selectedContextPaths} onOpen={openFile} onToggleContext={toggleContext} />
                <article>
                  <h3>{session.openFilePath ?? "Select a text file"}</h3>
                  <pre className="developer-code">{openContent}</pre>
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
              <p>Selected context: {session.selectedContextPaths.join(", ") || "None"}</p>
              {!providerInfo.isReal && <div className="developer-warning">Mock provider is active. It cannot generate applyable Developer Mode changes.</div>}
              <textarea rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe one manual change. NF will return a patch proposal only." />
              <button type="button" disabled={!providerInfo.isReal || !workspaceRoot} onClick={proposePatch}>Generate patch proposal</button>
            </section>
          )}
          {session.activeSection === "changes" && (
            <section>
              <h2>Changes</h2>
              {!session.pendingPatch ? <p>No patch is pending.</p> : (
                <>
                  <p>{session.pendingPatch.explanation}</p>
                  <ul>{changeRows.map((row) => <li key={row.path}><label><input type="checkbox" checked={row.selected} onChange={() => setSession((current) => ({ ...current, pendingSelectedPaths: row.selected ? current.pendingSelectedPaths.filter((path) => path !== row.path) : [...current.pendingSelectedPaths, row.path] }))} /> {row.kind}: {row.path}</label></li>)}</ul>
                  <pre className="developer-diff">{session.pendingPatch.patch}</pre>
                  <div className="developer-actions">
                    <button type="button" onClick={() => applyPatch(false)}>Apply all…</button>
                    <button type="button" onClick={() => applyPatch(true)}>Apply selected files…</button>
                    <button type="button" onClick={rejectPatch}>Reject</button>
                    <button type="button" onClick={proposePatch}>Regenerate</button>
                  </div>
                </>
              )}
              <button type="button" disabled={!session.lastAppliedSnapshots.length} onClick={revertLastPatch}>Revert most recent NF patch…</button>
            </section>
          )}
          {(session.activeSection === "terminal" || session.activeSection === "build-tests") && (
            <section>
              <h2>{session.activeSection === "terminal" ? "Terminal" : "Build & Tests"}</h2>
              <label>Exact command<input value={command} onChange={(event) => setCommand(event.target.value)} /></label>
              <label>Purpose<input value={commandPurpose} onChange={(event) => setCommandPurpose(event.target.value)} /></label>
              <label>Risk<input value={commandRisk} onChange={(event) => setCommandRisk(event.target.value)} /></label>
              <p>CWD: {workspaceRoot ?? "No workspace"}</p>
              <button type="button" disabled={!workspaceRoot || commandState?.status === "running"} onClick={executeCommand}>Review and approve command…</button>
              <button type="button" disabled={commandState?.status !== "running"} onClick={() => commandState && cancelDeveloperCommand(commandState.runId)}>Cancel</button>
              {commandState && <pre className="developer-terminal">{`Status: ${commandState.status}\nExit: ${commandState.exitCode ?? "—"}\nTruncated: ${commandState.truncated ? "yes" : "no"}\n\n${commandState.output}`}</pre>}
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
              <p>Developer state is stored separately in <code>.devassistant/developer-session.json</code>.</p>
              <pre>{JSON.stringify(session, null, 2)}</pre>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
