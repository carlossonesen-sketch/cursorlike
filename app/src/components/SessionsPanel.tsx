import { useState } from "react";
import type { SessionRecord } from "../core/types";

interface SessionsPanelProps {
  sessions: SessionRecord[];
  workspaceRoot: string | null;
  onView: (s: SessionRecord) => void;
  onApply: (s: SessionRecord) => void;
  onRevert: (s: SessionRecord) => void;
  applyInProgress: boolean;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function summary(explanation: string): string {
  const first = explanation.split(/\r?\n/)[0]?.trim() || "";
  return first.length > 50 ? `${first.slice(0, 50)}…` : first;
}

export function SessionsPanel({
  sessions,
  workspaceRoot,
  onView,
  onApply,
  onRevert,
  applyInProgress,
}: SessionsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!workspaceRoot) return null;

  return (
    <div className="sessions-panel">
      <button
        type="button"
        className="sessions-panel-header"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span>Sessions</span>
        <span className="sessions-count">{sessions.length}</span>
        <span className="sessions-chevron">{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && (
        <div className="sessions-list">
          {sessions.length === 0 && (
            <p className="muted">No sessions yet. Propose a patch or save one for later.</p>
          )}
          {[...sessions].reverse().map((s) => (
            <div key={s.id} className="session-row">
              <div className="session-meta">
                <span className="session-time" title={s.timestamp}>
                  {formatTime(s.timestamp)}
                </span>
                <span className={`session-status status-${s.status}`}>{s.status}</span>
                <span className="session-files">{s.filesChanged.length} file(s)</span>
              </div>
              <p className="session-summary muted">{summary(s.explanation) || "(no summary)"}</p>
              <div className="session-actions">
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() => onView(s)}
                >
                  View
                </button>
                {s.status === "pending" && (
                  <button
                    type="button"
                    className="btn primary small"
                    disabled={applyInProgress}
                    onClick={() => onApply(s)}
                  >
                    Apply
                  </button>
                )}
                {s.status === "applied" && (
                  <button
                    type="button"
                    className="btn secondary small"
                    disabled={applyInProgress}
                    onClick={() => onRevert(s)}
                  >
                    Revert
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
