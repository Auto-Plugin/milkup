$ErrorActionPreference = 'Stop'
npm install --global pnpm@11.7.0 --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'pnpm setup failed' }
rustup toolchain install 1.99.0 --profile minimal
if ($LASTEXITCODE -ne 0) { throw 'Rust setup failed' }
'RUSTUP_TOOLCHAIN=1.99.0' >> $env:GITHUB_ENV
rustup run 1.99.0 rustc --version --verbose
if ($LASTEXITCODE -ne 0) { throw 'Pinned compiler unavailable' }
foreach ($file in @('build-windows-mermaid-trial.ps1', 'run-windows-mermaid-product-e2e.ps1', 'verify-windows-app-manifest.ps1')) {
  $tokens = $null; $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD "scripts/ci/$file"), [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
}
$sevenZip = (Get-Command 7z -ErrorAction Stop | Select-Object -First 1).Source
& $sevenZip i
if ($LASTEXITCODE -ne 0) { throw 'Existing archive inspector unavailable' }
node --test scripts/ci/verify-nsis-image.test.mjs scripts/ci/inspect-mermaid-windows-dependencies.test.mjs tests/windows/stage-mermaid-evidence.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Packaging evidence regressions failed' }
