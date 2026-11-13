[CmdletBinding()]
param([switch]$Watch,[string]$PrivateDirectory,[string]$Instance)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Assert-EtwHost {
    if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted Windows required' }
    if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Recorder coordinator must already be elevated' }
}
function Invoke-EtwWatcher {
    Assert-EtwHost
    if ($Instance -cnotmatch '^MilkupEtw[a-f0-9]{32}$' -or -not (Test-Path -LiteralPath $PrivateDirectory -PathType Container)) { throw 'Invalid owned recorder context' }
    $wpr = Join-Path $env:SystemRoot 'System32/wpr.exe'
    $profile = Join-Path $PSScriptRoot '../../tests/native/fixtures/WebView2_CPU.wprp'
    $sig = Get-AuthenticodeSignature $wpr
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Trusted WPR required' }
    if ((Get-FileHash $profile).Hash.ToLowerInvariant() -cne 'becbf3e4638e5f458e16a8fb7e7b14ae15dcdfe06bdb3d89a86c58412b2b062a') { throw 'Pinned recording profile required' }
    $r = [ordered]@{ status = 'running'; startedUtc = [datetime]::UtcNow.ToString('o'); profileSha256 = (Get-FileHash $profile).Hash.ToLowerInvariant(); wprSha256 = (Get-FileHash $wpr).Hash.ToLowerInvariant(); boundedStop = $null; errors = @() }
    $started = $false
    try {
        $output = @(& $wpr -start $profile -filemode -recordtempto $PrivateDirectory -instancename $Instance 2>&1)
        $r.startExit = $LASTEXITCODE
        if ($LASTEXITCODE -ne 0) { throw 'Recorder start rejected' }
        $started = $true
        $r.readyUtc = [datetime]::UtcNow.ToString('o')
        $null = @(& $wpr -marker 'MILKUP_ETW_STARTUP_BEGIN' -instancename $Instance 2>&1)
        [IO.File]::WriteAllText((Join-Path $PrivateDirectory 'ready'), 'ready')
        $timer = [Diagnostics.Stopwatch]::StartNew()
        while (-not (Test-Path -LiteralPath (Join-Path $PrivateDirectory 'stop'))) {
            if ($timer.Elapsed.TotalSeconds -ge 180) { $r.boundedStop = '180-second-window'; break }
            $size = (Get-ChildItem -LiteralPath $PrivateDirectory -File | Measure-Object Length -Sum).Sum
            if ($size -ge 512MB) { $r.boundedStop = '512-MiB-recording-budget'; break }
            Start-Sleep -Milliseconds 500
        }
        $r.stopRequestedUtc = [datetime]::UtcNow.ToString('o')
        $null = @(& $wpr -marker 'MILKUP_ETW_STARTUP_END' -instancename $Instance 2>&1)
        $output = @(& $wpr -stop (Join-Path $PrivateDirectory 'startup.etl') 'Milkup isolated temporary-profile diagnostic' -instancename $Instance 2>&1)
        $r.stopExit = $LASTEXITCODE
        if ($LASTEXITCODE -ne 0) { throw 'Recorder stop rejected' }
        $started = $false
        $r.finishedUtc = [datetime]::UtcNow.ToString('o')
        $r.rawBytes = (Get-Item (Join-Path $PrivateDirectory 'startup.etl')).Length
        $r.rawSha256 = (Get-FileHash (Join-Path $PrivateDirectory 'startup.etl')).Hash.ToLowerInvariant()
        $r.status = 'captured'
    } catch { $r.errors += $_.Exception.GetType().FullName; $r.status = 'failed' }
    finally {
        if ($started) { $null = @(& $wpr -cancel -instancename $Instance 2>&1); $r.cancelExit = $LASTEXITCODE }
        $r | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $PrivateDirectory 'capture.json') -Encoding utf8
    }
}
function Start-MilkupEtw {
    Assert-EtwHost
    $dir = Join-Path $env:RUNNER_TEMP ('milkup-etw-private-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $instanceName = 'MilkupEtw' + [guid]::NewGuid().ToString('N')
    $info = [Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($a in @('-NoLogo','-NoProfile','-File',(Join-Path $PSScriptRoot 'webview-etw-capture.ps1'),'-Watch','-PrivateDirectory',$dir,'-Instance',$instanceName)) { $info.ArgumentList.Add($a) }
    $process = [Diagnostics.Process]::Start($info)
    $until = [datetime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path (Join-Path $dir 'ready'))) {
        if ($process.HasExited -or [datetime]::UtcNow -gt $until) { [IO.File]::WriteAllText((Join-Path $dir 'stop'),'stop'); throw 'Recorder readiness failed; no product launched' }
        Start-Sleep -Milliseconds 100
    }
    return @{ directory = $dir; process = $process; instance = $instanceName }
}
function Stop-MilkupEtw($Context, [string]$Node, [string]$AccountKind) {
    [IO.File]::WriteAllText((Join-Path $Context.directory 'stop'),'stop')
    if (-not $Context.process.WaitForExit(120000)) { throw 'Recorder merge did not finish in 120 seconds; raw trace is not uploaded' }
    $safe = Join-Path $env:RUNNER_TEMP ('milkup-etw-retained-' + $AccountKind)
    New-Item -ItemType Directory -Path $safe | Out-Null
    $r = Get-Content (Join-Path $Context.directory 'capture.json') -Raw | ConvertFrom-Json -AsHashtable
    $r.sourceSha = $env:GITHUB_SHA
    $r.accountKind = $AccountKind
    $r.rawTracePublic = $false
    $r.productLogicChanged = $false
    try {
        if ($r.status -ne 'captured') { throw 'Recording failed' }
        # Preserve full diagnostic bytes only inside authenticated encryption.
        # Product/account reports remain subject to their existing bounded gates.
        $etl = Join-Path $Context.directory 'startup.etl'
        $wpt = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Windows Performance Toolkit'
        $profiles = @(Get-ChildItem -LiteralPath $wpt -Filter '*.wpaProfile' -Recurse | Select-Object -First 64)
        $r.installedAnalysisProfiles = @($profiles | ForEach-Object { [IO.Path]::GetRelativePath($wpt,$_.FullName) })
        $eventsPath = Join-Path $Context.directory 'webview-events.xml'
        $writer = [IO.StreamWriter]::new($eventsPath,$false,[Text.UTF8Encoding]::new($false))
        $writer.WriteLine('<Events>')
        $count = 0
        try {
            $query = "*[System[Provider[@Guid='{E16EC3D2-BB0F-4E8F-BDB8-DE0BEA82DC3D}']]]"
            Get-WinEvent -Path $etl -Oldest -FilterXPath $query -MaxEvents 50001 -ErrorAction Stop | ForEach-Object {
                $count++
                if ($count -le 50000) {
                    # Keep payloads only in the encrypted bundle. Public output is count-only.
                    $writer.WriteLine($_.ToXml())
                }
            }
            $r.webviewEventCount = $count
            $r.webviewEventsTruncated = $count -gt 50000
        } catch { $r.eventReadErrorType = $_.Exception.GetType().FullName }
        finally { $writer.WriteLine('</Events>'); $writer.Dispose() }
        # Existing WPT profiles supply trusted table definitions; retain their list
        # for deterministic selection. Do not guess or publish arbitrary CSV fields.
        $archive = Join-Path $env:RUNNER_TEMP ('milkup-etw-bundle-' + [guid]::NewGuid().ToString('N') + '.zip')
        [IO.Compression.ZipFile]::CreateFromDirectory($Context.directory,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
        try {
            $sealed = Join-Path $safe 'startup-trace.sealed'
            $sealJson = @(& $Node (Join-Path $PSScriptRoot 'seal-etw.mjs') seal $archive (Join-Path $PSScriptRoot '../../tests/native/fixtures/etw-retention-public.pem') $sealed)
            if ($LASTEXITCODE -ne 0) { throw 'Trace encryption failed' }
            $r.sealed = ($sealJson -join "`n") | ConvertFrom-Json -AsHashtable
            $r.publicKeySha256 = (Get-FileHash (Join-Path $PSScriptRoot '../../tests/native/fixtures/etw-retention-public.pem')).Hash.ToLowerInvariant()
        } finally { Remove-Item -LiteralPath $archive -Force }
    } finally {
        Remove-Item -LiteralPath $Context.directory -Recurse -Force
        $r.rawRemoved = -not (Test-Path -LiteralPath $Context.directory)
        $r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $safe 'capture-summary.json') -Encoding utf8
    }
}
if ($Watch) { Invoke-EtwWatcher; exit }
