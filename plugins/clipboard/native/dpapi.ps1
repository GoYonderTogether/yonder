param([string]$Action, [string]$Service, [string]$Path)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$plain = $null
$stream = $null
try {
    Add-Type -AssemblyName System.Security
    $entropy = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($Service))
    if ($Action -eq 'put') {
        $stream = [IO.MemoryStream]::new()
        [Console]::OpenStandardInput().CopyTo($stream)
        $plain = $stream.ToArray()
        if ($plain.Length -gt 65536) { exit 77 }
        $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $out = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $out.Write($cipher, 0, $cipher.Length); $out.Flush($true) } finally { $out.Dispose() }
    } elseif ($Action -eq 'get') {
        if (![IO.File]::Exists($Path)) { exit 66 }
        $cipher = [IO.File]::ReadAllBytes($Path)
        if ($cipher.Length -gt 131072) { exit 77 }
        $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [Console]::OpenStandardOutput().Write($plain, 0, $plain.Length)
    } elseif ($Action -eq 'drop') {
        [IO.File]::Delete($Path)
    } else { exit 77 }
} catch { exit 77 } finally {
    if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
    if ($stream) { $stream.Dispose() }
}
