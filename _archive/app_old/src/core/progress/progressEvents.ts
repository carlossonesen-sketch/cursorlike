/**
 * Progress event bus: safe live thinking (steps + tool output), no private chain-of-thought.
 * Standard shape: { runId, ts, level, phase, message, data? }
 */

export type ProgressLevel = "info" | "warn" | "error" | "debug";

export type ProgressPhase =
  | "intent"
  | "targets"
  | "search"
  | "plan"
  | "diff"
  | "validate"
  | "apply"
  | "verify"
  | "ready"
  | "cancel"
  | "fail";

export interface ProgressEvent {
  runId: string;
  ts: number;
  level: ProgressLevel;
  phase: ProgressPhase;
  message: string;
  data?: Record<string, unknown>;
}

export type ProgressListener = (ev: ProgressEvent) => void;

const listeners = new Set<ProgressListener>();
const eventHistory: ProgressEvent[] = [];
const MAX_HISTORY = 200;

let currentRunId: string | null = null;
let cancelRequestedForRunId: string | null = null;

export function getCurrentRunId(): string | null {
  return currentRunId;
}

export function setCurrentRunId(id: string | null): void {
  currentRunId = id;
  if (id === null) cancelRequestedForRunId = null;
}

export function isCancelRequested(runId?: string): boolean {
  if (runId) return cancelRequestedForRunId === runId;
  return cancelRequestedForRunId === currentRunId && currentRunId !== null;
}

export function requestCancel(runId: string): void {
  cancelRequestedForRunId = runId;
}

export function subscribe(listener: ProgressListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(ev: ProgressEvent): void {
  eventHistory.push(ev);
  if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
  listeners.forEach((l) => {
    try {
      l(ev);
    } catch (e) {
      console.error("Progress listener error:", e);
    }
  });
}

export function getHistory(runId?: string): ProgressEvent[] {
  if (runId) return eventHistory.filter((e) => e.runId === runId);
  return [...eventHistory];
}

export function clearHistory(): void {
  eventHistory.length = 0;
}

/** Emit a step for the current run. */
export function emitStep(
  phase: ProgressPhase,
  message: string,
  data?: Record<string, unknown>,
  level: ProgressLevel = "info"
): void {
  const runId = currentRunId ?? "anonymous";
  emit({
    runId,
    ts: Date.now(),
    level,
    phase,
    message,
    data,
  });
}

/** Emit a step only if runId is still the current run (drop late responses). */
export function emitStepForRun(
  runId: string,
  phase: ProgressPhase,
  message: string,
  data?: Record<string, unknown>,
  level: ProgressLevel = "info"
): void {
  if (currentRunId !== runId) return;
  emit({
    runId,
    ts: Date.now(),
    level,
    phase,
    message,
    data,
  });
}

const HEARTBEAT_INTERVAL_MS = 2000;

/**
 * Start a heartbeat that emits progress every 2s during a long phase (search, plan, diff).
 * Returns a stop function; call it when the operation completes so the run can't hang silently.
 */
export function startProgressHeartbeat(
  phase: ProgressPhase,
  message: string
): () => void {
  const start = Date.now();
  const id = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    emitStep(phase, `${message} (elapsed ${elapsed}s)`, { elapsed });
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(id);
}
