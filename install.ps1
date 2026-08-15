# DeepSeek Harness Phone Remote - one-click deploy.
# Checks the environment, writes start_harness.ps1 from a template with the
# detected Tailscale values, enables Tailscale Serve (HTTPS), and prints the
# phone URLs. All comments are ASCII on purpose (PS 5.1 UTF-8 issue).
#
# Run: right-click "Run with PowerShell" or double-click 一键部署.cmd

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  DeepSeek Harness Phone Remote - One-Click Deploy" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. basic checks ----------
$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) {
    Write-Host "[X] Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js found"

$tsSvc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
if (-not $tsSvc -or $tsSvc.Status -ne "Running") {
    Write-Host "[X] Tailscale service is not running. Install and sign in: https://tailscale.com/download" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Tailscale service running"

# ---------- 2. read Tailscale identity ----------
$tsCli = "C:\Program Files\Tailscale\tailscale.exe"
$tsIP = ""
$tsName = ""
try {
    $tsIP = (& $tsCli ip -4 2>$null | Select-Object -First 1).Trim()
    $json = & $tsCli status --json 2>$null | Out-String
    if ($json) {
        $obj = $json | ConvertFrom-Json
        $tsName = ($obj.Self.DNSName -replace '\.$', '')
    }
} catch { }
if (-not $tsIP) {
    Write-Host "[!] Could not read the Tailscale IP (may need admin rights)." -ForegroundColor Yellow
    $tsIP = Read-Host "    Enter this PC's Tailscale IP manually (e.g. 100.x.y.z)"
}
if (-not $tsName) { $tsName = $env:COMPUTERNAME + ".tailnet.ts.net" }
Write-Host "[OK] Tailscale IP: $tsIP"
Write-Host "[OK] MagicDNS name: $tsName"

# ---------- 3. write runtime files ----------
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$ws  = Join-Path $env:USERPROFILE "Documents"
# Runtime scripts live OUTSIDE Documents so the phone file plugin can never
# rewrite its own launcher (Documents is the default allowed root).
$scriptDir = Join-Path $env:USERPROFILE ".dsh\launcher"
New-Item -ItemType Directory -Force -Path $scriptDir | Out-Null

foreach ($f in @("tailscale_forward.js", "restart_harness.ps1", "stop_harness.ps1", "keep_awake.ps1")) {
    if (Test-Path (Join-Path $src $f)) {
        Copy-Item (Join-Path $src $f) (Join-Path $scriptDir $f) -Force
    }
}

$template = Join-Path $src "start_harness.template.ps1"
if (Test-Path $template) {
    # Locate the dsh entry under the npx cache (the _npx hash dir changes per install).
    $dshBin = ""
    $candidates = Get-ChildItem (Join-Path $env:LOCALAPPDATA "npm-cache\_npx") -Directory -ErrorAction SilentlyContinue
    foreach ($c in $candidates) {
        $probe = Join-Path $c.FullName "node_modules\@deepseek-ai\dsh\lib\bin.js"
        if (Test-Path $probe) { $dshBin = $probe; break }
    }
    if (-not $dshBin) {
        Write-Host "[!] dsh entry not found under the npx cache; start_harness.ps1 will need a manual dshBin path." -ForegroundColor Yellow
    }

    $content = Get-Content $template -Raw
    $content = $content -replace '__TSIP__', $tsIP
    $content = $content -replace '__WORKSPACE__', $ws
    $content = $content -replace '__DSHBIN__', $dshBin
    $tsNameValid = ($tsName -match '\.ts\.net$')
    if ($tsNameValid) {
        $content = $content -replace '__TSNAME__', $tsName
    } else {
        $content = $content -replace ', "--trusted-host", "__TSNAME__"', ''
    }
    $content | Out-File -FilePath (Join-Path $scriptDir "start_harness.ps1") -Encoding ascii
    Write-Host "[OK] start_harness.ps1 written to $scriptDir (trusted host: $tsIP)"
} else {
    Write-Host "[!] template missing: $template" -ForegroundColor Yellow
}

# ---------- 3b. install the persistent file plugin into the web profile ----------
$profileDir = Join-Path (Join-Path $env:USERPROFILE ".dsh") "profiles\web"
$pkgSrc = Join-Path $src "remfs-persistent"
if ((Test-Path $profileDir) -and (Test-Path $pkgSrc)) {
    $pkgDst = Join-Path $profileDir "vendor\remfs-persistent"
    New-Item -ItemType Directory -Force -Path (Join-Path $pkgDst "lib") | Out-Null
    Copy-Item (Join-Path $pkgSrc "package.json") (Join-Path $pkgDst "package.json") -Force
    Copy-Item (Join-Path $pkgSrc "lib\host.js") (Join-Path $pkgDst "lib\host.js") -Force
    Copy-Item (Join-Path $pkgSrc "lib\client.js") (Join-Path $pkgDst "lib\client.js") -Force

    # Link (or copy) into the profile node_modules so the loader can resolve it.
    $nmPkg = Join-Path $profileDir "node_modules\@zetaluolang\remfs-persistent"
    New-Item -ItemType Directory -Force -Path (Split-Path $nmPkg) | Out-Null
    if (-not (Test-Path $nmPkg)) {
        New-Item -ItemType Junction -Path $nmPkg -Target $pkgDst -ErrorAction SilentlyContinue | Out-Null
        if (-not (Test-Path (Join-Path $nmPkg "package.json"))) {
            Copy-Item $pkgDst $nmPkg -Recurse -Force
        }
    }

    # Ensure the loader patch row exists (idempotent).
    $patch = Join-Path $profileDir "cordis.patch.yml"
    if (-not (Test-Path $patch) -or -not (Select-String -Path $patch -Pattern "remfs-persistent" -Quiet)) {
        Add-Content -Path $patch -Value "`n- insert:`n    - id: remfs-persistent`n      name: '@zetaluolang/remfs-persistent'`n      inject: [connection, fs]`n" -Encoding ascii
    }
    Write-Host "[OK] persistent plugin installed into the web profile"
} else {
    Write-Host "[!] web profile or remfs-persistent package missing - skip plugin install" -ForegroundColor Yellow
}

# ---------- 4. enable Tailscale Serve (HTTPS) ----------
Write-Host ""
Write-Host "[...] Enabling Tailscale Serve (HTTPS; needs 'HTTPS Certificates' enabled in the tailnet)..." -ForegroundColor Yellow
$serveOut = (& $tsCli serve --bg http://127.0.0.1:3080 2>&1 | Out-String)
if ($LASTEXITCODE -eq 0 -or $serveOut -match "Available within your tailnet") {
    Write-Host "[OK] Tailscale Serve enabled"
} else {
    Write-Host "[!] Serve could not be enabled: $serveOut" -ForegroundColor Yellow
    Write-Host "    Enable 'HTTPS Certificates' at https://login.tailscale.com/admin/dns and re-run." -ForegroundColor Yellow
}

# ---------- 5. print phone URLs ----------
Write-Host ""
Write-Host "================== DONE ==================" -ForegroundColor Green
Write-Host "Phone URL (recommended):" -ForegroundColor Green
Write-Host "   https://$tsName" -ForegroundColor White
Write-Host "Fallback (plain HTTP):" -ForegroundColor Green
Write-Host "   http://$tsIP`:3080" -ForegroundColor White
Write-Host ""
Write-Host "Phone: 1) Tailscale app -> Connected. 2) Open the URL in the browser." -ForegroundColor Yellow
Write-Host "PC daily: double-click the 'DeepSeek Harness' desktop shortcut." -ForegroundColor Yellow
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
