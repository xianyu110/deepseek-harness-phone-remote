# DeepSeek Harness desktop launcher.
# Double-click the desktop shortcut -> ensure the harness and the Tailscale
# phone-access forwarder are running, then open the browser.
# If they are already running, just open the browser.
#
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.
# Placeholders __TSIP__, __TSNAME__, __WORKSPACE__ and __DSHBIN__ are filled by install.ps1.

$ErrorActionPreference = "Continue"

$url = "http://127.0.0.1:3080"
$workspace = "__WORKSPACE__"
$node = "C:\Program Files\nodejs\node.exe"
$dshBin = "__DSHBIN__"
$logDir = Join-Path $env:USERPROFILE ".dsh\launcher"

# Process-ownership helpers: "port listening" alone is never treated as "our
# harness running"; the owning process command line must match $dshBin.
$common = Join-Path $PSScriptRoot "harness-common.ps1"
if (Test-Path $common) { . $common } else {
    Write-Host "[!] harness-common.ps1 missing - ownership checks disabled" -ForegroundColor Yellow
}

function Test-HarnessRunning {
    $pid_ = $null
    if (Get-Command Get-OwnedHarnessPid -ErrorAction SilentlyContinue) {
        $pid_ = Get-OwnedHarnessPid -Port 3080 -Marker $dshBin
    } else {
        $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
        if ($conn) { $pid_ = $conn.OwningProcess | Select-Object -First 1 }
    }
    return ($null -ne $pid_)
}

# Phone access through Tailscale: the GUI binds 127.0.0.1 only, so forward the
# PC's Tailscale IP to it. Ensured on every launch, even when the harness is
# already running, so the phone HTTP path never depends on a manual start.
$tailscaleIP = "__TSIP__"
$forwardBin = Join-Path $PSScriptRoot "tailscale_forward.js"

function Test-ForwardRunning {
    $pid_ = $null
    if (Get-Command Get-OwnedForwarderPid -ErrorAction SilentlyContinue) {
        $pid_ = Get-OwnedForwarderPid -ListenIP $tailscaleIP -Port 3080
    } else {
        $conn = Get-NetTCPConnection -LocalAddress $tailscaleIP -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
        if ($conn) { $pid_ = $conn.OwningProcess | Select-Object -First 1 }
    }
    return ($null -ne $pid_)
}

# Walk-on-LAN is OPT-IN by default. Create %USERPROFILE%\.dsh\lan-on (or set
# the DSH_REMFS_LAN=1 environment variable) to trust the LAN IP and start the
# LAN forwarder. Same-Wi-Fi direct access widens the network exposure, so it
# must be an explicit choice.
$lanOn = (Test-Path (Join-Path $env:USERPROFILE ".dsh\lan-on")) -or ($env:DSH_REMFS_LAN -eq "1")
$lanIP = ""
if ($lanOn) {
    # Excludes loopback, APIPA and the Tailscale CGNAT range. Detected fresh on
    # every launch because DHCP addresses change.
    $cands = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.IPAddress -ne "127.0.0.1" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.IPAddress -notlike "100.*" -and
        $_.PrefixOrigin -ne "WellKnown"
    }
    foreach ($c in ($cands | Sort-Object InterfaceMetric)) {
        $iface = Get-NetAdapter -InterfaceIndex $c.InterfaceIndex -ErrorAction SilentlyContinue
        if ($iface -and $iface.Status -eq "Up") { $lanIP = $c.IPAddress; break }
    }
}

