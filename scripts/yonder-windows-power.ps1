$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class YonderPower {
  [DllImport("kernel32.dll",SetLastError=true)] public static extern uint SetThreadExecutionState(uint flags);
}
'@
try {
    while ($null -ne ($line = [Console]::ReadLine())) {
        $request = $line | ConvertFrom-Json
        if ($request.active -lt 0 -or $request.active -gt 100000) { throw 'Invalid lease' }
        $flags = [uint32]2147483648
        if ($request.active -gt 0) { $flags = [uint32]2147483649 }
        $ok = [YonderPower]::SetThreadExecutionState($flags) -ne 0
        @{protected=($ok -and $request.active -gt 0);active=$request.active;error=$(if(!$ok){'Windows rejected power lease'}else{$null})} | ConvertTo-Json -Compress
    }
} finally { [void][YonderPower]::SetThreadExecutionState([uint32]2147483648) }
