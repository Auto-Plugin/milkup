# Synthetic transport preflight, not rendering evidence. No accounts or processes.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Assert-PlainPath([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (-not $item.PSIsContainer) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse file' }
        $item = $item.Directory
    }
    do {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse ancestor' }
        $item = $item.Parent
    } while ($null -ne $item)
}
function Require-Rejection([scriptblock]$Action) {
    $rejected = $false
    try { $null = & $Action } catch { $rejected = $true }
    if (-not $rejected) { throw 'Malformed synthetic evidence was accepted' }
}
. (Join-Path $PSScriptRoot 'visual-evidence.ps1')
$manifest = Join-Path $PSScriptRoot 'fixtures-manifest.json'
$fixtures = @((Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).fixtures)
$path = Join-Path $env:RUNNER_TEMP ('milkup-png-preflight-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
try {
    [byte[]]$png = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAABQAAAAACCAIAAACIduYMAAAAKUlEQVR4nO3WMQEAAAjDsPk3DS7gWGKizQAA5wIA3PseAABo9N1/AGi0Oxzx0xc3ZYUAAAAASUVORK5CYII=')
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($png)).ToLowerInvariant()
    $records = @()
    foreach ($fixture in $fixtures) {
        [IO.File]::WriteAllBytes((Join-Path $path ($fixture.id + '.png')), $png)
        $records += @{
            fixture=$fixture.id; expectedRegistrationId=$fixture.expectedRegistrationId
            ok=$true; rawRenderSucceeded=$true; registrationMatches=$true
            launcher=@{success=$true; stopMatrixAfterThisCase=$false; jobActiveAfterStop=0
                cleanupErrors=@(); profileDeletedAndFolderAbsent=$true; privateTreeRemoved=$true}
            pngValidation=@{decoded=$true; nonUniform=$true; sha256=$digest; width=1280; height=2}
            metadata=@{pngBytes=$png.Length}
        }
    }
    $report = @{records=$records; acceptedAssertions=50}
    $bundle = Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report
    if (-not $bundle.complete -or $bundle.status -cne 'complete' -or $bundle.checked.Count -ne 50) { throw 'Complete caching failed' }
    $frames = @(Write-PositivePngEvidence -Bundle $bundle)
    $end = $frames[-1].Substring('MILKUP_PNG_MANIFEST '.Length) | ConvertFrom-Json
    if ($end.count -ne 50 -or -not $end.complete -or $end.totalBytes -ne 50 * $png.Length) { throw 'Complete emission failed' }
    $failedPath = Join-Path $path ($fixtures[-1].id + '.png')
    Remove-Item -LiteralPath $failedPath
    $records[-1].ok = $false; $records[-1].launcher.success = $false
    $records[-1].launcher.stopMatrixAfterThisCase = $true
    $records[-1].launcher.privateTreeRemoved = $false
    $records[-1].launcher.cleanupErrors = @('synthetic native tree failure')
    $report.acceptedAssertions = 49
    $bundle = Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed
    if ($bundle.complete -or $bundle.status -cne 'partial-failed' -or $bundle.checked.Count -ne 49 -or
        $bundle.failedFixtures[0] -cne $fixtures[-1].id -or $bundle.unreachedFixtures.Count -ne 0) { throw 'Partial caching failed' }
    $frames = @(Write-PositivePngEvidence -Bundle $bundle)
    $end = $frames[-1].Substring('MILKUP_PNG_MANIFEST '.Length) | ConvertFrom-Json
    if ($end.count -ne 49 -or $end.complete -or $end.failedFixtures.Count -ne 1) { throw 'Partial emission failed' }
    Require-Rejection { Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report }
    [IO.File]::WriteAllBytes($failedPath, $png)
    Require-Rejection { Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed }
    Remove-Item -LiteralPath $failedPath
    $records[0].fixture = $fixtures[1].id
    Require-Rejection { Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed }
    $records[0].fixture = $fixtures[0].id
    $records[0].launcher.privateTreeRemoved = $false
    Require-Rejection { Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed }
    $records[0].launcher.privateTreeRemoved = $true
    $records[0].pngValidation.sha256 = '0' * 64
    Require-Rejection { Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed }
    $records[0].pngValidation.sha256 = $digest
    $records[-1].launcher.profileDeletedAndFolderAbsent = $false
    Require-Rejection { Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed }
    $records[-1].launcher.profileDeletedAndFolderAbsent = $true
    $records[0].launcher.jobActiveAfterStop = 1
    Require-Rejection { Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed }
    $records[0].launcher.jobActiveAfterStop = 0
    $records[0].launcher.cleanupErrors = @('synthetic unexpected error')
    Require-Rejection { Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed }
    $records[0].launcher.cleanupErrors = @()
    # A genuine early stop preserves only its successful prefix and accurately
    # distinguishes all not-yet-dispatched inputs from its single failed input.
    foreach ($fixture in @($fixtures | Select-Object -Skip 2 -First 47)) {
        Remove-Item -LiteralPath (Join-Path $path ($fixture.id + '.png'))
    }
    $failedRecord = $records[-1]
    $failedRecord.fixture = $fixtures[2].id
    $failedRecord.expectedRegistrationId = $fixtures[2].expectedRegistrationId
    $report.records = @($records[0], $records[1], $failedRecord)
    $report.acceptedAssertions = 2
    $bundle = Read-PositivePngEvidence -Output $path -Manifest $manifest -Report $report -PartialFailed
    if ($bundle.checked.Count -ne 2 -or $bundle.failedFixtures[0] -cne $fixtures[2].id -or
        $bundle.unreachedFixtures.Count -ne 47 -or $bundle.unreachedFixtures[0] -cne $fixtures[3].id) {
        throw 'Mid-matrix partial boundary failed'
    }
    Write-Output 'Synthetic PNG complete/terminal-partial/mid-partial and eight refusal checks passed; no rendering asserted.'
} finally {
    Assert-PlainPath $path
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $path) { throw 'Synthetic preflight directory remains' }
}
