import { useState, useEffect, useRef } from "react";
import {
  subscribe,
  getHistory,
  clearHistory,
  getCurrentRunId,
  type ProgressEvent,
  type ProgressPhase,
} from "../core/progress/progressEvents";
import { cancelCurrentRun } from "../core/runManager/runManager";

const PHASE_LABELS: Record<ProgressPhase, string> = {
  intent: "Intent",
  targets: "Target files",
  search: "Search",
  plan: "Plan",
  diff: "Diff",
  validate: "Validate",
  apply: "Apply",
  verify: "Verify",
  ready: "Ready",
  cancel: "Cancelled",
  fail: "Failed",
};

const STUCK_THRESHOLD_MS = 15000;

export type RuntimeStatus = "Down" | "Starting" | "Ready";

interface LivePaneProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  onRetry?: () => void;
  hasFailed?: boolean;
  workspaceRoot: string | null;
  runtimeStatus?: RuntimeStatus;
  runtimePort?: number | null;
  runtimeHealthStatus?: string | null;
  runtimeSpawnError?: string | null;
  runtimeLogLines?: string[];
  onStartRuntime?: () => Promise<void>;
  onStopRuntime?: () => Promise<void>;
  onRestartRuntime?: () => Promise<void>;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export function LivePane({
  isOpen,
  onToggleOpen,
  onRetry,
  hasFailed,
  workspaceRoot: _workspaceRoot,
  runtimeStatus = "Down",
  runtimePort = null,
  runtimeHealthStatus = null,
  runtimeSpawnError = null,
  runtimeLogLines = [],
  onStartRuntime,
  onStopRuntime,
  onRestartRuntime,
}: LivePaneProps) {
  const [events, setEvents] = useState<ProgressEvent[]>(() => getHistory());
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [possiblyStuck, setPossiblyStuck] = useState(false);
  const [runtimeActionPending, setRuntimeActionPending] = useState(false);
  const lastEventTs = useRef<number>(0);
  const stuckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribe((ev) => {
      setEvents((prev) => [...prev.slice(-199), ev]);
      setCurrentStep(ev.message || PHASE_LABELS[ev.phase] || ev.phase);
      lastEventTs.current = ev.ts;
      if (ev.phase === "ready" || ev.phase === "cancel" || ev.phase === "fail") {
        setPossiblyStuck(false);
        if (stuckTimer.current) {
          clearTimeout(stuckTimer.current);
          stuckTimer.current = null;
        }
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isOpen || events.length === 0) return;
    const last = events[events.length - 1];
    const running = last && last.phase !== "ready" && last.phase !== "cancel" && last.phase !== "fail";
    if (!running) return;
    stuckTimer.current = setTimeout(() => {
      setPossiblyStuck(true);
    }, STUCK_THRESHOLD_MS);
    return () => {
      if (stuckTimer.current) clearTimeout(stuckTimer.current);
    };
  }, [isOpen, events]);

  const currentRunId = getCurrentRunId();
  const running = currentRunId && events.some((e) => e.runId === currentRunId && e.phase !== "ready" && e.phase !== "cancel" && e.phase !== "fail");

  const handleStop = () => {
    const cancelled = cancelCurrentRun();
    if (cancelled) {
      setPossiblyStuck(false);
      if (stuckTimer.current) {
        clearTimeout(stuckTimer.current);
        stuckTimer.current = null;
      }
    }
  };

  const handleClear = () => {
    clearHistory();
    setEvents([]);
    setCurrentStep(null);
    setPossiblyStuck(false);
  };

  const displayEvents = events.slice(-100);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  return (
    <div className={`live-pane ${isOpen ? "live-pane-open" : "live-pane-closed"}`}>
      <div className="live-pane-header">
        <button
          type="button"
          className="live-pane-toggle"
          onClick={onToggleOpen}
          title={isOpen ? "Collapse Live" : "Expand Live"}
          aria-expanded={isOpen}
        >
          {isOpen ? "▶" : "◀"} Live
        </button>
        {isOpen && (
          <>
            <div className="live-pane-status">
              {running && (
                <span className="live-pane-spinner" aria-hidden />
              )}
              <span className="live-pane-step">
                {currentStep ?? "Idle"}
              </span>
            </div>
          </>
        )}
      </div>
      {isOpen && (
        <div className="live-pane-body">
          <div className="live-pane-runtime-status">
            <div className="live-pane-runtime-title">Runtime Status</div>
            <div className="live-pane-runtime-row">
              <span className="live-pane-runtime-label">Llama runtime:</span>
              <span className={`live-pane-runtime-badge status-${runtimeStatus.toLowerCase()}`}>
                {runtimeStatus}
              </span>
            </div>
            {runtimePort != null && (
              <div className="live-pane-runtime-row">
                <span className="live-pane-runtime-label">Port:</span>
                <span className="live-pane-runtime-value">{runtimePort}</span>
              </div>
            )}
            {runtimeHealthStatus != null && (
              <div className="live-pane-runtime-row">
                <span className="live-pane-runtime-label">Health:</span>
                <span className="live-pane-runtime-value">{runtimeHealthStatus}</span>
              </div>
            )}
            {runtimeSpawnError && (
              <div className="live-pane-runtime-error">
                <strong>Couldn&apos;t start llama-server</strong>
                <pre>{runtimeSpawnError}</pre>
              </div>
            )}
            <div className="live-pane-runtime-actions">
              {onStartRuntime && (
                <button
                  type="button"
                  className="btn small"
                  disabled={runtimeStatus !== "Down" || runtimeActionPending}
                  onClick={async () => {
                    setRuntimeActionPending(true);
                    try {
                      await onStartRuntime();
                    } finally {
                      setRuntimeActionPending(false);
                    }
                  }}
                >
                  Start
                </button>
              )}
              {onRestartRuntime && (
                <button
                  type="button"
                  className="btn small"
                  disabled={runtimeStatus !== "Ready" || runtimeActionPending}
                  onClick={async () => {
                    setRuntimeActionPending(true);
                    try {
                      await onRestartRuntime();
                    } finally {
                      setRuntimeActionPending(false);
                    }
                  }}
                >
                  Restart
                </button>
              )}
              {onStopRuntime && (
                <button
                  type="button"
                  className="btn small"
                  disabled={runtimeStatus !== "Ready" || runtimeActionPending}
                  onClick={async () => {
                    setRuntimeActionPending(true);
                    try {
                      await onStopRuntime();
                    } finally {
                      setRuntimeActionPending(false);
                    }
                  }}
                >
                  Stop
                </button>
              )}
            </div>
          </div>
          {runtimeLogLines.length > 0 && (
            <div className="live-pane-runtime-log-wrap">
              <div className="live-pane-runtime-log-title">Runtime log</div>
              <div className="live-pane-runtime-log" role="log">
                {runtimeLogLines.map((line, i) => (
                  <div key={`log-${i}`} className="live-pane-runtime-log-line">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
          {possiblyStuck && (
            <div className="live-pane-stuck">
              Possibly stuck. You can stop the operation.
            </div>
          )}
          <div className="live-pane-timeline">
            <div className="live-pane-timeline-title">Steps</div>
            <ul className="live-pane-steps-list">
              {["intent", "targets", "search", "plan", "diff", "validate", "apply", "verify", "ready"].map((phase) => {
                const ev = displayEvents.filter((e) => e.phase === phase).pop();
                const done = ev != null;
                const current = events[events.length - 1]?.phase === phase;
                return (
                  <li
                    key={phase}
                    className={`live-pane-step-item ${done ? "done" : ""} ${current ? "current" : ""}`}
                  >
                    <span className="live-pane-step-dot">{done ? "✓" : "○"}</span>
                    {PHASE_LABELS[phase as ProgressPhase]}
                    {ev && <span className="live-pane-step-ts">{formatTime(ev.ts)}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="live-pane-log-wrap">
            <div className="live-pane-log-title">Log</div>
            <div className="live-pane-log" role="log" ref={logRef}>
              {displayEvents.length === 0 ? (
                <div className="live-pane-log-empty">No events yet.</div>
              ) : (
                displayEvents.map((ev, i) => (
                  <div
                    key={`${ev.runId}-${ev.ts}-${i}`}
                    className={`live-pane-log-line level-${ev.level}`}
                  >
                    <span className="live-pane-log-ts">{formatTime(ev.ts)}</span>
                    <span className="live-pane-log-msg">{ev.message}</span>
                    {ev.data && Object.keys(ev.data).length > 0 && (
                      <span className="live-pane-log-data">
                        {JSON.stringify(ev.data).slice(0, 120)}
                        {(JSON.stringify(ev.data).length > 120) ? "…" : ""}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="live-pane-actions">
            <button
              type="button"
              className="btn small"
              disabled={!running}
              onClick={handleStop}
            >
              Stop
            </button>
            {hasFailed && onRetry && (
              <button type="button" className="btn small" onClick={onRetry}>
                Retry
              </button>
            )}
            <button type="button" className="btn small" onClick={handleClear}>
              Clear logs
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
