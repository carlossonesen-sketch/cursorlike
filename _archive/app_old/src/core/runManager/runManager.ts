/**
 * RunManager: per-run CancellationToken and AbortController so Stop actually cancels in-flight work.
 * - runId + token + AbortController created per run
 * - token.cancel() marks cancelled, aborts controller, emits progress "cancel"
 * - raceWithCancel / raceWithTimeout make long awaits cancellable and time-bounded
 * - Timeout calls abort() so backend can cancel the request
 */

import { emit, setCurrentRunId, getCurrentRunId } from "../progress/progressEvents";
import { runtimeCancelRun } from "../runtime/runtimeApi";

export interface CancellationToken {
  readonly cancelled: boolean;
  /** AbortSignal for this run; pass to fetch/model so backend can abort. */
  readonly signal: AbortSignal;
  /** Promise that rejects with CancelledError when cancel() is called. Use in Promise.race to abort waits. */
  readonly whenCancelled: Promise<never>;
  /** Called on timeout to abort in-flight request without full cancel (no emit). Internal use. */
  abortRequest?(): void;
  cancel(): void;
}

export class CancelledError extends Error {
  constructor(public readonly runId: string) {
    super("Run cancelled");
    this.name = "CancelledError";
  }
}

export class TimeoutError extends Error {
  constructor(public readonly phase: string, public readonly ms: number) {
    super(`${phase} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

let currentToken: CancellationToken | null = null;

/** Register the token for the current run so Stop can call token.cancel(). */
export function registerRunToken(_runId: string, token: CancellationToken): void {
  currentToken = token;
}

/** Unregister when run ends (success/fail/cancel). */
export function unregisterRunToken(): void {
  currentToken = null;
}

/** Cancel the current run (called when user clicks Stop). Returns true if a run was cancelled. */
export function cancelCurrentRun(): boolean {
  const runId = getCurrentRunId();
  const token = currentToken;
  if (runId && token && !token.cancelled) {
    runtimeCancelRun(runId);
    token.cancel();
    return true;
  }
  return false;
}

/** Create a run: runId + token + AbortController. Call token.cancel() when user clicks Stop. */
export function createRun(runId: string): { runId: string; token: CancellationToken } {
  const controller = new AbortController();
  let cancelled = false;
  let rejectCancelled: (err: CancelledError) => void;
  const whenCancelled = new Promise<never>((_, reject) => {
    rejectCancelled = (err: CancelledError) => reject(err);
  });
  const token: CancellationToken = {
    get cancelled() {
      return cancelled;
    },
    get signal() {
      return controller.signal;
    },
    whenCancelled,
    abortRequest: () => controller.abort(),
    cancel() {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      currentToken = null;
      rejectCancelled(new CancelledError(runId));
      emit({
        runId,
        ts: Date.now(),
        level: "info",
        phase: "cancel",
        message: "User cancelled",
      });
      setCurrentRunId(null);
    },
  };
  return { runId, token };
}

/** Return true if this run is still the active run and not cancelled (use before emit/UI). */
export function isActiveRun(runId: string, token: CancellationToken): boolean {
  return getCurrentRunId() === runId && !token.cancelled;
}

/** Race task with cancellation. Rejects with CancelledError if token is cancelled before task settles. */
export function raceWithCancel<T>(
  runId: string,
  token: CancellationToken,
  task: Promise<T>
): Promise<T> {
  if (token.cancelled) return Promise.reject(new CancelledError(runId));
  return Promise.race([task, token.whenCancelled]);
}

/** Timeout promise that rejects after ms (for Promise.race). */
function timeoutPromise(phase: string, ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new TimeoutError(phase, ms)), ms);
  });
}

/** Race task with timeout. Rejects with TimeoutError if task doesn't settle in time. If token provided, aborts in-flight request on timeout. */
export function raceWithTimeout<T>(
  phase: string,
  timeoutMs: number,
  task: Promise<T>,
  token?: CancellationToken
): Promise<T> {
  if (import.meta.env.VITE_NO_TIMEOUT === "1") {
    return task;
  }
  const timeout = timeoutPromise(phase, timeoutMs);
  const withAbort = token?.abortRequest
    ? timeout.then((err) => {
        try {
          token.abortRequest!();
        } catch {
          /* ignore */
        }
        throw err;
      })
    : timeout;
  return Promise.race([task, withAbort]);
}

/** Throw if token is already cancelled (call between steps). */
export function throwIfCancelled(runId: string, token: CancellationToken): void {
  if (token.cancelled) throw new CancelledError(runId);
}

/** Hard timeouts (ms) for phases. */
export const PLANNING_TIMEOUT_MS = 60_000;
export const DIFF_GENERATION_TIMEOUT_MS = 90_000;
export const VALIDATION_TIMEOUT_MS = 30_000;

/** Plan-based patch: plan + edit-plan JSON only (diff is generated locally). No long model diff wait. */
export const PLAN_AND_EDIT_PLAN_TIMEOUT_MS = 120_000;


