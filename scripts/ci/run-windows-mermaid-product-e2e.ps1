[CmdletBinding(DefaultParameterSetName = 'Parent')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Parent')][string]$Binary,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][string]$EvidenceDirectory,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit,
    [Parameter(Mandatory, ParameterSetName = 'Parent')][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedBinarySha256,
    [Parameter(ParameterSetName = 'Parent')][switch]$ProductionAssetsConfirmed,
    [Parameter(Mandatory, ParameterSetName = 'Child')][switch]$Child,
    [Parameter(Mandatory, ParameterSetName = 'Child')][string]$ChildSpecPath,
    [Parameter(Mandatory, ParameterSetName = 'Inspect')][switch]$InspectProcesses,
    [Parameter(Mandatory, ParameterSetName = 'Inspect')][ValidatePattern('^[0-9]+(,[0-9]+){0,7}$')][string]$ProcessIds
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Prepared driver only. It is never called by the compile-only workflow. No
# installer, Runtime provisioning, account reuse, token adjustment or ACL edit.
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
function Copy-BoundedEvidence([string]$Source, [string]$Destination) {
    $files = @(Plain-Files $Source)
    if ($files.Count -gt 94) { throw 'Synthetic evidence leaves no room within the 96-file transfer budget' }
    [long]$total = 0
    foreach ($file in $files) {
        $extension = $file.Extension.ToLowerInvariant()
        $limit = $(if ($extension -ceq '.png') { 32MB } else { 2MB })
        if ($extension -notin @('.json', '.png', '.log', '.txt', '.md') -or $file.Length -gt $limit) { throw 'Unexpected or oversized synthetic evidence file' }
        $total += $file.Length
    }
    # Reserve two MiB for the manifest and the outer audit in the bounded artifact.
    if ($total -gt 126MB) { throw 'Synthetic evidence leaves no room within the 128-MiB transfer budget' }
    # Preserve only bounded, self-authored evidence as top-level files. The
    # manifest records each original relative name; profile/UDF are outside Source.
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [void]$names.Add('windows-standard-product-audit.json')
    [void]$names.Add('evidence-files.json')
    $records = @()
    $number = 0
    foreach ($file in $files) {
        $number++
        $relative = [IO.Path]::GetRelativePath($Source, $file.FullName)
        $leaf = [regex]::Replace($file.Name, '[^a-zA-Z0-9._-]', '_')
        if ($file.Extension.ToLowerInvariant() -in @('.txt', '.md')) { $leaf += '.log' }
        $flat = $(if ($relative -ceq $file.Name) { $leaf } else { ('{0:d3}-' -f $number) + $leaf })
        if (-not $names.Add($flat)) { throw 'Synthetic evidence filename collision' }
        $target = Join-Path $Destination $flat
        Assert-Contained $target $Destination
        if (Test-Path -LiteralPath $target) { throw 'Evidence destination collision' }
        $proof = File-Proof $file.FullName
        $records += [ordered]@{ relativePath = $relative; retainedName = $flat; bytes = $proof.bytes; sha256 = $proof.sha256; sourcePath = $file.FullName }
    }
    foreach ($record in $records) {
        $target = Join-Path $Destination $record.retainedName
        Copy-Item -LiteralPath $record.sourcePath -Destination $target -ErrorAction Stop
        if ((File-Proof $target).sha256 -cne $record.sha256) { throw 'Evidence copy hash mismatch' }
        [void]$record.Remove('sourcePath')
    }
    $manifest = [ordered]@{ schema = 1; files = $records; totalBytes = $total; source = 'new standard-account synthetic evidence only' }
    Write-Json (Join-Path $Destination 'evidence-files.json') $manifest
    return [ordered]@{ files = $files.Count; bytes = $total; manifest = 'evidence-files.json' }

}
function Import-Observer([string]$Path) {
    Assert-PlainPath $Path
    if (-not ('WindowsMermaidStandardUser' -as [type])) { Add-Type -Path $Path -ErrorAction Stop }
}
function Invoke-StandardChild {
    Assert-HostedCandidate
    $spec = Read-SmallJson $ChildSpecPath
    if ($spec.schema -ne 1 -or $spec.runId -cnotmatch '^[a-f0-9]{32}$' -or
        $spec.expectedSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or
        $spec.candidateSha -cne $env:GITHUB_SHA -or $spec.expectedSessionId -le 0) { throw 'Invalid immutable child specification' }
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
    $result = [ordered]@{ status = 'blocked'; startedNode = $false; nodeExitCode = $null; error = $null }
    $context = [ordered]@{
        status = 'blocked'; actualSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        expectedSid = $spec.expectedSid; pureStandard = $false; interactive = $false
        sessionId = $null; expectedSessionId = $spec.expectedSessionId
        knownFolders = @{ profile = $profile; roamingAppData = $roaming; localAppData = $local }
        scratchRoot = $scratch; work = $work; evidence = $evidence; desktop = $null; blockedReasons = @()
        existingDesktopAclChanged = $false; securityPolicyChanged = $false
    }
    try {
        foreach ($inputFile in @($spec.binary, $spec.node, $spec.driver, $spec.harness, $spec.observer, $spec.wrapper)) { Assert-Hash $inputFile.path $inputFile.sha256 }
        Import-Observer $spec.observer.path
        $desktop = [WindowsMermaidStandardUser]::ObserveCurrentContext()
        $context.desktop = $desktop
        $context.pureStandard = $desktop.ContainsKey('token') -and $desktop.token.pureStandardUser -eq $true
        $context.sessionId = $(if ($desktop.ContainsKey('sessionId')) { $desktop.sessionId } else { $null })
        $context.blockedReasons = @($desktop.blockedReasons)
        if ($context.actualSid -cne $spec.expectedSid) { $context.blockedReasons += 'Current SID differs from the exact temporary account' }
        if (-not $context.pureStandard) { $context.blockedReasons += 'Pure-standard token gate rejected current coordinator' }
        if ($context.sessionId -ne $spec.expectedSessionId) { $context.blockedReasons += 'Current session differs from the existing runner interactive session' }
        $context.interactive = $desktop.desktopEligible -eq $true -and $context.sessionId -eq $spec.expectedSessionId
        if ($context.blockedReasons.Count -gt 0) { throw 'Standard-account interactive desktop is unavailable under existing permissions' }
        $context.status = 'ready'
        Write-Json (Join-Path $evidence 'standard-context.json') $context
        $variables = @{
            MILKUP_WINDOWS_MERMAID_APP = $spec.binary.path
            MILKUP_WINDOWS_MERMAID_APP_SHA256 = $spec.binary.sha256
            MILKUP_WINDOWS_MERMAID_EDGE_DRIVER = $spec.driver.path
            MILKUP_WINDOWS_MERMAID_WORK = $work
            MILKUP_WINDOWS_MERMAID_EVIDENCE = $evidence
            MILKUP_WINDOWS_MERMAID_EXPECTED_SID = $spec.expectedSid
            MILKUP_WINDOWS_MERMAID_EXPECTED_SESSION_ID = [string]$spec.expectedSessionId
            MILKUP_WINDOWS_MERMAID_RUN_ID = $spec.runId
            MILKUP_WINDOWS_MERMAID_CANDIDATE_SHA = $spec.candidateSha
            MILKUP_WINDOWS_MERMAID_RUNTIME_VERSION = $spec.runtime.version
            MILKUP_WINDOWS_MERMAID_RUNTIME_EXE = $spec.runtime.path
            MILKUP_WINDOWS_MERMAID_PROCESS_OBSERVER = $spec.wrapper.path
            MILKUP_WINDOWS_MERMAID_PWSH = (Get-Process -Id $PID).Path
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
        $report = Read-SmallJson (Join-Path $evidence 'mermaid-product-e2e.json')
        if ($report.status -cne 'passed') { throw 'Node exit succeeded without passing product evidence' }
        $result.status = 'passed'
    } catch {
        $result.error = $_.Exception.Message
        if (-not $result.startedNode) { $context.blockedReasons += $result.error }
    } finally {
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
    $records = [WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]($ProcessIds.Split(',')))
    ConvertTo-Json -InputObject @($records) -Depth 12 -Compress
    exit 0
}
if ($Child) { Invoke-StandardChild; exit 1 }
Assert-HostedCandidate
if (-not $ProductionAssetsConfirmed) { throw 'A linked binary with embedded production assets must be explicitly confirmed; no installer or dev URL' }
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
$harness = Join-Path $repository 'tests/windows/mermaid-product-e2e.mjs'
$audit = [ordered]@{
    schema = 1; status = 'failed'; source = $ExpectedCommit; runId = $env:GITHUB_RUN_ID; localRunId = $runId
    attempt = $env:GITHUB_RUN_ATTEMPT; runtime = $null; binary = $null; driver = $null; runnerContext = $null
    standardContext = $null; childResult = $null; supervisor = $null; evidenceCopy = $null
    accountName = $accountName; accountSid = $null; accountCreated = $false; accountDeleted = $false
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
    foreach ($pair in @(@($binaryProof.path, 'milkup-desktop.exe'), @($observer, 'WindowsMermaidStandardUser.cs'), @($PSCommandPath, 'run-windows-mermaid-product-e2e.ps1'), @($harness, 'mermaid-product-e2e.mjs'))) {
        Assert-PlainPath $pair[0]
        Copy-Item -LiteralPath $pair[0] -Destination (Join-Path $code $pair[1]) -ErrorAction Stop
        if ((File-Proof $pair[0]).sha256 -cne (File-Proof (Join-Path $code $pair[1])).sha256) { throw 'Frozen staging copy mismatch' }
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
    Add-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]'S-1-5-32-545') -Member $user
    $groups = @(Get-LocalGroup | Where-Object {
        @(Get-LocalGroupMember -Group $_ | Where-Object { $_.SID.Value -ceq $user.SID.Value }).Count -gt 0
    } | ForEach-Object { $_.SID.Value })
    $audit['localGroupSids'] = $groups
    if ($groups.Count -ne 1 -or $groups[0] -cne 'S-1-5-32-545') { throw 'Fresh account has unexpected group membership' }
    $spec = [ordered]@{
        schema = 1; runId = $runId; expectedSid = $user.SID.Value; expectedSessionId = $audit.runnerContext.sessionId
        candidateSha = $ExpectedCommit; runtime = $runtime
        binary = (File-Proof (Join-Path $code 'milkup-desktop.exe')); node = (File-Proof $node)
        driver = (File-Proof $driver); harness = (File-Proof (Join-Path $code 'mermaid-product-e2e.mjs'))
        observer = (File-Proof (Join-Path $code 'WindowsMermaidStandardUser.cs'))
        wrapper = (File-Proof (Join-Path $code 'run-windows-mermaid-product-e2e.ps1'))
    }
    $specPath = Join-Path $code 'child-spec.json'
    Write-Json $specPath $spec
    # Explicit environment: no runner credentials, browser overrides or injected
    # profile paths. The child resolves its actual Windows KnownFolders first.
    $environment = @(
        "SystemRoot=$env:SystemRoot", "WINDIR=$env:SystemRoot", "SystemDrive=$env:SystemDrive",
        "PATH=$env:SystemRoot\System32;$(Split-Path -Parent $pwsh);$(Split-Path -Parent $node)",
        'GITHUB_ACTIONS=true', 'RUNNER_ENVIRONMENT=github-hosted', 'GITHUB_REPOSITORY=Auto-Plugin/milkup',
        'GITHUB_REF=refs/heads/dot/mermaid-rebuild-20261103', "GITHUB_SHA=$ExpectedCommit"
    )
    if ($env:ProgramFiles) { $environment += "ProgramFiles=$env:ProgramFiles" }
    if (${env:ProgramFiles(x86)}) { $environment += "ProgramFiles(x86)=${env:ProgramFiles(x86)}" }
    foreach ($path in @($spec.wrapper.path, $specPath)) { if ($path.Contains('"') -or $path.Contains([char]0)) { throw 'Quoted or NUL child path rejected' } }
    $arguments = '-NoLogo -NoProfile -File "' + $spec.wrapper.path + '" -Child -ChildSpecPath "' + $specPath + '"'
    $processesEmpty = $false
    $audit.supervisor = [WindowsMermaidStandardUser]::Run($accountName, $password, $user.SID.Value,
        [uint32]$audit.runnerContext.sessionId, $pwsh, $arguments, $code, $environment, 1200000)
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
            $audit.evidenceCopy = Copy-BoundedEvidence $childEvidence $EvidenceDirectory
            if ($audit.standardContext.actualSid -cne $user.SID.Value) { throw 'Collected child evidence belongs to a different SID' }
        }
    }
    if ($audit.status -ceq 'passed' -and ($null -eq $audit.childResult -or $audit.childResult.status -cne 'passed')) { throw 'Successful supervisor lacks complete product-child evidence' }
    if (-not $processesEmpty) { throw 'Outer process-tree cleanup is uncertain' }
} catch {
    $audit.error = $_.Exception.Message
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
                $profileKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $user.SID.Value
                if (Test-Path -LiteralPath $profileKey) {
                    $profile = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $profileKey).ProfileImagePath)
                    $audit.actualWindowsProfile = $profile
                    [WindowsMermaidStandardUser]::DeleteTemporaryProfile($user.SID.Value)
                    if ((Test-Path -LiteralPath $profileKey) -or (Test-Path -LiteralPath $profile)) { throw 'Exact temporary account profile remains' }
                }
                $audit.profileDeleted = $true
            } catch { $audit.cleanupErrors += 'Exact temporary-profile cleanup failed: ' + $_.Exception.Message }
            try {
                $current = Get-LocalUser -Name $accountName -ErrorAction Stop
                if ($current.SID.Value -cne $user.SID.Value -or $current.Description -cne $description) { throw 'Account identity changed; refuse removal' }
                Remove-LocalUser -SID $user.SID -ErrorAction Stop
                if (Get-LocalUser -SID $user.SID -ErrorAction SilentlyContinue) { throw 'Exact temporary account remains' }
                $audit.accountDeleted = $true
            } catch { $audit.cleanupErrors += 'Exact temporary-account cleanup failed: ' + $_.Exception.Message }
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
