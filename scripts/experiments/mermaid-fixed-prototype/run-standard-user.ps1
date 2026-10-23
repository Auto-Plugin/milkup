param(
    [Parameter(Mandatory)][string]$Binary,
    [Parameter(Mandatory)][string]$Runtime,
    [Parameter(Mandatory)][string]$Evidence,
    [switch]$CaptureVisualEvidence
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or
    $env:GITHUB_REF -cne 'refs/heads/dot/milkup-v2-mermaid-prototype') {
    throw 'Temporary account is restricted to the reviewed disposable GitHub runner'
}

function Assert-PlainPath([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse path rejected' }
    if (-not $item.PSIsContainer) { $item = $item.Directory }
    do {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse ancestor rejected' }
        $item = $item.Parent
    } while ($null -ne $item)
}
function Set-PrivateDirectory([string]$Path, [string]$Sid, [string]$Rights) {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($entry in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @($Sid,$Rights))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($entry[0]),
            [Security.AccessControl.FileSystemRights]$entry[1],
            [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Read-CaseSummary([string]$Output) {
    if (-not (Test-Path -LiteralPath $Output -PathType Container)) { return }
    Assert-PlainPath $Output
    foreach ($file in Get-ChildItem -LiteralPath $Output -File -Filter '*.json' | Sort-Object Name) {
        if ($file.Name -ceq 'report.json') { continue }
        Assert-PlainPath $file.FullName
        if ($file.Length -gt 1048576) { throw 'Unexpected oversized case report' }
        $record = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json -AsHashtable
        $launcher = $record['launcher']
        if ($null -eq $launcher) { $launcher = @{} }
        $summary = [ordered]@{
            fixture = $record['fixture']; ok = $record['ok']; error = $record['error']
            rawRenderSucceeded = $record['rawRenderSucceeded']
            expectedRejection = $record['expectedRejection']
            observationOnly = $record['observationOnly']; executionFailure = $record['executionFailure']
            pngValidation = $record['pngValidation']; registrationMatches = $record['registrationMatches']
            standardUserEvidence = $launcher['standardUserEvidence']
            hostToken = $launcher['hostToken']; suspendedToken = $launcher['suspendedToken']
            browserToken = $launcher['browserToken']; browserProcessInOwnedJob = $launcher['browserProcessInOwnedJob']
            rendererError = $launcher['error']; rendererMetadata = $launcher['rendererMetadata']
            cleanupErrors = $launcher['cleanupErrors']; jobActiveAfterStop = $launcher['jobActiveAfterStop']
            profileDeletedAndFolderAbsent = $launcher['profileDeletedAndFolderAbsent']
            privateTreeRemoved = $launcher['privateTreeRemoved']
            privateTreeDeleteAttempts = $launcher['privateTreeDeleteAttempts']
            cleanupSupervisorSid = $launcher['cleanupSupervisorSid']
            stopMatrixAfterThisCase = $launcher['stopMatrixAfterThisCase']
        }
        # Only fixed synthetic result fields; no environment or credential dumps.
        Write-Output ('MILKUP_CASE_JSON ' + ($summary | ConvertTo-Json -Depth 20 -Compress))
    }
}

Assert-PlainPath $PSScriptRoot
Assert-PlainPath $Evidence
Assert-PlainPath $Runtime
Assert-PlainPath $Binary
. (Join-Path $PSScriptRoot 'visual-evidence.ps1')
. (Join-Path $PSScriptRoot 'cleanup-diagnostics.ps1')
Add-Type -Path (Join-Path $PSScriptRoot 'StandardUserProcess.cs')
$runId = [guid]::NewGuid().ToString('N')
$name = 'mkp' + $runId.Substring(0, 15)
$description = 'Milkup test ' + $runId
if ($name.Length -gt 20 -or $description.Length -gt 48) { throw 'Local account metadata exceeds Windows limits' }
$stage = Join-Path $env:RUNNER_TEMP ('milkup-standard-' + $runId)
$supervisorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($supervisorSid -cnotmatch '^S-1-5-21-[1-9][0-9]*-[1-9][0-9]*-[1-9][0-9]*-[1-9][0-9]*$') {
    throw 'Unexpected supervising runner identity'
}
$audit = [ordered]@{
    schema = 1; source = $env:GITHUB_SHA; userName = $name; userSid = $null
    runId = $env:GITHUB_RUN_ID; attempt = $env:GITHUB_RUN_ATTEMPT
    cleanupSupervisorSid = $supervisorSid
    accountCreated = $false; accountDeleted = $false; profileDeleted = $false
    stage = $stage; stageRemoved = $false; executions = @(); cleanupErrors = @()
    passwordInLogsFilesArgumentsOrEnvironment = $false
    changedFirewallOrUac = $false; changedExistingDesktopAcl = $false
    newRuntimeOrDependency = $false; productIntegrated = $false; artifactUpload = $false
    captureVisualEvidence = $CaptureVisualEvidence.IsPresent; visualEvidenceEmitted = $false
}
$password = [Security.SecureString]::new()
$user = $null
$creationAttempted = $false
$stageCreated = $false
$ownedProcessesCleared = $true
$failure = $null
$visualBundle = $null
try {
    if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { throw 'Generated account already exists' }
    # Directly append random characters to SecureString: no managed plaintext password.
    foreach ($character in 'aA1!'.ToCharArray()) { $password.AppendChar($character) }
    $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-+='
    for ($index=0; $index -lt 44; $index++) {
        $password.AppendChar($alphabet[[Security.Cryptography.RandomNumberGenerator]::GetInt32($alphabet.Length)])
    }
    $password.MakeReadOnly()
    $creationAttempted = $true
    $user = New-LocalUser -Name $name -Password $password -Description $description `
        -AccountExpires (Get-Date).AddDays(1) -UserMayNotChangePassword
    $audit.accountCreated = $true
    $sid = $user.SID.Value
    $audit.userSid = $sid
    Add-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]'S-1-5-32-545') -Member $user
    $memberships = @(Get-LocalGroup | Where-Object {
        @(Get-LocalGroupMember -Group $_ | Where-Object { $_.SID.Value -ceq $sid }).Count -gt 0
    } | ForEach-Object { $_.SID.Value })
    $audit['localGroupSids'] = $memberships
    if ($memberships.Count -ne 1 -or $memberships[0] -cne 'S-1-5-32-545') { throw 'Temporary account has unexpected group membership' }
    New-Item -ItemType Directory -Path $stage -ErrorAction Stop | Out-Null
    $stageCreated = $true
    Assert-PlainPath $stage
    Set-PrivateDirectory $stage $sid 'ReadAndExecute'
    foreach ($leaf in @('code','fixtures','fixtures-negative','state','outputs')) {
        New-Item -ItemType Directory -Path (Join-Path $stage $leaf) -ErrorAction Stop | Out-Null
    }
    Set-PrivateDirectory (Join-Path $stage 'state') $sid 'FullControl'
    Set-PrivateDirectory (Join-Path $stage 'outputs') $sid 'FullControl'
    foreach ($leaf in @('temp','profile','local','roaming')) {
        New-Item -ItemType Directory -Path (Join-Path $stage ('state/' + $leaf)) -ErrorAction Stop | Out-Null
    }
    $stagedBinary = Join-Path $stage 'code/fixed-mermaid.exe'
    Copy-Item -LiteralPath $Binary -Destination $stagedBinary
    if ((Get-FileHash $Binary).Hash -cne (Get-FileHash $stagedBinary).Hash) { throw 'Staged binary differs' }
    foreach ($manifest in @('fixtures-manifest.json','negative-fixtures-manifest.json')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $manifest) -Destination (Join-Path $stage $manifest)
    }
    foreach ($leaf in @('fixtures','fixtures-negative')) {
        Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot $leaf) -File -Filter '*.mmd' | ForEach-Object {
            Assert-PlainPath $_.FullName
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage ($leaf + '/' + $_.Name))
        }
    }
    $environment = @(
        "SystemRoot=$env:SystemRoot", "WINDIR=$env:SystemRoot", "SystemDrive=$env:SystemDrive",
        "PATH=$env:SystemRoot\System32", "TEMP=$stage\state\temp", "TMP=$stage\state\temp",
        "USERPROFILE=$stage\state\profile", "APPDATA=$stage\state\roaming", "LOCALAPPDATA=$stage\state\local",
        'MILKUP_MERMAID_PROTOTYPE_AUTHORIZED=fixed-official-data-only-temporary-test',
        "MILKUP_MERMAID_PROTOTYPE_EXPECTED_USER_SID=$sid",
        "MILKUP_MERMAID_PROTOTYPE_CLEANUP_OWNER_SID=$supervisorSid"
    )
    $cases = @(
        @{name='canary'; manifest='fixtures-manifest.json'; selector='flowchart-v2'; timeout=120000},
        @{name='positive'; manifest='fixtures-manifest.json'; selector=''; timeout=600000}
    )
    if (-not $CaptureVisualEvidence) {
        $cases += @{name='negative'; manifest='negative-fixtures-manifest.json'; selector=''; timeout=180000}
    }
    foreach ($case in $cases) {
        $output = Join-Path $stage ('outputs/' + $case.name)
        $manifest = Join-Path $stage $case.manifest
        $arguments = '--run "' + $Runtime + '" "' + $manifest + '" "' + $output + '"'
        if ($case.selector) { $arguments += ' ' + $case.selector }
        $ownedProcessesCleared = $false
        $result = [StandardUserProcess]::Run($name,$password,$sid,$stagedBinary,$arguments,$stage,$environment,$case.timeout)
        $ownedProcessesCleared = $result.jobEmpty -and $result.cleanupErrors.Count -eq 0
        $audit.executions += @{name=$case.name; result=$result}
        Write-Output ('MILKUP_SUPERVISOR_JSON ' + (@{name=$case.name; result=$result} | ConvertTo-Json -Depth 12 -Compress))
        Read-CaseSummary $output
        if (-not $result.success -and $ownedProcessesCleared) {
            try {
                Write-OwnedCleanupDiagnosis -Output $output -PrivateTemp (Join-Path $stage 'state/temp') -OuterResult $result
            } catch {
                $message = $_.Exception.Message
                $audit['readOnlyDiagnosticError'] = $message.Substring(0, [Math]::Min(512, $message.Length))
                Write-Output ('MILKUP_CLEANUP_DIAGNOSTIC_ERROR ' + (@{
                    runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; source=$env:GITHUB_SHA
                    error=$audit.readOnlyDiagnosticError
                } | ConvertTo-Json -Compress))
            }
        }
        if (-not $result.success -or -not $result.jobEmpty) {
            if ($CaptureVisualEvidence -and $case.name -ceq 'positive' -and $ownedProcessesCleared -and
                $result.resumed -and $result.jobAssigned -and $result.exitCode -ne 0) {
                try {
                    $reportPath = Join-Path $output 'report.json'
                    Assert-PlainPath $reportPath
                    if ((Get-Item -LiteralPath $reportPath).Length -gt 4194304) { throw 'Oversized visual report' }
                    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
                    $visualBundle = Read-PositivePngEvidence -Output $output -Manifest $manifest -Report $report -PartialFailed
                } catch {
                    # Preserve the original native failure even if evidence is
                    # missing or rejected. No rejected bytes can be exported.
                    $visualBundle = $null
                    $audit['visualEvidencePreparationError'] = $_.Exception.Message
                }
            }
            throw ('Standard-user ' + $case.name + ' failed; no subsequent dispatch')
        }
        $report = Get-Content -LiteralPath (Join-Path $output 'report.json') -Raw | ConvertFrom-Json
        if ($case.name -ceq 'positive' -and ($report.records.Count -ne 50 -or $report.acceptedAssertions -ne 50)) { throw 'Incomplete positive matrix' }
        if ($case.name -ceq 'negative' -and ($report.records.Count -ne 5 -or $report.acceptedAssertions -ne 4)) { throw 'Incomplete negative matrix' }
        $audit[($case.name + 'AcceptedAssertions')] = $report.acceptedAssertions
        if ($CaptureVisualEvidence -and $case.name -ceq 'positive') {
            $visualBundle = Read-PositivePngEvidence -Output $output -Manifest $manifest -Report $report
        }
    }
} catch {
    $failure = $_
    $audit['failure'] = $_.Exception.Message
} finally {
    $password.Dispose()
    # New-LocalUser may have committed before an unexpected transport exception.
    # Recover only our previously absent random name AND exact description.
    try {
        if ($creationAttempted -and $null -eq $user) {
            $candidate = Get-LocalUser -Name $name -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.Description -ceq $description) {
                $user = $candidate; $audit.accountCreated = $true; $audit.userSid = $user.SID.Value
            }
        }
    } catch { $audit.cleanupErrors += 'Account ownership recovery failed: ' + $_.Exception.Message }
    if ($null -ne $user) {
        try {
            if (-not $ownedProcessesCleared) { throw 'Owned process emptiness uncertain; retain profile' }
            $profileKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $user.SID.Value
            if (Test-Path -LiteralPath $profileKey) {
                $profilePath = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $profileKey).ProfileImagePath)
                $audit['actualWindowsProfile'] = $profilePath
                [StandardUserProcess]::DeleteTemporaryProfile($user.SID.Value)
                if ((Test-Path -LiteralPath $profileKey) -or (Test-Path -LiteralPath $profilePath)) { throw 'Temporary Windows profile remains' }
            }
            $audit.profileDeleted = $true
        } catch { $audit.cleanupErrors += 'Profile cleanup failed: ' + $_.Exception.Message }
        try {
            $current = Get-LocalUser -Name $name -ErrorAction Stop
            if ($current.SID.Value -cne $user.SID.Value -or $current.Description -cne $description) { throw 'Account identity changed; refuse deletion' }
            Remove-LocalUser -SID $user.SID -ErrorAction Stop
            if (Get-LocalUser -SID $user.SID -ErrorAction SilentlyContinue) { throw 'Temporary account remains' }
            $audit.accountDeleted = $true
        } catch { $audit.cleanupErrors += 'Account cleanup failed: ' + $_.Exception.Message }
    }
    if ($stageCreated) {
        try {
            if (-not $ownedProcessesCleared) { throw 'Owned process emptiness uncertain; retain test directory' }
            Assert-PlainPath $stage
            # Do not follow or recurse through a reparse point from writable test state.
            $linked = @(Get-ChildItem -LiteralPath $stage -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
            if ($linked.Count) { throw 'Stage contains reparse points; retain for explicit cleanup review' }
            Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction Stop
            if (Test-Path -LiteralPath $stage) { throw 'Temporary test tree remains' }
            $audit.stageRemoved = $true
        } catch { $audit.cleanupErrors += 'Stage cleanup failed: ' + $_.Exception.Message }
    }
    # Emit synthetic bytes only after all real cleanup has completed. A native
    # failure stays failed; outer cleanup never replaces the failed case result.
    if ($null -ne $visualBundle -and $ownedProcessesCleared -and $audit.accountDeleted -and
        $audit.profileDeleted -and $audit.stageRemoved -and $audit.cleanupErrors.Count -eq 0) {
        try {
            Write-PositivePngEvidence -Bundle $visualBundle
            $audit.visualEvidenceEmitted = $true
            $audit['visualEvidenceStatus'] = $visualBundle.status
        } catch {
            $audit['visualEvidenceEmissionError'] = $_.Exception.Message
            if ($null -eq $failure) { $failure = $_; $audit['failure'] = $_.Exception.Message }
        }
    }
    $visualBundle = $null
    # Persist and print only after attempting every owned-resource cleanup.
    $json = $audit | ConvertTo-Json -Depth 20
    $json | Set-Content -LiteralPath (Join-Path $Evidence 'standard-user.json')
    Write-Output ('MILKUP_ACCOUNT_JSON ' + ($audit | ConvertTo-Json -Depth 20 -Compress))
    "Temporary account removed: $($audit.accountDeleted); profile removed: $($audit.profileDeleted); test directory removed: $($audit.stageRemoved). No artifact upload." >> $env:GITHUB_STEP_SUMMARY
}
if ($audit.cleanupErrors.Count) { throw 'Temporary standard-user cleanup incomplete; inspect exact audit' }
if ($failure) { throw $failure }
