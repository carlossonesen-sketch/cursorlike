#Requires -Version 5.1
[CmdletBinding()] param()
$ErrorActionPreference = "Stop"

# Paths
$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $Root "DevAssistant"
$Exe    = Join-Path $AppDir "DevAssistant.exe"
$Tools  = Join-Path $Root "tools"
$Log    = Join-Path $Root "Start-Assistant.log"

function Log($msg){ $ts=(Get-Date).ToString("u"); "$ts $msg" | Tee-Object -FilePath $Log -Append }

# --- Utilities
function Test-Online {
  try {
    # Prefer a quick DNS check to avoid firewall popups
    [System.Net.Dns]::GetHostEntry("one.one.one.one") | Out-Null
    return $true
  } catch { return $false }
}

function OnPath($cmd) {
  $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Prepend-Path($p) {
  if (Test-Path $p) {
    $env:PATH = "$p;$env:PATH"
    Log "PATH+ $p"
  }
}

function Ensure-Tool($display, $detectCmd, $portableDir, $wingetId, [switch]$TryInstall) {
  Log "Check $display"
  if (OnPath $detectCmd) { Log "OK on PATH: $display"; return $true }

  if ($portableDir -and (Test-Path $portableDir)) {
    Prepend-Path $portableDir
    if (OnPath $detectCmd) { Log "Using portable $display at $portableDir"; return $true }
  }

  if ($TryInstall -and $Global:ONLINE -and (OnPath "winget")) {
    Log "Installing $display via winget ($wingetId)"
    $args = @("install","-e","--id",$wingetId,"--silent","--accept-source-agreements","--accept-package-agreements")
    $p = Start-Process -FilePath "winget" -ArgumentList $args -NoNewWindow -Wait -PassThru -ErrorAction SilentlyContinue
    if ($p -and $p.ExitCode -eq 0) {
      Log "winget install ok: $display"
      if (OnPath $detectCmd) { return $true }
      # sometimes PATH isn't refreshed; try common install dirs
      $common = @(
        "$env:ProgramFiles\Git\cmd",
        "$env:ProgramFiles\ffmpeg\bin",
        "$env:LOCALAPPDATA\Programs\Git\cmd",
        "$env:LOCALAPPDATA\Programs\ffmpeg\bin"
      )
      foreach($c in $common){ Prepend-Path $c }
      if (OnPath $detectCmd) { return $true }
    } else {
      Log "winget install failed/denied for $display (code $($p.ExitCode))"
    }
  }

  Log "MISSING: $display (no install or portable copy)."
  return $false
}

# --- Start
Log "===== Start-Assistant ====="
$ONLINE = Test-Online
Log ("Online="+$ONLINE)

# Always try to use bundled portable tools first
Prepend-Path (Join-Path $Tools "git\cmd")
Prepend-Path (Join-Path $Tools "ffmpeg\bin")
Prepend-Path (Join-Path $Tools "nodejs")
Prepend-Path (Join-Path $Tools "flutter\bin")
Prepend-Path (Join-Path $Tools "jdk\bin")
Prepend-Path (Join-Path $Tools "gradle\bin")

$haveWinget = OnPath "winget"
if (-not $haveWinget -and $ONLINE) {
  Write-Host "Winget not found. Optional installs will be skipped." -ForegroundColor Yellow
  Log "winget not found"
}

# Prompt user for install mode (lightweight tools by default)
Write-Host ""
Write-Host "Dev Assistant setup" -ForegroundColor Cyan
Write-Host "This will check for tools and install if missing (or use portable copies if offline)." -ForegroundColor Gray
Write-Host ""
Write-Host "Choose: [Y] Git & FFmpeg  [A] All common dev tools  [N] None (use portable copies if present)" -ForegroundColor Yellow
$choice = Read-Host "[Y/A/N]"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "Y" }
$choice = $choice.ToUpperInvariant()

$doLight = $choice -eq "Y"
$doAll   = $choice -eq "A"

# Light set (recommended): Git + FFmpeg
$okGit = Ensure-Tool "Git" "git" (Join-Path $Tools "git\cmd") "Git.Git" -TryInstall:$doLight
$okFF  = Ensure-Tool "FFmpeg/ffprobe" "ffprobe" (Join-Path $Tools "ffmpeg\bin") "Gyan.FFmpeg" -TryInstall:$doLight

# Optional heavy set
if ($doAll) {
  if (-not $ONLINE) { Write-Host "Offline: heavy installs will be skipped; using portable if present." -ForegroundColor Yellow }
  $okNode = Ensure-Tool "Node.js" "node" (Join-Path $Tools "nodejs") "OpenJS.NodeJS.LTS" -TryInstall
  $okFlut = Ensure-Tool "Flutter" "flutter" (Join-Path $Tools "flutter\bin") "Google.Flutter" -TryInstall
  $okJDK  = Ensure-Tool "OpenJDK 17" "java" (Join-Path $Tools "jdk\bin") "EclipseAdoptium.Temurin.17.JDK" -TryInstall
  $okGrad = Ensure-Tool "Gradle" "gradle" (Join-Path $Tools "gradle\bin") "Gradle.Gradle" -TryInstall
}

# Summary
Write-Host ""
Write-Host "READY. Launching Dev Assistant..." -ForegroundColor Green
Log "Launching EXE: $Exe"
if (-not (Test-Path $Exe)) { 
  Write-Host "ERROR: $Exe not found." -ForegroundColor Red
  Log "ERROR exe missing"
  exit /b 1
}

# Launch
Start-Process -FilePath $Exe -WorkingDirectory $AppDir
