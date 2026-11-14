param([Parameter(Mandatory)][string]$Binary,[Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$BinarySha256,[Parameter(Mandatory)][ValidatePattern('^Milkup-Isolated-[a-f0-9]{32}$')][string]$Queue,[Parameter(Mandatory)][ValidatePattern('^MILKUP_SPOOL_[a-f0-9]{32}$')][string]$Marker,[Parameter(Mandatory)][string]$EvidenceDirectory,[Parameter(Mandatory)][string]$NodeExecutable)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if(!$IsWindows -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or $env:GITHUB_REF -cne 'refs/heads/dot/print-queue-acceptance-20261114'){throw 'Exact isolated CI required'}
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
Add-Type -Path (Join-Path $PSScriptRoot '../release/WindowsInstallWindow.cs')
if((Get-FileHash -LiteralPath $Binary).Hash.ToLowerInvariant() -cne $BinarySha256){throw 'Exact staged candidate image required'}
$identity=[WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($PID))[0]
if(!$identity.ContainsKey('token') -or ![WindowsMermaidStandardUser]::MatchesExpectedAccountKind($identity.token,'pure-standard')){throw 'Ordinary Users-only medium-integrity account required'}
$r=[ordered]@{status='failed';harnessSha=$env:GITHUB_SHA;applicationBaseline='b877746f5dfd236dfc13f718ed23d837b8e4f89d';binarySha256=$BinarySha256;accountSid=$identity.token.sid;identity=$identity;queue=$Queue;marker=$Marker;phases=@();forcedCleanup=$false;normalExit=$false;defaultBefore=@(Get-CimInstance Win32_Printer|Where-Object Default|Select-Object -ExpandProperty Name)}
function Persist {$r|ConvertTo-Json -Depth 18|Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'print-child.json') -Encoding utf8}
function Phase([string]$Name,$Detail){$r.phases+=@{name=$Name;utc=[datetime]::UtcNow.ToString('o');detail=$Detail};Persist}
function FreeLocalPort {$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);try{$l.Start();return $l.LocalEndpoint.Port}finally{$l.Stop()}}
$product=$null;$healthDriver=$null
try {
    $runtimes=@()
    foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles) | Select-Object -Unique) {
      if (!$base) { continue }
      $root=Join-Path $base 'Microsoft/EdgeWebView/Application'
      if (Test-Path -LiteralPath $root) {
        $runtimes+=@(Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -cmatch '^\d+\.\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'msedgewebview2.exe')) })
      }
    }
    if (!$runtimes.Count) { throw 'Existing Evergreen required; no Runtime installation fallback' }
    $runtime=@($runtimes | Sort-Object { [version]$_.Name })[-1]
    $driverRoot=Join-Path $env:RUNNER_TEMP 'milkup-repair-health-driver'
    $healthProfile=Join-Path $env:RUNNER_TEMP 'milkup-repair-health-browser'
    if ((Test-Path -LiteralPath $driverRoot) -or (Test-Path -LiteralPath $healthProfile)) { throw 'Health directories must be fresh' }
    $null=New-Item -ItemType Directory $driverRoot
    $null=New-Item -ItemType Directory $healthProfile
    $archive=Join-Path $driverRoot 'driver.zip'
    $driverUrl="https://msedgedriver.microsoft.com/$($runtime.Name)/edgedriver_win64.zip"
    Invoke-WebRequest -Uri $driverUrl -OutFile $archive -TimeoutSec 60
    if ((Get-Item -LiteralPath $archive).Length -gt 64MB) { throw 'Bounded driver archive required' }
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try {
      if ($zip.Entries.Count -gt 64) { throw 'Driver archive entry budget' }
      [long]$expanded=0
      foreach ($entry in $zip.Entries) {
        $dest=[IO.Path]::GetFullPath((Join-Path $driverRoot $entry.FullName))
        if (!$dest.StartsWith($driverRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or ($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'Unsafe driver archive path' }
        $expanded+=$entry.Length
      }
      if ($expanded -gt 256MB) { throw 'Expanded driver archive budget' }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $archive -DestinationPath $driverRoot
    $driverExe=Join-Path $driverRoot 'msedgedriver.exe'
    $signature=Get-AuthenticodeSignature -LiteralPath $driverExe
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') { throw 'Valid Microsoft driver signature required' }
    # The verified standard-account coordinator has no inherited console handles.
    # Capture this native tool explicitly instead of assuming PowerShell's call
    # operator receives stdout in that context.
    $versionOut=Join-Path $driverRoot 'version.stdout.log'
    $versionErr=Join-Path $driverRoot 'version.stderr.log'
    $versionProcess=Start-Process -FilePath $driverExe -ArgumentList '--version' -PassThru -WindowStyle Hidden -RedirectStandardOutput $versionOut -RedirectStandardError $versionErr
    $versionBirth=$versionProcess.StartTime.ToUniversalTime().Ticks
    try {
      if (!$versionProcess.WaitForExit(15000)) { throw 'Driver version check exceeded 15 seconds' }
      foreach ($file in @($versionOut,$versionErr)) { if ((Get-Item -LiteralPath $file).Length -gt 4096) { throw 'Driver version evidence exceeds budget' } }
      $version=[IO.File]::ReadAllText($versionOut).Trim()
      Phase 'health-driver-version' @{exitCode=$versionProcess.ExitCode;stdout=$version;stderr=[IO.File]::ReadAllText($versionErr)}
      if ($versionProcess.ExitCode -ne 0 -or $version -notmatch ('^(?:Microsoft Edge WebDriver|MSEdgeDriver) '+[regex]::Escape($runtime.Name)+'(?:\s|$)')) { throw 'Exact installed Evergreen driver required' }
    } finally {
      if (!$versionProcess.HasExited) {
        if ($versionProcess.StartTime.ToUniversalTime().Ticks -ne $versionBirth -or ![StringComparer]::OrdinalIgnoreCase.Equals($versionProcess.Path,$driverExe)) { throw 'Driver version cleanup identity mismatch' }
        $versionProcess.Kill();if (!$versionProcess.WaitForExit(5000)) { throw 'Driver version process did not exit' }
      }
      $versionProcess.Dispose()
    }
    $driverPort=FreeLocalPort
    do { $debugPort=FreeLocalPort } while ($debugPort -eq $driverPort)
    $healthDriver=Start-Process -FilePath $driverExe -ArgumentList @("--port=$driverPort",'--allowed-ips=127.0.0.1') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDirectory 'driver.stdout.log') -RedirectStandardError (Join-Path $EvidenceDirectory 'driver.stderr.log')
    $driverBirth=$healthDriver.StartTime.ToUniversalTime().Ticks
    Phase 'health-driver-start' @{pid=$healthDriver.Id;creationTicks=$driverBirth;image=$driverExe;sha256=(Get-FileHash -LiteralPath $driverExe -Algorithm SHA256).Hash.ToLowerInvariant();version=$version;runtime=$runtime.Name;source=$driverUrl;signature='Valid Microsoft';profile=$healthProfile}
 $document=Join-Path $EvidenceDirectory ($Marker+'.md')
 [IO.File]::WriteAllText($document,"# $Marker`n`nIsolated Milkup spool verification. No real documents or physical output.`n")
 $r.documentSha256=(Get-FileHash -LiteralPath $document).Hash.ToLowerInvariant()
 $product=Start-Process -FilePath $Binary -ArgumentList @($document) -Environment @{WEBVIEW2_USER_DATA_FOLDER=$healthProfile;WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$debugPort --remote-debugging-address=127.0.0.1";TAURI_WEBVIEW_AUTOMATION='true'} -PassThru
 $birth=$product.StartTime.ToUniversalTime().Ticks;$held=$product.Handle
 Phase 'product-start' @{pid=$product.Id;creationTicks=$birth.ToString();image=$Binary}
 $r.productIdentity=[WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($product.Id))[0]
 if(!$r.productIdentity.ContainsKey('token') -or $r.productIdentity.token.sid -cne $r.accountSid -or ![WindowsMermaidStandardUser]::MatchesExpectedAccountKind($r.productIdentity.token,'pure-standard')){throw 'Product standard-user identity failed'}
 $run=[WindowsMermaidStandardUser]::RunNodeScript($NodeExecutable,[string[]]@((Join-Path $PSScriptRoot 'print-queue-ui.mjs'),$driverPort,$debugPort,$document,$EvidenceDirectory,$product.Id,$birth,$Binary,$Queue,$Marker),$PSScriptRoot,(Join-Path $EvidenceDirectory 'ui.stdout.log'),(Join-Path $EvidenceDirectory 'ui.stderr.log'),250000)
 Phase 'print-ui-finished' $run
 if($run.status -cne 'passed'){throw 'Application print UI failed'}
 $ui=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'print-ui.json') -Raw|ConvertFrom-Json
 if($ui.status -cne 'passed-ui-queue-contract-await-normal-close' -or $ui.printPhases.Count -ne 2 -or !$ui.printPhases[1].jobSubmitted -or !$ui.printPhases[1].systemCancel -or $ui.printPhases[1].jobsAfter.Count){throw 'Complete spool and single-job cancellation proof required'}
 if((Get-FileHash -LiteralPath $document).Hash.ToLowerInvariant() -cne $r.documentSha256){throw 'Test document changed'}
 $windows=@([MilkupInstallWindow]::Observe($product.Id,$birth,$Binary)|Where-Object productRoot)
 if($windows.Count -ne 1){throw 'Unique owned product close target required'}
 [MilkupInstallWindow]::Close($windows[0].hwnd,$product.Id,$birth,$Binary)
 if(!$product.WaitForExit(15000) -or $product.ExitCode -ne 0){throw 'Product normal close failed'}
 $r.normalExit=$true;$r.status='passed'
}catch{$r.error=$_|Out-String}finally{
 if($product -and !$product.HasExited){
  try{$windows=@([MilkupInstallWindow]::Observe($product.Id,$birth,$Binary)|Where-Object productRoot);if($windows.Count -eq 1){[MilkupInstallWindow]::Close($windows[0].hwnd,$product.Id,$birth,$Binary);$null=$product.WaitForExit(10000)}
   if(!$product.HasExited){$r.forcedCleanup=$true;throw 'Product remains live; owned outer Job cleanup is not normal close'}
  }catch{$r.cleanupError=$_|Out-String}
 }
 if($healthDriver){try{$healthDriver.Refresh();if(!$healthDriver.HasExited){if($healthDriver.StartTime.ToUniversalTime().Ticks -ne $driverBirth -or ![StringComparer]::OrdinalIgnoreCase.Equals($healthDriver.Path,$driverExe)){throw 'Driver cleanup identity changed'};$healthDriver.Kill();if(!$healthDriver.WaitForExit(5000)){throw 'Driver did not retire'}}}catch{$r.driverCleanupError=$_|Out-String;$r.status='failed'}}
 $r.defaultAfter=@(Get-CimInstance Win32_Printer|Where-Object Default|Select-Object -ExpandProperty Name)
 $r.defaultUnchanged=([string]::Join('|',@($r.defaultBefore|Sort-Object)) -ceq [string]::Join('|',@($r.defaultAfter|Sort-Object)))
 if(!$r.defaultUnchanged -or $r.forcedCleanup){$r.status='failed'}
 Persist
}
if($r.status -cne 'passed'){throw 'Application spool acceptance failed; exact child evidence retained'}
