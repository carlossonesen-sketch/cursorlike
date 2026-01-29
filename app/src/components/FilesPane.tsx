import { useState, useCallback } from "react";
import type { FileTreeNode } from "../core/types";
import type { SessionRecord } from "../core/types";
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
}: FilesPaneProps) {
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  const [viewerContent, setViewerContent] = useState<string>("");
  const [viewerLoading, setViewerLoading] = useState(false);

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
        {showDiffPanel && patch && (
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
        {(!showDiffPanel || !patch) && (
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
