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

# 6) 65c52ca audit item 5: install.ps1 must resolve the dsh entry
#    DETERMINISTICALLY (highest version across every npx cache entry, never
#    the first arbitrary one), record the actual version into the launcher,
#    and the launcher message must use the official package name.
if ($install -notmatch 'Get-DshCandidates|Get-VersionKey') {
    Write-Error "install.ps1 must compare dsh versions across all cache entries (deterministic resolution)"
    exit 1
}
if ($install -notmatch '\$dshVersion' -or $install -notmatch '__DSHVERSION__') {
    Write-Error "install.ps1 must record the resolved dsh version into start_harness.ps1 (__DSHVERSION__)"
    exit 1
}
if ($install -match 'foreach \(\$c in \$candidates\).*break') {
    Write-Error "install.ps1 must NOT stop at the first arbitrary dsh entry"
    exit 1
}
$tpl = Get-Content (Join-Path $root "start_harness.template.ps1") -Raw
if ($tpl -notmatch '__DSHVERSION__') {
    Write-Error "start_harness.template.ps1 must declare a __DSHVERSION__ placeholder"
    exit 1
}
if ($tpl -match 'npx dsh web') {
    Write-Error "launcher message must use the official 'npx @deepseek-ai/dsh web' (found bare 'npx dsh web')"
    exit 1
}
if ($tpl -notmatch 'npx @deepseek-ai/dsh web') {
    Write-Error "launcher message must reference the official package '@deepseek-ai/dsh'"
    exit 1
}
Write-Host "install smoke: OK (deterministic dsh version resolution, official package message)"
