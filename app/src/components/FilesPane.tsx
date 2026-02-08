import { useState, useCallback, useEffect } from "react";
import { diffLines } from "diff";
import type { FileTreeNode } from "../core/types";
import type { SessionRecord } from "../core/types";
import type { FileEditState } from "../App";
import { SessionsPanel } from "./SessionsPanel";

interface FilesPaneProps {
  fileTree: FileTreeNode[];
  selectedPaths: string[];
  onSelectPathsChange: (paths: string[]) => void;
  onPickFiles: () => void;
  onRunChecks?: () => void;
  sessions: SessionRecord[];
  workspaceRoot: string | null;
  applyInProgress: boolean;
  onViewSession: (s: SessionRecord) => void;
  onApplySession: (s: SessionRecord) => void;
  onRevertSession: (s: SessionRecord) => void;
  /** When View Diff clicked: show diff panel. */
  showDiffPanel: boolean;
  patch: string | null;
  previewMap: Map<string, { old: string; new: string }> | null;
  selectedDiffPath: string | null;
  onSelectDiffPath: (path: string) => void;
  readFile: (path: string) => Promise<string>;
  fileEditState: FileEditState | null;
  onFileEditChange: (editedText: string) => void;
  onFileEditSave: () => void;
  onSetBaseline: () => void;
  onResetToBaseline: () => void;
}

