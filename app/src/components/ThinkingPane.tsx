import { useState, useRef, useEffect } from "react";

export interface ThinkingLine {
  id: string;
  text: string;
  type?: "plan" | "action" | "review" | "status" | "error";
  timestamp?: string;
}

interface NormalizedEntry {
  id: string;
  ts: number;
  type?: string;
  text: string;
}

function normalizeEntry(line: ThinkingLine): NormalizedEntry {
  let ts = Date.now();
  if (line.timestamp != null) {
    const parsed = typeof line.timestamp === "string" ? new Date(line.timestamp).getTime() : Number(line.timestamp);
    if (!Number.isNaN(parsed)) ts = parsed;
  }
  return {
    id: line.id,
    ts,
    type: line.type,
    text: line.text ?? "",
  };
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface ThinkingPaneProps {
  lines: ThinkingLine[];
  isRunning: boolean;
  onStop?: () => void;
}

export function ThinkingPane({ lines, isRunning, onStop }: ThinkingPaneProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll || !feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [lines, autoScroll]);

  const handleScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setAutoScroll(atBottom);
  };

  const entries = lines.map(normalizeEntry);

  return (
    <div className="thinking-pane">
      <div className="thinking-pane-header">
        <span className="thinking-pane-title">Thinking</span>
      </div>
      <div
        ref={feedRef}
        className="thinking-feed"
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
      >
        {lines.length === 0 && !isRunning && (
          <div className="thinking-feed-empty muted">No activity yet. Run a pipeline to see thinking.</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`thinking-line${entry.type ? ` thinking-line-${entry.type}` : ""}`}
          >
            <div className="thinking-line-row">
              <span className="thinking-line-time">{formatTime(entry.ts)}</span>
              {entry.type != null && entry.type !== "" && (
                <span className="thinking-line-badge">{entry.type.toUpperCase()}</span>
              )}
              <div className="thinking-line-body">{entry.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="thinking-pane-footer">
        <button
          type="button"
          className="btn secondary"
          disabled={!isRunning}
          onClick={onStop}
        >
          Stop
        </button>
      </div>
    </div>
  );
}
