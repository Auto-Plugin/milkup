$ErrorActionPreference = 'Stop'
$head = @(git rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1 -or $head[0].Trim() -cne $env:GITHUB_SHA) { throw 'Wrong source candidate' }
git merge-base --is-ancestor b139a9891a086685d7e0e9e85472a29a629f7a45 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Candidate is outside accepted implementation' }
git diff --exit-code d1149a6a4d29c8414e36fc1af200fbc95e4b1601 HEAD -- apps/desktop/src-tauri/mermaid-engine apps/desktop/src-tauri/src apps/desktop/src plugins/diagrams-worker
if ($LASTEXITCODE -ne 0) { throw 'Reviewed native, renderer or Diagrams implementation changed before packaging' }
$dirty = @(git status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count) { throw 'Dirty candidate checkout' }
if (Test-Path scripts/experiments/mermaid-fixed-prototype) { throw 'Prototype must not enter installer' }
$engine = Get-Item apps/desktop/src-tauri/mermaid-engine/assets/mermaid-12.2.0.min.js
if ($engine.Length -ne 5494801 -or (Get-FileHash $engine.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f') { throw 'Official engine bytes changed' }
node scripts/check-versions.mjs
if ($LASTEXITCODE -ne 0) { throw 'Version metadata mismatch' }
if ((Get-Content package.json -Raw | ConvertFrom-Json).version -cne '2.0.0-beta.9') { throw 'Wrong test version' }
$evidence = Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence'
New-Item -ItemType Directory -Path (Join-Path $evidence 'public-plugins') | Out-Null
node tests/windows/capture-build-source-state.mjs $PWD checkout $env:GITHUB_SHA (Join-Path $evidence 'mermaid-source-checkout.json')
if ($LASTEXITCODE -ne 0) { throw 'Cannot retain original source state' }
'CARGO_TARGET_DIR=' + (Join-Path $env:RUNNER_TEMP 'mermaid-trial-cargo-target') >> $env:GITHUB_ENV
