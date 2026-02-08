# Runtime 503 / warmup audit

## STEP 0 — Baseline

### Commands to run (PowerShell, from repo root)

```powershell
cd "c:\Users\our entertainment\dev\DevAssistantCursorLite"

# Branch + recent commits
git rev-parse --abbrev-ref HEAD
git log -10 --oneline
git status

# Fetch and diff vs experiment/patch-speed (or main if that branch is your baseline)
git fetch
git diff --stat origin/experiment/patch-speed..HEAD
git diff origin/experiment/patch-speed..HEAD
git show --name-only HEAD
```

### Current state (snapshot)

- **Branch:** `fix/preview-apply-refresh`
- **Last 10 commits:** 485041a (fix: stabilize routing, disable timeouts…), 58627b8, 9ca2099, 5e3ccfd, 8279f10, a09bd94, 9298d70, 438e370, 70e1bfb, 57a5655
- **Status:** Modified (uncommitted): `app/src/App.tsx`, `app/src/components/ConversationPane.tsx`, `app/src/core/runtime/runtimeApi.ts`, `app/src/core/runtime/runtimeConfig.ts`; untracked: `cursorlike/`

### Files changed since last “runtime stable” (e.g. experiment/patch-speed)

- Diff stat vs `origin/experiment/patch-speed`: run `git diff --stat origin/experiment/patch-speed..HEAD` for current list.
- Commit 485041a touched: `app/src/App.tsx`, `app/src/core/runManager/runManager.ts`.

### 5-bullet summary of recent changes

1. **Timeouts:** Timeouts disabled when `VITE_NO_TIMEOUT=1`; `raceWithTimeout` in runManager skips the race so plan/edit has no hard timeout.
2. **Routing/workflow:** Routing stabilized; file edit workflow enabled via Tauri.
3. **Edit pipeline:** Incremental edit-plan pipeline (step-based, local diff); plan preview with apply/cancel before file edits.
4. **Runtime/toolRoot:** Global toolRoot fallback, tool initialization, cleanup; local runtime spawn + streaming verified.
5. **UI:** Runtime health in Live Pane shows raw HTTP code (e.g. `503`) from `runtimeHealthCheckStatus`; ConversationPane banner is driven by toolRoot/hasLlama/modelPath, not by HTTP status.

---

## STEP 1 — Runtime warmup (503 → 200)

### Cause of 503 for ~30s

- **A/B/C/D/E:** The 503 is from **llama-server** itself: it binds the port quickly but returns **503 on GET /health** until the model is loaded (~30s), then 200. So: process started (A), server listening (D), but **model loading (B)** causes 503. Not our proxy, not wrong URL/port.
- **Code path:**
  - **Spawn:** `app/src-tauri/src/runtime.rs` → `runtime_start` → `Command::new(&server_path).args(&args).spawn()` then loop polling `/health` every 1s up to `readiness_timeout_seconds()` (default 180).
  - **Health check:** `runtime_health_check` / `runtime_health_check_status` → `reqwest::get(format!("http://127.0.0.1:{}/health", port))` → returns bool or status code.
  - **Local vs fallback:** Frontend uses `runtimeHealthStatus` (ok/missing_runtime/missing_model) from toolRoot/hasLlama/modelPath in `openWorkspace`; provider fallback message when missing_runtime/missing_model.
  - **Banner:** `ConversationPane` shows runtime-health banner when `runtimeHealthStatus === "missing_runtime"` or `"missing_model"` or missing toolRoot/gguf; **Live Pane** shows raw code from `runtimeHealthCheckStatus` (e.g. "503", "200") as `runtimeHealthStatusText`.

### Temporary logging (DEBUG)

- In `runtime.rs`, when env `DEVASSISTANT_DEBUG_RUNTIME=1`: log spawn start time, command args, cwd; first health probe time and interval; response code/body for 503 vs 200; time-to-first-200. See code below.

### Reproduction script (PowerShell)

- Polls **llama-server** health directly (assumes port 8080 or set `$port`). Run after starting the app and starting the runtime (so llama-server is up), or start llama-server manually for a minimal repro.

```powershell
# Poll health every 1s until first 200 (run from repo root or any dir)
$port = 8080
$uri = "http://127.0.0.1:$port/health"
do {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  try {
    $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 5
    $status = $r.StatusCode
    $body = $r.Content
    if ($body.Length -gt 120) { $body = $body.Substring(0, 120) + "..." }
    Write-Host "$ts  $status  $body"
    if ($status -eq 200) { break }
  } catch {
    Write-Host "$ts  (failed)  $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 1
} while ($true)
```

---

## STEP 2 — “Time issue” (timeouts / intervals)

| Location | What | Relevance |
|----------|------|-----------|
| `app/src/core/runManager/runManager.ts` | `VITE_NO_TIMEOUT=== "1"` → `raceWithTimeout` returns task without racing; `PLAN_AND_EDIT_PLAN_TIMEOUT_MS = 120_000` | Timeouts disabled for plan+edit when env set; no change to runtime health. |
| `app/src/App.tsx` | `setInterval(pollRuntimeStatus, 2000)` | Polls runtime status every 2s when provider=local and Live Pane open; shows 503 until server returns 200. |
| `app/src/App.tsx` | `setTimeout(r, 500)` in restart | 500 ms delay between stop and start on restart. |
| `app/src-tauri/src/runtime.rs` | `readiness_timeout_seconds()` default 180; poll every 1s in `runtime_start` | Backend waits up to 180s for first 200; no change to why 503 appears. |
| `runtime_health_check_status` | Returns status code from llama-server | 503 is passed through from server; not generated by our code. |

**Conclusion:** The “time issue” is not a regression in our timeouts; it’s the normal ~30s model load during which llama-server returns 503. The only UX issue is showing raw "503" in the Live Pane.

---

## STEP 3 — Commands (Windows PowerShell)

From repo root:

```powershell
cd "c:\Users\our entertainment\dev\DevAssistantCursorLite"
```

From `app/` (or `cd app` from repo root):

```powershell
# TypeScript compile + Vite build
npm run build

# Tauri dev (only if you need to run the app)
npm run tauri dev

# Full Tauri build (longer; includes Rust release build)
npm run tauri build
```

Rust only (quick check from `app/src-tauri`):

```powershell
cd "c:\Users\our entertainment\dev\DevAssistantCursorLite\app\src-tauri"
cargo check
```

Lint (if you add a lint script to package.json): `npm run lint`

---

## STEP 4 — Recommended improvement (minimal)

- **Option chosen:** Treat 503 as “starting” in the UI: in Live Pane, show **"Warming up…"** (or "503 (loading model)") when the health status text is `"503"`, so the banner stays factual and we avoid a scary numeric code during normal warmup.
- **Also:** Add DEBUG-only logging in Rust behind `DEVASSISTANT_DEBUG_RUNTIME=1` (spawn time, health probe, time-to-first-200).
- **No change** to llama-server, health URL, or readiness timeout; no new retries or backoff in frontend (backend already polls until ready).

### Patch (minimal)

1. **LivePane.tsx:** When `runtimeHealthStatus === "503"`, display "Warming up…" instead of "503".
2. **runtime.rs:** When `std::env::var("DEVASSISTANT_DEBUG_RUNTIME").is_ok()`, log spawn timestamp, args, and each health response (code + short body) until 200, then log elapsed time.
