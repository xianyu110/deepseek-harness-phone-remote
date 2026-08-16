# Stop the DeepSeek Harness remote-access stack cleanly:
#   - dsh web (127.0.0.1:3080) - ONLY our own process (command-line verified)
#   - our Tailscale forwarder (the PC's Tailscale IP:3080)
#   - keep_awake.ps1 (via its pid file), so the PC may sleep again
# A FOREIGN process listening on 3080 is never killed.
# Leaves Tailscale itself running (the phone still needs the VPN).
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.
$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$common = Join-Path $scriptDir "harness-common.ps1"
if (-not (Test-Path $common)) {
    Write-Host "[X] harness-common.ps1 missing - refusing to stop anything blindly." -ForegroundColor Red
    exit 1
}
. $common

# Identify our harness marker from the launcher's own $dshBin line.
$startScript = Join-Path $scriptDir "start_harness.ps1"
$marker = ""
$forwardIPs = @()
if (Test-Path $startScript) {
    $dshLine = Get-Content $startScript | Where-Object { $_ -match '^\$dshBin\s*=\s*"' } | Select-Object -First 1
    if ($dshLine -and $dshLine -match '"([^"]+)"') { $marker = $Matches[1] }
    $tsLine = Get-Content $startScript | Where-Object { $_ -match '^\$tailscaleIP\s*=\s*"' } | Select-Object -First 1
    if ($tsLine -and $tsLine -match '"([^"]+)"') { $forwardIPs += $Matches[1] }
}

# 1. Kill ONLY processes this project owns (harness + our forwarders).
if ($marker -and (Get-Command Stop-OwnedHarnessStack -ErrorAction SilentlyContinue)) {
    Stop-OwnedHarnessStack -Marker $marker -ForwarderIPs $forwardIPs -Port 3080
} elseif ($marker) {
    $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        foreach ($p in ($conn.OwningProcess | Sort-Object -Unique)) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
            if ($proc -and $proc.CommandLine -and $proc.CommandLine.Contains($marker)) {
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# 2. keep_awake helper: ONLY if the pid's command line matches the deployed
#    keep_awake.ps1 path (a stale/reused pid is never killed blindly).
$pidFile = Join-Path $env:TEMP "dsh_keep_awake.pid"
$keepAwakeBin = Join-Path $scriptDir "keep_awake.ps1"
if (Get-Command Stop-OwnedKeepAwake -ErrorAction SilentlyContinue) {
    Stop-OwnedKeepAwake -PidFile $pidFile -KeepAwakeBin $keepAwakeBin
} else {
    if (Test-Path $pidFile) {
        $kp = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($kp -match '^\d+$') {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$kp)" -ErrorAction SilentlyContinue
            if ($proc -and $proc.CommandLine -and $proc.CommandLine.Contains($keepAwakeBin)) {
                Stop-Process -Id ([int]$kp) -Force -ErrorAction SilentlyContinue
            }
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Owned Harness, forwarder and keep_awake stopped. Tailscale is still up."
