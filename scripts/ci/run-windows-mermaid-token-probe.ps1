#Requires -Version 7.2
[CmdletBinding(DefaultParameterSetName = 'Parent')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Parent')][string]$ProbeBinary,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][string]$EvidenceDirectory,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedProbeExeSha256,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][ValidateSet('pure-standard', 'filtered-admin', IgnoreCase = $false)][string]$AccountKind,
    [Parameter(Mandatory, ParameterSetName = 'Child')][switch]$Child,
    [Parameter(Mandatory, ParameterSetName = 'Child')][string]$ChildSpecPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Independent, opt-in private-libtest diagnostics. No desktop eligibility check,
# frontend, EdgeDriver, Runtime installation, source input or arbitrary command.
# The established fixture helpers below are copied as reviewed source, never
# evaluated dynamically from the product wrapper. Its behavior stays unchanged.
function Assert-AccountMode([string]$Kind, [bool]$InstallerMode) {
    if ($Kind -cnotin @('pure-standard', 'filtered-admin')) { throw 'Unknown expected account kind' }
    if ($InstallerMode -and $Kind -cne 'pure-standard') { throw 'Installer mode permits only the fresh pure-standard account' }
}
function Get-ExpectedAccountGroupSids([string]$Kind) {
    Assert-AccountMode $Kind $false
    if ($Kind -ceq 'filtered-admin') { return @('S-1-5-32-545', 'S-1-5-32-544') }
    return @('S-1-5-32-545')
}
function Assert-ExpectedAccountGroups([string]$Kind, [string[]]$Actual) {
    $expected = @(Get-ExpectedAccountGroupSids $Kind)
    if ($Actual.Count -ne $expected.Count -or @($Actual | Select-Object -Unique).Count -ne $Actual.Count -or
        @($Actual | Where-Object { $_ -cnotin $expected }).Count -gt 0) { throw 'Fresh account has unexpected group membership' }
}
function Confirm-DeletedAccountGroupAbsence([string]$ExactSid) {
    if ($ExactSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$') { throw 'Expected exact newly owned account SID' }
    $result = [ordered]@{ sid = $ExactSid; readOnly = $true; complete = $false; groups = @(); errors = @() }
    foreach ($groupSid in @('S-1-5-32-545', 'S-1-5-32-544')) {
        $record = [ordered]@{ groupSid = $groupSid; queried = $false; exactSidPresent = $null }
        try {
            $members = @(Get-LocalGroupMember -SID $groupSid -ErrorAction Stop)
            $record.exactSidPresent = @($members | Where-Object { $_.SID.Value -ceq $ExactSid }).Count -gt 0
            $record.queried = $true
            if ($record.exactSidPresent) { $result.errors += 'Exact deleted-account SID remains in ' + $groupSid }
        } catch { $result.errors += 'Read-only group absence remains unconfirmed for ' + $groupSid + ': ' + $_.Exception.Message }
        $result.groups += $record
    }
    $result.complete = $result.errors.Count -eq 0
    return $result
}
function Assert-HostedCandidate {
    if (-not $IsWindows -or $PSVersionTable.PSVersion.Major -lt 7 -or
        $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
        $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or
        $env:GITHUB_REF -cne 'refs/heads/dot/mermaid-rebuild-20261103') {
        throw 'Only the independent candidate on a fresh GitHub-hosted Windows runner is permitted'
    }
}
function Assert-PlainPath([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse path rejected: $Path" }
    if (-not $item.PSIsContainer) { $item = $item.Directory }
    do {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse ancestor rejected' }
        $item = $item.Parent
    } while ($null -ne $item)
}
function Assert-Contained([string]$Path, [string]$Root) {
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path is outside its newly owned root' }
}
function New-OwnedDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) { throw "Refusing to reuse a directory: $Path" }
    New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null
    Assert-PlainPath $Path
}
function Read-BoundedText([string]$Path, [long]$Limit) {
    Assert-PlainPath $Path
    $inputStream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $memory = [IO.MemoryStream]::new()
    try {
        if ($inputStream.Length -gt $Limit) { throw 'Text input exceeds its byte budget' }
        $buffer = [byte[]]::new(65536)
        while ($true) {
            $count = $inputStream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $Limit - $memory.Length + 1))
            if ($count -eq 0) { break }
            if ($memory.Length + $count -gt $Limit) { throw 'Text input grew beyond its byte budget' }
            $memory.Write($buffer, 0, $count)
        }
        return [Text.UTF8Encoding]::new($false, $true).GetString($memory.ToArray())
    } finally { $inputStream.Dispose(); $memory.Dispose() }
}
function Read-SmallJson([string]$Path) {
    return (Read-BoundedText $Path 1MB) | ConvertFrom-Json -AsHashtable -Depth 24 -ErrorAction Stop
}
function Write-Json([string]$Path, $Value) {
    if (Test-Path -LiteralPath $Path) { Assert-PlainPath $Path }
    $json = $Value | ConvertTo-Json -Depth 24
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1MB) { throw 'JSON report exceeds its budget' }
    [IO.File]::WriteAllText($Path, $json + "`n", [Text.UTF8Encoding]::new($false))
}
function File-Proof([string]$Path) {
    $proof = Read-BoundedEvidenceProof $Path 256MB
    return [ordered]@{ path = [IO.Path]::GetFullPath($Path); bytes = $proof.bytes; sha256 = $proof.sha256 }
}
function Assert-Hash([string]$Path, [string]$Hash) {
    if ($Hash -cnotmatch '^[a-f0-9]{64}$' -or (File-Proof $Path).sha256 -cne $Hash) { throw 'Frozen input hash mismatch' }
}
function Plain-Files([string]$Root) {
    Assert-PlainPath $Root
    $queue = [Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($Root)
    $files = [Collections.Generic.List[object]]::new()
    $directories = 0
    while ($queue.Count -gt 0) {
        $directory = $queue.Dequeue()
        $directories++
        if ($directories -gt 128) { throw 'Owned evidence/tree traversal exceeds directory budget' }
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Owned tree contains a reparse point; retain it for explicit review' }
            if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
            else { $files.Add($item); if ($files.Count -gt 4096) { throw 'Owned tree exceeds file budget' } }
        }
    }
    return $files.ToArray()
}
function Read-BoundedEvidenceProof([string]$Path, [long]$Limit, [string]$CopyTo = '', $Created = $null) {
    Assert-PlainPath $Path
    $inputStream = $null; $outputStream = $null; $hasher = $null
    try {
        $inputStream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $expected = $inputStream.Length
        if ($expected -gt $Limit) { throw 'Evidence exceeds the read budget' }
        if ($CopyTo) {
            $outputStream = [IO.File]::Open($CopyTo, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            if ($null -ne $Created) { $Created.Value = $true }
        }
        $hasher = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
        $buffer = [byte[]]::new(65536); [long]$total = 0
        while ($true) {
            $count = $inputStream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $Limit - $total + 1))
            if ($count -eq 0) { break }
            $total += $count
            if ($total -gt $Limit) { throw 'Evidence grew beyond the read budget' }
            $hasher.AppendData($buffer, 0, $count)
            if ($null -ne $outputStream) { $outputStream.Write($buffer, 0, $count) }
        }
        if ($total -ne $expected) { throw 'Evidence changed while reading' }
        return [ordered]@{ bytes = $total; sha256 = [Convert]::ToHexString($hasher.GetHashAndReset()).ToLowerInvariant() }
    } finally {
        if ($null -ne $inputStream) { $inputStream.Dispose() }
        if ($null -ne $outputStream) { $outputStream.Dispose() }
        if ($null -ne $hasher) { $hasher.Dispose() }
    }
}
function Import-Observer([string]$Path) {
    Assert-PlainPath $Path
    if (-not ('WindowsMermaidStandardUser' -as [type])) { Add-Type -Path $Path -ErrorAction Stop }
}
function Read-ExactProfileState([string]$Sid, [string]$KnownPath) {
    $key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $Sid
    $state = [ordered]@{
        observedAt = [DateTime]::UtcNow.ToString('o'); sid = $Sid; readOnly = $true
        profileKeyPresent = $null; profilePath = $KnownPath; profilePathPresent = $null
        registryState = $null; registryRefCount = $null; hkuHivePresent = $null
        cimLoaded = $null; cimMatches = $null; diagnosticErrors = @()
    }
    try {
        $state.profileKeyPresent = Test-Path -LiteralPath $key -ErrorAction Stop
        if ($state.profileKeyPresent) {
            $properties = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
            $state.profilePath = [Environment]::ExpandEnvironmentVariables($properties.ProfileImagePath)
            foreach ($pair in @(@('State', 'registryState'), @('RefCount', 'registryRefCount'))) {
                $property = $properties.PSObject.Properties[$pair[0]]
                if ($null -ne $property) { $state[$pair[1]] = $property.Value }
            }
        }
        if ($state.profilePath) { $state.profilePathPresent = Test-Path -LiteralPath $state.profilePath -ErrorAction Stop }
    } catch { $state.diagnosticErrors += $_.Exception.Message }
    try { $state.hkuHivePresent = Test-Path -LiteralPath ('Registry::HKEY_USERS\' + $Sid) -ErrorAction Stop }
    catch { $state.diagnosticErrors += $_.Exception.Message }
    try {
        $profiles = @(Get-CimInstance -ClassName Win32_UserProfile -Filter ("SID = '" + $Sid + "'") -OperationTimeoutSec 2 -ErrorAction Stop)
        $state.cimMatches = $profiles.Count
        if ($profiles.Count -eq 1) { $state.cimLoaded = [bool]$profiles[0].Loaded }
        elseif ($profiles.Count -gt 1) { $state.diagnosticErrors += 'More than one profile matched the exact SID' }
    } catch { $state.diagnosticErrors += $_.Exception.Message }
    return $state
}
function Read-ExactSidProcesses([string]$Sid) {
    return [WindowsMermaidStandardUser]::ObserveExactSidProcesses($Sid)
}
function Invoke-ExactProfileDelete([string]$Sid) {
    [WindowsMermaidStandardUser]::DeleteTemporaryProfile($Sid)
}
function Remove-ExactProfileWithRetry([string]$Sid, $Audit) {
    $record = [ordered]@{
        maxAttempts = 6; retryWindowMs = 3000; retryDelayMs = 500
        attempts = @(); processChecks = @(); lastProcessObservation = $null; firstSharingViolationState = $null
        before = $null; after = $null; elapsedMs = 0
    }
    $Audit['profileCleanup'] = $record
    $record.before = Read-ExactProfileState $Sid $Audit.actualWindowsProfile
    if ($record.before.profilePath) { $Audit.actualWindowsProfile = $record.before.profilePath }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $completed = $false
    try {
        if ($null -eq $record.before.profileKeyPresent) { throw 'Exact profile registry state could not be observed' }
        if ($record.before.profileKeyPresent -and -not $Audit.actualWindowsProfile) { throw 'Exact profile path could not be observed' }
        for ($attempt = 1; $attempt -le $record.maxAttempts; $attempt++) {
            $observation = Read-ExactSidProcesses $Sid
            $record.lastProcessObservation = $observation
            $record.processChecks += @{ phase = 'before-delete'; attempt = $attempt; elapsedMs = $watch.ElapsedMilliseconds; complete = $observation.complete; matchCount = $observation.matchCount }
            if ($observation.complete -ne $true -or $observation.matchCount -ne 0) {
                throw 'Exact-SID processes remain or observation is incomplete; preserve profile/account without deleting or killing them'
            }
            if (-not $record.before.profileKeyPresent) { $completed = $true; break }
            if ($attempt -gt 1 -and $watch.ElapsedMilliseconds -ge $record.retryWindowMs) { throw 'Profile sharing-violation retry window expired; see recorded Win32 errors' }
            try {
                Invoke-ExactProfileDelete $Sid
                $record.attempts += @{ attempt = $attempt; elapsedMs = $watch.ElapsedMilliseconds; win32Error = $null; returnedSuccess = $true }
                $completed = $true
                break
            } catch {
                $exception = $_.Exception
                while ($null -ne $exception -and $exception -isnot [ComponentModel.Win32Exception]) { $exception = $exception.InnerException }
                $code = $(if ($null -ne $exception) { $exception.NativeErrorCode } else { $null })
                $record.attempts += @{ attempt = $attempt; elapsedMs = $watch.ElapsedMilliseconds; win32Error = $code; returnedSuccess = $false; error = $_.Exception.Message }
                if ($code -eq 32 -and $null -eq $record.firstSharingViolationState) {
                    $record.firstSharingViolationState = Read-ExactProfileState $Sid $Audit.actualWindowsProfile
                }
                $observation = Read-ExactSidProcesses $Sid
                $record.lastProcessObservation = $observation
                $record.processChecks += @{ phase = 'after-delete-failure'; attempt = $attempt; elapsedMs = $watch.ElapsedMilliseconds; complete = $observation.complete; matchCount = $observation.matchCount }
                if ($observation.complete -ne $true -or $observation.matchCount -ne 0) {
                    throw 'Profile delete failed and exact-SID processes remain or observation is incomplete; preserve profile/account'
                }
                if ($code -ne 32 -or $attempt -ge $record.maxAttempts -or $watch.ElapsedMilliseconds -ge $record.retryWindowMs) { throw }
                $remaining = $record.retryWindowMs - $watch.ElapsedMilliseconds
                Start-Sleep -Milliseconds ([Math]::Min($record.retryDelayMs, $remaining))
            }
        }
    } finally {
        $record.elapsedMs = $watch.ElapsedMilliseconds
        $record.after = Read-ExactProfileState $Sid $Audit.actualWindowsProfile
    }
    if (-not $completed -or $record.after.profileKeyPresent -ne $false -or
        ($Audit.actualWindowsProfile -and $record.after.profilePathPresent -ne $false) -or
        $record.after.hkuHivePresent -ne $false -or $record.after.cimLoaded -eq $true -or $record.after.cimMatches -gt 1) {
        throw 'Exact temporary profile removal is unconfirmed; retain the account and profile diagnostics'
    }
    $Audit.profileDeleted = $true
}
function Test-ProbeInteger($Value, [long]$Expected) {
    return ($Value -is [int] -or $Value -is [long] -or $Value -is [uint32]) -and $Value -eq $Expected
}
function Read-TokenProbeMarker([string]$Path, [string]$ExpectedKind) {
    $text = Read-BoundedText $Path 2MB
    $test = [regex]::Escape([WindowsMermaidStandardUser]::TokenProbeParentTest)
    $pattern = '(?m)^(?:test ' + $test + ' \.\.\. )?MILKUP_MERMAID_TOKEN_DIAGNOSTIC (?<json>[^\r\n]+)\r?$'
    $markers = [regex]::Matches($text, $pattern)
    if ($markers.Count -ne 1) { throw 'Expected exactly one complete token diagnostic marker' }
    $json = $markers[0].Groups['json'].Value
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1MB) { throw 'Token diagnostic JSON exceeds its budget' }
    $value = $json | ConvertFrom-Json -AsHashtable -Depth 24 -ErrorAction Stop
    if (-not (Test-ProbeInteger $value.schema 1) -or $value.accountKind -cne $ExpectedKind -or $value.status -cnotin @('observed', 'failed')) {
        throw 'Token diagnostic marker identity or status mismatch'
    }
    return $value
}
function Assert-ProbeFlag($Object, [string]$Name, [bool]$Expected) {
    if ($null -eq $Object -or -not $Object.Contains($Name) -or $Object[$Name] -isnot [bool] -or $Object[$Name] -ne $Expected) {
        throw ('Token diagnostic flag is missing or mismatched: ' + $Name)
    }
}
function Assert-TokenProbeObservation($Value, [long]$ExpectedParentPid) {
    if ($ExpectedParentPid -le 0 -or -not (Test-ProbeInteger $Value.parentPid $ExpectedParentPid) -or
        -not (Test-ProbeInteger $Value.childPid ([long]$Value.childPid)) -or $Value.childPid -le 0 -or $Value.childPid -gt [uint32]::MaxValue) { throw 'Token diagnostic is not bound to the held parent process' }
    foreach ($name in @('diagnosticOnly', 'hostPolicyAccepted', 'creationTimeJobVerified', 'parentAndSelfIdentityMatch')) { Assert-ProbeFlag $Value $name $true }
    foreach ($name in @('renderPolicyChanged', 'comStarted', 'webviewStarted', 'javascriptStarted')) { Assert-ProbeFlag $Value $name $false }
    if (-not (Test-ProbeInteger $Value.mermaidSourceBytes 0) -or
        -not (Test-ProbeInteger $Value.childExitCode 0) -or
        -not $Value.Contains('failedStage') -or $null -ne $Value.failedStage) { throw 'Token diagnostic exit/stage/source contract failed' }
    foreach ($pair in @(@('suspendedParentView', 'parent-suspended-child'), @('childSelfView', 'appcontainer-self'))) {
        $view = $Value[$pair[0]]
        Assert-ProbeFlag $view 'complete' $true
        $thread = $view.callerThreadToken
        Assert-ProbeFlag $thread 'present' $false
        Assert-ProbeFlag $thread 'complete' $true
        Assert-ProbeFlag $thread 'handleClosed' $true
        if (-not (Test-ProbeInteger $thread.win32Error 1008) -or -not $thread.Contains('token') -or $null -ne $thread.token) { throw 'Probe caller thread context was not observed as ERROR_NO_TOKEN' }
        $observerPid = $(if ($pair[0] -ceq 'suspendedParentView') { $ExpectedParentPid } else { [long]$Value.childPid })
        if ($view.caller -cne $pair[1] -or -not (Test-ProbeInteger $view.requestedSourceTokenAccess 8) -or
            -not (Test-ProbeInteger $view.observerPid $observerPid) -or -not (Test-ProbeInteger $view.subjectPid ([long]$Value.childPid))) { throw 'Token diagnostic caller, process identity or source access mismatch' }
    }
    $cleanup = $Value.cleanup
    foreach ($name in @('jobCreated', 'jobEmpty', 'profileCreated', 'profileDeleted', 'privateTreeCreated', 'privateTreeRemoved', 'ipcCompleted')) { Assert-ProbeFlag $cleanup $name $true }
    if ($cleanup.errors -isnot [array] -or $cleanup.errors.Count -ne 0 -or $cleanup.joins -isnot [array] -or $cleanup.joins.Count -ne 2) { throw 'Token diagnostic cleanup is incomplete' }
    $streams = @()
    foreach ($join in $cleanup.joins) {
        Assert-ProbeFlag $join 'finished' $true
        Assert-ProbeFlag $join 'cancelRequested' $false
        Assert-ProbeFlag $join 'panicked' $false
        $streams += $join.stream
    }
    if ((($streams | Sort-Object) -join ',') -cne 'stderr,stdout') { throw 'Token diagnostic stream cleanup identities are incomplete' }
    # Privilege equality is an observation, not an admission criterion: Windows
    # can update USED_FOR_ACCESS while the child performs the read-only probe.
    if (-not $Value.Contains('parentAndSelfPrivilegesMatch') -or $Value.parentAndSelfPrivilegesMatch -isnot [bool]) { throw 'Token diagnostic privilege comparison is absent' }
}
function Copy-TokenProbeEvidence([string]$Source, [string]$Destination) {
    Assert-PlainPath $Source
    $records = @(); $rejected = @(); [long]$total = 0
    $expected = @('token-probe-context.json', 'token-probe-child-result.json', 'token-probe-result.json', 'token-probe-stdout.log', 'token-probe-stderr.log')
    foreach ($name in $expected) {
        $path = Join-Path $Source $name; $target = Join-Path $Destination $name
        $created = $false
        try {
            Assert-Contained $path $Source; Assert-Contained $target $Destination
            $limit = $(if ($name.EndsWith('.json', [StringComparison]::Ordinal)) { 1MB } else { 2MB })
            $proof = Read-BoundedEvidenceProof $path ([Math]::Min($limit, 6MB - $total)) $target ([ref]$created)
            $retained = Read-BoundedEvidenceProof $target $limit
            if ($proof.bytes -ne $retained.bytes -or $proof.sha256 -cne $retained.sha256) { throw 'Probe evidence copy mismatch' }
            if ($name.EndsWith('.json', [StringComparison]::Ordinal)) { $null = Read-SmallJson $target }
            $total += $proof.bytes
            $records += @{ name = $name; bytes = $proof.bytes; sha256 = $proof.sha256 }
        } catch {
            if ($created -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target -Force -ErrorAction Stop }
            $rejected += @{ name = $name; reason = 'missing-or-invalid-bounded-file'; exceptionType = $_.Exception.GetType().Name }
        }
    }
    return @{ complete = $rejected.Count -eq 0; files = $records; bytes = $total; rejected = $rejected }
}
function Invoke-TokenProbeChild {
    Assert-HostedCandidate
    $spec = Read-SmallJson $ChildSpecPath
    if ($spec.schema -ne 1 -or $spec.runId -cnotmatch '^[a-f0-9]{32}$' -or
        $spec.expectedSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or
        $spec.candidateSha -cne $env:GITHUB_SHA -or $spec.expectedSessionId -le 0) { throw 'Invalid immutable token-probe specification' }
    Assert-AccountMode $spec.expectedAccountKind $false
    foreach ($inputFile in @($spec.probe, $spec.observer, $spec.wrapper)) { Assert-Hash $inputFile.path $inputFile.sha256 }
    Import-Observer $spec.observer.path
    $profile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    $roaming = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
    $local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    foreach ($folder in @($profile, $roaming, $local)) {
        if (-not [IO.Path]::IsPathFullyQualified($folder) -or -not (Test-Path -LiteralPath $folder -PathType Container)) { throw 'Real fresh-account KnownFolder is unavailable' }
        Assert-PlainPath $folder
    }
    $scratch = Join-Path $profile ('.milkup-mermaid-token-probe-' + $spec.runId)
    New-OwnedDirectory $scratch
    foreach ($name in @('evidence', 'temp')) { New-OwnedDirectory (Join-Path $scratch $name) }
    $evidence = Join-Path $scratch 'evidence'
    $env:USERPROFILE = $profile; $env:APPDATA = $roaming; $env:LOCALAPPDATA = $local
    $env:TEMP = Join-Path $scratch 'temp'; $env:TMP = $env:TEMP
    $env:MILKUP_MERMAID_TOKEN_DIAGNOSTIC = '1'
    $env:MILKUP_MERMAID_TOKEN_DIAGNOSTIC_ACCOUNT_KIND = $spec.expectedAccountKind
    $context = [ordered]@{
        schema = 1; expectedAccountKind = $spec.expectedAccountKind; expectedSid = $spec.expectedSid
        expectedSessionId = $spec.expectedSessionId; actualSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        observation = $null; accountKindVerified = $false; desktopRequired = $false
        knownFolders = @{ profile = $profile; roamingAppData = $roaming; localAppData = $local }
        scratchRoot = $scratch; securityPolicyChanged = $false; existingAclChanged = $false
    }
    $result = [ordered]@{
        schema = 1; status = 'failed'; candidateSha = $spec.candidateSha; expectedAccountKind = $spec.expectedAccountKind
        expectedSid = $spec.expectedSid; probe = $spec.probe; testName = [WindowsMermaidStandardUser]::TokenProbeParentTest
        process = $null; diagnosticStatus = $null; complete = $false; error = $null; secondaryFailure = $null
    }
    try {
        $context.observation = [WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($PID))[0]
        if (-not $context.observation.ContainsKey('token') -or $context.actualSid -cne $spec.expectedSid -or
            $context.observation.token.sid -cne $spec.expectedSid -or $context.observation.token.sessionId -ne $spec.expectedSessionId -or
            -not [WindowsMermaidStandardUser]::MatchesExpectedAccountKind($context.observation.token, $spec.expectedAccountKind)) {
            throw 'Token-probe coordinator lacks the exact admitted account/SID/session'
        }
        $context.accountKindVerified = $true
        Write-Json (Join-Path $evidence 'token-probe-context.json') $context
        $result.process = [WindowsMermaidStandardUser]::RunOwnedTokenProbe(
            $spec.probe.path, [IO.Path]::GetDirectoryName($spec.probe.path),
            (Join-Path $evidence 'token-probe-stdout.log'), (Join-Path $evidence 'token-probe-stderr.log'), 120000)
        if ($result.process.status -cne 'passed' -or $result.process.exitCode -ne 0 -or
            $result.process.captureExceeded -or -not $result.process.streamsDrained) {
            $result.error = 'Exact token-probe process failed or its output is incomplete: ' + $result.process.error
        }
        $diagnostic = Read-TokenProbeMarker (Join-Path $evidence 'token-probe-stdout.log') $spec.expectedAccountKind
        Write-Json (Join-Path $evidence 'token-probe-result.json') $diagnostic
        $result.diagnosticStatus = $diagnostic.status
        if ($result.process.status -cne 'passed' -or $result.process.exitCode -ne 0 -or
            $result.process.captureExceeded -or -not $result.process.streamsDrained) { throw 'Exact token-probe process did not finish with complete bounded output' }
        if ($diagnostic.status -cne 'observed') { throw 'Native token diagnostic reported failure; retain its original report' }
        Assert-TokenProbeObservation $diagnostic ([long]$result.process.pid)
        $result.complete = $true
        $result.status = 'passed'
    } catch {
        if (-not $result.error) { $result.error = $_.Exception.Message }
        else { $result.secondaryFailure = @{ exceptionType = $_.Exception.GetType().Name; reason = 'diagnostic-result-validation' } }
    }
    finally {
        Write-Json (Join-Path $evidence 'token-probe-context.json') $context
        Write-Json (Join-Path $evidence 'token-probe-child-result.json') $result
    }
    if ($result.status -ceq 'passed') { exit 0 }
    exit 1
}
if ($Child) { Invoke-TokenProbeChild; exit 1 }
Assert-HostedCandidate
Assert-AccountMode $AccountKind $false
if ($ExpectedCommit -cne $env:GITHUB_SHA) { throw 'Expected token-probe candidate differs from workflow source' }
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$head = @(git -C $repository rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1 -or $head[0].Trim() -cne $ExpectedCommit) { throw 'Checkout differs from exact token-probe candidate' }
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
Assert-Contained $EvidenceDirectory $env:RUNNER_TEMP
New-OwnedDirectory $EvidenceDirectory
$runId = [guid]::NewGuid().ToString('N'); $accountName = 'mkmt' + $runId.Substring(0, 14)
$description = 'Mermaid token probe ' + $runId
$stageParent = Join-Path $repository '.tmp'
New-Item -ItemType Directory -Force -Path $stageParent | Out-Null
Assert-PlainPath $stageParent
$stage = Join-Path $stageParent ('windows-mermaid-token-probe-' + $runId)
$observer = Join-Path $PSScriptRoot 'WindowsMermaidStandardUser.cs'
$audit = [ordered]@{
    schema = 1; status = 'failed'; source = $ExpectedCommit; runId = $env:GITHUB_RUN_ID; attempt = $env:GITHUB_RUN_ATTEMPT
    localRunId = $runId; expectedAccountKind = $AccountKind; expectedProbeExeSha256 = $ExpectedProbeExeSha256
    testName = 'launcher::token_diagnostic::parent_observes_suspended_and_self_tokens'
    runnerObservation = $null; probe = $null; supervisor = $null; childResult = $null; evidenceCopy = $null
    accountName = $accountName; accountSid = $null; accountCreated = $false; accountDeleted = $false
    localGroupSids = @(); accountGroupCleanup = $null; accountGroupCleanupConfirmed = $false
    actualWindowsProfile = $null; profileDeleted = $false; stage = $stage; stageRemoved = $false
    cleanupErrors = @(); error = $null; changedAcl = $false; changedUacOrSecurityPolicy = $false
    runtimeInstalled = $false; browserStartedByWrapper = $false; desktopRequired = $false
    inheritedRunnerEnvironment = $false; passwordInLogsFilesArgumentsOrEnvironment = $false
    originalProductReportsModified = $false; renderingPolicyChanged = $false
}
$user = $null; $creationAttempted = $false; $stageCreated = $false; $processesEmpty = $true
$password = [Security.SecureString]::new()
try {
    Import-Observer $observer
    $audit.runnerObservation = [WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($PID))[0]
    if (-not $audit.runnerObservation.ContainsKey('token') -or $audit.runnerObservation.token.sessionId -le 0) { throw 'Runner actual nonzero session could not be observed' }
    $proof = Read-BoundedEvidenceProof $ProbeBinary 256MB
    if ($proof.sha256 -cne $ExpectedProbeExeSha256 -or [IO.Path]::GetExtension($ProbeBinary) -cne '.exe') { throw 'Private libtest executable identity mismatch' }
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($ProbeBinary))
    try {
        $reader.BaseStream.Position = 0x3c; $reader.BaseStream.Position = $reader.ReadInt32()
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Private libtest is not PE x64' }
    } finally { $reader.Dispose() }
    New-OwnedDirectory $stage; $stageCreated = $true
    $code = Join-Path $stage 'code'; New-OwnedDirectory $code
    foreach ($pair in @(@($ProbeBinary, 'mermaid-token-probe.exe'), @($PSCommandPath, 'run-windows-mermaid-token-probe.ps1'), @($observer, 'WindowsMermaidStandardUser.cs'))) {
        $target = Join-Path $code $pair[1]
        $null = Read-BoundedEvidenceProof $pair[0] 256MB $target
        if ((File-Proof $pair[0]).sha256 -cne (File-Proof $target).sha256) { throw 'Frozen token-probe staging mismatch' }
    }
    $audit.probe = File-Proof (Join-Path $code 'mermaid-token-probe.exe')
    if ($audit.probe.sha256 -cne $ExpectedProbeExeSha256 -or $audit.probe.bytes -ne $proof.bytes) { throw 'Staged private libtest differs from the frozen approved executable' }
    $pwsh = (Get-Command pwsh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    Assert-PlainPath $pwsh
    if (Get-LocalUser -Name $accountName -ErrorAction SilentlyContinue) { throw 'Generated token-probe account already exists' }
    foreach ($character in 'aA1!'.ToCharArray()) { $password.AppendChar($character) }
    $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-+='
    for ($i = 0; $i -lt 44; $i++) { $password.AppendChar($alphabet[[Security.Cryptography.RandomNumberGenerator]::GetInt32($alphabet.Length)]) }
    $password.MakeReadOnly(); $creationAttempted = $true
    $user = New-LocalUser -Name $accountName -Password $password -Description $description -AccountExpires (Get-Date).AddDays(1) -UserMayNotChangePassword
    $audit.accountCreated = $true; $audit.accountSid = $user.SID.Value
    foreach ($groupSid in @(Get-ExpectedAccountGroupSids $AccountKind)) { Add-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]$groupSid) -Member $user }
    $groups = @(Get-LocalGroup | Where-Object {
        @(Get-LocalGroupMember -Group $_ | Where-Object { $_.SID.Value -ceq $user.SID.Value }).Count -gt 0
    } | ForEach-Object { $_.SID.Value })
    $audit.localGroupSids = $groups; Assert-ExpectedAccountGroups $AccountKind $groups
    $spec = [ordered]@{
        schema = 1; runId = $runId; candidateSha = $ExpectedCommit; expectedSid = $user.SID.Value
        expectedAccountKind = $AccountKind; expectedSessionId = $audit.runnerObservation.token.sessionId
        probe = $audit.probe; observer = (File-Proof (Join-Path $code 'WindowsMermaidStandardUser.cs'))
        wrapper = (File-Proof (Join-Path $code 'run-windows-mermaid-token-probe.ps1'))
    }
    $specPath = Join-Path $code 'child-spec.json'; Write-Json $specPath $spec
    $environment = @(
        "SystemRoot=$env:SystemRoot", "WINDIR=$env:SystemRoot", "SystemDrive=$env:SystemDrive",
        "PATH=$env:SystemRoot\System32;$(Split-Path -Parent $pwsh)",
        'GITHUB_ACTIONS=true', 'RUNNER_ENVIRONMENT=github-hosted', 'GITHUB_REPOSITORY=Auto-Plugin/milkup',
        'GITHUB_REF=refs/heads/dot/mermaid-rebuild-20261103', "GITHUB_SHA=$ExpectedCommit"
    )
    if ($env:ProgramFiles) { $environment += "ProgramFiles=$env:ProgramFiles" }
    if (${env:ProgramFiles(x86)}) { $environment += "ProgramFiles(x86)=${env:ProgramFiles(x86)}" }
    foreach ($path in @($spec.wrapper.path, $specPath)) { if ($path.Contains('"') -or $path.Contains([char]0)) { throw 'Quoted or NUL child path rejected' } }
    $arguments = '-NoLogo -NoProfile -File "' + $spec.wrapper.path + '" -Child -ChildSpecPath "' + $specPath + '"'
    $processesEmpty = $false
    $audit.supervisor = [WindowsMermaidStandardUser]::Run($accountName, $password, $user.SID.Value,
        [uint32]$spec.expectedSessionId, $AccountKind, $pwsh, $arguments, $code, $environment, 240000)
    $processesEmpty = $audit.supervisor.jobEmpty -eq $true -and $audit.supervisor.cleanupErrors.Count -eq 0
    $audit.status = $audit.supervisor.status
    $profileKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $user.SID.Value
    if (Test-Path -LiteralPath $profileKey) {
        $profile = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $profileKey).ProfileImagePath)
        $audit.actualWindowsProfile = $profile
        $childEvidence = Join-Path $profile ('.milkup-mermaid-token-probe-' + $runId + '/evidence')
        if ($processesEmpty -and (Test-Path -LiteralPath $childEvidence -PathType Container)) {
            $audit.evidenceCopy = Copy-TokenProbeEvidence $childEvidence $EvidenceDirectory
            $childPath = Join-Path $EvidenceDirectory 'token-probe-child-result.json'
            if (Test-Path -LiteralPath $childPath) {
                $audit.childResult = Read-SmallJson $childPath
                if ($audit.childResult.expectedSid -cne $user.SID.Value -or $audit.childResult.expectedAccountKind -cne $AccountKind -or
                    $audit.childResult.candidateSha -cne $ExpectedCommit -or $audit.childResult.probe.sha256 -cne $ExpectedProbeExeSha256) { throw 'Token-probe child evidence identity mismatch' }
                if ($audit.childResult.status -cne 'passed') { $audit.error = $audit.childResult.error }
            }
            if (-not $audit.evidenceCopy.complete) { $audit.status = 'failed'; if (-not $audit.error) { $audit.error = 'Token-probe evidence collection is incomplete' } }
        }
    }
    if ($audit.status -ceq 'passed' -and ($null -eq $audit.childResult -or $audit.childResult.status -cne 'passed' -or -not $audit.childResult.complete)) { throw 'Successful supervisor lacks complete diagnostic child evidence' }
    if (-not $processesEmpty) { throw 'Token-probe outer process cleanup remains uncertain' }
} catch {
    if (-not $audit.error) { $audit.error = $_.Exception.Message }
    $audit.status = 'failed'
} finally {
    $password.Dispose()
    try {
        if ($creationAttempted -and $null -eq $user) {
            $candidate = Get-LocalUser -Name $accountName -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.Description -ceq $description) { $user = $candidate; $audit.accountCreated = $true; $audit.accountSid = $user.SID.Value }
        }
    } catch { $audit.cleanupErrors += 'Exact account ownership recovery failed: ' + $_.Exception.Message }
    if ($null -ne $user) {
        if ($processesEmpty) {
            try { Remove-ExactProfileWithRetry $user.SID.Value $audit }
            catch { $audit.cleanupErrors += 'Exact temporary-profile cleanup failed: ' + $_.Exception.Message }
            if ($audit.profileDeleted -eq $true) {
                try {
                    $current = Get-LocalUser -Name $accountName -ErrorAction Stop
                    if ($current.SID.Value -cne $user.SID.Value -or $current.Description -cne $description) { throw 'Exact account identity changed; refuse removal' }
                    Remove-LocalUser -SID $user.SID -ErrorAction Stop
                    if (Get-LocalUser -SID $user.SID -ErrorAction SilentlyContinue) { throw 'Exact temporary account remains' }
                    $audit.accountDeleted = $true
                    $audit.accountGroupCleanup = Confirm-DeletedAccountGroupAbsence $user.SID.Value
                    $audit.accountGroupCleanupConfirmed = $audit.accountGroupCleanup.complete -eq $true
                    if (-not $audit.accountGroupCleanupConfirmed) { throw 'Exact deleted-account SID absence from both groups is unconfirmed' }
                } catch { $audit.cleanupErrors += 'Exact temporary-account cleanup failed: ' + $_.Exception.Message }
            } else { $audit.cleanupErrors += 'Profile removal unconfirmed: retain exact account' }
        } else { $audit.cleanupErrors += 'Process emptiness uncertain: retain exact account/profile' }
    }
    if ($stageCreated) {
        try {
            if (-not $processesEmpty) { throw 'Process emptiness uncertain: retain stage' }
            $null = @(Plain-Files $stage); Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction Stop
            if (Test-Path -LiteralPath $stage) { throw 'Owned token-probe stage remains' }
            $audit.stageRemoved = $true
        } catch { $audit.cleanupErrors += 'Owned-stage cleanup failed: ' + $_.Exception.Message }
    }
    if ($audit.cleanupErrors.Count) { $audit.status = 'failed' }
    Write-Json (Join-Path $EvidenceDirectory 'windows-mermaid-token-probe-audit.json') $audit
    $retained = @(); [long]$total = 0
    foreach ($name in @('windows-mermaid-token-probe-audit.json', 'token-probe-context.json', 'token-probe-child-result.json', 'token-probe-result.json', 'token-probe-stdout.log', 'token-probe-stderr.log')) {
        $path = Join-Path $EvidenceDirectory $name
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $limit = $(if ($name.EndsWith('.json', [StringComparison]::Ordinal)) { 1MB } else { 2MB })
        $proof = Read-BoundedEvidenceProof $path $limit
        $total += $proof.bytes; $retained += @{ name = $name; bytes = $proof.bytes; sha256 = $proof.sha256 }
    }
    if ($total -gt 7MB) { throw 'Closed token-probe evidence aggregate budget exceeded' }
    Write-Json (Join-Path $EvidenceDirectory 'token-probe-evidence-files.json') @{
        schema = 1; status = $audit.status; complete = $audit.status -ceq 'passed'
        expectedAccountKind = $AccountKind; source = $ExpectedCommit; files = $retained; totalBytes = $total
    }
    Write-Output ('MILKUP_WINDOWS_TOKEN_PROBE_AUDIT ' + (@{ status = $audit.status; expectedAccountKind = $AccountKind; accountDeleted = $audit.accountDeleted; profileDeleted = $audit.profileDeleted; stageRemoved = $audit.stageRemoved } | ConvertTo-Json -Compress))
}
if ($audit.status -cne 'passed') { throw 'Windows token probe did not complete; inspect windows-mermaid-token-probe-audit.json' }
