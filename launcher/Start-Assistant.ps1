#Requires -Version 5.1
[CmdletBinding()] param()
$ErrorActionPreference = "Stop"

$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root        = Split-Path -Parent $LauncherDir
$AppDir      = Join-Path $Root "app\src-tauri\target\release"
$Exe     = Join-Path $AppDir "devassistant-cursor-light.exe"
$Tools   = Join-Path $Root "tools"
$Log     = Join-Path $Root "Start-Assistant.log"

function Log($msg) {
  $ts = (Get-Date).ToString("u")
  "$ts $msg" | Tee-Object -FilePath $Log -Append
}

function Prepend-Path($p) {
  if (Test-Path $p) {
    $env:PATH = "$p;$env:PATH"
    Log "PATH+ $p"
  }
}

Log "===== DevAssistant Launcher ====="

Prepend-Path (Join-Path $Tools "git\cmd")
Prepend-Path (Join-Path $Tools "ffmpeg\bin")
Prepend-Path (Join-Path $Tools "nodejs")
Prepend-Path (Join-Path $Tools "flutter\bin")
Prepend-Path (Join-Path $Tools "jdk\bin")
Prepend-Path (Join-Path $Tools "gradle\bin")

if (-not (Test-Path $Exe)) {
  Log "ERROR: EXE not found at $Exe. Run 'npm run tauri build' in app first."
  Write-Host "EXE not found. Build the app: cd app && npm run tauri build" -ForegroundColor Red
  exit 1
}

Log "Launching $Exe"
Set-Location $AppDir
Start-Process -FilePath $Exe -WorkingDirectory $AppDir
