import { useCallback } from "react";

interface ChangesTabProps {
  explanation: string | null;
  patch: string | null;
  changedFiles: string[];
  previewMap: Map<string, { old: string; new: string }> | null;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onApplyPatch: () => void;
  onRevertLast: () => void;
  canRevert: boolean;
  applyInProgress?: boolean;
}

export function ChangesTab({
  explanation,
  patch,
  changedFiles,
  previewMap,
  selectedPath,
  onSelectPath,
  onApplyPatch,
  onRevertLast,
  canRevert,
  applyInProgress,
}: ChangesTabProps) {
  const copyExplanation = useCallback(() => {
    if (!explanation) return;
    void navigator.clipboard.writeText(explanation);
  }, [explanation]);

  const current = selectedPath ?? (changedFiles.length ? changedFiles[0]! : null);
  const preview = current && previewMap?.get(current);

  return (
    <div className="changes-tab">
      <div className="explanation-block">
        <h3>Explanation</h3>
        <p>{explanation ?? "No proposal yet. Use Chat → Propose Patch."}</p>
        {explanation && (
          <button type="button" className="btn secondary" onClick={copyExplanation}>
            Copy explanation
          </button>
        )}
      </div>
      <div className="diff-section">
        <h3>Changed files</h3>
        {changedFiles.length > 0 ? (
          <ul className="file-list">
            {changedFiles.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className={selectedPath === p ? "active" : ""}
                  onClick={() => onSelectPath(p)}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No changed files in current proposal.</p>
        )}
        {preview && (
          <div className="monaco-diff-wrap">
            <div className="diff-fallback">
              <pre><strong>Original</strong>{"\n"}{preview.old || "(empty)"}</pre>
              <pre><strong>Modified</strong>{"\n"}{preview.new || "(empty)"}</pre>
            </div>
          </div>
        )}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn primary"
          disabled={!patch || applyInProgress}
          onClick={onApplyPatch}
        >
          {applyInProgress ? "Applying…" : "Apply Patch"}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={!canRevert || applyInProgress}
          onClick={onRevertLast}
        >
          Revert Last Session
        </button>
      </div>
    </div>
  );
}
