# One-shot restart for the DeepSeek Harness Web GUI.
# Kills ONLY processes this project owns (the dsh web process matching the
# launcher's dshBin, plus our Tailscale forwarder), then relaunches via
# start_harness.ps1. A foreign process listening on 3080 is never killed and
# never exposed to the network.
#
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.

$ErrorActionPreference = "Continue"
$port = 3080
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Optional delayed start (seconds) so the user can read a message first.
$delay = 20
if ($args.Count -gt 0 -and $args[0] -match '^\d+$') { $delay = [int]$args[0] }
if ($delay -gt 0) { Start-Sleep -Seconds $delay }

$common = Join-Path $scriptDir "harness-common.ps1"
if (Test-Path $common) { . $common }

# Our harness marker comes from the generated launcher's $dshBin line; the
# owned forwarder address from its $tailscaleIP line.
$startScript = Join-Path $scriptDir "start_harness.ps1"
$marker = ""
$forwardIPs = @()
if (Test-Path $startScript) {
    $dshLine = Get-Content $startScript | Where-Object { $_ -match '^\$dshBin\s*=\s*"' } | Select-Object -First 1
    if ($dshLine -and $dshLine -match '"([^"]+)"') { $marker = $Matches[1] }
    $tsLine = Get-Content $startScript | Where-Object { $_ -match '^\$tailscaleIP\s*=\s*"' } | Select-Object -First 1
    if ($tsLine -and $tsLine -match '"([^"]+)"') { $forwardIPs += $Matches[1] }
}

if ($marker -and (Get-Command Stop-OwnedHarnessStack -ErrorAction SilentlyContinue)) {
    Stop-OwnedHarnessStack -Marker $marker -ForwarderIPs $forwardIPs -Port $port
} elseif ($marker) {
    $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        foreach ($p in ($conn.OwningProcess | Sort-Object -Unique)) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
            if ($proc -and $proc.CommandLine -and $proc.CommandLine.Contains($marker)) {
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            }
        }
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500
            $still = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue
            if (-not $still) { break }
        }
    }
}

# Relaunch (starts the harness hidden and waits for the port, then opens the browser).
& (Join-Path $scriptDir "start_harness.ps1")