export function FilesPane({
  fileTree,
  selectedPaths,
  onSelectPathsChange,
  onPickFiles,
  onRunChecks,
  sessions,
  workspaceRoot,
  applyInProgress,
  onViewSession,
  onApplySession,
  onRevertSession,
  showDiffPanel,
  patch,
  previewMap,
  selectedDiffPath,
  onSelectDiffPath,
  readFile,
  fileEditState,
  onFileEditChange,
  onFileEditSave,
  onSetBaseline,
  onResetToBaseline,
}: FilesPaneProps) {
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  const [viewerContent, setViewerContent] = useState<string>("");
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"editor" | "diff">("editor");

  const loadViewer = useCallback(
    async (path: string) => {
      setViewerPath(path);
      setViewerLoading(true);
      try {
        const content = await readFile(path);
        setViewerContent(content);
      } catch {
        setViewerContent("(could not read file)");
      } finally {
        setViewerLoading(false);
      }
    },
    [readFile]
  );

  const toggleFile = (path: string) => {
    const next = selectedPaths.includes(path)
      ? selectedPaths.filter((p) => p !== path)
      : [...selectedPaths, path];
    onSelectPathsChange(next);
  };

  const walk = (nodes: FileTreeNode[], base = "") => {
    const out: React.ReactNode[] = [];
    for (const n of nodes) {
      const path = base ? `${base}/${n.name}` : n.name;
      if (n.isDir) {
        out.push(
          <div key={path} className="tree-folder">
            <span className="tree-label">📁 {n.name}</span>
            <div className="tree-children">{walk(n.children ?? [], path)}</div>
          </div>
        );
      } else {
        const sel = selectedPaths.includes(path);
        out.push(
          <label
            key={path}
            className="tree-file"
            title={path}
          >
            <input
              type="checkbox"
              checked={sel}
              onChange={() => toggleFile(path)}
            />
            <span
              className="tree-label"
              onClick={() => loadViewer(path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && loadViewer(path)}
            >
              📄 {n.name}
            </span>
          </label>
        );
      }
    }
    return out;
  };

  const changedFiles = previewMap ? [...previewMap.keys()] : [];
  const current = selectedDiffPath ?? (changedFiles[0] ?? null);
  const preview = current && previewMap?.get(current);

  const diffPanelVisible = Boolean(showDiffPanel && fileEditState);
  useEffect(() => {
    console.log("DIFF_PANEL_VISIBLE", diffPanelVisible);
  }, [diffPanelVisible]);

  return (
    <div className="files-pane">
      <div className="files-section">
        <div className="files-toolbar">
          <button type="button" className="btn secondary" onClick={onPickFiles}>
            Select files
          </button>
          {onRunChecks && (
            <button type="button" className="btn secondary" onClick={onRunChecks}>
              Run checks
            </button>
          )}
        </div>
        <div className="tree-wrap">
          {fileTree.length === 0 ? (
            <p className="muted">Open a workspace to see files.</p>
          ) : (
            walk(fileTree)
          )}
        </div>
        {selectedPaths.length > 0 && (
          <p className="muted selected-summary">
            Selected: {selectedPaths.length} file(s)
          </p>
        )}
        <SessionsPanel
          sessions={sessions}
          workspaceRoot={workspaceRoot}
          onView={onViewSession}
          onApply={onApplySession}
          onRevert={onRevertSession}
          applyInProgress={applyInProgress}
        />
      </div>
      <div className="viewer-section">
        {showDiffPanel && fileEditState && (
          <div className="diff-panel file-edit-panel">
            <div className="file-edit-header">
              <h4>File: {fileEditState.relativePath}</h4>
              <div className="file-edit-toggle">
                <button
                  type="button"
                  className={viewMode === "editor" ? "active" : ""}
                  onClick={() => setViewMode("editor")}
                >
                  Editor
                </button>
                <button
                  type="button"
                  className={viewMode === "diff" ? "active" : ""}
                  onClick={() => setViewMode("diff")}
                >
                  Diff
                </button>
              </div>
            </div>
            {viewMode === "editor" && (
              <div className="file-edit-rows">
                <div className="file-edit-col">
                  <strong>Baseline (read-only)</strong>
                  <pre className="file-edit-original">{fileEditState.baselineText || "(empty)"}</pre>
                </div>
                <div className="file-edit-col">
                  <strong>Edited</strong>
                  <textarea
                    className="file-edit-textarea"
                    value={fileEditState.editedText}
                    onChange={(e) => onFileEditChange(e.target.value)}
                    spellCheck={false}
                  />
                </div>
              </div>
            )}
            {viewMode === "diff" && (
              <div className="file-edit-diff-view">
                {(() => {
                  const changes = diffLines(fileEditState.baselineText, fileEditState.editedText);
                  const hasChanges = changes.some((c: { added?: boolean; removed?: boolean }) => c.added || c.removed);
                  if (!hasChanges) {
                    return <p className="muted">No changes yet.</p>;
                  }
                  
                  interface DiffRow {
                    leftLine: string | null;
                    rightLine: string | null;
                    leftCls: string;
                    rightCls: string;
                  }
                  
                  const rows: DiffRow[] = [];
                  for (const change of changes) {
                    const lines = change.value.split(/\r?\n/);
                    if (lines[lines.length - 1] === "") lines.pop();
                    
                    if (change.removed) {
                      for (const line of lines) {
                        rows.push({
                          leftLine: line,
                          rightLine: null,
                          leftCls: "diff-cell-removed",
                          rightCls: "diff-cell-empty",
                        });
                      }
                    } else if (change.added) {
                      for (const line of lines) {
                        rows.push({
                          leftLine: null,
                          rightLine: line,
                          leftCls: "diff-cell-empty",
                          rightCls: "diff-cell-added",
                        });
                      }
                    } else {
                      for (const line of lines) {
                        rows.push({
                          leftLine: line,
                          rightLine: line,
                          leftCls: "diff-cell-context",
                          rightCls: "diff-cell-context",
                        });
                      }
                    }
                  }
                  
                  return (
                    <div className="diff-table">
                      <div className="diff-table-header">
                        <div className="diff-table-col">Baseline</div>
                        <div className="diff-table-col">Edited</div>
                      </div>
                      <div className="diff-table-body">
                        {rows.map((row, i) => (
                          <div key={i} className="diff-table-row">
                            <div className={`diff-table-cell ${row.leftCls}`}>
                              {row.leftLine !== null ? row.leftLine : ""}
                            </div>
                            <div className={`diff-table-cell ${row.rightCls}`}>
                              {row.rightLine !== null ? row.rightLine : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            <div className="file-edit-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!fileEditState.dirty || fileEditState.lastSaveStatus === "saving"}
                onClick={onFileEditSave}
              >
                Save
              </button>
              <button
                type="button"
                className="btn"
                onClick={onSetBaseline}
              >
                Set Baseline
              </button>
              <button
                type="button"
                className="btn"
                onClick={onResetToBaseline}
              >
                Reset
              </button>
              <span className="file-edit-status">
                {fileEditState.lastSaveStatus === "saving" && "Saving…"}
                {fileEditState.lastSaveStatus === "saved" &&
                  `Saved ${fileEditState.savedAt ? new Date(fileEditState.savedAt).toLocaleTimeString() : ""} (baseline unchanged)`}
                {fileEditState.lastSaveStatus === "error" && "Error saving"}
              </span>
            </div>
            {fileEditState.saveError && (
              <div className="file-edit-error">
                <strong>Error:</strong> {fileEditState.saveError}
              </div>
            )}
            {fileEditState.verifyInfo && (
              <div className="file-edit-verify">
                <strong>Verify:</strong> path={fileEditState.verifyInfo.absolutePath} | size={fileEditState.verifyInfo.fileSizeBytes} bytes | sha256={fileEditState.verifyInfo.contentHashPrefix}…
              </div>
            )}
          </div>
        )}
        {showDiffPanel && !fileEditState && patch && (
          <div className="diff-panel">
            <h4>Diff</h4>
            {changedFiles.length > 0 && (
              <ul className="diff-file-list">
                {changedFiles.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className={selectedDiffPath === p ? "active" : ""}
                      onClick={() => onSelectDiffPath(p)}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {preview && (
              <div className="diff-fallback">
                <pre>
                  <strong>Original</strong>
                  {"\n"}
                  {preview.old || "(empty)"}
                </pre>
                <pre>
                  <strong>Modified</strong>
                  {"\n"}
                  {preview.new || "(empty)"}
                </pre>
              </div>
            )}
            {!preview && patch && (
              <pre className="raw-diff">{patch}</pre>
            )}
          </div>
        )}
        {(!showDiffPanel || (!fileEditState && !patch)) && (
          <div className="file-viewer">
            <h4>{viewerPath ?? "File viewer"}</h4>
            {viewerPath && (
              <>
                {viewerLoading && <p className="muted">Loading…</p>}
                {!viewerLoading && (
                  <pre className="viewer-content">{viewerContent}</pre>
                )}
              </>
            )}
            {!viewerPath && (
              <p className="muted">
                Click a file in the tree to view, or use View Diff when a patch
                is proposed.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
