# Request a pairing-code rotation from the RUNNING harness host process.
#
# Single-writer model: ONLY the host process mutates ~/.dsh/remfs-security.json
# (under its own store lock). This script never reads/writes the store; it
# drops a flag file that the host's rotation watcher picks up (within ~8s),
# then waits for the fresh code to appear in remfs-pairing.txt.
#
# Windows PowerShell 5.1 compatible.
$ErrorActionPreference = "Stop"

$flag = Join-Path $env:USERPROFILE ".dsh\remfs-pairing-rotate.flag"
$txt  = Join-Path $env:USERPROFILE ".dsh\remfs-pairing.txt"

$before = ""
if (Test-Path $txt) { $before = (Get-Content $txt -TotalCount 1) }

[System.IO.File]::WriteAllText($flag, (Get-Date).ToUniversalTime().ToString("o"))
Write-Host "Rotation requested - waiting for the harness to write a new code..."

for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $txt) {
        $line = Get-Content $txt -TotalCount 1
        if ($line -and $line -ne $before -and $line -notmatch '^CONSUMED') {
            Write-Host "NEW PAIRING CODE: $line"
            exit 0
        }
    }
}

Write-Host "[!] No new code within 12s - is the harness running? (rotation happens only while the host process is alive)" -ForegroundColor Yellow
exit 1
