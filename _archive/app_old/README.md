# DevAssistant Cursor Lite (app)

Offline, portable desktop dev assistant. Cursor-like single-flow UI: conversation on the left, files/context and diff on the right.

## Setup

```bash
npm install
```

## Run

```bash
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Output: `src-tauri/target/release/` (exe) and installer artifacts.

## Add a GGUF model

1. Put your `.gguf` file in `./models` (e.g. `models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`).
2. Restart the app (or use **Runtime Status** → **Start**). The app auto-detects the model and uses it for the Local (llama.cpp) provider.

If multiple `.gguf` files exist, the app picks the **most recently modified** one and logs a warning.

## Launcher

From repo root, `launcher/Start-Assistant.cmd` (or `.ps1`) launches the built Tauri binary, prepends `tools/` to PATH, and logs to `Start-Assistant.log`. Build the app first.

## UI (single-flow, three panes)

- **Left pane (Chat)**: Conversation stream (user + assistant messages). Inline proposal cards with **Keep (Apply)**, **Revert**, **Save / Run later**, **View Diff**. Input + “Propose Patch” at bottom. Status line (“Scanning…”, “Generating patch…”, etc.) above input when busy.
- **Middle pane**: File tree, **Select files** / **Run checks**, selected context summary. File viewer, or diff panel when **View Diff** is active (summary + full unified diff).
- **Right pane (Live)**: Real-time progress and logs. Collapsible; open/closed state is saved per workspace in `.devassistant/settings.json` (`livePaneOpen`).

### How to read the Live pane

The **Live** pane shows safe, high-level progress—no private chain-of-thought, only steps and tool output.

- **Header**: Spinner and current step label (e.g. "Searching repo…", "Generating edit proposal…") while a run is active.
- **Steps**: Timeline of phases—Intent → Target files → Search → Plan → Diff → Validate → Apply → Verify → Ready. Completed steps show a check and timestamp; the current step is highlighted.
- **Log**: Scrollable, timestamped stream of events: routing decision and confidence, files considered and why chosen, retries (e.g. "Diff invalid → retry #1"), and readiness polling for llama-server (port, URL, status) when using the local provider.
- **Actions**:
  - **Stop**: Cancels the current run. Checks happen at async boundaries (e.g. after repo search, before model call); no partial file writes. If apply has already started, the current file write completes atomically before the run halts.
  - **Retry**: Shown when the last run failed; re-run the last action if your workflow supports it.
  - **Clear logs**: Clears the in-memory event history (current session only).
- **Possibly stuck**: If no progress event is received for 15 seconds while a run is active, a banner appears and **Stop** is emphasized so you can cancel safely.

## State machine

- **idle**: No proposal; user can propose.
- **patchProposed**: Proposal shown; user can Keep, Revert (discard), Save later, or View Diff.
- **patchApplied**: Patch applied; user can Revert (restore pre-apply snapshots).

## Plan-based diffs

For **EDIT** requests the app uses a **plan-based patch pipeline** to avoid long model runs:

1. **Plan**: The model produces a short text plan (what to change).
2. **Edit plan**: The model produces a compact JSON edit plan (`targetFiles` + per-file `operations`: `replace_range`, `insert_after`, `append`, `prepend` with anchors or line numbers).
3. **Apply + diff locally**: The app applies those operations in memory and generates the unified diff with a real diff library. No model call for the diff itself.

If the edit plan is invalid or apply fails, the app falls back to the older flow (model generates the unified diff), capped at 120s and 300 lines. Stop cancels the plan request immediately.

## Core modules

- `src/core/`: WorkspaceService, ProjectInspector, ContextBuilder, ModelGateway (mock), PatchEngine, MemoryStore, progress (event bus for Live pane)
- `src/components/`: TopBar, ConversationPane, FilesPane, LivePane, ProposalCard

## Snapshot smoke test

From repo root, run the snapshot smoke test (tests pure detection logic):

```bash
cd app && npm run snapshot:smoke
```

Or: `npx tsx scripts/dev_snapshot_smoke.ts` from repo root. Full snapshot generation runs when you open a workspace in the app; output is written to `.devassistant/project_snapshot.json`.

## Verify flow

1. **Open Workspace** → pick folder. Top bar shows path.
2. **Right pane** → **Select files** and/or check files in tree for context.
3. **Left pane** → type prompt → **Propose Patch**. Status: “Scanning…”, “Generating patch…”. Mock explanation + proposal card.
4. **Proposal card** → **Keep (Apply)** → patch applied, “Applied.” + **Revert**. **Revert** → restores files.
5. **Revert** (pending) → discard proposal. **Save / Run later** → store session as `pending`, no file writes.
6. **View Diff** → diff panel on right; **Hide diff** to close.
