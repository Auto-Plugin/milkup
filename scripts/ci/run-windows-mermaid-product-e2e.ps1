[CmdletBinding(DefaultParameterSetName = 'Parent')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Parent')][string]$Binary,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][string]$EvidenceDirectory,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedBinarySha256,
    [Parameter(ParameterSetName = 'Parent')][switch]$ProductionAssetsConfirmed,
    [Parameter(ParameterSetName = 'Parent')][ValidateSet('product', 'gui-regression', IgnoreCase = $false)][string]$HarnessMode = 'product',
    [Parameter(ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{40}$')][string]$ApplicationCandidateSha,
    [Parameter(ParameterSetName = 'Parent')][switch]$FrontendBoundaryProbe,
    [Parameter(ParameterSetName = 'Parent')][ValidateSet('pure-standard', 'filtered-admin', IgnoreCase = $false)][string]$AccountKind = 'pure-standard',
    [Parameter(ParameterSetName = 'Parent')][string]$Installer,
    [Parameter(ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedInstallerSha256,
    [Parameter(ParameterSetName = 'Parent')][string]$ExpectedVersion,
    [Parameter(ParameterSetName = 'Parent')][string]$PackageManifest,
    [Parameter(ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedPackageManifestSha256,
    [Parameter(Mandatory, ParameterSetName = 'Child')][switch]$Child,
    [Parameter(Mandatory, ParameterSetName = 'Child')][string]$ChildSpecPath,
    [Parameter(Mandatory, ParameterSetName = 'Inspect')][switch]$InspectProcesses,
    [Parameter(Mandatory, ParameterSetName = 'Inspect')][ValidatePattern('^[0-9]+(,[0-9]+){0,7}$')][string]$ProcessIds
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This opt-in driver never runs in the compile-only workflow. Optional NSIS
# installation runs only inside the new, verified non-elevated coordinator's Job.
# No Runtime provisioning, account reuse, token adjustment or existing ACL edit.
function Assert-AccountMode([string]$Kind, [bool]$InstallerMode) {
    if ($Kind -cnotin @('pure-standard', 'filtered-admin')) { throw 'Unknown expected account kind' }
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
        $env:GITHUB_REF -cnotin @('refs/heads/dot/mermaid-rebuild-20261103', 'refs/heads/dot/mermaid-stability-20261104')) {
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
function Read-SmallJson([string]$Path) {
    Assert-PlainPath $Path
    if ((Get-Item -LiteralPath $Path).Length -gt 1MB) { throw 'JSON evidence exceeds its budget' }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
}
function Write-Json([string]$Path, $Value) {
    if (Test-Path -LiteralPath $Path) { Assert-PlainPath $Path }
    $json = $Value | ConvertTo-Json -Depth 24
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1MB) { throw 'JSON report exceeds its budget' }
    [IO.File]::WriteAllText($Path, $json + "`n", [Text.UTF8Encoding]::new($false))
}
function File-Proof([string]$Path) {
    Assert-PlainPath $Path
    $file = Get-Item -LiteralPath $Path
    if ($file.PSIsContainer) { throw 'Expected regular file' }
    return [ordered]@{ path = $file.FullName; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
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
function Get-ChildEvidenceNames {
    $names = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($name in @('standard-context.json', 'standard-child-result.json', 'mermaid-product-e2e.json', 'node-stdout.log', 'node-stderr.log', 'edgedriver-native.log', 'edgedriver-stdio.log', 'installation-result.json', 'installed-binary-comparison.json', 'installed-binary-comparison-stderr.log', 'installer-stdout.log', 'installer-stderr.log')) { $names.Add($name, $name) }
    foreach ($fixture in @('ordinary', 'wide', 'c4', 'invalid')) {
        $names.Add($fixture + '-product.log', $fixture + '-product.log')
        foreach ($prefix in @('fixture-', 'saved-')) { $name = $prefix + $fixture + '.md'; $names.Add($name, $name + '.log') }
    }
    $steps = @('01-initial-disabled-source', '02-enable-and-exact-bytes', '03-real-edit-save-replacement', '04-undo-exact-original', '05-redo-exact-edit', '06-disable-and-reenable-in-place', '07-wide', '07-c4', '07-invalid', '08-final-disable')
    foreach ($step in $steps) { foreach ($suffix in @('-window.png', '-failure-window.png')) { $names.Add($step + $suffix, $step + $suffix) } }
    $names.Add('unhandled-failure-window.png', 'unhandled-failure-window.png')
    foreach ($name in @('02-enabled', '03-edited', '04-undone', '05-redone', '06-reenabled', '07-wide', '07-c4')) { $names.Add($name + '-diagram.png', $name + '-diagram.png') }
    foreach ($name in @('gui-regression.json', 'gui-native-audit.json', 'native-window-events.json', 'gui-observer-stderr.log', 'gui-idle-product.log', 'gui-busy-product.log', 'gui-console-positive.png', 'gui-native-failure.png', 'gui-ordinary-diagram.png', 'gui-wide-diagram.png', 'gui-multi-diagram.png', 'gui-multi-2-diagram.png')) { $names.Add($name, $name) }
    foreach ($step in @('blank-start-enable', 'open-ordinary-stable', 'open-wide-stable', 'resize-wide', 'repeat-document-open', 'multi-diagram', 'idle-close', 'busy-close')) {
        $name = 'gui-' + $step + '-window.png'; $names.Add($name, $name)
    }
    $names.Add('gui-failure-cleanup-window.png', 'gui-failure-cleanup-window.png')
    foreach ($fixture in @('ordinary', 'wide', 'multi', 'busy')) {
        $name = 'fixture-gui-' + $fixture + '.md'; $names.Add($name, $name + '.log')
    }
    return ,$names
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
function Copy-BoundedEvidence([string]$Source, [string]$Destination) {
    Assert-PlainPath $Source
    $allowed = Get-ChildEvidenceNames
    $state = @{ rejected = @(); rejectedCount = 0; hashBytes = 0L }
    function Reject-Evidence($Item, [string]$Reason) {
        $state.rejectedCount++
        if ($state.rejected.Count -ge 64) { return }
        $known = $null -ne $Item -and $allowed.ContainsKey($Item.Name)
        $entry = [ordered]@{ relativePath = $null; nameSha256 = $null; bytes = $null; sha256 = $null; hashStatus = 'unavailable'; reason = $Reason }
        if ($null -ne $Item) {
            if ($known) { $entry.relativePath = $Item.Name }
            else { $entry.nameSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Item.Name))).ToLowerInvariant(); $entry.hashStatus = 'not-read-unknown-name' }
            if (-not $Item.PSIsContainer -and -not ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                $entry.bytes = $Item.Length
                if ($known) {
                    $entry.hashStatus = 'not-read-budget'
                    if ($Item.Length -le 32MB -and $state.hashBytes + $Item.Length + 1 -le 126MB) {
                        try {
                            $state.hashBytes += $Item.Length + 1
                            $proof = Read-BoundedEvidenceProof $Item.FullName $Item.Length
                            $entry.bytes = $proof.bytes; $entry.sha256 = $proof.sha256; $entry.hashStatus = 'complete'
                        } catch { $entry.hashStatus = 'unavailable' }
                    }
                }
            }
        }
        $state.rejected += $entry
    }
    # Only known top-level harness files can pass the unchanged artifact whitelist.
    # Never recurse into a profile/UDF or an unknown directory.
    $items = [Collections.Generic.List[object]]::new()
    $observed = 0
    foreach ($path in [IO.Directory]::EnumerateFileSystemEntries($Source)) {
        if (++$observed -ge 4096) { Reject-Evidence $null 'entry-limit'; break }
        $item = Get-Item -LiteralPath $path -Force
        if (-not $allowed.ContainsKey($item.Name)) { Reject-Evidence $item 'unapproved-name'; continue }
        if ($item.PSIsContainer) { Reject-Evidence $item 'not-regular-file'; continue }
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Reject-Evidence $item 'reparse-point'; continue }
        $items.Add($item)
    }
    $records = @(); [long]$total = 0
    # Preserve small diagnostic files before spending the aggregate budget on PNGs.
    foreach ($file in ($items | Sort-Object @{ Expression = { $_.Extension -ceq '.png' } }, Name)) {
        $limit = $(if ($file.Extension -ceq '.png') { 32MB } else { 2MB })
        if ($file.Length -gt $limit) { Reject-Evidence $file 'file-size'; continue }
        if ($records.Count -ge 94) { Reject-Evidence $file 'file-count'; continue }
        if ($total + $file.Length -gt 126MB) { Reject-Evidence $file 'aggregate-size'; continue }
        $target = Join-Path $Destination $allowed[$file.Name]
        Assert-Contained $target $Destination
        if (Test-Path -LiteralPath $target) { Reject-Evidence $file 'destination-exists'; continue }
        $reason = 'source-read'
        $created = $false
        try {
            $reason = 'copy-failed'
            $proof = Read-BoundedEvidenceProof $file.FullName ([Math]::Min($limit, 126MB - $total)) $target ([ref]$created)
            $retained = Read-BoundedEvidenceProof $target $limit
            $reason = 'target-mismatch'
            if ($retained.bytes -ne $proof.bytes -or $retained.sha256 -cne $proof.sha256) { throw 'Evidence copy mismatch' }
            if ($file.Extension -ceq '.json') { $reason = 'invalid-json'; $null = Get-Content -LiteralPath $target -Raw | ConvertFrom-Json -ErrorAction Stop }
            if ($file.Extension -ceq '.png') {
                $reason = 'invalid-png'
                $stream = [IO.File]::OpenRead($target)
                try { $signature = [byte[]]::new(8); if ($stream.Read($signature, 0, 8) -ne 8 -or [Convert]::ToHexString($signature) -cne '89504E470D0A1A0A') { throw 'Invalid PNG signature' } } finally { $stream.Dispose() }
            }
            $records += [ordered]@{ relativePath = $file.Name; retainedName = $allowed[$file.Name]; bytes = $proof.bytes; sha256 = $proof.sha256 }
            $total += $proof.bytes
        } catch {
            # This path was absent before our CreateNew copy. A partial copy is
            # removed, never listed as complete or substituted with a truncated log.
            if ($created -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target -Force -ErrorAction Stop }
            Reject-Evidence $file $reason
        }
    }
    $complete = $state.rejectedCount -eq 0
    $omitted = $state.rejectedCount - $state.rejected.Count
    $manifest = [ordered]@{ schema = 1; files = $records; totalBytes = $total; source = 'new standard-account synthetic evidence only'; complete = $complete; rejected = $state.rejected; rejectedCount = $state.rejectedCount; rejectionsOmitted = $omitted }
    Write-Json (Join-Path $Destination 'evidence-files.json') $manifest
    return [ordered]@{ files = $records.Count; bytes = $total; manifest = 'evidence-files.json'; complete = $complete; rejected = $state.rejected; rejectedCount = $state.rejectedCount; rejectionsOmitted = $omitted }
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
function Assert-InstallationManifest($Manifest, [string]$Commit, [string]$Version, [string]$BuiltHash) {
    if ($Manifest.schema -ne 1 -or $Manifest.candidateSha -cne $Commit -or
        $Manifest.version -cne $Version -or $Version -cnotmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
        $Manifest.builtBinarySha256 -cne $BuiltHash -or
        $Manifest.expectedInstalledBinarySha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $Manifest.installMode -cne 'currentUser' -or $Manifest.webviewInstallMode -cne 'skip') {
        throw 'Installer manifest identity or per-user/no-runtime-install policy mismatch'
    }
    if (@($Manifest.resources).Count -ne 1) { throw 'Expected only the declared file.ico resource' }
    foreach ($item in $Manifest.resources) {
        if ($item.relativePath -cne 'file.ico' -or $item.bytes -le 0 -or $item.bytes -gt 4MB -or
            $item.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Unexpected installed resource declaration' }
    }
    if (@($Manifest.bundledPlugins).Count -lt 1 -or @($Manifest.bundledPlugins).Count -gt 32) { throw 'Bounded embedded plugin inventory required' }
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $reviewedMermaid = 0
    foreach ($plugin in $Manifest.bundledPlugins) {
        if ($plugin.id -cnotmatch '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' -or
            $plugin.version -cnotmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
            $plugin.archiveFile -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.milkup-plugin$' -or
            $plugin.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $plugin.bytes -le 0 -or $plugin.bytes -gt 64MB -or
            -not $names.Add($plugin.archiveFile)) { throw 'Invalid or duplicate embedded plugin inventory entry' }
        if ($plugin.id -ceq 'milkup.diagrams' -and $plugin.version -ceq '1.3.0') { $reviewedMermaid++ }
    }
    if ($reviewedMermaid -ne 1) { throw 'Exact reviewed Mermaid 1.3.0 package missing or ambiguous' }
}
function Assert-InstallationCoordinator($Spec, $Context) {
    Assert-AccountMode $Spec.expectedAccountKind $true
    if (-not $Context.interactive -or $Context.actualSid -cne $Spec.expectedSid -or
        $Spec.expectedSessionId -le 0 -or $Context.sessionId -ne $Spec.expectedSessionId -or
        $Context.expectedAccountKind -cne $Spec.expectedAccountKind -or -not $Context.accountKindVerified -or
        -not [WindowsMermaidStandardUser]::MatchesExpectedAccountKind($Context.desktop.token, $Spec.expectedAccountKind) -or
        $Context.desktop.token.sid -cne $Spec.expectedSid -or $Context.desktop.token.sessionId -ne $Spec.expectedSessionId -or
        $Context.pureStandard -isnot [bool] -or $Context.filteredAdmin -isnot [bool] -or
        $Context.pureStandard -ne ($Spec.expectedAccountKind -ceq 'pure-standard') -or
        $Context.filteredAdmin -ne ($Spec.expectedAccountKind -ceq 'filtered-admin')) {
        throw 'Installer requires the exact verified non-elevated account kind, SID and interactive session'
    }
}
function Invoke-StandardInstallation($Spec, $Context, [string]$Scratch, [string]$Evidence) {
    $installDirectory = Join-Path $Scratch 'install'
    Assert-Contained $installDirectory $Scratch
    $record = [ordered]@{
        schema = 1; status = 'failed'; candidateSha = $Spec.applicationCandidateSha; mode = 'nsis-current-user'
        expectedSid = $Spec.expectedSid; actualSid = $Context.actualSid; expectedAccountKind = $Spec.expectedAccountKind
        expectedSessionId = $Spec.expectedSessionId; sessionId = $Context.sessionId
        installer = $Spec.installer; installerRun = $null; installDirectory = $installDirectory
        installedBinary = $null; binaryComparison = $null; comparisonRun = $null; resources = @()
        bundledPlugins = @(); embeddedPluginBinding = $null; productAcceptance = 'not-started'
        expectedVersion = $Spec.expectedVersion; error = $null; cleanupErrors = @()
        cleanupScope = 'Entire exact newly created account profile after confirmed process emptiness; includes this install directory and HKCU'
    }
    try {
        Assert-InstallationCoordinator $Spec $Context
        if (Test-Path -LiteralPath $installDirectory) { throw 'Refuse to install over an existing directory' }
        foreach ($inputFile in @($Spec.installer, $Spec.packageManifest, $Spec.binaryVerifier)) { Assert-Hash $inputFile.path $inputFile.sha256 }
        $manifest = Read-SmallJson $Spec.packageManifest.path
        $baseline = $Spec.harnessMode -ceq 'gui-regression' -and $Spec.applicationCandidateSha -cne $Spec.candidateSha
        $manifestBuiltHash = $(if ($baseline) { '6cb3cdf7fc31f064d7b0582f89fc67efbad94772f94434b54fb1063437d593eb' } else { $Spec.binary.sha256 })
        Assert-InstallationManifest $manifest $Spec.applicationCandidateSha $Spec.expectedVersion $manifestBuiltHash
        $record.bundledPlugins = @($manifest.bundledPlugins)
        $record.installerRun = [WindowsMermaidStandardUser]::RunOwnedInstaller(
            $Spec.installer.path, $installDirectory, $Scratch,
            (Join-Path $Evidence 'installer-stdout.log'), (Join-Path $Evidence 'installer-stderr.log'),
            $Spec.expectedSid, [uint32]$Spec.expectedSessionId, $Spec.expectedAccountKind, 120000)
        if ($record.installerRun.status -cne 'passed' -or $record.installerRun.exitCode -ne 0 -or
            $record.installerRun.identityVerified -ne $true -or
            $record.installerRun.expectedAccountKind -cne $Spec.expectedAccountKind) { throw 'Same-account installer did not complete with verified identity and exit zero' }
        Assert-PlainPath $installDirectory
        $installedPath = Join-Path $installDirectory 'milkup-desktop.exe'
        Assert-Contained $installedPath $Scratch
        $proof = File-Proof $installedPath
        if ($proof.bytes -gt 64MB -or $proof.sha256 -cne $manifest.expectedInstalledBinarySha256) { throw 'Installed binary differs from exact expected NSIS image' }
        $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($installedPath)
        if ($versionInfo.FileVersion -cne $Spec.expectedVersion -or $versionInfo.ProductVersion -cne $Spec.expectedVersion) { throw 'Installed file/product version differs from candidate version' }
        $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($installedPath))
        try {
            $reader.BaseStream.Position = 0x3c
            $reader.BaseStream.Position = $reader.ReadInt32()
            if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Installed application is not PE x64' }
        } finally { $reader.Dispose() }
        $record.installedBinary = [ordered]@{ path = $proof.path; bytes = $proof.bytes; sha256 = $proof.sha256
            fileVersion = $versionInfo.FileVersion; productVersion = $versionInfo.ProductVersion; peMachine = '0x8664' }
        if ($baseline) {
            # This is an independently reinstalled delivered image, not a new compilation.
            if ($Spec.binaryRole -cne 'extractedExpectedImage' -or
                $Spec.installer.sha256 -cne 'f7fe28275477e8957653649924348bc06e24b4b49d63f6e1d6a6f08ed65c6fbf' -or
                $Spec.binary.sha256 -cne '5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84' -or
                $proof.sha256 -cne $Spec.binary.sha256 -or $proof.bytes -ne $Spec.binary.bytes) { throw 'Exact delivered baseline image comparison failed' }
            $record['extractedExpectedImage'] = $Spec.binary
            $record.binaryComparison = [ordered]@{
                schema = 1; status = 'passed'; comparisonKind = 'reinstalled-to-pinned-extracted-image'
                expectedImageSha256 = $Spec.binary.sha256; installedSha256 = $proof.sha256; bytes = $proof.bytes
                compiledInThisRun = $false; historicalSourceRunId = '41713129442'
                historicalSourceCandidate = 'a5556beea5cdd1570361c528b2326bc0ad8ba0c4'
                historicalComparison = 'https://github.com/Auto-Plugin/milkup/actions/runs/41713129442'
            }
            Write-Json (Join-Path $Evidence 'installed-binary-comparison.json') $record.binaryComparison
        } else {
        $record.comparisonRun = [WindowsMermaidStandardUser]::RunNodeScript(
            $Spec.node.path, [string[]]@($Spec.binaryVerifier.path, $Spec.binary.path, $installedPath), $Scratch,
            (Join-Path $Evidence 'installed-binary-comparison.json'),
            (Join-Path $Evidence 'installed-binary-comparison-stderr.log'), 30000)
        if ($record.comparisonRun.status -cne 'passed') { throw 'Exact installed-binary comparison failed' }
        $comparison = Read-SmallJson (Join-Path $Evidence 'installed-binary-comparison.json')
        if ($comparison.status -cne 'passed' -or $comparison.builtSha256 -cne $Spec.binary.sha256 -or
            $comparison.expectedInstalledSha256 -cne $manifest.expectedInstalledBinarySha256 -or
            $comparison.installedSha256 -cne $proof.sha256 -or $comparison.bytes -ne $proof.bytes) { throw 'Installed-binary comparison does not bind the frozen candidate' }
        $record.binaryComparison = $comparison
        }
        foreach ($resource in $manifest.resources) {
            $path = Join-Path $installDirectory $resource.relativePath
            Assert-Contained $path $installDirectory
            $actual = File-Proof $path
            if ($actual.sha256 -cne $resource.sha256 -or $actual.bytes -ne $resource.bytes) { throw 'Installed resource differs from candidate manifest' }
            $record.resources += [ordered]@{ relativePath = $resource.relativePath; bytes = $actual.bytes; sha256 = $actual.sha256; verified = $true }
        }
        # Bundled plugin archives are Vite-embedded data, not external resource
        # files. The build manifest records sealed archives; full byte equality
        # (with only Tauri's exact bundle marker substitution) binds that image.
        # The unchanged UI harness additionally observes Diagrams version 1.3.0.
        $record.embeddedPluginBinding = 'exact-installed-image-byte-comparison'
        $record.status = 'passed'
    } catch { $record.error = $_.Exception.Message }
    finally { Write-Json (Join-Path $Evidence 'installation-result.json') $record }
    return $record
}
function Invoke-StandardChild {
    Assert-HostedCandidate
    $spec = Read-SmallJson $ChildSpecPath
    if ($spec.schema -ne 1 -or $spec.runId -cnotmatch '^[a-f0-9]{32}$' -or
        $spec.expectedSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or
        $spec.candidateSha -cne $env:GITHUB_SHA -or $spec.expectedSessionId -le 0) { throw 'Invalid immutable child specification' }
    if ($spec.harnessMode -cnotin @('product', 'gui-regression') -or $spec.applicationCandidateSha -cnotmatch '^[a-f0-9]{40}$' -or
        ($spec.harnessMode -ceq 'product' -and $spec.applicationCandidateSha -cne $spec.candidateSha)) { throw 'Invalid separated harness/application identity' }
    if ($spec.frontendBoundaryProbe -and ($spec.harnessMode -cne 'gui-regression' -or $spec.applicationCandidateSha -cne $spec.candidateSha)) { throw 'Optional frontend diagnostic is only allowed for current-candidate GUI mode' }
    Assert-AccountMode $spec.expectedAccountKind ($spec.mode -ceq 'nsis-current-user')
    $profile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    $roaming = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
    $local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    foreach ($folder in @($profile, $roaming, $local)) {
        if (-not [IO.Path]::IsPathFullyQualified($folder) -or -not (Test-Path -LiteralPath $folder -PathType Container)) { throw 'Real standard-account KnownFolder is unavailable' }
        Assert-PlainPath $folder
    }
    $scratch = Join-Path $profile ('.milkup-mermaid-product-' + $spec.runId)
    New-OwnedDirectory $scratch
    foreach ($leaf in @('work', 'evidence', 'temp')) { New-OwnedDirectory (Join-Path $scratch $leaf) }
    $work = Join-Path $scratch 'work'
    $evidence = Join-Path $scratch 'evidence'
    $env:USERPROFILE = $profile
    $env:APPDATA = $roaming
    $env:LOCALAPPDATA = $local
    $env:TEMP = Join-Path $scratch 'temp'
    $env:TMP = $env:TEMP
    $result = [ordered]@{ status = 'blocked'; startedNode = $false; nodeExitCode = $null; error = $null; expectedAccountKind = $spec.expectedAccountKind }
    $installation = $null
    $context = [ordered]@{
        status = 'blocked'; actualSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        expectedSid = $spec.expectedSid; expectedAccountKind = $spec.expectedAccountKind
        pureStandard = $false; filteredAdmin = $false; accountKindVerified = $false; interactive = $false
        sessionId = $null; expectedSessionId = $spec.expectedSessionId
        knownFolders = @{ profile = $profile; roamingAppData = $roaming; localAppData = $local }
        scratchRoot = $scratch; work = $work; evidence = $evidence; desktop = $null; blockedReasons = @()
        existingDesktopAclChanged = $false; securityPolicyChanged = $false
    }
    try {
        foreach ($inputFile in @($spec.binary, $spec.node, $spec.driver, $spec.harness, $spec.observer, $spec.wrapper)) { Assert-Hash $inputFile.path $inputFile.sha256 }
        foreach ($inputFile in @($spec.additionalHarnessFiles)) { Assert-Hash $inputFile.path $inputFile.sha256 }
        Import-Observer $spec.observer.path
        $desktop = [WindowsMermaidStandardUser]::ObserveCurrentContext()
        $context.desktop = $desktop
        $context.pureStandard = $desktop.ContainsKey('token') -and $desktop.token.pureStandardUser -eq $true
        $context.filteredAdmin = $desktop.ContainsKey('token') -and $desktop.token.filteredAdmin -eq $true
        $context.accountKindVerified = $desktop.ContainsKey('token') -and [WindowsMermaidStandardUser]::MatchesExpectedAccountKind($desktop.token, $spec.expectedAccountKind)
        $context.sessionId = $(if ($desktop.ContainsKey('sessionId')) { $desktop.sessionId } else { $null })
        $context.blockedReasons = @($desktop.blockedReasons)
        if ($context.actualSid -cne $spec.expectedSid) { $context.blockedReasons += 'Current SID differs from the exact temporary account' }
        if (-not $context.accountKindVerified) { $context.blockedReasons += 'Expected account-kind token gate rejected current coordinator' }
        if ($context.sessionId -ne $spec.expectedSessionId) { $context.blockedReasons += 'Current session differs from the existing runner interactive session' }
        $context.interactive = $desktop.desktopEligible -eq $true -and $context.sessionId -eq $spec.expectedSessionId
        if ($context.blockedReasons.Count -gt 0) { throw 'Standard-account interactive desktop is unavailable under existing permissions' }
        $context.status = 'ready'
        Write-Json (Join-Path $evidence 'standard-context.json') $context
        $application = $spec.binary
        if ($spec.mode -ceq 'nsis-current-user') {
            $result.status = 'failed'
            $installation = Invoke-StandardInstallation $spec $context $scratch $evidence
            if ($installation.status -cne 'passed') { throw "Standard-account installation failed: $($installation.error)" }
            $application = $installation.installedBinary
        } elseif ($spec.mode -cne 'linked-binary') { throw 'Unknown product input mode' }
        $variables = @{
            MILKUP_WINDOWS_MERMAID_APP = $application.path
            MILKUP_WINDOWS_MERMAID_APP_SHA256 = $application.sha256
            MILKUP_WINDOWS_MERMAID_EDGE_DRIVER = $spec.driver.path
            MILKUP_WINDOWS_MERMAID_WORK = $work
            MILKUP_WINDOWS_MERMAID_EVIDENCE = $evidence
            MILKUP_WINDOWS_MERMAID_EXPECTED_SID = $spec.expectedSid
            MILKUP_WINDOWS_MERMAID_EXPECTED_ACCOUNT_KIND = $spec.expectedAccountKind
            MILKUP_WINDOWS_MERMAID_EXPECTED_SESSION_ID = [string]$spec.expectedSessionId
            MILKUP_WINDOWS_MERMAID_RUN_ID = $spec.runId
            MILKUP_WINDOWS_MERMAID_CANDIDATE_SHA = $spec.candidateSha
            MILKUP_WINDOWS_MERMAID_HARNESS_MODE = $spec.harnessMode
            MILKUP_WINDOWS_MERMAID_FRONTEND_BOUNDARY_PROBE = $(if ($spec.frontendBoundaryProbe) { '1' } else { '0' })
            MILKUP_WINDOWS_MERMAID_HARNESS_CANDIDATE_SHA = $spec.candidateSha
            MILKUP_WINDOWS_MERMAID_APPLICATION_CANDIDATE_SHA = $spec.applicationCandidateSha
            MILKUP_WINDOWS_MERMAID_RUNTIME_VERSION = $spec.runtime.version
            MILKUP_WINDOWS_MERMAID_RUNTIME_EXE = $spec.runtime.path
            MILKUP_WINDOWS_MERMAID_PROCESS_OBSERVER = $spec.wrapper.path
            MILKUP_WINDOWS_MERMAID_PWSH = (Get-Process -Id $PID).Path
        }
        if ($null -ne $installation) {
            $variables['MILKUP_WINDOWS_MERMAID_INSTALLER_SHA256'] = $spec.installer.sha256
            $inventory = @($installation.bundledPlugins | ForEach-Object { @{ id = $_.id; version = $_.version } })
            $variables['MILKUP_WINDOWS_MERMAID_EXPECTED_PLUGIN_INVENTORY'] = ConvertTo-Json -InputObject $inventory -Depth 4 -Compress
        }
        foreach ($entry in $variables.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process') }
        $result.startedNode = $true
        $result.status = 'failed'
        $result['nodeRun'] = [WindowsMermaidStandardUser]::RunNodeHarness(
            $spec.node.path, $spec.harness.path, [IO.Path]::GetDirectoryName($spec.harness.path),
            (Join-Path $evidence 'node-stdout.log'), (Join-Path $evidence 'node-stderr.log'), 900000)
        $result.startedNode = $result.nodeRun.started
        $result.nodeExitCode = $result.nodeRun.exitCode
        if ($result.nodeRun.status -cne 'passed') { throw "Windows product Node harness failed: $($result.nodeRun.error)" }
        $reportName = $(if ($spec.harnessMode -ceq 'gui-regression') { 'gui-regression.json' } else { 'mermaid-product-e2e.json' })
        $report = Read-SmallJson (Join-Path $evidence $reportName)
        if ($report.status -cne 'passed') { throw 'Node exit succeeded without passing product evidence' }
        if ($spec.harnessMode -ceq 'gui-regression' -and ($report.applicationCandidateSha -cne $spec.applicationCandidateSha -or
            $report.harnessCandidateSha -cne $spec.candidateSha -or $report.harnessMode -cne 'gui-regression')) { throw 'GUI report did not bind the separate application and harness identities' }
        if ($null -ne $installation) {
            if ($report.applicationSha256 -cne $installation.installedBinary.sha256 -or
                $report.application -cne $installation.installedBinary.path) { throw 'Product report did not use the installed executable' }
            if ($spec.harnessMode -ceq 'gui-regression') { $installation['guiAcceptance'] = 'passed'; $installation.productAcceptance = 'not-run-gui-only' }
            else { $installation.productAcceptance = 'passed' }
        }
        $result.status = 'passed'
    } catch {
        $result.error = $_.Exception.Message
        if (-not $result.startedNode) { $context.blockedReasons += $result.error }
    } finally {
        if ($null -ne $installation) {
            if ($result.status -cne 'passed' -and $result.startedNode) {
                if ($spec.harnessMode -ceq 'gui-regression') { $installation['guiAcceptance'] = 'failed'; $installation.productAcceptance = 'not-run-gui-only' }
                else { $installation.productAcceptance = 'failed' }
            }
            Write-Json (Join-Path $evidence 'installation-result.json') $installation
        }
        Write-Json (Join-Path $evidence 'standard-context.json') $context
        Write-Json (Join-Path $evidence 'standard-child-result.json') $result
    }
    if ($result.status -ceq 'passed') { exit 0 }
    if ($result.status -ceq 'blocked') { exit 77 }
    exit 1
}

if ($InspectProcesses) {
    Assert-HostedCandidate
    Import-Observer (Join-Path $PSScriptRoot 'WindowsMermaidStandardUser.cs')
    if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $env:MILKUP_WINDOWS_MERMAID_EXPECTED_SID) { throw 'Process observation requires the exact standard coordinator SID' }
    Assert-AccountMode $env:MILKUP_WINDOWS_MERMAID_EXPECTED_ACCOUNT_KIND $false
    $current = [WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($PID))[0]
    if (-not $current.ContainsKey('token') -or
        -not [WindowsMermaidStandardUser]::MatchesExpectedAccountKind($current.token, $env:MILKUP_WINDOWS_MERMAID_EXPECTED_ACCOUNT_KIND) -or
        $current.token.sessionId -ne [uint32]$env:MILKUP_WINDOWS_MERMAID_EXPECTED_SESSION_ID) { throw 'Process observation requires the exact expected account kind and session' }
    $records = [WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]($ProcessIds.Split(',')))
    foreach ($record in $records) { $record['expectedAccountKind'] = $env:MILKUP_WINDOWS_MERMAID_EXPECTED_ACCOUNT_KIND }
    ConvertTo-Json -InputObject @($records) -Depth 12 -Compress
    exit 0
}
if ($Child) { Invoke-StandardChild; exit 1 }
Assert-HostedCandidate
if (-not $ProductionAssetsConfirmed) { throw 'A linked binary with embedded production assets must be explicitly confirmed; no dev URL' }
$installerMode = -not [string]::IsNullOrEmpty($Installer)
Assert-AccountMode $AccountKind $installerMode
if ($installerMode) {
    if (-not $ExpectedInstallerSha256 -or -not $ExpectedVersion -or -not $PackageManifest -or -not $ExpectedPackageManifestSha256) {
        throw 'Installer mode requires its exact hash, version and frozen package manifest/hash'
    }
} elseif ($ExpectedInstallerSha256 -or $ExpectedVersion -or $PackageManifest -or $ExpectedPackageManifestSha256) {
    throw 'Installer-only arguments cannot be silently ignored in linked-binary mode'
}
if ($HarnessMode -ceq 'product' -and $ApplicationCandidateSha) { throw 'Separate application identity is allowed only in explicit GUI regression mode' }
if (-not $ApplicationCandidateSha) { $ApplicationCandidateSha = $ExpectedCommit }
if ($FrontendBoundaryProbe -and ($HarnessMode -cne 'gui-regression' -or $ApplicationCandidateSha -cne $ExpectedCommit)) { throw 'Optional frontend diagnostic is only allowed for current-candidate GUI mode' }
if ($ApplicationCandidateSha -cne $ExpectedCommit) {
    # The sole mixed-source case is the independently hashed, already delivered beta.9 baseline.
    # It never enters the ordinary installed-product acceptance or package finalizer.
    if ($HarnessMode -cne 'gui-regression' -or -not $installerMode -or
        $ApplicationCandidateSha -cne 'a5556beea5cdd1570361c528b2326bc0ad8ba0c4' -or
        $ExpectedInstallerSha256 -cne 'f7fe28275477e8957653649924348bc06e24b4b49d63f6e1d6a6f08ed65c6fbf' -or
        $ExpectedBinarySha256 -cne '5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84' -or
        $ExpectedVersion -cne '2.0.0-beta.9') { throw 'Only the exact delivered beta.9 installer/binary may be a mixed-source GUI baseline' }
}
if ($ExpectedCommit -cne $env:GITHUB_SHA) { throw 'Expected candidate SHA differs from the workflow source' }
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$head = @(git -C $repository rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1 -or $head[0].Trim() -cne $ExpectedCommit) { throw 'Checkout differs from the exact candidate' }
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
Assert-Contained $EvidenceDirectory $env:RUNNER_TEMP
New-OwnedDirectory $EvidenceDirectory
$runId = [guid]::NewGuid().ToString('N')
$accountName = 'mkme' + $runId.Substring(0, 14)
$description = 'Mermaid test ' + $runId
$stageParent = Join-Path $repository '.tmp'
New-Item -ItemType Directory -Force -Path $stageParent | Out-Null
Assert-PlainPath $stageParent
$stage = Join-Path $stageParent ('windows-mermaid-product-' + $runId)
$observer = Join-Path $PSScriptRoot 'WindowsMermaidStandardUser.cs'
$harnessLeaf = $(if ($HarnessMode -ceq 'gui-regression') { 'mermaid-gui-regression.mjs' } else { 'mermaid-product-e2e.mjs' })
$harness = Join-Path $repository ('tests/windows/' + $harnessLeaf)
$audit = [ordered]@{
    schema = 1; status = 'failed'; source = $ExpectedCommit; runId = $env:GITHUB_RUN_ID; localRunId = $runId
    expectedAccountKind = $AccountKind; harnessMode = $HarnessMode; applicationCandidateSha = $ApplicationCandidateSha
    mode = $(if ($installerMode) { 'nsis-current-user' } else { 'linked-binary' }); installation = $null
    installedDirectoryRemoved = $null
    attempt = $env:GITHUB_RUN_ATTEMPT; runtime = $null; binary = $null; driver = $null; runnerContext = $null
    standardContext = $null; childResult = $null; supervisor = $null; evidenceCopy = $null
    accountName = $accountName; accountSid = $null; accountCreated = $false; accountDeleted = $false
    accountGroupCleanup = $null; accountGroupCleanupConfirmed = $false
    actualWindowsProfile = $null; profileDeleted = $false; stage = $stage; stageRemoved = $false
    cleanupErrors = @(); error = $null; changedAcl = $false; changedUacOrSecurityPolicy = $false
    runtimeInstalled = $false; fixedRuntimeUsed = $false; installerExecuted = $false; artifactUploadedByHarness = $false
    passwordInLogsFilesArgumentsOrEnvironment = $false; outerCleanupProvesProductInnerCleanup = $false
}
$user = $null
$password = [Security.SecureString]::new()
$creationAttempted = $false
$stageCreated = $false
$processesEmpty = $true
try {
    Import-Observer $observer
    $audit.runnerContext = [WindowsMermaidStandardUser]::ObserveCurrentContext()
    if (-not $audit.runnerContext.desktopEligible) {
        $audit.status = 'blocked'
        throw 'Fresh runner has no observable existing interactive desktop; no account or GUI process started'
    }
    $binaryProof = File-Proof $Binary
    if ($binaryProof.sha256 -cne $ExpectedBinarySha256 -or [IO.Path]::GetFileName($Binary) -cne 'milkup-desktop.exe') { throw 'Expected production binary identity mismatch' }
    if ($binaryProof.bytes -gt 512MB) { throw 'Product binary exceeds the test input budget' }
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($binaryProof.path))
    try {
        $reader.BaseStream.Position = 0x3c
        $reader.BaseStream.Position = $reader.ReadInt32()
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Product binary is not PE x64' }
    } finally { $reader.Dispose() }
    $audit.binary = $binaryProof
    $audit['binaryRole'] = $(if ($ApplicationCandidateSha -cne $ExpectedCommit) { 'extractedExpectedImage' } else { 'compiledCandidate' })
    $installerProof = $null; $manifestProof = $null
    if ($installerMode) {
        $installerProof = File-Proof $Installer
        $manifestProof = File-Proof $PackageManifest
        if ($installerProof.sha256 -cne $ExpectedInstallerSha256 -or $installerProof.bytes -gt 256MB -or
            $manifestProof.sha256 -cne $ExpectedPackageManifestSha256) { throw 'Installer or manifest frozen identity mismatch' }
        $manifest = Read-SmallJson $manifestProof.path
        $manifestBuiltHash = $(if ($ApplicationCandidateSha -cne $ExpectedCommit) { '6cb3cdf7fc31f064d7b0582f89fc67efbad94772f94434b54fb1063437d593eb' } else { $binaryProof.sha256 })
        Assert-InstallationManifest $manifest $ApplicationCandidateSha $ExpectedVersion $manifestBuiltHash
        if ($ApplicationCandidateSha -cne $ExpectedCommit -and $manifest.expectedInstalledBinarySha256 -cne '5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84') { throw 'Delivered beta.9 installed image identity mismatch' }
    }
    $machineRoots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { $_ } | Select-Object -Unique
    $candidates = @()
    foreach ($machineRoot in $machineRoots) {
        $runtimeRoot = Join-Path $machineRoot 'Microsoft/EdgeWebView/Application'
        if (-not (Test-Path -LiteralPath $runtimeRoot -PathType Container)) { continue }
        Assert-PlainPath $runtimeRoot
        foreach ($directory in Get-ChildItem -LiteralPath $runtimeRoot -Directory) {
            if ($directory.Name -cnotmatch '^\d+\.\d+\.\d+\.\d+$') { continue }
            $runtimeExe = Join-Path $directory.FullName 'msedgewebview2.exe'
            if (Test-Path -LiteralPath $runtimeExe -PathType Leaf) {
                $proof = File-Proof $runtimeExe
                $candidates += @{ path = $proof.path; version = $directory.Name; sha256 = $proof.sha256; bytes = $proof.bytes; kind = 'existing-machine-Evergreen' }
            }
        }
    }
    if ($candidates.Count -eq 0) { $audit.status = 'blocked'; throw 'No existing machine Evergreen Runtime is readable; no install or Fixed Runtime fallback' }
    $runtime = @($candidates | Sort-Object { [version]$_.version })[-1]
    $audit.runtime = $runtime
    New-OwnedDirectory $stage
    $stageCreated = $true
    $code = Join-Path $stage 'code'
    New-OwnedDirectory $code
    foreach ($pair in @(@($binaryProof.path, 'milkup-desktop.exe'), @($observer, 'WindowsMermaidStandardUser.cs'), @($PSCommandPath, 'run-windows-mermaid-product-e2e.ps1'), @($harness, $harnessLeaf))) {
        Assert-PlainPath $pair[0]
        Copy-Item -LiteralPath $pair[0] -Destination (Join-Path $code $pair[1]) -ErrorAction Stop
        if ((File-Proof $pair[0]).sha256 -cne (File-Proof (Join-Path $code $pair[1])).sha256) { throw 'Frozen staging copy mismatch' }
    }
    $additionalHarnessFiles = @()
    if ($HarnessMode -ceq 'gui-regression') {
        $guiSources = @('tests/windows/mermaid-product-e2e.mjs', 'tests/windows/mermaid-gui-contract.mjs', 'scripts/ci/run-windows-mermaid-gui-observer.ps1', 'scripts/ci/WindowsMermaidGuiObserver.cs')
        if ($FrontendBoundaryProbe) { $guiSources += 'tests/windows/mermaid-frontend-boundary-probe.mjs' }
        foreach ($relative in $guiSources) {
            $source = Join-Path $repository $relative
            $destination = Join-Path $code ([IO.Path]::GetFileName($relative))
            Assert-PlainPath $source
            Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
            if ((File-Proof $source).sha256 -cne (File-Proof $destination).sha256) { throw 'GUI helper frozen staging copy mismatch' }
            $additionalHarnessFiles += File-Proof $destination
        }
    }
    if ($installerMode) {
        foreach ($pair in @(@($installerProof.path, 'candidate-installer.exe'), @($manifestProof.path, 'installer-input.json'), @((Join-Path $repository 'tests/windows/verify-installed-binary.mjs'), 'verify-installed-binary.mjs'))) {
            Assert-PlainPath $pair[0]
            Copy-Item -LiteralPath $pair[0] -Destination (Join-Path $code $pair[1]) -ErrorAction Stop
            if ((File-Proof $pair[0]).sha256 -cne (File-Proof (Join-Path $code $pair[1])).sha256) { throw 'Installer staging copy mismatch' }
        }
    }
    $driverUrl = "https://msedgedriver.microsoft.com/$($runtime.version)/edgedriver_win64.zip"
    $archive = Join-Path $stage 'edgedriver.zip'
    Invoke-WebRequest -Uri $driverUrl -OutFile $archive
    if ((Get-Item -LiteralPath $archive).Length -gt 64MB) { throw 'Matching EdgeDriver archive exceeds budget' }
    $driverRoot = Join-Path $code 'edgedriver'
    New-OwnedDirectory $driverRoot
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        if ($zip.Entries.Count -gt 64) { throw 'Unexpected EdgeDriver archive entry count' }
        [long]$bytes = 0
        foreach ($entry in $zip.Entries) {
            $destination = Join-Path $driverRoot $entry.FullName
            Assert-Contained $destination $driverRoot
            if (($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'Driver archive contains a symlink' }
            $bytes += $entry.Length
        }
        if ($bytes -gt 256MB) { throw 'Expanded driver archive exceeds budget' }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $archive -DestinationPath $driverRoot -ErrorAction Stop
    $driver = Join-Path $driverRoot 'msedgedriver.exe'
    $signature = Get-AuthenticodeSignature -LiteralPath $driver
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') { throw 'Matching EdgeDriver lacks a valid Microsoft signature' }
    $driverVersion = (& $driver --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $driverVersion -notmatch [regex]::Escape($runtime.version)) { throw 'EdgeDriver does not match existing Evergreen version' }
    $audit.driver = File-Proof $driver
    $audit.driver['version'] = $driverVersion
    $audit.driver['source'] = $driverUrl
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $pwsh = (Get-Command pwsh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    foreach ($path in @($node, $pwsh)) { Assert-PlainPath $path }
    if (Get-LocalUser -Name $accountName -ErrorAction SilentlyContinue) { throw 'Generated account already exists' }
    foreach ($character in 'aA1!'.ToCharArray()) { $password.AppendChar($character) }
    $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-+='
    for ($index = 0; $index -lt 44; $index++) { $password.AppendChar($alphabet[[Security.Cryptography.RandomNumberGenerator]::GetInt32($alphabet.Length)]) }
    $password.MakeReadOnly()
    $creationAttempted = $true
    $user = New-LocalUser -Name $accountName -Password $password -Description $description -AccountExpires (Get-Date).AddDays(1) -UserMayNotChangePassword
    $audit.accountCreated = $true
    $audit.accountSid = $user.SID.Value
    # Only the just-created, exact owned account receives these memberships.
    foreach ($groupSid in @(Get-ExpectedAccountGroupSids $AccountKind)) {
        Add-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]$groupSid) -Member $user
    }
    $groups = @(Get-LocalGroup | Where-Object {
        @(Get-LocalGroupMember -Group $_ | Where-Object { $_.SID.Value -ceq $user.SID.Value }).Count -gt 0
    } | ForEach-Object { $_.SID.Value })
    $audit['localGroupSids'] = $groups
    Assert-ExpectedAccountGroups $AccountKind $groups
    $spec = [ordered]@{
        schema = 1; runId = $runId; expectedSid = $user.SID.Value; expectedSessionId = $audit.runnerContext.sessionId
        expectedAccountKind = $AccountKind
        candidateSha = $ExpectedCommit; applicationCandidateSha = $ApplicationCandidateSha; harnessMode = $HarnessMode
        frontendBoundaryProbe = [bool]$FrontendBoundaryProbe
        additionalHarnessFiles = $additionalHarnessFiles; runtime = $runtime; mode = $audit.mode
        binaryRole = $audit.binaryRole; binary = (File-Proof (Join-Path $code 'milkup-desktop.exe')); node = (File-Proof $node)
        driver = (File-Proof $driver); harness = (File-Proof (Join-Path $code $harnessLeaf))
        observer = (File-Proof (Join-Path $code 'WindowsMermaidStandardUser.cs'))
        wrapper = (File-Proof (Join-Path $code 'run-windows-mermaid-product-e2e.ps1'))
    }
    if ($installerMode) {
        $spec['installer'] = File-Proof (Join-Path $code 'candidate-installer.exe')
        $spec['packageManifest'] = File-Proof (Join-Path $code 'installer-input.json')
        $spec['binaryVerifier'] = File-Proof (Join-Path $code 'verify-installed-binary.mjs')
        $spec['expectedVersion'] = $ExpectedVersion
    }
    $specPath = Join-Path $code 'child-spec.json'
    Write-Json $specPath $spec
    # Explicit environment: no runner credentials, browser overrides or injected
    # profile paths. The child resolves its actual Windows KnownFolders first.
    $environment = @(
        "SystemRoot=$env:SystemRoot", "WINDIR=$env:SystemRoot", "SystemDrive=$env:SystemDrive",
        "PATH=$env:SystemRoot\System32;$(Split-Path -Parent $pwsh);$(Split-Path -Parent $node)",
        'GITHUB_ACTIONS=true', 'RUNNER_ENVIRONMENT=github-hosted', 'GITHUB_REPOSITORY=Auto-Plugin/milkup',
        "GITHUB_REF=$env:GITHUB_REF", "GITHUB_SHA=$ExpectedCommit"
    )
    if ($env:ProgramFiles) { $environment += "ProgramFiles=$env:ProgramFiles" }
    if (${env:ProgramFiles(x86)}) { $environment += "ProgramFiles(x86)=${env:ProgramFiles(x86)}" }
    foreach ($path in @($spec.wrapper.path, $specPath)) { if ($path.Contains('"') -or $path.Contains([char]0)) { throw 'Quoted or NUL child path rejected' } }
    $arguments = '-NoLogo -NoProfile -File "' + $spec.wrapper.path + '" -Child -ChildSpecPath "' + $specPath + '"'
    $processesEmpty = $false
    $audit.supervisor = [WindowsMermaidStandardUser]::Run($accountName, $password, $user.SID.Value,
        [uint32]$audit.runnerContext.sessionId, $AccountKind, $pwsh, $arguments, $code, $environment, 1200000)
    $processesEmpty = $audit.supervisor.jobEmpty -eq $true -and $audit.supervisor.cleanupErrors.Count -eq 0
    $audit.status = $audit.supervisor.status
    $profileKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $user.SID.Value
    if (Test-Path -LiteralPath $profileKey) {
        $profile = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $profileKey).ProfileImagePath)
        $audit.actualWindowsProfile = $profile
        $childEvidence = Join-Path $profile ('.milkup-mermaid-product-' + $runId + '/evidence')
        if ($processesEmpty -and (Test-Path -LiteralPath $childEvidence -PathType Container)) {
            $audit.standardContext = Read-SmallJson (Join-Path $childEvidence 'standard-context.json')
            $audit.childResult = Read-SmallJson (Join-Path $childEvidence 'standard-child-result.json')
            if ($audit.childResult.status -ceq 'failed') { $audit.error = $audit.childResult.error }
            if ($installerMode -and (Test-Path -LiteralPath (Join-Path $childEvidence 'installation-result.json'))) {
                $audit.installation = Read-SmallJson (Join-Path $childEvidence 'installation-result.json')
                $audit.installerExecuted = $null -ne $audit.installation.installerRun -and $audit.installation.installerRun.started -eq $true
                if ($audit.installation.actualSid -cne $user.SID.Value -or $audit.installation.candidateSha -cne $ApplicationCandidateSha) { throw 'Installation evidence belongs to a different identity or candidate' }
            }
            $audit.evidenceCopy = Copy-BoundedEvidence $childEvidence $EvidenceDirectory
            if (-not $audit.evidenceCopy.complete) {
                $audit.status = 'failed'
                if (-not $audit.error) { $audit.error = 'Evidence collection incomplete; see bounded rejection metadata' }
            }
            if ($audit.standardContext.actualSid -cne $user.SID.Value -or $audit.standardContext.expectedAccountKind -cne $AccountKind -or
                $audit.childResult.expectedAccountKind -cne $AccountKind) { throw 'Collected child evidence belongs to a different SID or account kind' }
        }
    }
    if ($audit.status -ceq 'passed' -and ($null -eq $audit.childResult -or $audit.childResult.status -cne 'passed')) { throw 'Successful supervisor lacks complete product-child evidence' }
    if ($installerMode -and $audit.status -ceq 'passed' -and ($null -eq $audit.installation -or
        $audit.installation.status -cne 'passed' -or
        ($HarnessMode -ceq 'product' -and $audit.installation.productAcceptance -cne 'passed') -or
        ($HarnessMode -ceq 'gui-regression' -and $audit.installation.guiAcceptance -cne 'passed') -or -not $audit.installerExecuted)) { throw 'Successful installed acceptance lacks complete installation/product proof' }
    if (-not $processesEmpty) { throw 'Outer process-tree cleanup is uncertain' }
} catch {
    if ($null -ne $audit.childResult -and $audit.childResult.status -ceq 'failed' -and $audit.childResult.error) {
        $audit.error = $audit.childResult.error
        $audit['secondaryFailure'] = @{ reason = 'evidence-collection-exception'; exceptionType = $_.Exception.GetType().Name }
    } else { $audit.error = $_.Exception.Message }
    if ($audit.status -ceq 'passed') { $audit.status = 'failed' }
} finally {
    $password.Dispose()
    try {
        if ($creationAttempted -and $null -eq $user) {
            $candidate = Get-LocalUser -Name $accountName -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.Description -ceq $description) {
                $user = $candidate; $audit.accountCreated = $true; $audit.accountSid = $user.SID.Value
            }
        }
    } catch { $audit.cleanupErrors += 'Exact account ownership recovery failed: ' + $_.Exception.Message }
    if ($null -ne $user) {
        if ($processesEmpty) {
            try {
                Remove-ExactProfileWithRetry $user.SID.Value $audit
                if ($installerMode -and $null -ne $audit.installation) {
                    Assert-Contained $audit.installation.installDirectory $audit.actualWindowsProfile
                    $audit.installedDirectoryRemoved = -not (Test-Path -LiteralPath $audit.installation.installDirectory)
                    if (-not $audit.installedDirectoryRemoved) { throw 'Exact installed directory remains after profile cleanup' }
                }
            } catch { $audit.cleanupErrors += 'Exact temporary-profile cleanup failed: ' + $_.Exception.Message }
            if ($audit.profileDeleted -eq $true -and (-not $installerMode -or $null -eq $audit.installation -or $audit.installedDirectoryRemoved -eq $true)) {
                try {
                    $current = Get-LocalUser -Name $accountName -ErrorAction Stop
                    if ($current.SID.Value -cne $user.SID.Value -or $current.Description -cne $description) { throw 'Account identity changed; refuse removal' }
                    Remove-LocalUser -SID $user.SID -ErrorAction Stop
                    if (Get-LocalUser -SID $user.SID -ErrorAction SilentlyContinue) { throw 'Exact temporary account remains' }
                    $audit.accountDeleted = $true
                    $audit.accountGroupCleanup = Confirm-DeletedAccountGroupAbsence $user.SID.Value
                    $audit.accountGroupCleanupConfirmed = $audit.accountGroupCleanup.complete -eq $true
                    if (-not $audit.accountGroupCleanupConfirmed) { throw 'Exact deleted-account SID absence from Users and Administrators is unconfirmed' }
                } catch { $audit.cleanupErrors += 'Exact temporary-account cleanup failed: ' + $_.Exception.Message }
            } else { $audit.cleanupErrors += 'Profile or installed-directory removal unconfirmed: preserve the exact account for explicit review' }
        } else { $audit.cleanupErrors += 'Process emptiness uncertain: preserve the exact account/profile for explicit review' }
    }
    if ($stageCreated) {
        try {
            if (-not $processesEmpty) { throw 'Process emptiness uncertain: preserve stage' }
            $null = @(Plain-Files $stage)
            Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction Stop
            if (Test-Path -LiteralPath $stage) { throw 'Owned test stage remains' }
            $audit.stageRemoved = $true
        } catch { $audit.cleanupErrors += 'Owned-stage cleanup failed: ' + $_.Exception.Message }
    }
    if ($audit.cleanupErrors.Count -gt 0) { $audit.status = 'failed' }
    Write-Json (Join-Path $EvidenceDirectory 'windows-standard-product-audit.json') $audit
    Write-Output ('MILKUP_WINDOWS_PRODUCT_AUDIT ' + ($audit | ConvertTo-Json -Depth 24 -Compress))
}
if ($audit.status -cne 'passed') { throw "Windows product E2E $($audit.status); inspect windows-standard-product-audit.json" }
