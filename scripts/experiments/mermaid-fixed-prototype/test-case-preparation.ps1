# Synthetic projection checks and own-source contract; no account or process access.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'case-preparation.ps1')
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$empty = Convert-PreparationSummary @{}
Require ($null -eq $empty.ready -and $null -eq $empty.stderr -and $null -eq $empty.ipcThreadsCompleted -and $null -eq $empty.readyWaitElapsedMs) 'Missing fields were converted into positive evidence'
$engine = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'src/engine.rs') -Raw
Require ($engine -cmatch '(?s)const STARTUP_PHASES: &\[&str\] = &\[(.*?)\];') 'Cannot read pinned native phase names'
$nativePhases = @([regex]::Matches($Matches[1], '"([a-z-]+)"') | ForEach-Object { $_.Groups[1].Value })
$projector = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'case-preparation.ps1') -Raw
Require ($projector -cmatch '(?s)\$phases = @\((.*?)\)') 'Cannot read projection phase names'
$projectionPhases = @([regex]::Matches($Matches[1], "'([a-z-]+)'") | ForEach-Object { $_.Groups[1].Value })
Require ($nativePhases.Count -eq 19 -and $projectionPhases.Count -eq 19 -and @(Compare-Object ($nativePhases | Sort-Object) ($projectionPhases | Sort-Object) -CaseSensitive).Count -eq 0) 'Native phase and projection allowlists differ'
foreach ($phase in $nativePhases) {
    $projected = Convert-PreparationSummary @{stderr="MILKUP_PHASE $phase elapsedUs=123 hresult=0x80004005"}
    Require ($projected.stderr.lines.Count -eq 1 -and $projected.stderr.unknownLinesOmitted -eq 0) 'Native phase was dropped by projection'
}
$hidden = 'private-synthetic-content'
$source = @{
    ready=@{phase='ready';engine='12.2.0';browserProcessId=42;source=$hidden}
    prepareElapsedMs=17;readyWaitElapsedMs=12;prepareDeadlineMs=10000;renderDeadlineMs=2000
    ipcThreadsCompleted=$true;stderrExceededBudget=$false
    preStopJob=@{active=1;peakJobMemoryBytes=1234;members=@(@{pid=42;image="C:\$hidden\msedgewebview2.exe";token=@{isAppContainer=$true;elevated=$false;capabilityCount=0;userSid=$hidden;seDebugPrivilege=@{present=$false}}})}
    stderr="MILKUP_PHASE helper-enter elapsedUs=0`r`nMILKUP_PHASE environment-callback-failed elapsedUs=12 hresult=0x80004005`r`nFixed Mermaid prototype failed: Native helper deadline reached`n$hidden"
}
$summary = Convert-PreparationSummary $source
$encoded = $summary | ConvertTo-Json -Depth 10 -Compress
Require (-not $encoded.Contains($hidden)) 'Private content escaped projection'
Require ($summary.stderr.lines.Count -eq 3 -and $summary.stderr.unknownLinesOmitted -eq 1 -and -not $summary.stderr.truncated) 'Fixed stderr projection failed'
Require ($summary.readyWaitElapsedMs -eq 12 -and $summary.prepareElapsedMs -eq 17 -and $summary.prepareDeadlineMs -eq 10000 -and $summary.renderDeadlineMs -eq 2000) 'Timing projection changed values'
Require ($summary.preStopJob.members[0].image -ceq 'msedgewebview2.exe' -and $summary.preStopJob.members[0].isAppContainer) 'Owned Job projection failed'
Require ($summary.stderr.sha256AfterLossyDecode -ceq [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($source.stderr))).ToLowerInvariant()) 'Stderr digest mismatch'
$source.stderr = @(
    "MILKUP_PHASE $hidden elapsedUs=1",
    "MILKUP_PHASE helper-enter elapsedUs=1 $hidden",
    'MILKUP_PHASE helper-enter elapsedUs=-1',
    'MILKUP_PHASE helper-enter elapsedUs=1234567890123',
    'MILKUP_PHASE helper-enter elapsedUs=1 hresult=0x80004005suffix',
    "Fixed Mermaid prototype failed: $hidden",
    "https://invalid.example/$hidden",
    "file:///C:/$hidden"
) -join "`n"
$summary = Convert-PreparationSummary $source
Require ($summary.stderr.lines.Count -eq 0 -and $summary.stderr.unknownLinesOmitted -eq 8) 'Untrusted stderr accepted as phase/error'
Require (-not ($summary | ConvertTo-Json -Depth 10 -Compress).Contains($hidden)) 'Unknown stderr was emitted'
$source.stderr = (@('MILKUP_PHASE helper-enter elapsedUs=0') * 25) -join "`n"
$summary = Convert-PreparationSummary $source
Require ($summary.stderr.lines.Count -eq 24 -and $summary.stderr.truncated) 'Phase count bound failed'
$source.stderr = 'x' * 16385
$summary = Convert-PreparationSummary $source
Require ($summary.stderr.lines.Count -eq 0 -and $summary.stderr.truncated) 'Oversized stderr inspected/emitted'
$source.stderr = ''
$source.preStopJob.members = @($source.preStopJob.members[0]) * 17
$summary = Convert-PreparationSummary $source
Require ($summary.preStopJob.memberCount -eq 17 -and $summary.preStopJob.members.Count -eq 16 -and $summary.preStopJob.membersTruncated) 'Owned member bound failed'
$source.ready = @{phase=$hidden;engine=$hidden;browserProcessId=-1}
$source.prepareElapsedMs = $true; $source.readyWaitElapsedMs = -1; $source.ipcThreadsCompleted = 'true'
$source.preStopJob = @{inspectionError=$hidden}
$summary = Convert-PreparationSummary $source
Require ($summary.ready.phase -ceq '<unrecognized>' -and $null -eq $summary.ready.engine -and $null -eq $summary.ready.browserProcessId) 'Malformed ready accepted'
Require ($null -eq $summary.prepareElapsedMs -and $null -eq $summary.readyWaitElapsedMs -and $null -eq $summary.ipcThreadsCompleted) 'Malformed timing/boolean accepted'
Require ($summary.preStopJob.inspectionFailed -and $null -eq $summary.preStopJob.active -and $summary.preStopJob.members.Count -eq 0) 'Unknown Job inspection became successful zero'
Require (-not ($summary | ConvertTo-Json -Depth 10 -Compress).Contains($hidden)) 'Unknown ready/Job content leaked'
Write-Output 'Synthetic preparation projection passed: missing/valid, eight refusals, phase/byte/member limits, malformed fields and content omission; no rendering asserted.'
