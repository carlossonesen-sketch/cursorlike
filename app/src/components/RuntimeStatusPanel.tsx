import { useState, useEffect, useCallback } from "react";
import {
  startLocalModel,
  detectRuntimeStatus,
  ensureLogDir,
  type StartLocalModelStatus,
} from "../core/runtime/runtimeConfig";
import { runtimeStatus } from "../core/runtime/runtimeApi";

type ServerStatus = "—" | "starting" | "running" | "error";
type PanelSize = "small" | "medium" | "large";

interface RuntimeStatusPanelProps {
  workspaceRoot: string | null;
}

function CopyablePath({ label, path }: { label: string; path: string }) {
  if (!path) return null;
  return (
    <div className="runtime-status-row runtime-status-path">
      <span className="runtime-status-label">{label}</span>
      <code className="runtime-status-path-value" title={path}>{path}</code>
    </div>
  );
}

export function RuntimeStatusPanel({ workspaceRoot }: RuntimeStatusPanelProps) {
  const [minimized, setMinimized] = useState(false);
  const [size, setSize] = useState<PanelSize>("medium");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [runtimeFound, setRuntimeFound] = useState(false);
  const [modelFound, setModelFound] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("—");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [paths, setPaths] = useState<{
    workspaceRoot: string;
    toolRoot: string | null;
    logFilePath: string;
    runtimeConfigPath: string;
  }>({ workspaceRoot: "", toolRoot: null, logFilePath: "", runtimeConfigPath: "" });
  const [createLogDirResult, setCreateLogDirResult] = useState<string | null>(null);

  const detect = useCallback(async () => {
    if (!workspaceRoot) {
      setRuntimeFound(false);
      setModelFound(false);
      setPaths({ workspaceRoot: "", toolRoot: null, logFilePath: "", runtimeConfigPath: "" });
      return;
    }
    try {
      const r = await detectRuntimeStatus(workspaceRoot);
      setRuntimeFound(r.runtimeFound);
      setModelFound(r.modelFound);
      setPaths({
        workspaceRoot: r.workspaceRoot,
        toolRoot: r.toolRoot,
        logFilePath: r.logFilePath,
        runtimeConfigPath: r.runtimeConfigPath,
      });
    } catch {
      setRuntimeFound(false);
      setModelFound(false);
      setPaths({ workspaceRoot: "", toolRoot: null, logFilePath: "", runtimeConfigPath: "" });
    }
  }, [workspaceRoot]);

  useEffect(() => {
    detect();
  }, [detect]);

  const refreshRunning = useCallback(async () => {
    if (!workspaceRoot) return;
    try {
      const s = await runtimeStatus();
      if (s.running && s.port != null) setServerStatus("running");
    } catch {
      /* ignore */
    }
  }, [workspaceRoot]);

  useEffect(() => {
    if (serverStatus !== "running") return;
    const t = setInterval(refreshRunning, 3000);
    return () => clearInterval(t);
  }, [serverStatus, refreshRunning]);

  const handleStart = useCallback(async () => {
    if (!workspaceRoot) return;
    setLastError(null);
    setLastResult(null);
    setServerStatus("starting");
    try {
      const result = await startLocalModel(workspaceRoot);
      const s = result.status as StartLocalModelStatus;
      const details = result.details ?? "";
      setLastResult(`${s}${details ? ` | ${details}` : ""}`);
      if (s === "started" || s === "already_running") {
        setServerStatus("running");
        setRuntimeFound(true);
        setModelFound(true);
      } else if (s === "missing_runtime") {
        setRuntimeFound(false);
        setServerStatus("—");
        setLastError(result.details ?? "Runtime missing.");
      } else if (s === "missing_model") {
        setModelFound(false);
        setServerStatus("—");
        setLastError(result.details ?? "Model missing.");
      } else {
        setServerStatus("error");
        setLastError(result.details ?? "Unknown error.");
      }
    } catch (e) {
      setServerStatus("error");
      setLastError(String(e));
      setLastResult(`error | ${String(e)}`);
    } finally {
      await detect();
    }
  }, [workspaceRoot, detect]);

  const logRoot = paths.toolRoot ?? paths.workspaceRoot;

  const handleCreateLogDir = useCallback(async () => {
    if (!logRoot) {
      setCreateLogDirResult("No log root (open workspace, then Refresh).");
      return;
    }
    setCreateLogDirResult(null);
    const result = await ensureLogDir(logRoot);
    if (result.ok) {
      setCreateLogDirResult(`OK: ${result.logFilePath}`);
      await detect();
    } else {
      setCreateLogDirResult(`Error: ${result.error} workspaceRoot=${result.workspaceRoot}`);
    }
  }, [logRoot, detect]);

  return (
    <div className={`runtime-status-panel runtime-status-size-${size}`}>
      <div className="runtime-status-header">
        <span className="runtime-status-title">Runtime Status</span>
        <div className="runtime-status-header-actions">
          <button
            type="button"
            className="btn-link runtime-status-minimize"
            onClick={() => setMinimized((m) => !m)}
            aria-expanded={!minimized}
          >
            {minimized ? "Expand" : "Minimize"}
          </button>
          <span className="runtime-status-size-buttons">
            <button
              type="button"
              className={size === "small" ? "btn secondary active" : "btn secondary"}
              onClick={() => setSize("small")}
            >
              S
            </button>
            <button
              type="button"
              className={size === "medium" ? "btn secondary active" : "btn secondary"}
              onClick={() => setSize("medium")}
            >
              M
            </button>
            <button
              type="button"
              className={size === "large" ? "btn secondary active" : "btn secondary"}
              onClick={() => setSize("large")}
            >
              L
            </button>
          </span>
        </div>
      </div>
      {!minimized && (
        <div className="runtime-status-body">
          <div className="runtime-status-rows">
            <div className="runtime-status-row">
              <span className="runtime-status-label">Runtime</span>
              <span className="runtime-status-value">{runtimeFound ? "found" : "missing"}</span>
            </div>
            <div className="runtime-status-row">
              <span className="runtime-status-label">Model</span>
              <span className="runtime-status-value">{modelFound ? "found" : "missing"}</span>
            </div>
            <div className="runtime-status-row">
              <span className="runtime-status-label">Server</span>
              <span className="runtime-status-value">{serverStatus}</span>
            </div>
          </div>
          {(lastError || lastResult != null || createLogDirResult != null) && (
            <div className="runtime-status-extra">
              {lastError && (
                <div className="runtime-status-row runtime-status-error">
                  <span className="runtime-status-label">Last error</span>
                  <span className="runtime-status-value">{lastError}</span>
                </div>
              )}
              {lastResult != null && (
                <div className="runtime-status-row">
                  <span className="runtime-status-label">Last result</span>
                  <span className="runtime-status-value">{lastResult}</span>
                </div>
              )}
              {createLogDirResult != null && (
                <div className="runtime-status-row runtime-status-create-log-result">
                  <span className="runtime-status-value">{createLogDirResult}</span>
                </div>
              )}
            </div>
          )}
          <div className="runtime-status-actions">
            <button
              type="button"
              className="btn secondary"
              disabled={!workspaceRoot || serverStatus === "starting"}
              onClick={handleStart}
            >
              Start
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={!workspaceRoot}
              onClick={detect}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={!logRoot}
              onClick={handleCreateLogDir}
            >
              Create log dir
            </button>
          </div>
          <div className="runtime-status-details">
            <button
              type="button"
              className="btn-link runtime-status-details-toggle"
              onClick={() => setDetailsExpanded((d) => !d)}
              aria-expanded={detailsExpanded}
            >
              {detailsExpanded ? "Hide Details" : "Details ▸"}
            </button>
            {detailsExpanded && (
              <div className="runtime-status-paths">
                <CopyablePath label="workspaceRoot" path={paths.workspaceRoot} />
                <CopyablePath label="toolRoot" path={paths.toolRoot ?? ""} />
                <CopyablePath label="logFilePath" path={paths.logFilePath} />
                <CopyablePath label="runtimeConfigPath" path={paths.runtimeConfigPath} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
