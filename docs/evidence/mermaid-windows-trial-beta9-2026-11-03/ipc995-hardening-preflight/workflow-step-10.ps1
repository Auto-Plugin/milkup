$ErrorActionPreference = 'Stop'
node scripts/ci/prepare-mermaid-trial-payload.mjs finalize (Join-Path $env:RUNNER_TEMP 'mermaid-trial-build-evidence') (Join-Path $env:RUNNER_TEMP 'mermaid-trial-delivery') (Join-Path $env:RUNNER_TEMP 'mermaid-trial-installed-evidence')
if ($LASTEXITCODE -ne 0) { throw 'Final installed-delivery verification failed' }
'ready=true' >> $env:GITHUB_OUTPUT
