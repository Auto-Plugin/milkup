# Long-lived, test-only JSONL host. This runs under the same existing medium
# account/session/desktop as the product. It never changes tokens or desktop ACLs.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$FixtureRoot,
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [string]$ExpectedSid = '',
    [int]$ExpectedSessionId = -1,
    [ValidateSet('', 'pure-standard', 'filtered-admin')][string]$ExpectedAccountKind = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Assert-PlainAbsolutePath([string]$Value, [bool]$Directory) {
    if (-not [IO.Path]::IsPathFullyQualified($Value) -or $Value.IndexOfAny([char[]]@(0, 10, 13, 34)) -ge 0) { throw 'Plain absolute helper path required' }
    $item = Get-Item -LiteralPath $Value -Force
    if ($item.PSIsContainer -ne $Directory) { throw 'Helper path type mismatch' }
    for ($part = $item; $null -ne $part; $part = if ($part -is [IO.DirectoryInfo]) { $part.Parent } else { $part.Directory }) {
        if (($part.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked helper path or ancestor rejected' }
    }
    return [IO.Path]::GetFullPath($Value)
}
function Write-Response($RequestId, [bool]$Ok, $Result, [string]$Failure = '') {
    if ($Ok) { $response = @{ id = $RequestId; ok = $true; result = $Result } }
    else { $response = @{ id = $RequestId; ok = $false; error = $Failure.Substring(0, [Math]::Min(1024, $Failure.Length)) } }
    $line = ConvertTo-Json -InputObject $response -Depth 20 -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($line) -gt 65536) { throw 'Native observer response exceeds budget' }
    [Console]::WriteLine($line)
    [Console]::Out.Flush()
}
function Assert-RequestFields($Request, [string[]]$Allowed) {
    foreach ($field in $Request.Keys) { if ($field -notin $Allowed) { throw "Unknown native observer request field: $field" } }
}
function Assert-IdentityContext {
    $context = [WindowsMermaidStandardUser]::ObserveCurrentContext()
    if ($context.desktopEligible -ne $true) { throw ('Same interactive input desktop unavailable: ' + ($context.blockedReasons -join '; ')) }
    $token = $context.token
    $standard = [WindowsMermaidStandardUser]::MatchesExpectedAccountKind($token, 'pure-standard')
    $filtered = [WindowsMermaidStandardUser]::MatchesExpectedAccountKind($token, 'filtered-admin')
    if (-not $standard -and -not $filtered) { throw 'Native observer requires an ordinary medium primary token' }
    if ($ExpectedAccountKind -and -not [WindowsMermaidStandardUser]::MatchesExpectedAccountKind($token, $ExpectedAccountKind)) { throw 'Native observer account kind mismatch' }
    if ($ExpectedSid -and $token.sid -cne $ExpectedSid) { throw 'Native observer SID mismatch' }
    if ($ExpectedSessionId -ge 0 -and $context.sessionId -ne $ExpectedSessionId) { throw 'Native observer session mismatch' }
    return $context
}
function Save-NativeReport($Report) {
    $Report['identityContext'] = $script:identityContext
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Report -Depth 20 -Compress))
    if ($bytes.Length -gt 2MB) { throw 'Native window report exceeds 2 MiB budget' }
    $destination = Join-Path $EvidenceDirectory 'native-window-events.json'
    $stream = [IO.FileStream]::new($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    $summary = @{}
    foreach ($field in @('schema', 'complete', 'positiveControlPassed', 'productVisibleConsoleCount', 'unattributedVisibleConsoleCount', 'overflow', 'observerErrors', 'elapsedMs', 'pollMilliseconds', 'windowEventHookUsed', 'desktopOrAclChanged', 'productTerminatedByObserver')) { $summary[$field] = $Report[$field] }
    $summary.report = 'native-window-events.json'
    $summary.reportBytes = $bytes.Length
    return $summary
}

