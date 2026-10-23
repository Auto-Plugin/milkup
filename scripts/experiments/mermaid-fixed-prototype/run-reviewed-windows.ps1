# Candidate execution entry point. No workflow is installed by this file.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or
    $env:GITHUB_REF -cne 'refs/heads/dot/milkup-v2-mermaid-prototype' -or
    $env:GITHUB_RUN_ATTEMPT -ne '1') { throw 'Unexpected reviewed prototype scope' }
$event = Get-Content -Raw $env:GITHUB_EVENT_PATH | ConvertFrom-Json
if ($event.repository.private -or $event.deleted -or
    -not $event.head_commit.message.Contains('[mermaid-fixed-prototype]')) {
    throw 'Missing exact prototype execution marker'
}
$source = @(git rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $source.Count -ne 1 -or $source[0].Trim() -cne $env:GITHUB_SHA) { throw 'Source SHA mismatch/read failed' }
git merge-base --is-ancestor b7f9cdecfc02c2f0710fc9d6b71c12419364e644 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Wrong prototype baseline' }
$allowed = '^(scripts/experiments/mermaid-fixed-prototype/|\.github/workflows/v2-mermaid-fixed-prototype\.yml$)'
$changed = @(git diff --name-only b7f9cdecfc02c2f0710fc9d6b71c12419364e644 HEAD)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read prototype diff' }
foreach ($file in $changed) {
    if ($file -cnotmatch $allowed) { throw "Unreviewed path in isolated prototype branch: $file" }
}
$dirty = @(git status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'Dirty or unreadable prototype checkout' }
$root = $PSScriptRoot
$engine = Join-Path $root 'assets/mermaid-12.2.0.min.js'
if ((Get-Item $engine).Length -ne 5494801 -or
    (Get-FileHash $engine -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f') {
    throw 'Fixed official engine differs'
}
$roots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:ProgramFiles 'Microsoft/EdgeWebView/Application')
) | Select-Object -Unique
$candidates = @(foreach ($directory in $roots) {
    if (Test-Path -LiteralPath $directory -PathType Container) {
        foreach ($child in Get-ChildItem -LiteralPath $directory -Directory) {
            $version = $null
            if ([Version]::TryParse($child.Name, [ref]$version) -and
                (Test-Path -LiteralPath (Join-Path $child.FullName 'msedgewebview2.exe') -PathType Leaf)) {
                [pscustomobject]@{ path = $child.FullName; version = $version }
            }
        }
    }
})
if ($candidates.Count -eq 0) { throw 'No existing WebView2; no Runtime installation fallback' }
$runtime = ($candidates | Sort-Object version -Descending | Select-Object -First 1).path
$proof = Join-Path $env:RUNNER_TEMP ('mermaid-fixed-prototype-evidence-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $proof -ErrorAction Stop | Out-Null
"evidence_root=$proof" >> $env:GITHUB_OUTPUT
'evidence_created=true' >> $env:GITHUB_OUTPUT
$env:CARGO_TARGET_DIR = Join-Path $env:RUNNER_TEMP 'mermaid-fixed-prototype-target'
$compiler = @(rustc --version --verbose)
if ($LASTEXITCODE -ne 0) { throw 'Existing compiler unavailable; no toolchain installation fallback' }
$compiler | Set-Content (Join-Path $proof 'compiler.txt')
$manifest = Join-Path $root 'Cargo.toml'
# Build-resource network only: fetch the already-reviewed lockfile packages.
# No npm/plugin installation, toolchain update, browser or WebView2 installation.
cargo fetch --locked --manifest-path $manifest
if ($LASTEXITCODE -ne 0) { throw 'Locked build-resource fetch failed' }
$env:CARGO_NET_OFFLINE = 'true'
cargo test --locked --offline --manifest-path $manifest
if ($LASTEXITCODE -ne 0) { throw 'Offline tests failed; missing cached crates remain a preflight blocker' }
cargo build --locked --offline --manifest-path $manifest
if ($LASTEXITCODE -ne 0) { throw 'Offline build failed; no dependency-fetch fallback' }
$binary = Join-Path $env:CARGO_TARGET_DIR 'debug/milkup-mermaid-fixed-prototype.exe'
[ordered]@{
    exactSource = $env:GITHUB_SHA
    baseline = 'b7f9cdecfc02c2f0710fc9d6b71c12419364e644'
    runtime = $runtime
    binaryBytes = (Get-Item $binary).Length
    binarySha256 = (Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant()
    fixedEngineBytes = (Get-Item $engine).Length
    executableIsPrototypeNotInstaller = $true
    nativeNetworkGuarantee = $false
    standardUserAcceptance = 'Fresh temporary local Users account; suspended token/SID gate; profile/account/test-directory cleanup; no privilege adjustment'
} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $proof 'execution.json')
& (Join-Path $root 'run-standard-user.ps1') -Binary $binary -Runtime $runtime -Evidence $proof
$dirty = @(git status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'Prototype modified source checkout or status inspection failed' }
