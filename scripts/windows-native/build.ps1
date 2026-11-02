# Maintainers/CI only. Normal installs use the verified prebuilds in the source tag.
param([ValidateSet('x64', 'arm64')][string]$Arch = (node -p 'process.arch'))
$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location $Root
$NodeVersion = (& node --input-type=module -e "import { NODE_VERSION } from './scripts/windows-native/artifacts.mjs'; console.log(NODE_VERSION)").Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read pinned Node version' }
$Build = Join-Path $Root ".build/windows-native/$Arch"
$Out = Join-Path $Root "packages/sdk/native/win32-$Arch"
New-Item -ItemType Directory -Force $Build, "$Build/headers", $Out | Out-Null
$Base = "https://nodejs.org/dist/v$NodeVersion"
$Archive = "node-v$NodeVersion-headers.tar.gz"
Invoke-WebRequest "$Base/SHASUMS256.txt" -OutFile "$Build/SHASUMS256.txt"
Invoke-WebRequest "$Base/$Archive" -OutFile "$Build/$Archive"
Invoke-WebRequest "$Base/win-$Arch/node.lib" -OutFile "$Build/node.lib"
function Assert-Hash([string]$File, [string]$Name) {
    $Lines = @(Get-Content "$Build/SHASUMS256.txt" | Where-Object { ($_ -split '\s+')[1] -eq $Name })
    if ($Lines.Count -ne 1) { throw "Missing or ambiguous official SHA256: $Name" }
    $Expected = ($Lines[0] -split '\s+')[0].ToLowerInvariant()
    if ((Get-FileHash -Algorithm SHA256 $File).Hash -ine $Expected) { throw "SHA256 mismatch: $Name" }
    return $Expected
}
$HeadersHash = Assert-Hash "$Build/$Archive" $Archive
$LibraryHash = Assert-Hash "$Build/node.lib" "win-$Arch/node.lib"
& tar -xzf "$Build/$Archive" -C "$Build/headers"
if ($LASTEXITCODE -ne 0) { throw 'Header extraction failed' }
$VsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$Vs = & $VsWhere -latest -products '*' -property installationPath
if (-not $Vs) { throw 'Maintainer native builds require Visual Studio C++ tools and Windows SDK' }
$Include = Join-Path $Build "headers/node-v$NodeVersion/include/node"
# /MT avoids adding a Visual C++ redistributable requirement to user installations.
$Batch = @"
@echo off
call "$Vs\Common7\Tools\VsDevCmd.bat" -arch=$Arch
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /EHsc /MT /O2 /LD /W4 /DNAPI_VERSION=8 /I"$Include" "$Root\packages\sdk\native\windows-pipe.cc" /Fo:"$Build\owner-pipe.obj" /link /INCREMENTAL:NO /Brepro /OUT:"$Out\owner-pipe.node" /IMPLIB:"$Build\owner-pipe.lib" "$Build\node.lib" advapi32.lib
if errorlevel 1 exit /b 1
>"$Build\toolchain.txt" echo %VCToolsVersion%
>>"$Build\toolchain.txt" echo %WindowsSDKVersion%
"@
[System.IO.File]::WriteAllText("$Build/compile.cmd", $Batch, [System.Text.Encoding]::Default)
& cmd /d /c "$Build/compile.cmd"
if ($LASTEXITCODE -ne 0) { throw 'Windows native compilation failed' }
$Toolchain = Get-Content "$Build/toolchain.txt"
$Inputs = @{
    headersSha256 = $HeadersHash
    nodeLibrarySha256 = $LibraryHash
    msvcVersion = $Toolchain[0].Trim()
    windowsSdkVersion = $Toolchain[1].Trim().TrimEnd('\')
} | ConvertTo-Json
[System.IO.File]::WriteAllText("$Build/inputs.json", $Inputs, (New-Object System.Text.UTF8Encoding($false)))
& node scripts/windows-native/artifacts.mjs record $Arch
if ($LASTEXITCODE -ne 0) { throw 'Windows native provenance validation failed' }
