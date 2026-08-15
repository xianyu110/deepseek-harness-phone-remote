# Keep the system awake while the DeepSeek Harness runs.
# Uses SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED); no admin
# needed and no power-plan change. Exiting this process releases the request.
#
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.
#
# NOTE: the flag MUST be passed as [uint32] - PowerShell parses a bare
# 0x80000001 as a signed int32 (-2147483647), which fails the UInt32
# parameter conversion, throwing every call and silently keeping the loop
# alive while doing NOTHING (the original bug that let the PC sleep).
# A status file makes a broken invocation visible instead of silent.

$pidFile = Join-Path $env:TEMP "dsh_keep_awake.pid"
$statusFile = Join-Path $env:TEMP "dsh_keep_awake.status"
try { "$PID" | Out-File -FilePath $pidFile -Encoding ascii -ErrorAction Stop } catch { }

Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class DshKeepAwake {
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

$ok = $false
# ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x1.
# Use DECIMAL literals: PowerShell parses a hex literal >= 0x80000000 as a
# negative Int32, and the .NET method binder then fails to convert it to the
# UInt32 parameter, so every call throws (the original silent-failure bug).
$flags = [uint32]2147483649
while ($true) {
    try {
        $r = [DshKeepAwake]::SetThreadExecutionState($flags)
        if (-not $ok) {
            $ok = $true
            try { "OK $PID $(Get-Date -Format o) ret=$r" | Out-File -FilePath $statusFile -Encoding ascii -ErrorAction Stop } catch { }
        }
    } catch {
        try { "FAIL $PID $(Get-Date -Format o) $($_.Exception.Message)" | Out-File -FilePath $statusFile -Encoding ascii -ErrorAction Stop } catch { }
    }
    Start-Sleep -Seconds 30
}
