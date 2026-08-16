# Regenerate the /remfs pairing code on the PC (no harness restart needed).
# Prints the fresh one-time code and writes it to remfs-pairing.txt.
# Windows PowerShell 5.1 compatible; Node ^22.19 || >=24 required.
$ErrorActionPreference = "Stop"

$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) {
    Write-Host "[X] Node.js not found at $node" -ForegroundColor Red
    exit 1
}

$secFile = Join-Path $env:USERPROFILE ".dsh\remfs-security.json"
$secJs   = Join-Path $env:USERPROFILE ".dsh\profiles\web\vendor\remfs-persistent\lib\security.js"
if (-not (Test-Path $secJs)) {
    Write-Host "[X] security.js not found at $secJs - re-run install.ps1" -ForegroundColor Red
    exit 1
}

$secUrl = "file:///" + ($secFile -replace '\\', '/')
$jsUrl  = "file:///" + ($secJs -replace '\\', '/')
# ensurePairingCode wants a plain filesystem path, so escape backslashes for
# the JS single-quoted string (PowerShell passes '\\' through verbatim).
$secJsPath = $secFile -replace '\\', '\\'
$expr   = "const m = await import('$jsUrl'); const c = await m.ensurePairingCode('$secJsPath'); console.log(c ? ('NEW PAIRING CODE: ' + c) : 'code unchanged (see ~/.dsh/remfs-pairing.txt)')"

& $node --input-type=module -e $expr
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
