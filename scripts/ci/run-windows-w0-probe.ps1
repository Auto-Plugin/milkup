# Authorized, bounded AppContainer compatibility experiment. No delivery actions.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:GITHUB_REPOSITORY -ne 'Auto-Plugin/milkup' -or
    $env:GITHUB_REF -ne 'refs/heads/dot/milkup-v2-windows-backends') {
    throw 'Unexpected W0 execution scope'
}
$event = Get-Content -Raw $env:GITHUB_EVENT_PATH | ConvertFrom-Json
if ($event.repository.private -or $event.deleted -or
    -not $event.head_commit.message.Contains('[windows-w0-probe]')) { throw 'Missing public W0 gate' }
if ((git rev-parse HEAD).Trim() -ne $env:GITHUB_SHA) { throw 'W0 source mismatch' }
git merge-base --is-ancestor 3747004b15e1dcf9c92b794b1f818c0853b98d11 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Unexpected W0 baseline' }
$roots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:ProgramFiles 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application')
) | Select-Object -Unique
$candidates = @(foreach ($root in $roots) {
    if (Test-Path -LiteralPath $root -PathType Container) {
        foreach ($directory in Get-ChildItem -LiteralPath $root -Directory) {
            $version = $null
            if ([Version]::TryParse($directory.Name, [ref]$version) -and
                (Test-Path -LiteralPath (Join-Path $directory.FullName 'msedgewebview2.exe') -PathType Leaf)) {
                [pscustomobject]@{ path = $directory.FullName; version = $version }
            }
        }
    }
})
if ($candidates.Count -eq 0) { throw 'No installed WebView2 Runtime; W0 blocked without download fallback' }
$runtime = ($candidates | Sort-Object version -Descending | Select-Object -First 1).path
$env:CARGO_TARGET_DIR = Join-Path $env:RUNNER_TEMP 'milkup-w0-target'
$env:MILKUP_W0_AUTHORIZED = 'temporary-ci-no-network-private-directory-only'
try {
    cargo build --locked --manifest-path scripts/ci/windows-w0-probe/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'W0 prototype build failed' }
    $binary = Join-Path $env:CARGO_TARGET_DIR 'debug/milkup-windows-w0-probe.exe'
    Write-Host "W0 exact source: $env:GITHUB_SHA; Runtime: $runtime"
    & $binary $runtime
    if ($LASTEXITCODE -ne 0) { throw 'W0 compatibility or cleanup failed; retain the reported boundary, do not expand permissions' }
} finally {
    Remove-Item Env:MILKUP_W0_AUTHORIZED -ErrorAction SilentlyContinue
}
