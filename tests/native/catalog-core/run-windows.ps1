[CmdletBinding()]
param(
    [string]$TargetDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) 'milkup-catalog-core-target'),
    [switch]$Offline
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    throw 'This runner requires actual Windows. Cross-compilation is not runtime acceptance.'
}
$manifest = Join-Path $PSScriptRoot 'Cargo.toml'
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../apps/desktop/src-tauri/src'))
$rustInfo = @(& rustc --version --verbose)
if ($LASTEXITCODE -ne 0) { throw 'rustc is unavailable or failed' }
if (-not ($rustInfo -match '^host: .*-windows-msvc$')) {
    throw 'An installed Windows MSVC Rust toolchain and MSVC linker are required; this script installs neither.'
}
$oldTargetDirectory = $env:CARGO_TARGET_DIR
$started = [DateTime]::UtcNow.ToString('o')
try {
    $env:CARGO_TARGET_DIR = [System.IO.Path]::GetFullPath($TargetDirectory)
    $arguments = @('test', '--locked', '--manifest-path', $manifest, '--target', 'x86_64-pc-windows-msvc', '--all-targets')
    if ($Offline) { $arguments += '--offline' }
    $arguments += @('--', '--test-threads=1')
    & cargo @arguments
    $testExit = $LASTEXITCODE
    $inputs = @('plugin_catalog.rs', 'plugin_catalog_tests.rs', 'plugin_catalog_windows.rs') | ForEach-Object {
        $path = Join-Path $sourceRoot $_
        @{ file = $_; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() }
    }
    [ordered]@{
        suite = 'native-catalog-core'
        platform = [System.Environment]::OSVersion.VersionString
        startedUtc = $started
        completedUtc = [DateTime]::UtcNow.ToString('o')
        rustc = $rustInfo
        target = 'x86_64-pc-windows-msvc'
        exitCode = $testExit
        passed = ($testExit -eq 0)
        sourceInputs = $inputs
        lockSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot 'Cargo.lock')).Hash.ToLowerInvariant()
        scope = 'Real catalog filesystem/transaction tests; no Tauri UI, WebView2, installer, or artifact upload'
    } | ConvertTo-Json -Depth 5
    if ($testExit -ne 0) { throw "Native catalog tests failed with exit code $testExit" }
}
finally {
    $env:CARGO_TARGET_DIR = $oldTargetDirectory
}