if (-not (Test-Path $node)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Node.js not found: $node", "DeepSeek Harness")
    exit 1
}
if (-not (Test-Path $dshBin)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("dsh not found: $dshBin`nRe-run: npx dsh web once to restore the cache.", "DeepSeek Harness")
    exit 1
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Start the harness only when OUR harness is not already running (a foreign
# process occupying 3080 must not be mistaken for ours and must never be
# exposed to the network).
$ready = $true
if (-not (Test-HarnessRunning)) {
    # Self-heal: with the harness down, its file locks are released, so sync
    # the plugin from vendor into node_modules. Abort rather than launch a
    # harness with a broken plugin import.
    $remfsVendor = "C:\Users\zeta\.dsh\profiles\web\vendor\remfs-persistent"
    $remfsNmPkg = "C:\Users\zeta\.dsh\profiles\web\node_modules\@zetaluolang\remfs-persistent"
    if ((Get-Command Sync-RemfsPlugin -ErrorAction SilentlyContinue) -and -not (Sync-RemfsPlugin -Vendor $remfsVendor -NmPkg $remfsNmPkg)) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show("remfs plugin sync failed. Re-run install.ps1.", "DeepSeek Harness")
        exit 1
    }
    $outLog = Join-Path $logDir "harness_$stamp.out.log"
    $errLog = Join-Path $logDir "harness_$stamp.err.log"

    # Remote access: phone reaches this GUI through the PC's Tailscale IP
    # (plain HTTP via the TCP forwarder), the tailnet HTTPS name (via tailscale
    # serve), and optionally the LAN IP (walk-on-LAN, opt-in). All must pass
    # the /api browser-trust fence.
    $trusted = @("--port", "3080", "--trusted-host", "__TSIP__", "--trusted-host", "__TSNAME__")
    if ($lanIP) { $trusted += @("--trusted-host", $lanIP) }
    $proc = Start-Process -FilePath $node `
        -ArgumentList (@($dshBin, "web") + $trusted) `
        -WorkingDirectory $workspace `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -PassThru

    # Wait up to 30s for OUR harness to come up.
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-HarnessRunning) { $ready = $true; break }
        if ($proc.HasExited) { break }
    }
}

# Ensure the Tailscale forwarder whenever our harness is up. Re-check the port
# here (not the $ready flag) so a slow harness boot still gets its forwarders.
if ((Test-HarnessRunning) -and (Test-Path $forwardBin) -and -not (Test-ForwardRunning)) {
    $fOut = Join-Path $logDir "forward_$stamp.out.log"
    $fErr = Join-Path $logDir "forward_$stamp.err.log"
    Start-Process -FilePath $node `
        -ArgumentList @($forwardBin, $tailscaleIP, "3080", "3080") `
        -WorkingDirectory $workspace `
        -WindowStyle Hidden `
        -RedirectStandardOutput $fOut `
        -RedirectStandardError $fErr | Out-Null
    Start-Sleep -Seconds 1
}

# Walk-on-LAN forwarder: only when explicitly enabled.
if ($lanIP -and (Test-HarnessRunning) -and (Test-Path $forwardBin)) {
    $lanListening = Get-NetTCPConnection -LocalAddress $lanIP -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
    if (-not $lanListening) {
        $fOut = Join-Path $logDir "forward_lan_$stamp.out.log"
        $fErr = Join-Path $logDir "forward_lan_$stamp.err.log"
        Start-Process -FilePath $node `
            -ArgumentList @($forwardBin, $lanIP, "3080", "3080") `
            -WorkingDirectory $workspace `
            -WindowStyle Hidden `
            -RedirectStandardOutput $fOut `
            -RedirectStandardError $fErr | Out-Null
        Start-Sleep -Seconds 1
    }
}

# Keep the system awake while the harness runs (no admin, no power-plan change).
$keepAwakeBin = Join-Path $PSScriptRoot "keep_awake.ps1"
$keepAwakePid = Join-Path $env:TEMP "dsh_keep_awake.pid"
$keepAwakeAlive = $false
if (Test-Path $keepAwakePid) {
    $kp = Get-Content $keepAwakePid -ErrorAction SilentlyContinue
    if ($kp -match '^\d+$') {
        $kpProc = Get-Process -Id ([int]$kp) -ErrorAction SilentlyContinue
        if ($kpProc) { $keepAwakeAlive = $true }
    }
}
if ($ready -and -not $keepAwakeAlive -and (Test-Path $keepAwakeBin)) {
    $kOut = Join-Path $logDir "keepawake_$stamp.out.log"
    $kErr = Join-Path $logDir "keepawake_$stamp.err.log"
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $keepAwakeBin) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $kOut `
        -RedirectStandardError $kErr | Out-Null
}

Start-Process $url

if ($lanIP) {
    Write-Host "Walk-on-LAN (same Wi-Fi): http://$lanIP`:3080"
}

if (-not $ready) {
    Add-Type -AssemblyName System.Windows.Forms
    $detail = ""
    if (Test-Path $errLog) { $detail = (Get-Content $errLog -Tail 5 -ErrorAction SilentlyContinue) -join "`n" }
    [System.Windows.Forms.MessageBox]::Show(
        "Harness did not become ready.`nLogs: $logDir`n`n$detail",
        "DeepSeek Harness"
    )
}
