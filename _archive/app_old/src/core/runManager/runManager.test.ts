/**
 * RunManager cancel harness: starts a fake long task and confirms cancel stops it.
 * Asserts no chat route or "Generating reply" after cancel.
 * Run: npx tsx app/src/core/runManager/runManager.test.ts
 */

import {
  createRun,
  registerRunToken,
  unregisterRunToken,
  cancelCurrentRun,
  raceWithCancel,
  CancelledError,
} from "./runManager";
import { setCurrentRunId, subscribe } from "../progress/progressEvents";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHarness(): Promise<void> {
  let passed = 0;
  let failed = 0;

  // Test 1: cancel stops a long task within ~1s (task is racing with whenCancelled)
  {
    const runId = "test-run-1";
    const { token } = createRun(runId);
    setCurrentRunId(runId);
    registerRunToken(runId, token);

    const longTask = sleep(30_000).then(() => "done");
    const resultPromise = raceWithCancel(runId, token, longTask);

    // Cancel after 50ms
    await sleep(50);
    const cancelled = cancelCurrentRun();
    if (!cancelled) {
      console.error("FAIL: cancelCurrentRun() should return true when a run is active");
      failed++;
    } else {
      try {
        await resultPromise;
        console.error("FAIL: resultPromise should reject with CancelledError");
        failed++;
      } catch (e) {
        if (e instanceof CancelledError && e.runId === runId) {
          passed++;
          console.log("PASS: cancel stops long task, promise rejected with CancelledError");
        } else {
          console.error("FAIL: expected CancelledError, got", e);
          failed++;
        }
      }
    }
    unregisterRunToken();
    setCurrentRunId(null);
  }

  // Test 2: cancelCurrentRun() returns false when no run
  {
    setCurrentRunId(null);
    unregisterRunToken();
    const cancelled = cancelCurrentRun();
    if (cancelled) {
      console.error("FAIL: cancelCurrentRun() should return false when no run");
      failed++;
    } else {
      passed++;
      console.log("PASS: cancelCurrentRun() returns false when no run");
    }
  }

  // Test 3: token.cancelled is true after cancel()
  {
    const runId = "test-run-3";
    const { token } = createRun(runId);
    token.whenCancelled.catch(() => {}); // avoid unhandled rejection when we cancel
    if (token.cancelled) {
      console.error("FAIL: token should not be cancelled initially");
      failed++;
    } else {
      token.cancel();
      if (!token.cancelled) {
        console.error("FAIL: token.cancelled should be true after cancel()");
        failed++;
      } else {
        passed++;
        console.log("PASS: token.cancelled is true after cancel()");
      }
    }
  }

  // Test 4: cancel during fake long request — no further progress events, no chat route
  {
    const runId = "test-run-4";
    const { token } = createRun(runId);
    setCurrentRunId(runId);
    registerRunToken(runId, token);

    const eventsAfterCancel: { message: string; phase: string }[] = [];
    const unsub = subscribe((ev) => {
      if (ev.runId === runId) eventsAfterCancel.push({ message: ev.message, phase: ev.phase });
    });

    const longTask = sleep(30_000).then(() => "done");
    const resultPromise = raceWithCancel(runId, token, longTask);

    await sleep(50);
    cancelCurrentRun();
    try {
      await resultPromise;
    } catch {
      /* expected CancelledError */
    }
    await sleep(20);
    unsub();
    unregisterRunToken();
    setCurrentRunId(null);

    const chatLike = eventsAfterCancel.some(
      (e) =>
        e.message.includes("Route: chat") ||
        e.message.includes("Generating reply")
    );
    if (chatLike) {
      console.error("FAIL: after cancel, no event should be 'Route: chat' or 'Generating reply'. Got:", eventsAfterCancel);
      failed++;
    } else {
      passed++;
      console.log("PASS: no chat route or Generating reply after cancel");
    }
  }

  console.log("");
  console.log(`RunManager harness: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runHarness();
