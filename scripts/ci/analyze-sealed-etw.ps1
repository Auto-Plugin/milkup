[CmdletBinding()]
param([Parameter(Mandatory)][string]$PrivateDirectory,[Parameter(Mandatory)][string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup') { throw 'Isolated hosted Windows only' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$summary = [ordered]@{ status = 'waiting-for-wrapped-key'; analysisRun = $env:GITHUB_RUN_ID; sourceRun = '43513112486'; sourceSha = '0c3e71e90891267cc8c2e438ff4e869c3e401e32'; errors = @(); rawUploaded = $false; productStarted = $false; securitySettingsChanged = $false }
try {
    $inputDir = Join-Path $PrivateDirectory 'source'
    $null = & gh run download 43513112486 --repo Auto-Plugin/milkup --name 'milkup-startup-etw-0c3e71e90891267cc8c2e438ff4e869c3e401e32' --dir $inputDir 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Exact encrypted source artifact unavailable' }
    $sealed = Join-Path $inputDir 'startup-trace.sealed'
    $capture = Get-Content (Join-Path $inputDir 'capture-summary.json') -Raw | ConvertFrom-Json -AsHashtable
    $traceHash = (Get-FileHash $sealed).Hash.ToLowerInvariant()
    if ($capture.sourceSha -cne $summary.sourceSha -or $capture.accountKind -cne 'pure-standard' -or $capture.sealed.sha256 -cne $traceHash -or $capture.sealed.bytes -ne (Get-Item $sealed).Length) { throw 'Exact trace identity mismatch' }
    $publicPath = Join-Path $PrivateDirectory 'recipient-public.pem'
    $publicHash = (Get-FileHash $publicPath).Hash.ToLowerInvariant()
    $url = 'https://api.github.com/repos/Auto-Plugin/milkup/contents/tests/native/fixtures/etw-analysis-envelopes/' + $env:GITHUB_RUN_ID + '.json?ref=dot/webview-etw-preflight-20261113'
    $deadline = [datetime]::UtcNow.AddMinutes(15)
    $envelope = $null
    while ([datetime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-RestMethod -Uri $url -Headers @{ Authorization = ('Bearer ' + $env:GH_TOKEN); Accept = 'application/vnd.github+json' } -TimeoutSec 15
            if ($response.size -gt 4096 -or $response.encoding -cne 'base64') { throw 'Envelope budget' }
            $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($response.content))
            $candidate = $text | ConvertFrom-Json -AsHashtable
            if ($candidate.schema -ne 1 -or $candidate.analysisRun -cne $env:GITHUB_RUN_ID -or $candidate.traceSha256 -cne $traceHash -or $candidate.recipientSha256 -cne $publicHash -or $candidate.wrappedKey.Length -gt 1024) { throw 'Envelope identity mismatch' }
            $envelope = Join-Path $PrivateDirectory 'envelope.json'
            [IO.File]::WriteAllText($envelope,$text)
            break
        } catch {
            if ([datetime]::UtcNow -ge $deadline) { break }
            Start-Sleep -Seconds 10
        }
    }
    if (-not $envelope) { throw 'No exact-run wrapped key received within 15 minutes' }
    $archive = Join-Path $PrivateDirectory 'raw.zip'
    $null = & node (Join-Path $PSScriptRoot 'seal-etw.mjs') unseal $sealed (Join-Path $PrivateDirectory 'recipient-private.pem') $archive $envelope
    if ($LASTEXITCODE -ne 0) { throw 'Authenticated trace decryption failed' }
    $raw = Join-Path $PrivateDirectory 'raw'
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        if ($zip.Entries.Count -gt 1000) { throw 'Archive entry budget' }
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $total += $entry.Length
            if ($total -gt 3GB -or $entry.FullName -match '(^[\\/]|\.\.|:)' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe archive entry' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($archive,$raw)
    $etl = Join-Path $raw 'startup.etl'
    if ((Get-FileHash $etl).Hash.ToLowerInvariant() -cne $capture.rawSha256 -or (Get-Item $etl).Length -ne $capture.rawBytes) { throw 'Original ETL hash mismatch' }
    $summary.traceSha256 = $traceHash
    $summary.rawSha256 = $capture.rawSha256
    $reports = Join-Path $PrivateDirectory 'reports'
    New-Item -ItemType Directory -Path $reports | Out-Null
    $xperf = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Windows Performance Toolkit/xperf.exe'
    $signature = Get-AuthenticodeSignature $xperf
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Signed Microsoft Xperf required' }
    $summary.xperfSha256 = (Get-FileHash $xperf).Hash.ToLowerInvariant()
    $summary.actions = @()
    foreach ($action in @('tracestats','process','cpudisk','diskio','profile','marks')) {
        $path = Join-Path $reports ($action + '.txt')
        $info = [Diagnostics.ProcessStartInfo]::new($xperf)
        $info.UseShellExecute = $false; $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
        foreach ($a in @('-i',$etl,'-o',$path,'-quiet','-a',$action)) { $info.ArgumentList.Add($a) }
        $proc = [Diagnostics.Process]::Start($info)
        $stdout = $proc.StandardOutput.ReadToEndAsync(); $stderr = $proc.StandardError.ReadToEndAsync()
        $finished = $proc.WaitForExit(120000)
        if (-not $finished) { $proc.Kill($true); $proc.WaitForExit() }
        $summary.actions += @{ action = $action; timedOut = -not $finished; exitCode = $proc.ExitCode; bytes = $(if (Test-Path $path) { (Get-Item $path).Length } else { 0 }) }
        $proc.Dispose()
    }
    Copy-Item (Join-Path $raw 'webview-events.xml') $reports -ErrorAction SilentlyContinue
    $bundle = Join-Path $PrivateDirectory 'reports.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($reports,$bundle,[IO.Compression.CompressionLevel]::Optimal,$false)
    $sealJson = @(& node (Join-Path $PSScriptRoot 'seal-etw.mjs') seal $bundle (Join-Path $PSScriptRoot '../../tests/native/fixtures/etw-retention-public.pem') (Join-Path $OutputDirectory 'analysis.sealed'))
    if ($LASTEXITCODE -ne 0) { throw 'Analysis encryption failed' }
    $summary.sealed = ($sealJson -join "`n") | ConvertFrom-Json -AsHashtable
    $summary.status = 'processed'
    if (@($summary.actions | Where-Object { $_.timedOut -or $_.exitCode -ne 0 -or $_.bytes -eq 0 }).Count) { $summary.status = 'partial-analysis' }
} catch { $summary.status = 'failed'; $summary.errors += $_.Exception.GetType().FullName }
finally {
    Remove-Item -LiteralPath $PrivateDirectory -Recurse -Force
    $summary.privateFilesRemoved = -not (Test-Path -LiteralPath $PrivateDirectory)
    $summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $OutputDirectory 'analysis-summary.json') -Encoding utf8
}
if ($summary.status -ne 'processed') { throw 'Trace analysis incomplete; see allowlisted summary' }
