# Shared process-ownership helpers for the DeepSeek Harness launcher.
#
# "Port 3080 is listening" is NOT enough to mean "our harness is running": an
# unrelated localhost service could occupy it. Every check verifies the owning
# process's command line before trusting, starting or killing anything, so the
# launcher never exposes a foreign 3080 service to Tailscale/LAN and stop /
# restart never kills a process we do not own.
#
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.

$ErrorActionPreference = "Continue"

# Returns the PID of the process listening on 127.0.0.1:$Port whose command
# line contains $Marker (e.g. the dsh bin path), or $null when it is not ours.
function Get-OwnedHarnessPid {
    param([int]$Port = 3080, [string]$Marker)
    $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return $null }
    foreach ($p in ($conn.OwningProcess | Sort-Object -Unique)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -and $Marker -and $proc.CommandLine.Contains($Marker)) {
            return [int]$p
        }
    }
    return $null
}

# Returns the PID of the process listening on $ListenIP:$Port whose command
# line contains "tailscale_forward.js" (one of our forwarders), or $null.
function Get-OwnedForwarderPid {
    param([string]$ListenIP, [int]$Port = 3080)
    $conn = Get-NetTCPConnection -LocalAddress $ListenIP -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return $null }
    foreach ($p in ($conn.OwningProcess | Sort-Object -Unique)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -and $proc.CommandLine.Contains("tailscale_forward.js")) {
            return [int]$p
        }
    }
    return $null
}

# Kills ONLY processes this project owns (the harness matching $Marker and our
# forwarders), then waits for the harness port to free up.
function Stop-OwnedHarnessStack {
    param([string]$Marker, [string[]]$ForwarderIPs = @(), [int]$Port = 3080)
    $mine = @()
    $hp = Get-OwnedHarnessPid -Port $Port -Marker $Marker
    if ($hp) { $mine += $hp }
    foreach ($ip in $ForwarderIPs) {
        if (-not $ip) { continue }
        $fp = Get-OwnedForwarderPid -ListenIP $ip -Port $Port
        if ($fp) { $mine += $fp }
    }
    $mine | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-OwnedHarnessPid -Port $Port -Marker $Marker)) { break }
    }
}
