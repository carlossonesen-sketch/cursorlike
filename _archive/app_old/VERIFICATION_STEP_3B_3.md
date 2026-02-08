# Step 3B.3 Verification Checklist

## A) ProjectDetector (`core/project/ProjectDetector.ts`)

- [ ] **Node/TS:** package.json, tsconfig.json → detectedTypes, recommendedPacks (node, typescript)
- [ ] **Python:** pyproject.toml, requirements.txt, poetry.lock → python
- [ ] **Flutter:** pubspec.yaml → flutter
- [ ] **C/C++:** CMakeLists.txt, Makefile, *.cpp, *.h → cpp; when CMake present, default build = "cmake --build ."
- [ ] **PowerShell:** *.ps1, *.psm1, *.psd1 (count presence) → powershell
- [ ] **Tauri:** src-tauri/tauri.conf.json → tauri
- [ ] **Firebase:** firebase.json → firebase
- [ ] **Next.js:** next.config.* or app/, pages/ → nextjs
- [ ] **Commands:** From package.json scripts: dev/start, build, test, lint; else type defaults (e.g. Flutter: "flutter test", Python: "pytest")
- [ ] **Return:** detectedTypes, recommendedPacks, importantFiles, detectedCommands

## B) Settings (`.devassistant/settings.json`)

- [ ] **Stored:** autoPacksEnabled (default true), enabledPacks: string[]
- [ ] **On workspace open:** Read settings; if autoPacksEnabled set enabledPacks = recommendedPacks and write settings; if false do not modify enabledPacks
- [ ] **Read/write:** readWorkspaceSettings(root), writeWorkspaceSettings(root, settings)

## C) Project snapshot (`.devassistant/project_snapshot.json`)

- [ ] **Contents:** detectedTypes, enabledPacks, importantFiles, detectedCommands, generatedAt
- [ ] **When:** Updated on workspace open and on Refresh

## D) ContextBuilder

- [ ] **Section:** "=== PROJECT SNAPSHOT ===" with Types, Packs, Commands, Important files
- [ ] **Retrieval:** If enabledPacks is empty, do not retrieve knowledge; otherwise filter/boost chunks by enabledPacks tags

## E) UI (sidebar Project block)

- [ ] **Detected Types** shown
- [ ] **Packs Enabled** with checkboxes to toggle packs on/off
- [ ] **Commands** (dev/build/test/lint) when detected
- [ ] **Toggle:** Auto-enable packs (on/off), persisted to settings.json
- [ ] **Button:** Refresh — re-runs detector and rebuilds snapshot (and settings if auto-enable on)

## Quick manual test

1. Open workspace with package.json (e.g. app folder). Check Project block shows Node/TS, Packs enabled, Commands, Auto-enable packs on, Refresh button.
2. Uncheck a pack; confirm settings.json and project_snapshot.json updated.
3. Turn off Auto-enable packs; open another workspace then reopen first; confirm enabledPacks unchanged.
4. Click Refresh; confirm snapshot and (if auto on) settings updated.
5. Run pipeline; confirm context includes "=== PROJECT SNAPSHOT ===" and (if packs enabled) knowledge is retrieved; with no packs enabled, no knowledge chunks.

## Out of scope

- No embeddings / vector DB
- No llama.cpp integration
- No Jira
