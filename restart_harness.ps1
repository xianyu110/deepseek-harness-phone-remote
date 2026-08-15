# One-shot restart for the DeepSeek Harness Web GUI.
# Kills the process listening on port 3080, then relaunches via start_harness.ps1
# so the new --trusted-host flag takes effect.
#
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.

$ErrorActionPreference = "Continue"
$port = 3080
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Optional delayed start (seconds) so the user can read a message first.
$delay = 20
if ($args.Count -gt 0 -and $args[0] -match '^\d+$') { $delay = [int]$args[0] }
if ($delay -gt 0) { Start-Sleep -Seconds $delay }

# Kill every process listening on the harness port: dsh web on 127.0.0.1 and
# the Tailscale forwarder on the Tailscale IP. Killing only the first match
# could leave the other one half-alive.
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
$pidsToKill = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $pidsToKill) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
    # Wait for the port to free up.
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        $still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $still) { break }
    }

# Relaunch (starts the harness hidden and waits for the port, then opens the browser).
& (Join-Path $scriptDir "start_harness.ps1")
