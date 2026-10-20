[CmdletBinding()]
param([Parameter(Mandatory)][string]$EvidenceDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# PowerShell must let us record native exit codes, including expected failures.
$PSNativeCommandUseErrorActionPreference = $false
if (-not $IsWindows) { throw 'Desktop source check requires actual Windows' }
if ($env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup') { throw 'Unexpected source-check repository' }
switch -CaseSensitive ($env:GITHUB_REF) {
    'refs/heads/dot/milkup-v2-product-phase8-readiness' {
        $baseline = 'a4d44e680478d7894450f30f3d533dc1c3131974'
        $marker = '[windows-desktop-source-check]'
    }
    'refs/heads/dot/milkup-v2-windows-backends' {
        $baseline = '3747004b15e1dcf9c92b794b1f818c0853b98d11'
        $marker = '[windows-backends-check]'
    }
    'refs/heads/dot/milkup-v2-update-checkpoint' {
        $baseline = '5b62eb75615170f8a9cd8eede5fa42f275850ca7'
        $marker = '[windows-update-check]'
    }
    default { throw 'Unexpected source-check scope' }
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $root
$script:phaseCommands = $null
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    $startedAt = [DateTime]::UtcNow.ToString('o')
    & $Executable @Arguments
    $exitCode = $LASTEXITCODE
    if ($null -ne $script:phaseCommands) {
        $script:phaseCommands.Add([ordered]@{
            executable = $Executable; arguments = $Arguments; exitCode = $exitCode
            startedAt = $startedAt; endedAt = [DateTime]::UtcNow.ToString('o')
        })
    }
    if ($exitCode -ne 0) { throw "$Executable exited $exitCode" }
}
$head = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -cne $env:GITHUB_SHA) { throw 'Checkout SHA mismatch' }
Invoke-Checked git @('merge-base', '--is-ancestor', $baseline, 'HEAD')
if (& git status --porcelain) { throw 'Dirty initial checkout' }
$event = Get-Content $env:GITHUB_EVENT_PATH -Raw | ConvertFrom-Json
if ($event.repository.private -ne $false -or $event.deleted -ne $false -or
    -not $event.head_commit.message.Contains($marker)) {
    throw 'Public repository and explicit commit marker required'
}
if (Test-Path $EvidenceDirectory) { throw 'Evidence directory must be new' }
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
$EvidenceDirectory = (Resolve-Path $EvidenceDirectory).Path
$env:CARGO_TARGET_DIR = Join-Path $EvidenceDirectory 'cargo-target'
$env:CARGO_BUILD_TARGET = 'x86_64-pc-windows-msvc'
$env:CARGO_BUILD_JOBS = '2'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_RELEASE_DEBUG = '0'
$env:RUST_TEST_THREADS = '1'
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
$env:COREPACK_ENABLE_NETWORK = '0'
$env:CI = 'true'
$phases = [System.Collections.Generic.List[object]]::new()
function Invoke-Phase([string]$Name, [scriptblock]$Action) {
    $record = [ordered]@{ name = $Name; startedAt = [DateTime]::UtcNow.ToString('o'); status = 'failed' }
    $script:phaseCommands = [System.Collections.Generic.List[object]]::new()
    $passed = $false
    Write-Host "::group::$Name"
    try {
        & $Action | Out-Host
        $record.status = 'passed'
        $passed = $true
    } catch {
        $record['error'] = $_.ToString()
        Write-Host "::error::$Name failed: $_"
    } finally {
        $record['endedAt'] = [DateTime]::UtcNow.ToString('o')
        $record['commands'] = $script:phaseCommands.ToArray()
        $script:phaseCommands = $null
        $phases.Add($record)
        ConvertTo-Json -InputObject $phases.ToArray() -Depth 12 | Set-Content (Join-Path $EvidenceDirectory 'phases.json')
        Write-Host ($record | ConvertTo-Json -Depth 12 -Compress)
        Write-Host '::endgroup::'
    }
    return $passed
}
$npmRoot = (& npm root --global).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve pinned pnpm installation' }
$pnpm = Join-Path $npmRoot 'pnpm/bin/pnpm.cjs'
if (-not (Test-Path $pnpm -PathType Leaf)) { throw 'Missing pinned pnpm CLI' }
$version = (& node $pnpm --version).Trim()
if ($LASTEXITCODE -ne 0 -or $version -cne '11.7.0') { throw 'Unexpected pnpm version' }
$sourceProof = [ordered]@{
    commit = $head
    baseline = $baseline
    platform = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    node = (& node --version)
    pnpm = $version
    rustc = (& rustc --version --verbose)
    dependencyPolicies = 'Workspace frozen lock; diagrams reviewed frozen SDK 0.3.4; ten Worker independent builds explicitly legacy/non-frozen.'
    boundary = 'Source checks and local compile outputs only. No installed application, GUI, Runtime provisioning or delivery acceptance.'
}
$sourceProof | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $EvidenceDirectory 'source.json')
$restored = Invoke-Phase 'locked-workspace-restore' {
    Invoke-Checked node @($pnpm, 'install', '--frozen-lockfile', '--config.manage-package-manager-versions=false')
}
if (-not $restored) { throw 'Dependency restore failed; dependent phases cannot execute' }
$null = Invoke-Phase 'updater-vendor-provenance' {
    Invoke-Checked node @('scripts/check-updater-vendor.mjs')
}
$null = Invoke-Phase 'source-check-contracts' {
    Invoke-Checked node @('--test', 'scripts/check-versions.test.mjs', 'scripts/check-updater-vendor.test.mjs', 'tests/ci/windows-desktop-source-check.test.mjs', 'tests/ci/stage-public-plugin-check.test.mjs', 'tests/ci/public-plugin-windows-checkout.test.mjs', 'tests/ci/diagrams-build-paths.test.mjs', 'tests/ci/public-plugin-build-contract.test.mjs', 'tests/ci/public-plugin-dom-build.test.mjs', 'tests/ci/public-plugin-sdk-artifact.test.mjs')
}
# SDK declarations must exist before packing the standalone public package.
$sdkBuilt = Invoke-Phase 'public-sdk-build' {
    Invoke-Checked node @($pnpm, '--filter', '@milkup/plugin-sdk', 'build')
}
$publicDirectory = Join-Path $EvidenceDirectory 'public-plugins'
$pluginsBuilt = $false
if ($sdkBuilt) {
    $pluginsBuilt = Invoke-Phase 'eleven-independent-public-plugins' {
        Invoke-Checked node @('scripts/ci/verify-public-plugin-builds.mjs', $publicDirectory, $pnpm)
    }
}
if ($pluginsBuilt) {
    $null = Invoke-Phase 'eleven-independent-plugin-types' {
        $proof = Get-Content (Join-Path $publicDirectory 'verification.json') -Raw | ConvertFrom-Json
        if (@($proof.plugins).Count -ne 11) { throw 'Expected eleven independent plugins' }
        foreach ($plugin in $proof.plugins) {
            Invoke-Checked node @($pnpm, '--dir', (Join-Path $publicDirectory $plugin.id), 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json')
        }
    }
    $pluginsBuilt = Invoke-Phase 'verified-bundle-staging' {
        Invoke-Checked node @('scripts/ci/stage-public-plugin-check.mjs', $publicDirectory)
    }
}
# Test failures do not hide independent compiler/linker evidence; every failed
# phase still fails the overall job. No test retry or changed deadline here.
$null = Invoke-Phase 'workspace-tests' { Invoke-Checked node @($pnpm, 'test') }
$null = Invoke-Phase 'workspace-types' { Invoke-Checked node @($pnpm, 'typecheck') }
$frontendBuilt = $false
if ($pluginsBuilt) {
    $frontendBuilt = Invoke-Phase 'workspace-build' { Invoke-Checked node @($pnpm, 'build') }
}
$manifest = 'apps/desktop/src-tauri/Cargo.toml'
$null = Invoke-Phase 'desktop-check-all-targets' {
    Invoke-Checked cargo @('check', '--locked', '--manifest-path', $manifest, '--all-targets')
}
$null = Invoke-Phase 'windows-updater-launch-tests' {
    # The desktop --lib suite does not execute dependency unit tests. Discover
    # this private regression suite explicitly so a stale filter cannot pass
    # after silently running zero tests.
    $testArguments = @('test', '--locked', '--manifest-path', $manifest, '-p', 'tauri-plugin-updater', '--lib', 'windows_install::tests::')
    $testList = @(Invoke-Checked cargo ($testArguments + @('--', '--list')))
    $testList | Set-Content (Join-Path $EvidenceDirectory 'updater-launch-tests.txt')
    $testList | Write-Host
    $requiredTests = @(
        'windows_install::tests::rejected_launch_preserves_app_and_can_be_retried'
        'windows_install::tests::real_missing_executable_returns_error_without_cleanup_or_exit'
    )
    foreach ($test in $requiredTests) {
        if ($testList -cnotcontains "${test}: test") { throw "Required Windows updater regression missing: $test" }
    }
    Invoke-Checked cargo ($testArguments + @('--', '--nocapture', '--test-threads=1'))
}
$null = Invoke-Phase 'desktop-full-library-tests' {
    try {
        & "$PSScriptRoot/test-windows-rust-library.ps1" -EvidenceDirectory $EvidenceDirectory
    } finally {
        $resultPath = Join-Path $EvidenceDirectory 'rust-test-result.json'
        if (Test-Path $resultPath) {
            $result = Get-Content $resultPath -Raw | ConvertFrom-Json
            $script:phaseCommands.Add([ordered]@{
                executable = 'cargo'
                arguments = @('test', '--locked', '--manifest-path', $manifest, '--lib', '--message-format=json')
                exitCode = $result.cargoExitCode
                evidence = 'rust-test-result.json'
            })
        }
    }
    if ($result.status -cne 'passed') { throw 'Full native suite did not pass' }
}
if ($frontendBuilt) {
    $null = Invoke-Phase 'desktop-production-compile-link' {
        Invoke-Checked cargo @('build', '--locked', '--manifest-path', $manifest, '--release', '--bin', 'milkup-desktop', '--features', 'tauri/custom-protocol')
        $executable = Join-Path $env:CARGO_TARGET_DIR 'x86_64-pc-windows-msvc/release/milkup-desktop.exe'
        & "$PSScriptRoot/verify-windows-app-manifest.ps1" -Executable $executable -EvidenceDirectory $EvidenceDirectory -EvidenceName 'production-binary'
        Get-Content (Join-Path $EvidenceDirectory 'production-binary-manifest.json') | Write-Host
    }
}
$null = Invoke-Phase 'tracked-source-unchanged' {
    Invoke-Checked git @('diff', '--exit-code')
    Invoke-Checked git @('diff', '--cached', '--exit-code')
}
Write-Host ($phases.ToArray() | ConvertTo-Json -Depth 12)
if (-not $frontendBuilt -or @($phases | Where-Object { $_.status -ne 'passed' }).Count -ne 0) {
    throw 'Windows source verification incomplete or failed; see each phase above'
}
