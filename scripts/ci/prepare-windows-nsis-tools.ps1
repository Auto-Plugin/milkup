[CmdletBinding()]
param([Parameter(Mandatory)][string]$EvidenceDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') {
    throw 'Pinned NSIS preparation is only for the isolated Windows build host'
}
$staging = Join-Path $env:RUNNER_TEMP 'milkup-pinned-nsis-tools'
$cache = Join-Path $env:LOCALAPPDATA 'tauri'
$target = Join-Path $cache 'NSIS'
$expanded = Join-Path $staging 'expanded'
if (Test-Path -LiteralPath $target) { throw 'Refusing an existing NSIS tool cache' }
if ((Test-Path -LiteralPath $cache) -and ((Get-Item -LiteralPath $cache).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Unexpected linked Tauri tools directory'
}
node "$PSScriptRoot/prepare-windows-nsis-tools.mjs" $staging
if ($LASTEXITCODE -ne 0) { throw 'Pinned NSIS tool download or byte verification failed before compilation' }
$zip = Join-Path $staging 'nsis-3.11.zip'
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $total = 0L
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName
        $parts = $name.TrimEnd('/').Split('/')
        if ($parts[0] -cne 'nsis-3.11' -or $name.Contains('\') -or $name.Contains(':') -or
            @($parts | Where-Object { $_ -cin @('', '.', '..') }).Count -ne 0 -or -not $names.Add($name) -or
            (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000 -or
            ($entry.ExternalAttributes -band 0x400) -ne 0) { throw 'Unsafe NSIS archive entry' }
        $total += $entry.Length
        if ($total -gt 64MB -or $names.Count -gt 4096) { throw 'NSIS extraction budget exceeded' }
    }
} finally { $archive.Dispose() }
Expand-Archive -LiteralPath $zip -DestinationPath $expanded
$tools = Join-Path $expanded 'nsis-3.11'
$additional = Join-Path $tools 'Plugins/x86-unicode/additional'
New-Item -ItemType Directory -Path $additional -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $staging 'nsis_tauri_utils.dll') -Destination $additional
foreach ($name in @('makensis.exe','Bin/makensis.exe','Stubs/lzma-x86-unicode','Stubs/lzma_solid-x86-unicode','Plugins/x86-unicode/additional/nsis_tauri_utils.dll','Include/MUI2.nsh','Include/FileFunc.nsh','Include/x64.nsh','Include/nsDialogs.nsh','Include/WinMessages.nsh','Include/Win/COM.nsh','Include/Win/Propkey.nsh','Include/Win/RestartManager.nsh')) {
    $file = Get-Item -LiteralPath (Join-Path $tools $name)
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Required NSIS tool is not a plain file' }
}
New-Item -ItemType Directory -Path $cache -Force | Out-Null
Move-Item -LiteralPath $tools -Destination $target
Copy-Item -LiteralPath (Join-Path $staging 'receipt.json') -Destination (Join-Path $EvidenceDirectory 'nsis-toolchain-receipt.json')
Write-Host 'Exact official NSIS toolchain prepared before application compilation.'
