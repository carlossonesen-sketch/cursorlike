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

## Launcher

From repo root, `launcher/Start-Assistant.cmd` (or `.ps1`) launches the built Tauri binary, prepends `tools/` to PATH, and logs to `Start-Assistant.log`. Build the app first.

## UI (single-flow, no tabs)

- **Left pane**: Conversation stream (user + assistant messages). Inline proposal cards with **Keep (Apply)**, **Revert**, **Save / Run later**, **View Diff**. Input + “Propose Patch” at bottom. Status line (“Scanning…”, “Generating patch…”, etc.) above input when busy.
- **Right pane**: File tree, **Select files** / **Run checks**, selected context summary. File viewer, or diff panel when **View Diff** is active (summary + full unified diff).

## State machine

- **idle**: No proposal; user can propose.
- **patchProposed**: Proposal shown; user can Keep, Revert (discard), Save later, or View Diff.
- **patchApplied**: Patch applied; user can Revert (restore pre-apply snapshots).

## Core modules

- `src/core/`: WorkspaceService, ProjectInspector, ContextBuilder, ModelGateway (mock), PatchEngine, MemoryStore
- `src/components/`: TopBar, ConversationPane, FilesPane, ProposalCard

## Verify flow

1. **Open Workspace** → pick folder. Top bar shows path.
2. **Right pane** → **Select files** and/or check files in tree for context.
3. **Left pane** → type prompt → **Propose Patch**. Status: “Scanning…”, “Generating patch…”. Mock explanation + proposal card.
4. **Proposal card** → **Keep (Apply)** → patch applied, “Applied.” + **Revert**. **Revert** → restores files.
5. **Revert** (pending) → discard proposal. **Save / Run later** → store session as `pending`, no file writes.
6. **View Diff** → diff panel on right; **Hide diff** to close.
