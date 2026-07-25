$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LauncherPath = Join-Path $ProjectRoot "Start-NF.ps1"

if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) {
    throw "Launcher script not found: $LauncherPath"
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "NF (Development).lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$LauncherPath`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.WindowStyle = 1
$shortcut.Description = "Launch NF in development mode"
$shortcut.Save()

Write-Host "Created shortcut: $shortcutPath"
