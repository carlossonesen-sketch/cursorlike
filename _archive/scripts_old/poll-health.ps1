# Poll llama-server /health every 1s until first 200.
# Usage: start the app and start the runtime first, or run llama-server manually on $port.
# Then: .\scripts\poll-health.ps1   or   $env:LLAMA_PORT=11435; .\scripts\poll-health.ps1
$port = if ($env:LLAMA_PORT) { [int]$env:LLAMA_PORT } else { 8080 }
$uri = "http://127.0.0.1:$port/health"
Write-Host "Polling $uri every 1s (stop after first 200)..."
do {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  try {
    $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 5
    $status = $r.StatusCode
    $body = $r.Content
    if ($body.Length -gt 120) { $body = $body.Substring(0, 120) + "..." }
    Write-Host "$ts  $status  $body"
    if ($status -eq 200) { break }
  } catch {
    Write-Host "$ts  (failed)  $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 1
} while ($true)
