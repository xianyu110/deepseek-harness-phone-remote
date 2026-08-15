# Keep the system awake while the DeepSeek Harness runs.
# Uses SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED); no admin
# needed and no power-plan change. Exiting this process releases the request.
#
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.

$pidFile = Join-Path $env:TEMP "dsh_keep_awake.pid"
try { "$PID" | Out-File -FilePath $pidFile -Encoding ascii -ErrorAction Stop } catch { }

Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class DshKeepAwake {
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

while ($true) {
    try { [DshKeepAwake]::SetThreadExecutionState(0x80000001) | Out-Null } catch { }
    Start-Sleep -Seconds 30
}
