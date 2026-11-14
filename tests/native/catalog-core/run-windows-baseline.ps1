[CmdletBinding()]
param(
    [string]$TargetDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) 'milkup-catalog-baseline-target'),
    [switch]$Offline
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    throw 'The expected baseline failure must execute on real Windows, not a cross-compile host.'
}
$baseline = '4e0d305bab563e3fc58aa97bb18115b6bf8f69d6'
$sourcePath = 'apps/desktop/src-tauri/src/plugin_catalog.rs'
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('milkup-catalog-baseline-' + [Guid]::NewGuid().ToString('N'))
$drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($work))
if ($drive.DriveFormat -ne 'NTFS' -or $drive.DriveType -ne [System.IO.DriveType]::Fixed) {
    throw 'The baseline regression requires a temporary directory on a fixed local NTFS volume.'
}
$source = @(& git -C $repo show "${baseline}:${sourcePath}")
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the fixed baseline from Git; fetch that commit before running.' }
$oldTargetDirectory = $env:CARGO_TARGET_DIR
$oldNativePreference = Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
$oldNativePreferenceValue = if ($null -ne $oldNativePreference) { $oldNativePreference.Value } else { $null }
try {
    # Expected test exit 101 must be inspected rather than raised before output checks.
    if ($null -ne $oldNativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
    New-Item -ItemType Directory -Path (Join-Path $work 'src') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Cargo.toml') -Destination $work
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Cargo.lock') -Destination $work
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $copiedSource = Join-Path $work 'src/baseline.rs'
    [System.IO.File]::WriteAllText($copiedSource, (($source -join "`n") + "`n"), $utf8)
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $copiedSource).Hash.ToLowerInvariant()
    if ($sourceHash -ne 'b04225d2b48cba126f154ba65e8bdb5485b2b103589de87c0be8f907459e8fb4') {
        throw 'Baseline source byte hash changed; refuse altered encoding/newlines or another source.'
    }
    $lib = @'
extern crate self as tauri;
pub use url::Url;
#[path = "baseline.rs"]
pub mod plugin_catalog;

#[cfg(all(test, windows))]
mod regression {
    #[test]
    fn windows_catalog_opens_ntfs_profile() {
        struct Root(std::path::PathBuf);
        impl Drop for Root {
            fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
        }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = Root(std::env::temp_dir().join(format!("milkup-catalog-baseline-regression-{}-{stamp}", std::process::id())));
        std::fs::create_dir(&root.0).unwrap();
        let catalog = crate::plugin_catalog::read(&root.0)
            .expect("a fresh local NTFS catalog must be usable on Windows");
        assert_eq!(catalog["version"], 1);
    }
}
'@
    [System.IO.File]::WriteAllText((Join-Path $work 'src/lib.rs'), $lib, $utf8)
    $env:CARGO_TARGET_DIR = [System.IO.Path]::GetFullPath($TargetDirectory)
    $arguments = @('test', '--locked', '--manifest-path', (Join-Path $work 'Cargo.toml'), '--target', 'x86_64-pc-windows-msvc', '--lib')
    if ($Offline) { $arguments += '--offline' }
    $arguments += @('regression::windows_catalog_opens_ntfs_profile', '--', '--exact', '--test-threads=1')
    $output = @(& cargo @arguments 2>&1)
    $testExit = $LASTEXITCODE
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    Write-Output $text
    if ($testExit -ne 101 -or
        $text -notmatch 'test regression::windows_catalog_opens_ntfs_profile \.\.\. FAILED' -or
        $text -notmatch '\[plugin-catalog:unsupported\] safe native catalog mutation is not implemented on this platform' -or
        $text -notmatch 'test result: FAILED\. 0 passed; 1 failed;') {
        throw "Expected the named baseline runtime failure, not build failure or another error; actual exit $testExit"
    }
    [ordered]@{
        suite = 'native-catalog-windows-baseline-red'
        baseline = $baseline
        sourceSha256 = $sourceHash
        platform = [System.Environment]::OSVersion.VersionString
        volume = $drive.DriveFormat
        expectedRedVerified = $true
        testExitCode = $testExit
        test = 'regression::windows_catalog_opens_ntfs_profile'
        scope = 'Executed original baseline read on actual Windows NTFS; unsupported runtime failure required'
    } | ConvertTo-Json
    # GitHub pwsh wrappers propagate LASTEXITCODE even when a script returns normally.
    # Only the fully checked expected runtime failure is a successful RED step.
    $global:LASTEXITCODE = 0
}
finally {
    $env:CARGO_TARGET_DIR = $oldTargetDirectory
    if ($null -ne $oldNativePreference) { $PSNativeCommandUseErrorActionPreference = $oldNativePreferenceValue }
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
