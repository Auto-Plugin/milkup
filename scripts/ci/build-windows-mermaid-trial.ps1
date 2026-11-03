[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or
    $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or
    $env:GITHUB_REF -cne 'refs/heads/dot/mermaid-rebuild-20261103') {
    throw 'Only the independent Windows test-delivery candidate is permitted'
}
function Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited $LASTEXITCODE" }
}
function Record([string]$Path) {
    $file = Get-Item -LiteralPath $Path
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected plain packaged input' }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($file.FullName)
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    return [ordered]@{
        path = $file.FullName; name = $file.Name; bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        productVersion = $version.ProductVersion; fileVersion = $version.FileVersion
        signature = $signature.Status.ToString()
    }
}
function Write-NewJson([string]$Path, $Value) {
    if (Test-Path -LiteralPath $Path) { throw "Refusing to replace packaging evidence: $Path" }
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 24) + "`n", [Text.UTF8Encoding]::new($false))
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $root
if (-not (Test-Path -LiteralPath $EvidenceDirectory -PathType Container) -or (Test-Path -LiteralPath $OutputDirectory)) {
    throw 'Existing evidence root and a new delivery directory required'
}
$head = @(git rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1 -or $head[0].Trim() -cne $env:GITHUB_SHA) { throw 'Wrong packaging candidate' }
$sha = $head[0].Trim()
Checked git @('merge-base', '--is-ancestor', '03e62ba936aafc33a3828f734c0cbba58465ab7b', $sha)
$dirty = @(git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'Packaging requires a strictly clean checkout' }
Checked node @('scripts/check-versions.mjs')
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ($version -cne '2.0.0-beta.8') { throw 'Wrong Mermaid test version' }
$config = Get-Content apps/desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$overlay = Join-Path $root 'scripts/ci/tauri-mermaid-trial.json'
$overlayValue = Get-Content $overlay -Raw | ConvertFrom-Json
if ($env:TAURI_CONFIG -or (Test-Path apps/desktop/src-tauri/tauri.windows.conf.json) -or
    $config.bundle.windows.nsis.installMode -cne 'currentUser' -or
    $overlayValue.bundle.windows.webviewInstallMode.type -cne 'skip' -or
    $config.plugins.updater.endpoints.Count -ne 0 -or $config.plugins.updater.pubkey -cne '') {
    throw 'Unexpected installer/runtime/update configuration'
}
if (-not $env:CARGO_TARGET_DIR) { throw 'An isolated Cargo target directory is required' }
$env:CARGO_BUILD_TARGET = 'x86_64-pc-windows-msvc'
Checked pnpm @('--filter', '@milkup/desktop', 'exec', 'tauri', 'build', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis', '--config', $overlay, '--ci', '--', '--locked')
$release = Join-Path $env:CARGO_TARGET_DIR 'x86_64-pc-windows-msvc/release'
$installers = @(Get-ChildItem -LiteralPath (Join-Path $release 'bundle/nsis') -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw 'Exactly one new NSIS installer required' }
$binary = Join-Path $release 'milkup-desktop.exe'
$compiled = Record $binary
$installer = Record $installers[0].FullName
foreach ($record in @($compiled, $installer)) {
    if ($record.productVersion -cne $version -or $record.signature -cne 'NotSigned') { throw 'Unexpected packaged version or signature state' }
}
$sevenZip = (Get-Command 7z -ErrorAction Stop | Select-Object -First 1).Source
$inspection = Join-Path $EvidenceDirectory 'nsis-payload-inspection'
if (Test-Path -LiteralPath $inspection) { throw 'Extraction path must be new' }
Checked $sevenZip @('x', $installers[0].FullName, "-o$inspection", '-y')
$imageProofPath = Join-Path $EvidenceDirectory 'nsis-image-proof.json'
Checked node @('scripts/ci/verify-nsis-image.mjs', $binary, $inspection, $imageProofPath)
$imageProof = Get-Content -LiteralPath $imageProofPath -Raw | ConvertFrom-Json
if ($imageProof.status -cne 'passed' -or $imageProof.compiledSha256 -cne $compiled.sha256) { throw 'NSIS byte transformation proof failed' }
$extracted = Record $imageProof.path
if ($extracted.productVersion -cne $version -or $extracted.signature -cne 'NotSigned' -or
    $extracted.sha256 -cne $imageProof.expectedNsisSha256) { throw 'Extracted application identity mismatch' }
& "$PSScriptRoot/verify-windows-app-manifest.ps1" -Executable $imageProof.path -EvidenceDirectory $EvidenceDirectory -EvidenceName 'packaged-production-binary'
$icon = Get-Item -LiteralPath (Join-Path $root 'apps/desktop/src-tauri/icons/file.ico')
$resources = @([ordered]@{ relativePath = 'file.ico'; bytes = $icon.Length; sha256 = (Get-FileHash -LiteralPath $icon.FullName -Algorithm SHA256).Hash.ToLowerInvariant() })
$icons = @($imageProof.files | Where-Object { [IO.Path]::GetFileName($_.path) -ceq 'file.ico' })
if ($icons.Count -ne 1 -or $icons[0].sha256 -cne $resources[0].sha256 -or $icons[0].bytes -ne $resources[0].bytes) { throw 'Actual installer lacks the exact file icon resource' }
Write-NewJson (Join-Path $EvidenceDirectory 'installer-input.json') ([ordered]@{
    schema = 1; candidateSha = $sha; version = $version
    builtBinarySha256 = $compiled.sha256; expectedInstalledBinarySha256 = $extracted.sha256
    resources = $resources; bundledPlugins = @()
})
Write-NewJson (Join-Path $EvidenceDirectory 'packaging-record.json') ([ordered]@{
    schema = 1; candidateSha = $sha; version = $version; platform = 'windows-x86_64'
    runId = $env:GITHUB_RUN_ID; runAttempt = $env:GITHUB_RUN_ATTEMPT
    runUrl = "https://github.com/Auto-Plugin/milkup/actions/runs/$env:GITHUB_RUN_ID"
    acceptedImplementationBase = '03e62ba936aafc33a3828f734c0cbba58465ab7b'
    installer = $installer; compiledApplication = $compiled; extractedApplication = $extracted
    nsisInstallMode = 'currentUser'; webviewInstallMode = 'skip'; existingEvergreenRequired = $true
    artifactRetentionDays = 7; signing = 'unsigned'; officialRelease = $false
    installerExecuted = $false; installedProductAccepted = $false
})
Checked node @('scripts/ci/prepare-mermaid-trial-payload.mjs', 'prepare', $EvidenceDirectory, $OutputDirectory)
$dirty = @(git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { $dirty | Write-Host; throw 'Source checkout changed during packaging' }
Write-Host 'NSIS built and inspected; installed product acceptance remains a separate required step.'
