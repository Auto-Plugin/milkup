# Fixed diagnostic projection only. Never emits raw stderr, image paths or inputs.
function Convert-PreparationSummary([hashtable]$Launcher) {
    function NumberOrNull($Value) {
        if (($Value -is [int] -or $Value -is [long] -or $Value -is [uint32] -or $Value -is [uint64]) -and
            $Value -ge 0 -and $Value -le 9007199254740991) { return $Value }
        return $null
    }
    function BooleanOrNull($Value) {
        if ($Value -is [bool]) { return $Value }
        return $null
    }
    $result = [ordered]@{
        ready = $null
        prepareElapsedMs = (NumberOrNull $Launcher['prepareElapsedMs'])
        readyWaitElapsedMs = (NumberOrNull $Launcher['readyWaitElapsedMs'])
        prepareDeadlineMs = (NumberOrNull $Launcher['prepareDeadlineMs'])
        renderDeadlineMs = (NumberOrNull $Launcher['renderDeadlineMs'])
        parentTimeOrigin = 'Immediately before ResumeThread; original ready recv wait unchanged'
        helperTimeOrigin = 'engine::run entry; helper initialization deadline still starts after COM'
        ipcThreadsCompleted = (BooleanOrNull $Launcher['ipcThreadsCompleted'])
        stderrExceededBudget = (BooleanOrNull $Launcher['stderrExceededBudget'])
        preStopJob = $null; stderr = $null; projectionTruncated = $false
    }
    $ready = $Launcher['ready']
    if ($ready -is [System.Collections.IDictionary]) {
        $result.ready = [ordered]@{
            phase = $(if ($ready['phase'] -cin @('ready','fatal')) { $ready['phase'] } else { '<unrecognized>' })
            engine = $(if ($ready['engine'] -ceq '12.2.0') { '12.2.0' } else { $null })
            browserProcessId = (NumberOrNull $ready['browserProcessId'])
        }
    }
    $job = $Launcher['preStopJob']
    if ($job -is [System.Collections.IDictionary]) {
        $members = @($job['members'])
        if ($null -eq $job['members']) { $members = @() }
        $result.preStopJob = [ordered]@{
            active = (NumberOrNull $job['active'])
            peakJobMemoryBytes = (NumberOrNull $job['peakJobMemoryBytes'])
            peakProcessMemoryBytes = (NumberOrNull $job['peakProcessMemoryBytes'])
            jobMemoryLimitBytes = (NumberOrNull $job['jobMemoryLimitBytes'])
            activeProcessLimit = (NumberOrNull $job['activeProcessLimit'])
            limitFlags = (NumberOrNull $job['limitFlags'])
            inspectionFailed = ($null -ne $job['inspectionError'])
            memberCount = $members.Count; membersTruncated = ($members.Count -gt 16)
            members = @(foreach ($member in $members | Select-Object -First 16) {
                if ($member -isnot [System.Collections.IDictionary]) { continue }
                $basename = '<unrecognized-image>'
                if ($member['image'] -is [string]) {
                    $candidate = ($member['image'] -replace '\\','/').Split('/')[-1]
                    if ($candidate -cin @('msedgewebview2.exe','mermaid-fixed-prototype.exe','milkup-mermaid-fixed-prototype.exe')) { $basename = $candidate }
                }
                $token = $member['token']
                if ($token -isnot [System.Collections.IDictionary]) { $token = @{} }
                $debug = $token['seDebugPrivilege']
                if ($debug -isnot [System.Collections.IDictionary]) { $debug = @{} }
                [ordered]@{
                    pid = (NumberOrNull $member['pid']); image = $basename
                    inspectionFailed = ($null -ne $member['inspectionError'])
                    isAppContainer = (BooleanOrNull $token['isAppContainer'])
                    elevated = (BooleanOrNull $token['elevated'])
                    capabilityCount = (NumberOrNull $token['capabilityCount'])
                    seDebugPresent = (BooleanOrNull $debug['present'])
                }
            })
        }
    }
    if ($Launcher['stderr'] -is [string]) {
        $raw = $Launcher['stderr']
        $bytes = [Text.Encoding]::UTF8.GetBytes($raw)
        $phases = @(
            'helper-enter','token-before','token-ok','com-start','com-returned',
            'environment-call-start','environment-call-returned','environment-callback-ok','environment-callback-failed',
            'controller-call-start','controller-call-returned','controller-callback-ok','controller-callback-failed',
            'controls-installed','navigate-start','navigate-returned',
            'bootstrap-ready-validated','ready-frame-start','ready-frame-flushed'
        )
        $knownErrors = @('Native helper deadline reached','Callback channel closed','Unexpected bootstrap ready',
            'Only the zero-capability AppContainer child may render')
        $accepted = @(); $unknown = 0; $acceptedBytes = 0; $truncated = $bytes.Length -gt 16384
        # The native reader already enforces 16 KiB. Refuse to inspect beyond it.
        if (-not $truncated) {
            foreach ($line in ($raw -split '\r?\n')) {
                if ($line.Length -eq 0) { continue }
                $keep = $false
                if ($line -cmatch '^MILKUP_PHASE (?<phase>[a-z-]+) elapsedUs=(?<time>[0-9]{1,12})(?: hresult=(?<hr>0x[0-9A-Fa-f]{8}))?$') {
                    $keep = $Matches['phase'] -cin $phases
                } elseif ($line.StartsWith('Fixed Mermaid prototype failed: ', [StringComparison]::Ordinal)) {
                    $keep = $line.Substring('Fixed Mermaid prototype failed: '.Length) -cin $knownErrors
                }
                if (-not $keep) { $unknown++; continue }
                $length = [Text.Encoding]::UTF8.GetByteCount($line) + 1
                if ($accepted.Count -ge 24 -or $acceptedBytes + $length -gt 2048) { $truncated = $true; continue }
                $accepted += $line; $acceptedBytes += $length
            }
        }
        $result.stderr = [ordered]@{
            utf8BytesAfterLossyDecode = $bytes.Length
            sha256AfterLossyDecode = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
            lines = $accepted; unknownLinesOmitted = $unknown
            truncated = $truncated; rawTextEmitted = $false
        }
    }
    # Bounded total output, even if a malformed report supplies excessive members.
    if ([Text.Encoding]::UTF8.GetByteCount(($result | ConvertTo-Json -Depth 10 -Compress)) -gt 8192) {
        return [ordered]@{ projectionTruncated = $true; reason = 'Projection exceeded 8 KiB'; ready = $null; stderr = $null; preStopJob = $null }
    }
    return $result
}
