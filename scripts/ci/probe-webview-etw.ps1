[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable GitHub-hosted Windows only' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$private = Join-Path $env:RUNNER_TEMP ('milkup-wpr-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $private | Out-Null
$result = [ordered]@{ schema = 1; status = 'checking'; sourceSha = $env:GITHUB_SHA; imageOS = $env:ImageOS; imageVersion = $env:ImageVersion; osVersion = [Environment]::OSVersion.Version.ToString(); tools = @(); capture = $null; noProductStarted = $true; noRawTraceUploaded = $true; securitySettingsChanged = $false }
function Tool([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @{ name = [IO.Path]::GetFileName($path); found = $false } }
    $file = Get-Item -LiteralPath $path
    $sig = Get-AuthenticodeSignature -LiteralPath $path
    $trusted = $sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match 'O=Microsoft Corporation'
    return @{ name = $file.Name; found = $true; version = $file.VersionInfo.FileVersion; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant(); signatureStatus = $sig.Status.ToString(); microsoftSigned = $trusted }
}
$wpr = Join-Path $env:SystemRoot 'System32/wpr.exe'
$paths = @($wpr, (Join-Path $env:SystemRoot 'System32/tracerpt.exe'))
foreach ($name in @('wpa.exe','wpaexporter.exe','xperf.exe')) {
    foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) { $paths += Join-Path $base "Windows Kits/10/Windows Performance Toolkit/$name" }
    $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue
    if ($command) { $paths += $command.Source }
}
$paths = @($paths | Select-Object -Unique)
$started = $false
$instance = 'MilkupPreflight' + [guid]::NewGuid().ToString('N')
try {
    $result.tools = @($paths | ForEach-Object { Tool $_ })
    $result.elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $profile = Join-Path $PSScriptRoot '../../tests/native/fixtures/WebView2_CPU.wprp'
    $result.profileSha256 = (Get-FileHash -LiteralPath $profile).Hash.ToLowerInvariant()
    if ($result.profileSha256 -cne 'becbf3e4638e5f458e16a8fb7e7b14ae15dcdfe06bdb3d89a86c58412b2b062a') { throw 'Official pinned profile mismatch' }
    if (-not $result.tools[0].microsoftSigned -or -not $result.elevated) { throw 'Trusted elevated WPR unavailable' }
    $profiles = @(& $wpr -profiles $profile 2>&1)
    $result.profileEnumerationExit = $LASTEXITCODE
    if ($LASTEXITCODE -ne 0) { throw 'Official WPR profile rejected' }
    $result.capture = [ordered]@{ startExit = $null; markerExit = $null; stopExit = $null; bytes = 0; sha256 = $null; sampleEventCount = 0; sampleProviders = @(); sampledOnly = $true; rawRemoved = $false }
    $startOutput = @(& $wpr -start $profile -filemode -recordtempto $private -instancename $instance 2>&1)
    $result.capture.startExit = $LASTEXITCODE
    if ($LASTEXITCODE -ne 0) { throw 'WPR recording unavailable' }
    $started = $true
    $markerOutput = @(& $wpr -marker 'MILKUP_ETW_CAPABILITY_NO_PRODUCT' -instancename $instance 2>&1)
    $result.capture.markerExit = $LASTEXITCODE
    Start-Sleep -Seconds 2
    $etl = Join-Path $private 'preflight.etl'
    $stopOutput = @(& $wpr -stop $etl 'Milkup disposable capability probe' -instancename $instance 2>&1)
    $result.capture.stopExit = $LASTEXITCODE
    if ($LASTEXITCODE -ne 0) { throw 'WPR stop failed' }
    $started = $false
    $result.capture.bytes = (Get-Item -LiteralPath $etl).Length
    $result.capture.sha256 = (Get-FileHash -LiteralPath $etl).Hash.ToLowerInvariant()
    try {
        $events = @(Get-WinEvent -Path $etl -Oldest -MaxEvents 100 -ErrorAction Stop)
        $result.capture.sampleEventCount = $events.Count
        # Names and IDs only; no event payload, paths, command lines or messages.
        $result.capture.sampleProviders = @($events | Group-Object ProviderId | ForEach-Object { @{ providerId = $_.Name; count = $_.Count } })
    } catch { $result.capture.sampleReadErrorType = $_.Exception.GetType().FullName }
    $result.status = 'capture-capability-verified'
} catch {
    $result.status = 'blocked'
    $result.errorType = $_.Exception.GetType().FullName
    # The step type and native exit codes suffice; never print raw tool messages.
} finally {
    if ($started) { $cancelOutput = @(& $wpr -cancel -instancename $instance 2>&1); $result.cancelExit = $LASTEXITCODE }
    Remove-Item -LiteralPath $private -Recurse -Force
    if ($null -ne $result.capture) { $result.capture.rawRemoved = -not (Test-Path -LiteralPath $private) }
    $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'capabilities.json') -Encoding utf8
}
if ($result.status -ne 'capture-capability-verified') { throw 'ETW preflight blocked; see sanitized capabilities.json' }
