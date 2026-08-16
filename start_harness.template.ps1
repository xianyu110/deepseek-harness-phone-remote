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

function Test-HarnessListening {
    $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

# Phone access through Tailscale: the GUI binds 127.0.0.1 only, so forward the
# PC's Tailscale IP to it. Ensured on every launch, even when the harness is
# already running, so the phone HTTP path never depends on a manual start.
$tailscaleIP = "__TSIP__"
$forwardBin = Join-Path $PSScriptRoot "tailscale_forward.js"

function Test-ForwardListening {
    $conn = Get-NetTCPConnection -LocalAddress $tailscaleIP -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

# Walk-on-LAN: when the phone is on the same Wi-Fi it can bypass Tailscale and
# connect straight to the PC's LAN IP. Detected fresh on every launch because
# DHCP addresses change. Excludes loopback, APIPA, and the Tailscale CGNAT range.
function Get-LanIPv4 {
    $cands = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.IPAddress -ne "127.0.0.1" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.IPAddress -notlike "100.*" -and
        $_.PrefixOrigin -ne "WellKnown"
    }
    foreach ($c in ($cands | Sort-Object InterfaceMetric)) {
        $iface = Get-NetAdapter -InterfaceIndex $c.InterfaceIndex -ErrorAction SilentlyContinue
        if ($iface -and $iface.Status -eq "Up") { return $c.IPAddress }
    }
    return ""
}
$lanIP = Get-LanIPv4

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

# Start the harness only when it is not already running.
$ready = $true
if (-not (Test-HarnessListening)) {
    $outLog = Join-Path $logDir "harness_$stamp.out.log"
    $errLog = Join-Path $logDir "harness_$stamp.err.log"

    # Remote access: phone reaches this GUI through the PC's Tailscale IP
    # (plain HTTP via the TCP forwarder), the tailnet HTTPS name (via tailscale
    # serve), and the LAN IP (walk-on-LAN, same Wi-Fi). All must pass the /api
    # browser-trust fence.
    $trusted = @("--port", "3080", "--trusted-host", "__TSIP__", "--trusted-host", "__TSNAME__")
    if ($lanIP) { $trusted += @("--trusted-host", $lanIP) }
    $proc = Start-Process -FilePath $node `
        -ArgumentList (@($dshBin, "web") + $trusted) `
        -WorkingDirectory $workspace `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -PassThru

    # Wait up to 30s for the port to come up.
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-HarnessListening) { $ready = $true; break }
        if ($proc.HasExited) { break }
    }
}

# Ensure the Tailscale forwarder whenever the harness is up.
if ($ready -and (Test-Path $forwardBin) -and -not (Test-ForwardListening)) {
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

# Walk-on-LAN forwarder: same-Wi-Fi access without Tailscale.
if ($ready -and $lanIP -and (Test-Path $forwardBin)) {
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
