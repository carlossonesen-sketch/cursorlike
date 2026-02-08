# Verification: Local (llama.cpp) provider — toolRoot + auto-start

## 1. toolRoot detection

- [ ] **`find_tool_root(workspace_root)`** (Rust): Walk up from workspace root up to 8 levels. First dir containing BOTH `runtime/llama/llama-server.exe` (Windows) and `models/` (folder) is toolRoot. Return absolute path or `None`.
- [ ] **`findToolRoot(workspaceRoot)`** (TS): Invokes `find_tool_root`, returns `string | null`.
- [ ] Works when workspace is e.g. `/app` (repo root) or a subdir; toolRoot can be a parent.

## 2. Runtime discovery and start

- [ ] **llama-server path**: Always derived as `toolRoot/runtime/llama/llama-server.exe` (Windows). No UI picker.
- [ ] **Validation**: Path is checked to exist before starting.
- [ ] **Start args**: `--host 127.0.0.1 --port 11435` (or `settings.port`), `--model <modelPath>`. Reuse existing process when already running on same port.
- [ ] **`runtime_start`** (Rust): Accepts `gguf_path`, `tool_root`, `params`, `port_override`. Uses toolRoot to resolve llama-server path; uses fixed port 11435 (or override) when toolRoot provided.

## 3. Auto-select GGUF model

- [ ] **`modelDir`**: `toolRoot/models`.
- [ ] **When**: `settings.modelPath` empty OR `toolRootExists(toolRoot, modelPath)` false.
- [ ] **Scan**: `scan_models_for_gguf(tool_root)` (Rust) or `scanModelsForGGUF(toolRoot)` (TS). 1 file → use it; multiple → prefer filename containing `coder|code|instruct` (case-insensitive), then largest file size.
- [ ] **Persist**: Chosen `modelPath` (toolRoot-relative, e.g. `models/foo.gguf`) stored in `workspaceRoot/.devassistant/settings.json`.

## 4. Settings schema

- [ ] **Stored**: `modelPath` (toolRoot-relative), `port` (optional, default 11435). No `llamaServerPath` (always derived from toolRoot).

## 5. UI

- [ ] **Default**: No packs list, no commands list, no model/server paths. Provider select only.
- [ ] **"Advanced ▸"** toggle reveals: toolRoot, provider status (local/mock), model name + full path (read-only), "Rescan models" button, optional model override (Browse). Packs, commands, Auto-enable, Refresh under Advanced.
- [ ] **toolRoot error**: When provider=local and toolRoot not found: "Could not find runtime/llama/llama-server.exe. Expected under toolRoot/runtime/llama."
- [ ] **No model**: When local, toolRoot found, no GGUF: "Drop a .gguf into <toolRoot>/models". Rescan / Browse in Advanced.

## 6. Provider=Local flow

- [ ] **On workspace open or provider → local**: Discover toolRoot (`find_tool_root`). If missing, show error; Keep Mock available.
- [ ] **If toolRoot found**: Auto-select model (scan when `modelPath` empty or file missing), persist, set `ggufPath` = `resolveModelPath(toolRoot, modelPath)`.
- [ ] **Ensure runtime**: Before generate, `ensureLocalRuntime(settings, toolRoot, port)` — start llama-server if not running (derived path, port 11435 or override), then generate. No [MOCK] when using local.

## 7. Helpers

- [ ] **`resolveModelPath(toolRoot, relPath)`**: Returns absolute path for GGUF (used for `--model` and runtime).
- [ ] **`tool_root_exists(tool_root, rel_path)`** / **`toolRootExists`**: Check file/dir exists under toolRoot.
- [ ] **`scan_models_for_gguf`** / **`scanModelsForGGUF`**: Scan `toolRoot/models` for `*.gguf`, return toolRoot-relative path or null.

## Quick manual test

1. Place `llama-server.exe` in `runtime/llama/` and a `.gguf` in `models/` (e.g. at repo root).
2. Open workspace (repo root or e.g. `app/`). Select Provider **Local**.
3. Confirm no toolRoot error, no "Drop a .gguf" if model was found. Expand **Advanced ▸** → toolRoot, model path (read-only), Rescan, Override, packs, commands.
4. Run pipeline or propose patch → runtime starts (or reused), real LLM output (no [MOCK]).
5. Change workspace to a folder without `runtime/llama` + `models/` → switch to Local → see "Could not find runtime/llama/llama-server.exe...". Mock still usable.
