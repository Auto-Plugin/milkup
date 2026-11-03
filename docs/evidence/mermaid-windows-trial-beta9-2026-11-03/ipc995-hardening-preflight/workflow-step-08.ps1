$ErrorActionPreference = 'Stop'
$evidence = Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence'
$record = Get-Content (Join-Path $evidence 'packaging-record.json') -Raw | ConvertFrom-Json
$manifest = Join-Path $evidence 'installer-input.json'
$manifestHash = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant()
$failures = @()
foreach ($kind in @('pure-standard', 'filtered-admin')) {
  try {
    ./scripts/ci/run-windows-mermaid-product-e2e.ps1 -Binary $record.compiledApplication.path -ExpectedBinarySha256 $record.compiledApplication.sha256 -Installer $record.installer.path -ExpectedInstallerSha256 $record.installer.sha256 -ExpectedVersion $record.version -PackageManifest $manifest -ExpectedPackageManifestSha256 $manifestHash -EvidenceDirectory (Join-Path $env:RUNNER_TEMP "mermaid-trial-installed-evidence/$kind") -ExpectedCommit $env:GITHUB_SHA -ProductionAssetsConfirmed -AccountKind $kind
  } catch {
    $failures += "$kind : $($_.Exception.Message)"
    Write-Host "::error::$kind installed-product acceptance failed; original reports retained"
  }
}
if ($failures.Count) { throw ($failures -join "`n") }
