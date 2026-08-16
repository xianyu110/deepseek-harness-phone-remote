# Deployment smoke test (bug-fix pass: full lib/ copy, no per-file list).
# Verifies: (1) the deploy package ships every lib module, (2) package.json
# ships lib/, (3) install.ps1 copies the WHOLE lib dir, (4) a dry deployment
# actually yields an importable security.js. Windows PowerShell 5.1 compatible.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pkg = Join-Path $root "remfs-persistent"

$required = @("host.js", "client.js", "security.js", "dispatch.js")

# 1) every lib file present in the deploy package
foreach ($f in $required) {
    if (-not (Test-Path (Join-Path $pkg "lib\$f"))) {
        Write-Error "missing lib\$f in the deploy package"
        exit 1
    }
}

# 2) package.json ships the whole lib dir
$pj = Get-Content (Join-Path $pkg "package.json") -Raw | ConvertFrom-Json
if ($null -eq $pj.files -or $pj.files -notcontains "lib") {
    Write-Error "package.json files must include 'lib'"
    exit 1
}

# 3) install.ps1 copies the whole lib dir (Recurse), never a per-file list
$install = Get-Content (Join-Path $root "install.ps1") -Raw
if ($install -match 'Copy-Item\s+\(Join-Path\s+\$pkgSrc\s+"lib"\)\s+\(Join-Path\s+\$pkgDst\s+"lib"\)\s+-Recurse') {
    # ok
} else {
    Write-Error "install.ps1 must copy the whole lib dir (Copy-Item ... lib ... -Recurse)"
    exit 1
}

# 4) dry deployment to a temp profile and import the deployed security module
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("remfs-smoke-" + [guid]::NewGuid().ToString("N"))
$profileDir = Join-Path $tmp "profiles\web"
$dst = Join-Path $profileDir "vendor\remfs-persistent"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item (Join-Path $pkg "package.json") (Join-Path $dst "package.json") -Force
Copy-Item (Join-Path $pkg "lib") (Join-Path $dst "lib") -Recurse -Force
try {
    foreach ($f in $required) {
        if (-not (Test-Path (Join-Path $dst "lib\$f"))) {
            Write-Error "dry deployment missing lib\$f"
            exit 1
        }
    }
    $url = "file:///" + ((Join-Path $dst "lib\security.js") -replace '\\', '/')
    & node --input-type=module -e "const m = await import('$url'); if (!m || typeof m.verifyDevice !== 'function') process.exit(1);" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "deployed security.js is not importable"
        exit 1
    }
    Write-Host "install smoke: OK (full lib dir deployed, security.js importable)"
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# 5) install.ps1 must never print a blank "https://" phone URL when the
#    Tailscale MagicDNS name is unavailable (65c52ca audit item 6): the print
#    must be guarded by a tsName validity check, and appear exactly once.
$httpsHits = [regex]::Matches($install, 'https://\$tsName')
if ($httpsHits.Count -ne 1) {
    Write-Error "install.ps1 must print the https phone URL exactly once (guarded); found $($httpsHits.Count)"
    exit 1
}
if ($install -notmatch '(?s)if \(\$tsName -match ''\\\.ts\\\.net\$''\) \{.*?https://\$tsName') {
    Write-Error "install.ps1 phone-URL print must be guarded by a valid tsName check"
    exit 1
}
Write-Host "install smoke: OK (phone URL guarded, no blank https://)"
