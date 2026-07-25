$ErrorActionPreference = "Stop"

function Stop-WithMessage {
    param([string]$Message)

    Write-Host ""
    Write-Host "NF development launcher failed:" -ForegroundColor Red
    Write-Host $Message -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close this window"
    exit 1
}

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $ProjectRoot "app"

try {
    Set-Location -LiteralPath $ProjectRoot
} catch {
    Stop-WithMessage "Could not change to project directory: $ProjectRoot"
}

if (-not (Test-Path -LiteralPath $AppRoot -PathType Container)) {
    Stop-WithMessage "Could not find the app directory: $AppRoot"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Stop-WithMessage "Node.js was not found on PATH. Install Node.js, then open a new PowerShell window and try again."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $npmCommand) {
    Stop-WithMessage "npm was not found on PATH. Install Node.js/npm, then open a new PowerShell window and try again."
}

if (-not (Test-Path -LiteralPath (Join-Path $AppRoot "package.json") -PathType Leaf)) {
    Stop-WithMessage "Could not find app/package.json. The repository may be incomplete."
}

Write-Host "Starting NF development app..." -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"
Write-Host "App:     $AppRoot"
Write-Host ""

try {
    Set-Location -LiteralPath $AppRoot
    & $npmCommand.Source run tauri dev
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Stop-WithMessage "npm run tauri dev exited with code $exitCode."
    }
} catch {
    Stop-WithMessage $_.Exception.Message
}
