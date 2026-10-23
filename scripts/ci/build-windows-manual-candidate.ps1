[CmdletBinding()]
param([Parameter(Mandatory)][string]$EvidenceDirectory, [Parameter(Mandatory)][string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not $IsWindows -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or
    $env:GITHUB_REF -cne 'refs/heads/dot/milkup-v2-beta7-appearance-menu' -or
    $env:GITHUB_RUN_ATTEMPT -ne '1') { throw 'Outside approved manual-candidate scope' }
function Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited $LASTEXITCODE" }
}
function Record([string]$Path) {
    $f = Get-Item -LiteralPath $Path
    $v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($f.FullName)
    $s = Get-AuthenticodeSignature -LiteralPath $f.FullName
    return [ordered]@{ name=$f.Name; bytes=$f.Length; sha256=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); productVersion=$v.ProductVersion; fileVersion=$v.FileVersion; signature=$s.Status.ToString() }
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $root
$sha = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read packaging source SHA' }
$gitStatus = @(git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read packaging source state' }
$identity = [ordered]@{ actualSha=$sha; expectedSha=$env:GITHUB_SHA; gitStatus=$gitStatus }
$identityJson = $identity | ConvertTo-Json -Depth 4
Write-Host $identityJson
$identityJson | Set-Content (Join-Path $EvidenceDirectory 'manual-prebundle-identity.json') -Encoding utf8
if ($sha -cne $env:GITHUB_SHA) { throw 'Unexpected source SHA' }
# Native compilation can leave generated platform schemas. Preserve and inspect
# their bytes with the existing allowlist; never reset or ignore arbitrary files.
Checked node @('tests/windows/verify-build-tree.mjs',(Get-Location).Path,(Join-Path $EvidenceDirectory 'manual-prebundle-tree.json'))
$source = Get-Content (Join-Path $EvidenceDirectory 'source.json') -Raw | ConvertFrom-Json
$phases = @(Get-Content (Join-Path $EvidenceDirectory 'phases.json') -Raw | ConvertFrom-Json)
if ($source.commit -cne $sha -or $phases.Count -lt 15 -or @($phases | Where-Object status -ne 'passed').Count) { throw 'Complete exact-source Windows checks required' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ($version -cne '2.0.0-beta.7') { throw 'Unexpected manual candidate version' }
$config = Get-Content apps/desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
if ($env:TAURI_CONFIG -or $config.bundle.windows.PSObject.Properties.Name -contains 'webviewInstallMode' -or
    (Test-Path apps/desktop/src-tauri/tauri.windows.conf.json)) { throw 'Retain existing small-package WebView2 mode' }
if (Test-Path $OutputDirectory) { throw 'Delivery directory must be new' }
$env:CARGO_TARGET_DIR = Join-Path $EvidenceDirectory 'cargo-target'
$env:CARGO_BUILD_TARGET = 'x86_64-pc-windows-msvc'
Checked pnpm @('--filter','@milkup/desktop','exec','tauri','build','--target','x86_64-pc-windows-msvc','--bundles','nsis','--ci','--','--locked')
$release = Join-Path $env:CARGO_TARGET_DIR 'x86_64-pc-windows-msvc/release'
$installers = @(Get-ChildItem (Join-Path $release 'bundle/nsis') -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw 'Exactly one current NSIS installer required' }
$binary = Join-Path $release 'milkup-desktop.exe'
$appRecord = Record $binary
$installerRecord = Record $installers[0].FullName
foreach ($r in @($appRecord,$installerRecord)) {
    if ($r.productVersion -cne $version -or $r.signature -cne 'NotSigned') { throw "Unexpected version/signature: $($r | ConvertTo-Json -Compress)" }
}
# Read the freshly built NSIS archive with the runner's existing 7-Zip. Never execute it.
$sevenZip = (Get-Command 7z -ErrorAction Stop).Source
$inspection = Join-Path $EvidenceDirectory 'nsis-payload-inspection'
if (Test-Path $inspection) { throw 'Inspection directory already exists' }
Checked $sevenZip @('x',$installers[0].FullName,"-o$inspection",'-y')
$imageProofPath = Join-Path $EvidenceDirectory 'nsis-image-proof.json'
Checked node @('scripts/ci/verify-nsis-image.mjs',$binary,$inspection,$imageProofPath)
$imageProof = Get-Content $imageProofPath -Raw | ConvertFrom-Json
if ($imageProof.status -cne 'passed' -or $imageProof.compiledSha256 -cne $appRecord.sha256) { throw 'NSIS image proof mismatch' }
$payloadRecord = Record $imageProof.path
if ($payloadRecord.productVersion -cne $version -or $payloadRecord.signature -cne 'NotSigned' -or
    $payloadRecord.sha256 -cne $imageProof.expectedNsisSha256) { throw 'Bundled application identity mismatch' }
& "$PSScriptRoot/verify-windows-app-manifest.ps1" -Executable $imageProof.path -EvidenceDirectory $EvidenceDirectory -EvidenceName 'packaged-production-binary'
$packagedHead = @(git rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $packagedHead.Count -ne 1 -or $packagedHead[0].Trim() -cne $sha) { throw 'Packaging changed source SHA or inspection failed' }
Checked node @('tests/windows/verify-build-tree.mjs',(Get-Location).Path,(Join-Path $EvidenceDirectory 'manual-build-tree.json'))
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$name = "milkup-$version-windows-x64-$($sha.Substring(0,12))-setup.exe"
Copy-Item -LiteralPath $installers[0].FullName -Destination (Join-Path $OutputDirectory $name)
$installerRecord['deliveredName'] = $name
$manifest = [ordered]@{
    status='built-for-user-manual-trial'; commit=$sha; version=$version; platform='windows-x86_64'
    baseline='cc2cfc1d44b937e56cfcbd6e8f3cdcf3ded10189'; runId=$env:GITHUB_RUN_ID
    runUrl="https://github.com/Auto-Plugin/milkup/actions/runs/$env:GITHUB_RUN_ID"
    installer=$installerRecord; compiledApplication=$appRecord; application=$payloadRecord; extractedApplication=$payloadRecord
    nsisImageVerification=$imageProof
    payloadImageMatchesCheckedBinary=$false; payloadImageMatchesExpectedNsisImage=$true; installerExecuted=$false; guiImeAccepted=$false
    signing='unsigned'; webviewMode='existing-default-downloadBootstrapper; no full Runtime bundled'
    windowsDomPdf='disabled'; windowsDiagrams='restricted-worker-flowchart-sequence; full Mermaid not supported'
    updates='built-in About; legacy plugin data retained'; realUpgradeRollback='unverified'; productionChannel='unconfigured'
    artifactRetentionDays=1; deliveryDestination='Auto-Plugin/milkup Actions artifact and current conversation only'
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $OutputDirectory 'manifest.json') -Encoding utf8
Checked node @('scripts/ci/prepare-manual-trial-payload.mjs',$EvidenceDirectory,$OutputDirectory)
Write-Host "MANUAL_DELIVERY_MANIFEST=$($manifest | ConvertTo-Json -Depth 10 -Compress)"
# No installer, application, debug prototype, or Runtime is launched by this script.
