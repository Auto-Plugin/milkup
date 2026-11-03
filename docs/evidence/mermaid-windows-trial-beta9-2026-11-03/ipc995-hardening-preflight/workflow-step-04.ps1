$ErrorActionPreference = 'Stop'
pnpm install --frozen-lockfile --config.manage-package-manager-versions=false
if ($LASTEXITCODE -ne 0) { throw 'Locked workspace restore failed' }
$mathDependencies = Join-Path $env:RUNNER_TEMP 'mermaid-trial-math-input'
npm install --prefix $mathDependencies --ignore-scripts --no-audit --no-fund katex@0.19.0
if ($LASTEXITCODE -ne 0) { throw 'Pinned KaTeX build input restore failed' }
$katex = Join-Path $mathDependencies 'node_modules/katex'
if ((Get-Content (Join-Path $katex 'package.json') -Raw | ConvertFrom-Json).version -cne '0.19.0') { throw 'Wrong KaTeX input' }
$mathModules = Join-Path $PWD 'plugins/math/node_modules'
New-Item -ItemType Directory -Force -Path $mathModules | Out-Null
$katexLink = Join-Path $mathModules 'katex'
if (Test-Path -LiteralPath $katexLink) { throw 'Unexpected existing KaTeX staging path' }
New-Item -ItemType Junction -Path $katexLink -Target $katex | Out-Null
$records = @(node scripts/ci/prepare-bundled-plugins.mjs)
if ($LASTEXITCODE -ne 0) { throw 'Exact reviewed plugin staging failed' }
$records | Write-Host
$objects = @($records | ForEach-Object { $_ | ConvertFrom-Json })
if ($objects.Count -ne 10) { throw 'Expected ten Windows plugins' }
$objects | ConvertTo-Json -Depth 32 | Set-Content (Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence/public-plugins/staged-bundles.json') -Encoding utf8
pnpm --filter @milkup/desktop typecheck
if ($LASTEXITCODE -ne 0) { throw 'Desktop type check failed' }
node --test scripts/ci/prepare-mermaid-trial-payload.test.mjs tests/windows/mermaid-product-e2e.test.mjs tests/windows/verify-installed-binary.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Delivery verification regressions failed' }
./tests/windows/account-kind-wrapper.test.ps1
./tests/windows/installer-wrapper.test.ps1
$ownedProcess = @(& pwsh -NoProfile -File scripts/ci/test-windows-mermaid-owned-process.ps1 2>&1)
$ownedProcessExit = $LASTEXITCODE
$ownedProcess | Write-Host
$ownedProcess | Set-Content (Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence/owned-process-regression.log') -Encoding utf8
if ($ownedProcessExit -ne 0) { throw 'Held-process installer regressions failed' }
Push-Location plugins/diagrams-worker
try {
  node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
  if ($LASTEXITCODE -ne 0) { throw 'Diagrams compiler/renderer regressions failed' }
  node --test scripts/package-seals.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Reviewed package-seal regressions failed' }
} finally { Pop-Location }
