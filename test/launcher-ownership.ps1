# Launcher process-ownership regression test (bug-fix pass).
# 1) A FOREIGN process listening on a port must NOT be reported as our harness,
#    must NOT match an empty marker, and must never be killed.
# 2) Stop-OwnedHarnessStack kills ONLY a process whose command line matches the
#    marker (owned), leaving foreign listeners alive.
# 3) restart_harness.ps1 derives the owned forwarder IP (never an empty list).
# Windows PowerShell 5.1 compatible. Dummy servers run from temp .js files so
# Start-Process argument quoting cannot break them.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root "harness-common.ps1")

if (-not (Get-Command Get-OwnedHarnessPid -ErrorAction SilentlyContinue)) {
    Write-Error "Get-OwnedHarnessPid not defined (harness-common.ps1 missing?)"
    exit 1
}

function New-DummyServer([int]$Port, [string]$Marker) {
    $dir = Join-Path $env:TEMP ("remfs-dummy-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $code = "require('http').createServer(function(){ }).listen($Port,'127.0.0.1'); setInterval(function(){},1000);"
    $file = Join-Path $dir "server.js"
    [System.IO.File]::WriteAllText($file, $code)
    # The marker must appear in the PROCESS COMMAND LINE (ownership is verified
    # by command line, not file contents), so pass it as a node argument.
    $argsList = @($file)
    if ($Marker) { $argsList += $Marker }
    $p = Start-Process -FilePath "node" -ArgumentList $argsList -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 2
    return @{ Proc = $p; Dir = $dir }
}

$foreign = $null
$owned = $null
try {
    # --- 1) foreign listener on port A is never ours, never killed ---
    $portA = 3124
    $foreign = New-DummyServer -Port $portA
    $pidOurs = Get-OwnedHarnessPid -Port $portA -Marker "C:\Fake\Not\Our\Path\bin.js"
    if ($null -ne $pidOurs) { Write-Error "foreign :$portA listener reported as our harness"; exit 1 }
    $pidEmpty = Get-OwnedHarnessPid -Port $portA -Marker ""
    if ($null -ne $pidEmpty) { Write-Error "empty marker matched a listener"; exit 1 }
    if (-not (Get-Process -Id $foreign.Proc.Id -ErrorAction SilentlyContinue)) {
        Write-Error "foreign :$portA process died unexpectedly"
        exit 1
    }

    # --- 2) owned listener (marker in cmdline) is killed; foreign survives ---
    $marker = "remfs-ownership-test-marker"
    $portB = 3125
    $owned = New-DummyServer -Port $portB -Marker $marker
    $pidOwned = Get-OwnedHarnessPid -Port $portB -Marker $marker
    if ($null -eq $pidOwned -or $pidOwned -ne $owned.Proc.Id) {
        Write-Error "owned listener not identified (got '$pidOwned', expected $($owned.Proc.Id))"
        exit 1
    }
    Stop-OwnedHarnessStack -Marker $marker -ForwarderIPs @() -Port $portB
    if (Get-Process -Id $owned.Proc.Id -ErrorAction SilentlyContinue) {
        Write-Error "owned listener survived Stop-OwnedHarnessStack"
        exit 1
    }
    if (-not (Get-Process -Id $foreign.Proc.Id -ErrorAction SilentlyContinue)) {
        Write-Error "FOREIGN listener was killed by Stop-OwnedHarnessStack!"
        exit 1
    }

    # --- 3) restart_harness.ps1 derives the OWNED FORWARDER IDENTITY from the
    #        launcher (the forwarder bin path), never an empty IP list, and the
    #        owned forwarders are stopped by exact command-line identity. ---
    $restartSrc = Get-Content (Join-Path $root "restart_harness.ps1") -Raw
    if ($restartSrc -notmatch '\$forwarderBin\s*=\s*Join-Path' -or $restartSrc -notmatch 'tailscale_forward\.js') {
        Write-Error "restart_harness.ps1 must derive the forwarder bin path from the launcher"
        exit 1
    }
    if ($restartSrc -match 'ForwarderIPs\s+@\(\)') {
        Write-Error "restart_harness.ps1 must not pass an empty ForwarderIPs list"
        exit 1
    }

    # --- 4) keep_awake ownership: a stale/reused pid is never trusted or
    #        killed; a process whose cmdline contains the keep_awake bin IS. ---
    $keepAwakeBinFake = "C:\Fake\Not\Our\Path\keep_awake.ps1"
    $keepAwakePid = Join-Path $env:TEMP ("remfs-kap-" + [guid]::NewGuid().ToString("N") + ".pid")
    $foreign2 = $null
    $kap = $null
    try {
        # 4a) pid file pointing at a FOREIGN process (cmdline lacks the bin path)
        $foreign2 = New-DummyServer -Port 3126 -Marker "not-the-keep-awake-bin"
        [System.IO.File]::WriteAllText($keepAwakePid, "$($foreign2.Proc.Id)")
        if (Test-KeepAwakeOwned -PidFile $keepAwakePid -KeepAwakeBin $keepAwakeBinFake) {
            Write-Error "stale keep_awake pid (foreign process) reported as owned"
            exit 1
        }
        Stop-OwnedKeepAwake -PidFile $keepAwakePid -KeepAwakeBin $keepAwakeBinFake
        if (-not (Get-Process -Id $foreign2.Proc.Id -ErrorAction SilentlyContinue)) {
            Write-Error "FOREIGN process killed by Stop-OwnedKeepAwake (stale pid)!"
            exit 1
        }
        if (Test-Path $keepAwakePid) {
            Write-Error "Stop-OwnedKeepAwake must remove the pid file"
            exit 1
        }

        # 4b) a keep_awake-like process whose cmdline contains the bin path IS killed
        $kap = New-DummyServer -Port 3127 -Marker $keepAwakeBinFake
        [System.IO.File]::WriteAllText($keepAwakePid, "$($kap.Proc.Id)")
        if (-not (Test-KeepAwakeOwned -PidFile $keepAwakePid -KeepAwakeBin $keepAwakeBinFake)) {
            Write-Error "owned keep_awake process not identified (cmdline must contain bin path)"
            exit 1
        }
        Stop-OwnedKeepAwake -PidFile $keepAwakePid -KeepAwakeBin $keepAwakeBinFake
        if (Get-Process -Id $kap.Proc.Id -ErrorAction SilentlyContinue) {
            Write-Error "owned keep_awake process survived Stop-OwnedKeepAwake"
            exit 1
        }
        Write-Host "keep_awake ownership: OK (stale pid never trusted/killed, owned killed)"
    } finally {
        if ($foreign2) { Stop-Process -Id $foreign2.Proc.Id -Force -ErrorAction SilentlyContinue; Remove-Item $foreign2.Dir -Recurse -Force -ErrorAction SilentlyContinue }
        if ($kap) { Stop-Process -Id $kap.Proc.Id -Force -ErrorAction SilentlyContinue; Remove-Item $kap.Dir -Recurse -Force -ErrorAction SilentlyContinue }
        Remove-Item $keepAwakePid -Force -ErrorAction SilentlyContinue
    }

    # --- 5) LAN forwarder lifecycle (65c52ca audit item 3): stop/restart must
    #        kill EVERY owned forwarder (Tailscale IP AND the dynamic LAN IP),
    #        tracked by PID + exact command-line identity - never only the
    #        Tailscale IP. A FOREIGN listener on a LAN IP must fail visibly. ---
    $fwdBinFake = "C:\Fake\Not\Our\Path\tailscale_forward.js"
    $fwdLan = $null
    $fwdTs = $null
    $foreign3 = $null
    try {
        # two forwarder-like processes (LAN + Tailscale) whose cmdline contains
        # the forwarder bin path, plus a foreign process that does not
        $fwdLan = New-DummyServer -Port 3128 -Marker $fwdBinFake
        $fwdTs = New-DummyServer -Port 3129 -Marker $fwdBinFake
        $foreign3 = New-DummyServer -Port 3130 -Marker "not-a-forwarder"

        $allOwned = Get-OwnedForwarderPids -ForwarderBin $fwdBinFake
        if ($null -eq $allOwned) { Write-Error "Get-OwnedForwarderPids returned null"; exit 1 }
        if ($allOwned -notcontains $fwdLan.Proc.Id -or $allOwned -notcontains $fwdTs.Proc.Id) {
            Write-Error "Get-OwnedForwarderPids must find ALL owned forwarders by cmdline identity (got: $($allOwned -join ','))"
            exit 1
        }
        if ($allOwned -contains $foreign3.Proc.Id) {
            Write-Error "Get-OwnedForwarderPids must NOT match a process without the forwarder bin path"
            exit 1
        }

        # Stop-OwnedHarnessStack -ForwarderBin kills BOTH owned forwarders,
        # leaves the foreign one alive.
        Stop-OwnedHarnessStack -Marker "unused-marker" -ForwarderBin $fwdBinFake -Port 3080
        if (Get-Process -Id $fwdLan.Proc.Id -ErrorAction SilentlyContinue) {
            Write-Error "LAN forwarder survived Stop-OwnedHarnessStack"
            exit 1
        }
        if (Get-Process -Id $fwdTs.Proc.Id -ErrorAction SilentlyContinue) {
            Write-Error "Tailscale forwarder survived Stop-OwnedHarnessStack"
            exit 1
        }
        if (-not (Get-Process -Id $foreign3.Proc.Id -ErrorAction SilentlyContinue)) {
            Write-Error "FOREIGN process killed by Stop-OwnedHarnessStack (forwarder bin mismatch)!"
            exit 1
        }

        # stop/restart must derive the forwarder bin path (not only an IP list),
        # and the start template must fail VISIBLY on a foreign LAN listener.
        $stopSrc = Get-Content (Join-Path $root "stop_harness.ps1") -Raw
        if ($stopSrc -notmatch 'ForwarderBin' -or $stopSrc -notmatch 'tailscale_forward\.js') {
            Write-Error "stop_harness.ps1 must stop ALL forwarders by bin-path identity (ForwarderBin)"
            exit 1
        }
        $restartSrc2 = Get-Content (Join-Path $root "restart_harness.ps1") -Raw
        if ($restartSrc2 -notmatch 'ForwarderBin' -or $restartSrc2 -notmatch 'tailscale_forward\.js') {
            Write-Error "restart_harness.ps1 must stop ALL forwarders by bin-path identity (ForwarderBin)"
            exit 1
        }
        $tplSrc = Get-Content (Join-Path $root "start_harness.template.ps1") -Raw
        if ($tplSrc -notmatch 'Get-OwnedForwarderPid -ListenIP \$lanIP') {
            Write-Error "start_harness template must verify the LAN listener is OURS (Get-OwnedForwarderPid -ListenIP \$lanIP)"
            exit 1
        }
        if ($tplSrc -notmatch 'foreign|FOREIGN|foreign process') {
            Write-Error "start_harness template must fail visibly when a foreign process owns the LAN:3080 listener"
            exit 1
        }
        Write-Host "LAN forwarder lifecycle: OK (all owned stopped by bin identity, foreign survives, template fails visibly on foreign LAN listener)"
    } finally {
        if ($fwdLan) { Stop-Process -Id $fwdLan.Proc.Id -Force -ErrorAction SilentlyContinue; Remove-Item $fwdLan.Dir -Recurse -Force -ErrorAction SilentlyContinue }
        if ($fwdTs) { Stop-Process -Id $fwdTs.Proc.Id -Force -ErrorAction SilentlyContinue; Remove-Item $fwdTs.Dir -Recurse -Force -ErrorAction SilentlyContinue }
        if ($foreign3) { Stop-Process -Id $foreign3.Proc.Id -Force -ErrorAction SilentlyContinue; Remove-Item $foreign3.Dir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    Write-Host "launcher ownership: OK (foreign not trusted/killed, owned killed, forwarder IP derived)"
} finally {
    if ($foreign) { Stop-Process -Id $foreign.Proc.Id -Force -ErrorAction SilentlyContinue; Remove-Item $foreign.Dir -Recurse -Force -ErrorAction SilentlyContinue }
    if ($owned) { Stop-Process -Id $owned.Proc.Id -Force -ErrorAction SilentlyContinue; Remove-Item $owned.Dir -Recurse -Force -ErrorAction SilentlyContinue }
}
