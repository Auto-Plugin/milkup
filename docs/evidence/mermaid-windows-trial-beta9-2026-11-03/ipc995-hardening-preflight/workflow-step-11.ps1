$ErrorActionPreference = 'Stop'
$source = Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence'
$destination = Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-retained'
New-Item -ItemType Directory -Path $destination | Out-Null
$names = @('mermaid-source-checkout.json', 'mermaid-source-desktop-check.json', 'mermaid-source-final.json', 'nsis-image-proof.json', 'packaging-record.json', 'installer-input.json', 'packaged-production-binary-manifest.json', 'packaged-production-binary.manifest', 'public-plugins/staged-bundles.json', 'public-plugins/verification.json', 'mermaid-trial-preparation.json', 'mermaid-trial-finalization.json', 'windows-runtime-dependencies.json', 'windows-runtime-imports.log', 'owned-process-regression.log', 'native-regression.log')
$retained = @()
foreach ($name in $names) {
  $path = Join-Path $source $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
  $file = Get-Item -LiteralPath $path
  if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 2MB) { throw 'Invalid packaging evidence input' }
  $target = Join-Path $destination ($name.Replace('/', '-'))
  Copy-Item -LiteralPath $path -Destination $target -ErrorAction Stop
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -cne (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Packaging evidence copy mismatch' }
  $retained += [ordered]@{ name = [IO.Path]::GetFileName($target); bytes = $file.Length; sha256 = $hash }
}
[ordered]@{ candidateSha = $env:GITHUB_SHA; files = $retained; includesBinariesOrProfiles = $false } | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $destination 'manifest.json') -Encoding utf8
"directory=$destination" >> $env:GITHUB_OUTPUT
'ready=true' >> $env:GITHUB_OUTPUT
