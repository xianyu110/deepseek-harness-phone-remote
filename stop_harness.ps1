# Stop the DeepSeek Harness remote-access stack cleanly:
#   - dsh web (127.0.0.1:3080)
#   - Tailscale forwarder (the PC's Tailscale IP:3080)
#   - keep_awake.ps1 (via its pid file), so the PC may sleep again
# Leaves Tailscale itself running (the phone still needs the VPN).
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.
$ErrorActionPreference = "Continue"

# 1. Harness + forwarder (any listener on 3080).
$conns = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
$pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $pids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}

# 2. keep_awake helper (registered via pid file).
$pidFile = Join-Path $env:TEMP "dsh_keep_awake.pid"
if (Test-Path $pidFile) {
    $kp = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($kp -match '^\d+$') {
        Stop-Process -Id ([int]$kp) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Harness, forwarder and keep_awake stopped. Tailscale is still up."
