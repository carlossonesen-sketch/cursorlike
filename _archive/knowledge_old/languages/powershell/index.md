# PowerShell Pack

## Rules
- Prefer Set-StrictMode -Version Latest in scripts you control.
- Use $ErrorActionPreference = "Stop" for fail-fast automation.
- Use Join-Path over manual path concatenation.
- Quote paths with spaces.

## Common project ops
- Repo search: Get-ChildItem -Recurse -Filter *.ts
- Grep: Select-String -Path .\src\*.ts -Pattern "TODO" -Recurse
- JSON: Get-Content file.json | ConvertFrom-Json
- Invoke: & .\script.ps1 -Arg value

## Gotchas
- ExecutionPolicy on new machines
- Backticks vs quotes, line continuation
- PowerShell vs CMD escaping for curl/json