if (-not $IsWindows) { throw 'Native GUI observation requires Windows' }
$NodePath = Assert-PlainAbsolutePath $NodePath $false
$FixtureRoot = Assert-PlainAbsolutePath $FixtureRoot $true
$EvidenceDirectory = Assert-PlainAbsolutePath $EvidenceDirectory $true
if ([IO.Path]::GetFileName($NodePath) -ine 'node.exe') { throw 'Pinned existing node.exe required' }
if ($env:NODE_OPTIONS -or $env:NODE_PATH) { throw 'Console positive control requires no Node preload options or module path override' }
foreach ($name in @('WindowsMermaidStandardUser.cs', 'WindowsMermaidGuiObserver.cs')) {
    $source = Assert-PlainAbsolutePath (Join-Path $PSScriptRoot $name) $false
    Add-Type -Path $source -ErrorAction Stop
}
$script:identityContext = Assert-IdentityContext
$observer = [WindowsMermaidGuiObserver]::new()
$hasStarted = $false
$hasStopped = $false
$savedReport = $false
$count = 0
try {
    while ($null -ne ($line = [Console]::ReadLine())) {
        $requestId = $null
        try {
            if (++$count -gt 128 -or $line.Length -gt 4096) { throw 'Native observer request budget exceeded' }
            $request = ConvertFrom-Json -InputObject $line -AsHashtable -Depth 8
            if ($request -isnot [System.Collections.IDictionary] -or -not $request.Contains('id') -or -not $request.Contains('command')) { throw 'Native observer request object required' }
            $requestId = $request.id
            if ($requestId -isnot [long] -and $requestId -isnot [int]) { throw 'Integer request id required' }
            if ($requestId -lt 1 -or $requestId -gt 1000 -or $request.command -isnot [string]) { throw 'Invalid native observer request identity' }
            if ($hasStopped) { throw 'Native observer already stopped' }
            switch -Exact ($request.command) {
                'start' {
                    Assert-RequestFields $request @('id', 'command')
                    if ($hasStarted) { throw 'Native observer already started' }
                    $script:identityContext = Assert-IdentityContext
                    # Set before calling Start so a failed native start still
                    # gets a detailed report during EOF/finally cleanup.
                    $hasStarted = $true
                    $result = $observer.Start($NodePath, $FixtureRoot, $EvidenceDirectory)
                    $result['identityContext'] = $script:identityContext
                }
                'positiveControl' {
                    Assert-RequestFields $request @('id', 'command')
                    $null = Assert-IdentityContext
                    $result = $observer.PositiveControl()
                }
                'setProduct' {
                    Assert-RequestFields $request @('id', 'command', 'pid', 'image', 'creationFileTime')
                    if (-not $request.Contains('pid') -or -not $request.Contains('image') -or -not $request.Contains('creationFileTime') -or $request.image -isnot [string] -or $request.creationFileTime -isnot [string]) { throw 'Exact product identity fields required' }
                    $result = $observer.SetProduct([uint32]$request.pid, $request.image, $request.creationFileTime)
                }
                'phase' {
                    Assert-RequestFields $request @('id', 'command', 'name')
                    if (-not $request.Contains('name') -or $request.name -isnot [string]) { throw 'Native phase name required' }
                    $result = $observer.Phase($request.name)
                }
                'chooseFile' {
                    Assert-RequestFields $request @('id', 'command', 'path')
                    if (-not $request.Contains('path') -or $request.path -isnot [string]) { throw 'Owned fixture path required' }
                    $null = Assert-IdentityContext
                    $result = $observer.ChooseFile($request.path)
                }
                'measureProduct' {
                    Assert-RequestFields $request @('id', 'command')
                    $null = Assert-IdentityContext
                    $result = $observer.MeasureProduct()
                }
                'resizeProduct' {
                    Assert-RequestFields $request @('id', 'command', 'mode', 'width', 'height')
                    if (-not $request.Contains('mode') -or $request.mode -isnot [string] -or $request.mode -notin @('normal', 'maximize', 'restore')) { throw 'Closed native window mode required' }
                    $width = 0; $height = 0
                    if ($request.mode -eq 'normal') {
                        if (-not $request.Contains('width') -or -not $request.Contains('height') -or ($request.width -isnot [int] -and $request.width -isnot [long]) -or ($request.height -isnot [int] -and $request.height -isnot [long])) { throw 'Integer native window dimensions required' }
                        $width = [int]$request.width; $height = [int]$request.height
                    } elseif ($request.Contains('width') -or $request.Contains('height')) { throw 'State-only native window operation cannot include dimensions' }
                    $null = Assert-IdentityContext
                    $result = $observer.ResizeProduct($request.mode, $width, $height)
                }
                'stop' {
                    Assert-RequestFields $request @('id', 'command')
                    $report = $observer.Stop()
                    $hasStopped = $true
                    $result = Save-NativeReport $report
                    $savedReport = $true
                }
                default { throw 'Unsupported native observer command' }
            }
            Write-Response $requestId $true $result
            if ($hasStopped) { break }
        } catch {
            Write-Response $requestId $false $null $_.Exception.Message
            if ($count -gt 128 -or $line.Length -gt 4096) { break }
        }
    }
} finally {
    if ($hasStarted -and -not $savedReport) {
        try {
            $report = $observer.Stop()
            $report['complete'] = $false
            $report['observerErrors'] = @($report['observerErrors']) + 'Protocol ended without a successfully saved explicit stop report'
            $null = Save-NativeReport $report
        } catch { [Console]::Error.WriteLine(('Native observer final report failed: ' + $_.Exception.Message).Substring(0, [Math]::Min(1024, ('Native observer final report failed: ' + $_.Exception.Message).Length))) }
    }
    $observer.Dispose()
}
