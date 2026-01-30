# Git baseline setup

## 1. Sanity check (run first)

```powershell
cd "c:\Users\our entertainment\dev\DevAssistantCursorLite"

# Ensure no credentials or service-account JSON tracked
git ls-files | Select-String -Pattern "\.env$|credentials|service.account|secrets"
# Expect: no matches. If any, run: git rm --cached <path> and add ignore rules.
```

## 2. Git commands for baseline commit

```powershell
cd "c:\Users\our entertainment\dev\DevAssistantCursorLite"

# Stop tracking workspace-local and large binaries (files stay on disk)
git rm -r --cached .devassistant
git rm --cached models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf
# If you have other .gguf: git rm --cached models/<name>.gguf
git rm -r --cached runtime/llama
git add runtime/llama/README.md

# Stage new root .gitignore
git add .gitignore

# Commit (GIT_BASELINE.md is optional; omit if you prefer not to track it)
git commit -m "chore: baseline project snapshot"
```

## 3. Confirm what was committed

```powershell
git show --stat
git status
```

- `.gitignore` added; `GIT_BASELINE.md` optional (use only as local reference).
- `.devassistant/`, `models/*.gguf`, `runtime/llama/*` (except `README.md`) removed from tracking.
- All other tracked project files unchanged.
