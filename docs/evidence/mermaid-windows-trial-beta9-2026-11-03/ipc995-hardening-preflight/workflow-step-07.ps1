$ErrorActionPreference = 'Stop'
$evidence = Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence'
if (-not (Test-Path -LiteralPath $evidence)) { throw 'Original source evidence unavailable' }
node tests/windows/capture-build-source-state.mjs $PWD final $env:GITHUB_SHA (Join-Path $evidence 'mermaid-source-final.json')
if ($LASTEXITCODE -ne 0) { throw 'Cannot retain final source state' }
$head = @(git rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1 -or $head[0].Trim() -cne $env:GITHUB_SHA) { throw 'Source SHA changed during packaging' }
$dirty = @(git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect source checkout' }
$dirty | Write-Host
git diff --no-ext-diff --no-textconv HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect source diff' }
git diff --cached --exit-code
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'Source checkout changed during packaging; never restore or relax the gate' }
