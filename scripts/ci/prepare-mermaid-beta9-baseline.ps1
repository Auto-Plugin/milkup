[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or $env:GITHUB_REF -cne 'refs/heads/dot/mermaid-stability-20261104') {
    throw 'Only the independent Windows regression checkout is permitted'
}
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Baseline input directory must be new' }
$root = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $root.StartsWith([IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Expected a new runner temporary directory' }
New-Item -ItemType Directory -Path $root | Out-Null
function Proof([string]$Path, [string]$Hash, [long]$Length = 0) {
    $file = Get-Item -LiteralPath $Path
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected plain pinned input file' }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $Hash -or ($Length -gt 0 -and $file.Length -ne $Length)) { throw 'Pinned delivered input mismatch' }
    return [ordered]@{ path = $file.FullName; bytes = $file.Length; sha256 = $actual }
}
$application = 'a5556beea5cdd1570361c528b2326bc0ad8ba0c4'
$artifactJson = & gh api repos/Auto-Plugin/milkup/actions/artifacts/13270072153
if ($LASTEXITCODE -ne 0) { throw 'Cannot read delivered artifact metadata' }
$artifact = ($artifactJson -join "`n") | ConvertFrom-Json
if ($artifact.id -ne 13270072153 -or $artifact.expired -or $artifact.size_in_bytes -ne 6176973 -or
    $artifact.workflow_run.id -ne 41713129442 -or $artifact.workflow_run.head_sha -cne $application -or
    $artifact.digest -cne 'sha256:4346d92ccc7f9b47ef14a1b5b70a97db38128baea5176b9250084a2cd28486d2') { throw 'Delivered artifact provenance mismatch' }
$zipPath = Join-Path $root 'delivered-beta9.zip'
# PowerShell 7.4+ preserves native redirected stdout bytes; never print the redirect URL/token.
& gh api repos/Auto-Plugin/milkup/actions/artifacts/13270072153/zip > $zipPath
if ($LASTEXITCODE -ne 0) { throw 'Cannot download delivered artifact' }
$zipProof = Proof $zipPath '4346d92ccc7f9b47ef14a1b5b70a97db38128baea5176b9250084a2cd28486d2' 6176973
$payload = Join-Path $root 'delivery'
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    if ($archive.Entries.Count -ne 29) { throw 'Delivered archive entry count changed' }
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -cmatch '(^[/\\]|[\\:]|(^|/)\.\.(/|$))' -or $entry.Length -gt 32MB) { throw 'Unexpected delivered archive entry' }
    }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $payload)
$installer = Proof (Join-Path $payload 'milkup-2.0.0-beta.9-windows-x64-a5556beea5cd-setup.exe') 'f7fe28275477e8957653649924348bc06e24b4b49d63f6e1d6a6f08ed65c6fbf' 5898153
$inspection = Join-Path $root 'static-nsis'
& 7z x $installer.path "-o$inspection" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Read-only NSIS extraction failed' }
$images = @(Get-ChildItem -LiteralPath $inspection -Recurse -File -Filter milkup-desktop.exe)
if ($images.Count -ne 1) { throw 'Expected one actual delivered application image' }
$image = Proof $images[0].FullName '5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84' 24040960
$manifest = Proof (Join-Path $PSScriptRoot '../../docs/evidence/mermaid-windows-trial-beta9-2026-11-03/attempt-41713129442/extracted/inspection/installer-input.json') '9dbf8713658fd07015dba44e89aac6f252f8c8a0d7a85d1baefd511c28673184'
$record = [ordered]@{
    schema = 1; harnessCandidateSha = $env:GITHUB_SHA; applicationCandidateSha = $application
    compiledInThisRun = $false; historicalSourceRunId = 41713129442
    artifactId = $artifact.id; artifactExpiresAt = $artifact.expires_at
    archive = $zipProof; installer = $installer; extractedExpectedImage = $image; packageManifest = $manifest
    compiledBinaryAvailable = $false; imageReconstructionPerformed = $false; privilegedApplicationExecution = $false
}
$record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'baseline-provenance.json') -Encoding utf8
