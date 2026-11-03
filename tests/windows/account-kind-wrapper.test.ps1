#Requires -Version 7.2
# Pure policy and mocked group queries; no accounts, tokens or Windows API calls.
[CmdletBinding()]
param([string]$OutputPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '../../scripts/ci/WindowsMermaidStandardUser.cs'
$wrapper = Join-Path $PSScriptRoot '../../scripts/ci/run-windows-mermaid-product-e2e.ps1'
Add-Type -Path $helper
$parseErrors = $null; $tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($wrapper, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Assert-AccountMode', 'Get-ExpectedAccountGroupSids', 'Assert-ExpectedAccountGroups', 'Confirm-DeletedAccountGroupAbsence')) {
    $nodes = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name }, $true))
    if ($nodes.Count -ne 1) { throw 'Missing or ambiguous local policy function' }
    . ([scriptblock]::Create($nodes[0].Extent.Text))
}
$results = [Collections.Generic.List[object]]::new()
$sid = 'S-1-5-21-11-22-33-1003'
function Case([string]$Name, [scriptblock]$Body) {
    & $Body
    $results.Add(@{ name = $Name; passed = $true })
}
function Assert-True([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function New-Token([string]$Kind) {
    $filtered = $Kind -ceq 'filtered-admin'
    $value = [Collections.Generic.Dictionary[string,object]]::new()
    $privileges = [Collections.Generic.List[Collections.Generic.Dictionary[string,object]]]::new()
    foreach ($name in @('SeChangeNotifyPrivilege', 'SeShutdownPrivilege', 'SeUndockPrivilege', 'SeIncreaseWorkingSetPrivilege', 'SeTimeZonePrivilege')) {
        $privilege = [Collections.Generic.Dictionary[string,object]]::new()
        $privilege['name'] = $name; $privilege['attributes'] = [uint32]3
        $privileges.Add($privilege)
    }
    foreach ($entry in (@{
        sid = $sid; ownerSid = $sid; ownerIsUser = $true; sessionId = 2
        tokenType = 1; integrityRid = 8192; uiAccess = $false; elevated = $false
        elevationType = $(if ($filtered) { 3 } else { 1 })
        administratorsGroupPresentIncludingDenyOnly = $filtered
        administratorsGroupAttributes = $(if ($filtered) { [uint32]16 } else { $null })
        seDebugPrivilegePresent = $false; privileges = $privileges.ToArray()
        privilegeCount = 5; hostDisallowedPrivilegeCount = 0; privilegesComplete = $true
        pureStandardUser = -not $filtered; filteredAdmin = $filtered
    }).GetEnumerator()) { $value[$entry.Key] = $entry.Value }
    return ,$value
}
function Reject-Token([string]$Kind, [scriptblock]$Change) {
    $value = New-Token $Kind
    & $Change $value
    Assert-True (-not [WindowsMermaidStandardUser]::MatchesExpectedAccountKind($value, $Kind)) 'Incomplete or unsafe token facts were accepted'
}
Case 'accept complete primary medium pure-standard token' {
    Assert-True ([WindowsMermaidStandardUser]::MatchesExpectedAccountKind((New-Token 'pure-standard'), 'pure-standard')) 'Valid standard token rejected'
}
Case 'accept complete non-elevated limited administrator with exact deny-only attributes' {
    Assert-True ([WindowsMermaidStandardUser]::MatchesExpectedAccountKind((New-Token 'filtered-admin'), 'filtered-admin')) 'Valid filtered token rejected'
}
Case 'reject cross-kind and unknown-kind expectations' {
    Assert-True (-not [WindowsMermaidStandardUser]::MatchesExpectedAccountKind((New-Token 'pure-standard'), 'filtered-admin')) 'Standard token accepted as filtered'
    Assert-True (-not [WindowsMermaidStandardUser]::MatchesExpectedAccountKind((New-Token 'filtered-admin'), 'pure-standard')) 'Filtered token accepted as standard'
    Assert-True (-not [WindowsMermaidStandardUser]::MatchesExpectedAccountKind((New-Token 'filtered-admin'), 'administrator')) 'Unknown expected kind accepted'
}
foreach ($kind in @('pure-standard', 'filtered-admin')) {
    foreach ($pair in @(
        @('elevated', $true), @('elevationType', 2), @('tokenType', 2), @('integrityRid', 12288),
        @('integrityRid', 4096), @('uiAccess', $true), @('seDebugPrivilegePresent', $true),
        @('privilegesComplete', $false), @('hostDisallowedPrivilegeCount', 1), @('privilegeCount', 65),
        @('ownerIsUser', $false), @('ownerSid', 'S-1-5-32-544')
    )) {
        Case "$kind rejects $($pair[0])=$($pair[1])" { Reject-Token $kind { param($t) $t[$pair[0]] = $pair[1] } }
    }
    Case "$kind rejects unobserved privilege omitted from count and flags" {
        Reject-Token $kind { param($t) $t['privileges'][0]['name'] = 'SeImpersonatePrivilege' }
    }
    Case "$kind rejects duplicate privilege records" {
        Reject-Token $kind { param($t) $t['privileges'][1]['name'] = 'SeChangeNotifyPrivilege' }
    }
    Case "$kind rejects truncated privilege array" {
        Reject-Token $kind { param($t) $t['privilegeCount'] = 4 }
    }
    Case "$kind rejects missing actual token fact despite asserted class booleans" {
        Reject-Token $kind { param($t) $t.Remove('uiAccess') | Out-Null }
    }
    Case "$kind rejects stringified numeric fact" {
        Reject-Token $kind { param($t) $t['tokenType'] = '1' }
    }
}
foreach ($flags in @(0, 2, 4, 8, 18, 20, 24, 17, 48)) {
    Case "filtered administrator rejects group attributes $flags" {
        Reject-Token 'filtered-admin' { param($t) $t['administratorsGroupAttributes'] = [uint32]$flags }
    }
}
Case 'reject UAC-disabled/default administrator token' {
    Reject-Token 'filtered-admin' { param($t) $t['elevationType'] = 1 }
}
Case 'reject standard token carrying any Administrators membership' {
    Reject-Token 'pure-standard' { param($t) $t['administratorsGroupPresentIncludingDenyOnly'] = $true; $t['administratorsGroupAttributes'] = [uint32]16 }
}
Case 'accept exact group fixtures only' {
    Assert-ExpectedAccountGroups 'pure-standard' @('S-1-5-32-545')
    Assert-ExpectedAccountGroups 'filtered-admin' @('S-1-5-32-544', 'S-1-5-32-545')
}
foreach ($entry in @(
    @('pure-standard', @('S-1-5-32-544', 'S-1-5-32-545')),
    @('filtered-admin', @('S-1-5-32-545')),
    @('filtered-admin', @('S-1-5-32-544', 'S-1-5-32-544')),
    @('filtered-admin', @('S-1-5-32-544', 'S-1-5-32-545', 'S-1-5-32-555'))
)) {
    Case "reject wrong or duplicate group set $($entry[0]):$($entry[1] -join ',')" {
        $rejected = $false
        try { Assert-ExpectedAccountGroups $entry[0] $entry[1] } catch { $rejected = $true }
        Assert-True $rejected 'Unexpected account group membership accepted'
    }
}
Case 'filtered account cannot enter installer mode' {
    Assert-AccountMode 'pure-standard' $true
    Assert-AccountMode 'filtered-admin' $false
    $rejected = $false
    try { Assert-AccountMode 'filtered-admin' $true } catch { $rejected = $true }
    Assert-True $rejected 'Filtered account admitted to installation'
}
$script:groupBehavior = 'clean'
$queriedGroups = [Collections.Generic.List[string]]::new()
function Get-LocalGroupMember {
    [CmdletBinding()]
    param([Alias('SID')][string]$GroupSid)
    $queriedGroups.Add($GroupSid)
    if ($script:groupBehavior -ceq 'unknown' -and $GroupSid -ceq 'S-1-5-32-544') { throw 'Synthetic read-only access failure' }
    if ($script:groupBehavior -ceq 'residual' -and $GroupSid -ceq 'S-1-5-32-544') { return @{ SID = @{ Value = $sid } } }
    return @{ SID = @{ Value = 'S-1-5-21-11-22-33-1004' } }
}
foreach ($scenario in @('clean', 'residual', 'unknown')) {
    Case "exact deleted-account group cleanup $scenario" {
        $script:groupBehavior = $scenario
        $queriedGroups.Clear()
        $proof = Confirm-DeletedAccountGroupAbsence $sid
        Assert-True ($proof.complete -eq ($scenario -ceq 'clean')) 'Group cleanup reported an incorrect certainty'
        Assert-True ($proof.readOnly -and $queriedGroups.Count -eq 2 -and $proof.groups.Count -eq 2) 'Group checks did not cover both exact groups'
        if ($scenario -cne 'clean') { Assert-True ($proof.errors.Count -gt 0) 'Group uncertainty was discarded' }
    }
}
$report = @{ status = 'passed'; tests = $results.Count; cases = $results.ToArray()
    helperSha256 = (Get-FileHash $helper -Algorithm SHA256).Hash.ToLowerInvariant()
    wrapperSha256 = (Get-FileHash $wrapper -Algorithm SHA256).Hash.ToLowerInvariant()
    nativeWindowsApisExecuted = $false; accountsChanged = $false; remoteTasksTriggered = $false }
$json = $report | ConvertTo-Json -Depth 8
if ($OutputPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json + "`n", [Text.UTF8Encoding]::new($false)) }
Write-Output $json
