# Launcher process-ownership regression test (bug-fix pass).
# A FOREIGN process listening on 127.0.0.1:3080 must NOT be reported as our
# harness, must NOT match an empty marker, and must never be killed. Windows
# PowerShell 5.1 compatible.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root "harness-common.ps1")

if (-not (Get-Command Get-OwnedHarnessPid -ErrorAction SilentlyContinue)) {
    Write-Error "Get-OwnedHarnessPid not defined (harness-common.ps1 missing?)"
    exit 1
}

# Dummy listener on a spare port (the real harness may occupy 3080).
$port = 3123
$dummy = Start-Process -FilePath "node" `
    -ArgumentList @("-e", "require('http').createServer(function(){ }).listen($port,'127.0.0.1'); setInterval(function(){},1000);") `
    -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
try {
    # 1) a foreign listener must never be reported as ours (marker mismatch)
    $pidOurs = Get-OwnedHarnessPid -Port $port -Marker "C:\Fake\Not\Our\Path\bin.js"
    if ($null -ne $pidOurs) {
        Write-Error "foreign :$port listener reported as our harness"
        exit 1
    }
    # 2) an empty marker must never match anything
    $pidEmpty = Get-OwnedHarnessPid -Port $port -Marker ""
    if ($null -ne $pidEmpty) {
        Write-Error "empty marker matched a listener"
        exit 1
    }
    # 3) the foreign process must still be alive (we never killed it)
    $alive = Get-Process -Id $dummy.Id -ErrorAction SilentlyContinue
    if (-not $alive) {
        Write-Error "foreign :3080 process was killed by ownership logic!"
        exit 1
    }
    Write-Host "launcher ownership: OK (foreign :3080 not trusted, not killed)"
} finally {
    Stop-Process -Id $dummy.Id -Force -ErrorAction SilentlyContinue
}
