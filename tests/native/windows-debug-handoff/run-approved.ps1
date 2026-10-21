# Review-only until the specific controlled-process CI run is approved.
# This script never installs a tool, changes privileges, or launches an installer.
param([switch]$ApprovedControlledProcesses)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $ApprovedControlledProcesses) { throw 'Specific runtime approval is required' }
if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'Requires Windows x64' }
if ($env:MILKUP_APPROVED_WINDOWS_PROBE) { throw 'Unexpected inherited runtime opt-in' }

# Fail if the existing compiler is unavailable; no automatic provisioning fallback.
rustup run 1.99.0 rustc --version
if ($LASTEXITCODE -ne 0) { throw 'Pinned existing compiler unavailable' }
$manifest = Join-Path $PSScriptRoot 'Cargo.toml'
$target = Join-Path $env:RUNNER_TEMP 'milkup-debug-probe-build'
if (Test-Path $target) { throw 'Expected fresh experiment target directory' }
rustup run 1.99.0 cargo test --manifest-path $manifest --target-dir $target --locked --lib
if ($LASTEXITCODE -ne 0) { throw 'Portable decision gates failed' }
rustup run 1.99.0 cargo build --manifest-path $manifest --target-dir $target --locked --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Windows prototype build failed' }
$exe = Join-Path $target 'x86_64-pc-windows-msvc/debug/milkup-windows-debug-handoff-probe.exe'
if (-not (Test-Path $exe -PathType Leaf)) { throw 'Missing self-built prototype' }
Get-FileHash -Algorithm SHA256 -LiteralPath $exe | Format-List

$output = [System.Collections.Generic.List[string]]::new()
try {
    # An accidental-execution guard, not an authorization mechanism.
    $env:MILKUP_APPROVED_WINDOWS_PROBE = 'controlled-self-built-processes-only'
    & $exe --suite 2>&1 | ForEach-Object { $line = "$_"; $output.Add($line); Write-Host $line }
    $code = $LASTEXITCODE
} finally {
    Remove-Item Env:MILKUP_APPROVED_WINDOWS_PROBE -ErrorAction SilentlyContinue
}
if ($code -ne 0) { throw "Bounded prototype failed: $code; retain printed temp evidence path" }
$summaries = @($output | Where-Object { $_.StartsWith('PROBE_SUMMARY=') })
if ($summaries.Count -ne 1) { throw 'Exactly one runtime summary required' }
$summary = $summaries[0].Substring('PROBE_SUMMARY='.Length) | ConvertFrom-Json
if (-not $summary.passed -or $summary.cases.Count -ne 7) { throw 'Incomplete runtime cases' }
if ($summary.installer_or_release_validated -or $summary.power_loss_validated) { throw 'Invalid validation boundary' }
if ($summary.ordinary_user_runtime_validated) {
    $boundary = 'Seven cases passed under the recorded ordinary medium-integrity token. No installation, release or health validation.'
} else {
    $boundary = 'Seven cases passed ONLY in the recorded administrator/other token context. Ordinary-user validation remains UNVERIFIED.'
}
Write-Host $boundary
if ($env:GITHUB_STEP_SUMMARY) { $boundary | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8 }
# No upload-artifact/cache operation. Evidence stays in ephemeral RUNNER_TEMP and logs.
