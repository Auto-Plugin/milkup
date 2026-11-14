$ErrorActionPreference = 'Stop'
$nativeTests = @(& cargo test --locked --manifest-path apps/desktop/src-tauri/mermaid-engine/Cargo.toml --lib -- --test-threads=1 --nocapture 2>&1)
$nativeTestsExit = $LASTEXITCODE
$nativeTests | Write-Host
$nativeTests | Set-Content (Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence/native-regression.log') -Encoding utf8
if ($nativeTestsExit -ne 0) { throw 'Private engine regression tests failed' }
node tests/windows/capture-build-source-state.mjs $PWD desktop-check $env:GITHUB_SHA (Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence/mermaid-source-desktop-check.json')
if ($LASTEXITCODE -ne 0) { throw 'Cannot retain source state' }
