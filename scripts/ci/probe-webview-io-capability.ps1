[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') { throw 'Isolated Windows required' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$wpr = Join-Path $env:SystemRoot 'System32/wpr.exe'
$sig = Get-AuthenticodeSignature $wpr
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Signed Microsoft WPR required' }
$r = [ordered]@{ schema = 1; sourceSha = $env:GITHUB_SHA; wprSha256 = (Get-FileHash $wpr).Hash.ToLowerInvariant(); imageVersion = $env:ImageVersion; recordingStarted = $false; productStarted = $false; securitySettingsChanged = $false; queries = @(); exports = @() }
function Query([string[]]$CommandArguments) {
    $output = @(& $wpr @CommandArguments 2>&1) -join "`n"
    $code = $LASTEXITCODE
    if ($output.Length -gt 131072) { throw 'Capability metadata exceeds budget' }
    $r.queries += @{ arguments = $CommandArguments; exitCode = $code; text = $output }
    return $output
}
$profiles = Query -CommandArguments @('-profiles')
$names = @()
foreach ($line in ($profiles -split "`n")) {
    if ($line -match '^\s*([A-Za-z0-9_]+)\s+.*(File I/O|Mini[Ff]ilter|Disk I/O|Storage)') { $names += $Matches[1] }
}
foreach ($name in @($names | Select-Object -Unique)) {
    $null = Query -CommandArguments @('-profiledetails',$name,'-filemode')
    $export = Join-Path $OutputDirectory ($name + '.wprp')
    $null = Query -CommandArguments @('-exportprofile',$name,$export,'-filemode')
    if (Test-Path $export) { $r.exports += @{ name = $name; bytes = (Get-Item $export).Length; sha256 = (Get-FileHash $export).Hash.ToLowerInvariant() } }
}
$providers = @(& $wpr -providers 2>&1)
$code = $LASTEXITCODE
$r.providerQueryExit = $code
# Static registered-provider names/GUIDs only; no process or trace payload.
$r.storageProviders = @($providers | Where-Object { $_ -match 'StorPort|StorDiag|Storage-Class|FilterManager|Minifilter' } | Select-Object -First 32 | ForEach-Object { [string]$_ })
$r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $OutputDirectory 'capabilities.json') -Encoding utf8
