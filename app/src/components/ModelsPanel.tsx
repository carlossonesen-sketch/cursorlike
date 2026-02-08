/**
 * Settings > Models: role dropdowns, Auto-pick, health indicator, Download recommended.
 * Does not scan C:\ — only allowed model dirs from backend.
 */

import { useState, useEffect, useCallback } from "react";
import type { ModelRolePaths } from "../core/types";
import type { DiscoveredModelEntry, ModelMetadata } from "../core/models/modelRegistry";
import {
  discoverModels,
  getGlobalModelsDir,
  downloadModelFile,
  parseModelMetadata,
  pickRecommended,
} from "../core/models/modelRegistry";
import {
  RECOMMENDED_MODELS,
  MANUAL_STEPS,
  type RecommendedModelSpec,
} from "../core/models/recommendedModels";

type DownloadStatus = "idle" | "downloading" | "done" | "failed";

const ROLES: { key: keyof ModelRolePaths; label: string }[] = [
  { key: "coder", label: "Coder" },
  { key: "general", label: "General" },
  { key: "reviewer", label: "Reviewer" },
  { key: "embeddings", label: "Embeddings" },
  { key: "reranker", label: "Reranker" },
];

interface ModelsPanelProps {
  workspaceRoot: string | null;
  modelRoles: ModelRolePaths | undefined;
  onModelRolesChange: (roles: ModelRolePaths) => void;
}

export function ModelsPanel({
  workspaceRoot,
  modelRoles,
  onModelRolesChange,
}: ModelsPanelProps) {
  const [entries, setEntries] = useState<DiscoveredModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalModelsDir, setGlobalModelsDir] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<Record<string, DownloadStatus>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    getGlobalModelsDir().then(setGlobalModelsDir).catch(() => setGlobalModelsDir(null));
  }, []);

  const refresh = useCallback(async () => {
    if (!workspaceRoot) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const list = await discoverModels(workspaceRoot);
      setEntries(list);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const metadataMap = new Map<string, ModelMetadata>();
  entries.forEach((e) => metadataMap.set(e.absolute_path, parseModelMetadata(e.display_path)));

  const handleRoleChange = (role: keyof ModelRolePaths, value: string) => {
    const next = { ...modelRoles, [role]: value || undefined };
    onModelRolesChange(next);
  };

  const handleAutoPick = () => {
    const { coder, general, reviewer } = pickRecommended(entries, metadataMap);
    onModelRolesChange({
      ...modelRoles,
      coder: coder ?? modelRoles?.coder,
      general: general ?? modelRoles?.general,
      reviewer: reviewer ?? modelRoles?.reviewer,
    });
  };

  const currentCoder = modelRoles?.coder ?? "";
  const currentGeneral = modelRoles?.general ?? "";
  const healthCoder = currentCoder && entries.some((e) => e.absolute_path === currentCoder);
  const healthGeneral = currentGeneral && entries.some((e) => e.absolute_path === currentGeneral);

  const startDownload = useCallback(
    async (model: RecommendedModelSpec) => {
      if (!globalModelsDir) {
        setDownloadError("Global models dir not available.");
        return;
      }
      const destPath = `${globalModelsDir.replace(/\/+$/, "")}/${model.filename}`;
      setDownloadStatus((s) => ({ ...s, [model.filename]: "downloading" }));
      setDownloadError(null);
      try {
        await downloadModelFile(model.url, destPath);
        setDownloadStatus((s) => ({ ...s, [model.filename]: "done" }));
        if (workspaceRoot) await refresh();
      } catch (e) {
        const msg = String(e);
        setDownloadStatus((s) => ({ ...s, [model.filename]: "failed" }));
        setDownloadError(`${MANUAL_STEPS}\n\nTarget folder: ${globalModelsDir}\n\nError: ${msg}`);
      }
    },
    [globalModelsDir, workspaceRoot, refresh]
  );

  const downloadAll = useCallback(async () => {
    for (const model of RECOMMENDED_MODELS) {
      await startDownload(model);
    }
  }, [startDownload]);

  return (
    <div className="models-panel">
      <div className="models-panel-header">
        <span className="models-panel-title">Models</span>
        <button type="button" className="btn secondary" disabled={!workspaceRoot || loading} onClick={refresh}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {!workspaceRoot ? (
        <p className="models-panel-muted">Open a workspace to discover models.</p>
      ) : (
        <>
          <div className="models-panel-actions">
            <button type="button" className="btn secondary" disabled={entries.length === 0} onClick={handleAutoPick}>
              Auto-pick recommended
            </button>
          </div>
          <div className="models-panel-health">
            {currentCoder && !healthCoder && (
              <span className="models-panel-warning">Coder model path missing; use first available or reselect.</span>
            )}
            {currentGeneral && !healthGeneral && (
              <span className="models-panel-warning">General model path missing; use first available or reselect.</span>
            )}
          </div>
          {ROLES.map(({ key, label }) => (
            <div key={key} className="models-panel-row">
              <label className="models-panel-label">{label}</label>
              <select
                className="models-panel-select"
                value={modelRoles?.[key] ?? ""}
                onChange={(e) => handleRoleChange(key, e.target.value)}
              >
                <option value="">—</option>
                {entries.map((e) => (
                  <option key={e.absolute_path} value={e.absolute_path}>
                    {e.display_path} ({e.source})
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="models-panel-downloads">
            <div className="models-panel-downloads-header">
              <span className="models-panel-title">Recommended models</span>
              <button
                type="button"
                className="btn secondary"
                disabled={!globalModelsDir || RECOMMENDED_MODELS.some((m) => downloadStatus[m.filename] === "downloading")}
                onClick={downloadAll}
              >
                Download all
              </button>
            </div>
            {RECOMMENDED_MODELS.map((model) => {
              const status = downloadStatus[model.filename] ?? "idle";
              return (
                <div key={model.filename} className="models-panel-download-row">
                  <span className="models-panel-download-label">{model.label}</span>
                  <span className="models-panel-download-filename">{model.filename}</span>
                  <span className={`models-panel-download-status status-${status}`}>
                    {status === "idle" && "—"}
                    {status === "downloading" && "Downloading…"}
                    {status === "done" && "Done"}
                    {status === "failed" && "Failed"}
                  </span>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={!globalModelsDir || status === "downloading"}
                    onClick={() => startDownload(model)}
                  >
                    Download
                  </button>
                </div>
              );
            })}
            {downloadError && (
              <div className="models-panel-download-error">
                <pre>{downloadError}</pre>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
