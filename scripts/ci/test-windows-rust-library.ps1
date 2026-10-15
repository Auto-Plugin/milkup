[CmdletBinding()]
param([Parameter(Mandatory)][string]$EvidenceDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows Rust harness validation requires Windows' }
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$artifacts = [System.Collections.Generic.List[string]]::new()
# This runs the complete original lib suite. JSON only identifies the exact
# executable produced by this invocation; no filename glob or stale binary.
& cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --message-format=json | ForEach-Object {
    $line = $_
    if ($line.StartsWith('{')) {
        try { $message = $line | ConvertFrom-Json } catch { Write-Output $line; return }
        if ($message.reason -eq 'compiler-artifact' -and $message.profile.test -and
            $message.target.name -eq 'milkup_desktop_lib' -and $message.executable) {
            $artifacts.Add($message.executable)
        }
        if ($message.reason -eq 'compiler-message') { Write-Output $message.message.rendered }
    } else { Write-Output $line }
}
$testExitCode = $LASTEXITCODE
$result = [ordered]@{ cargoExitCode = $testExitCode; testExecutables = $artifacts.ToArray(); status = 'failed'; diagnosticOnly = $false }
if ($testExitCode -eq 0) {
    $result.status = 'passed'
    $result | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $EvidenceDirectory 'rust-test-result.json')
    return
}
try {
    if ($artifacts.Count -ne 1) { throw 'Expected exactly one current library test executable for diagnostics' }
    & "$PSScriptRoot/capture-windows-rust-loader.ps1" -Executable $artifacts[0] -EvidenceDirectory $EvidenceDirectory
} catch { $result['diagnosticError'] = $_.ToString() }
finally { $result | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $EvidenceDirectory 'rust-test-result.json') }
# Diagnostic probes, including any successful temporary copy, NEVER satisfy this gate.
throw "Full Rust library test suite failed with exit code $testExitCode; delivery forbidden"
