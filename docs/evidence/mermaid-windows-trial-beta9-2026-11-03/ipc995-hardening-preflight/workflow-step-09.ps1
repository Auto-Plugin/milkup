$ErrorActionPreference = 'Stop'
$staging = Join-Path $env:RUNNER_TEMP 'mermaid-trial-installed-retained'
New-Item -ItemType Directory -Path $staging | Out-Null
$retained = 0
foreach ($kind in @('pure-standard', 'filtered-admin')) {
  $directory = Join-Path $env:RUNNER_TEMP "mermaid-trial-installed-evidence/$kind"
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }
  foreach ($phase in @('checkout', 'desktop-check', 'final')) {
    $name = 'mermaid-source-' + $phase + '.json'
    Copy-Item -LiteralPath (Join-Path $env:RUNNER_TEMP "mermaid-trial-build-evidence/$name") -Destination (Join-Path $directory $name) -ErrorAction Stop
  }
  node tests/windows/stage-mermaid-evidence.mjs $directory (Join-Path $staging $kind) $env:GITHUB_SHA
  if ($LASTEXITCODE -ne 0) { throw "Installed evidence failed bounded provenance verification for $kind" }
  $retained++
}
if ($retained -eq 0) { exit 0 }
"directory=$staging" >> $env:GITHUB_OUTPUT
'ready=true' >> $env:GITHUB_OUTPUT
