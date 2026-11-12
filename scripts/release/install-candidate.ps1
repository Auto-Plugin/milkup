# Run only on an ephemeral hosted Windows runner. This is a single runner-account
# install/window/close/uninstall smoke test, not dual-account or missing-Runtime acceptance.
param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][string]$SourceSha,[Parameter(Mandatory=$true)][string]$Variant,[Parameter(Mandatory=$true)][string]$EvidenceDirectory,[switch]$RepairSameVersion,[switch]$RepairHealth,[switch]$DocumentHealth,[switch]$StartupComparison,[string]$NodeExecutable)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows') { throw 'Requires ephemeral Windows Actions runner' }
if ($RepairHealth -and !$RepairSameVersion) { throw 'Repair health requires same-version repair' }
if ($StartupComparison -and (!$RepairHealth -or $DocumentHealth -or $Variant -cne 'windows-standard')) { throw 'Startup comparison requires standard isolated repair health without document mutations' }
if ($DocumentHealth -and !$RepairHealth) { throw 'Document health requires isolated repair health' }
if ($RepairHealth -and (![IO.Path]::IsPathFullyQualified($NodeExecutable) -or !(Test-Path -LiteralPath $NodeExecutable -PathType Leaf))) { throw 'Repair health requires the exact coordinator-verified Node executable' }
Add-Type -Path (Join-Path $PSScriptRoot 'WindowsInstallWindow.cs')
if (Test-Path -LiteralPath $EvidenceDirectory) { throw 'Evidence directory must be new' }
New-Item -ItemType Directory $EvidenceDirectory | Out-Null
$record=[ordered]@{schema=1;status='running';sourceSha=$SourceSha;variant=$Variant;accountSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;phases=@();guiAcceptance='window-smoke-only';dualAccount='not-run';missingRuntime='not-run';offlineRuntimeProvisioning='not-run';upgrade='not-run';rollback='not-implemented';wordTablePaste='not-run';nativeIme='not-run';installedDelayedCaret='not-run';sameVersionRepair='not-run';signedRecovery='not-run-channel-unconfigured';recoveryHealth='not-run';forcedCleanup=$false}
function Persist { $record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'installation.json') -Encoding utf8 }
function Phase([string]$Name,$Detail) { $record.phases+=@{name=$Name;utc=[DateTime]::UtcNow.ToString('o');detail=$Detail}; Persist }
function OwnedMaintenance([string]$File,[string[]]$Arguments) {
  $p=Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  Phase 'maintenance-start' @{image=$File;pid=$p.Id;creationUtc=$p.StartTime.ToUniversalTime().ToString('o');arguments=$Arguments}
  if (!$p.WaitForExit(120000)) { throw 'Native maintenance exceeded 120 seconds' }
  Phase 'maintenance-exit' @{image=$File;exitCode=$p.ExitCode}
  if ($p.ExitCode -ne 0) { throw 'Native maintenance failed' }
}
function VerifyOwnedStartupAndClose([string]$Prefix,[string]$WindowKey) {
  $startup=[Diagnostics.Stopwatch]::StartNew()
  $launch=@{FilePath=$binary;ArgumentList=@($document);PassThru=$true}
  if ($RepairHealth) { $launch.Environment=@{WEBVIEW2_USER_DATA_FOLDER=$healthProfile;WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$debugPort --remote-debugging-address=127.0.0.1";TAURI_WEBVIEW_AUTOMATION='true'} }
  $script:product=Start-Process @launch
  $creation=$product.StartTime.ToUniversalTime().ToString('o')
  $creationTicks=$product.StartTime.ToUniversalTime().Ticks
  Phase ($Prefix + 'application-start') @{pid=$product.Id;creationUtc=$creation;image=$binary;debugPort=$debugPort;healthProfile=$healthProfile}
  $deadline=[DateTime]::UtcNow.AddSeconds(45)
  $record[$WindowKey]=@()
  $lastWindows=$null
  $window=$null
  do {
    $product.Refresh()
    if ($product.HasExited) { throw 'Application exited before visible window' }
    $windows=@([MilkupInstallWindow]::Observe($product.Id,$creationTicks,$binary))
    $snapshot=ConvertTo-Json -InputObject $windows -Depth 4 -Compress
    if ($snapshot -cne $lastWindows) {
      if ($record[$WindowKey].Count -ge 128) { throw 'Window startup evidence exceeded its budget' }
      $record[$WindowKey]+=@{elapsedMs=$startup.Elapsed.TotalMilliseconds;windows=$windows}
      $lastWindows=$snapshot
      Persist
    }
    $roots=@($windows | Where-Object { $_.productRoot })
    if ($roots.Count -gt 1) { throw 'Ambiguous visible Tauri main window' }
    if ($roots.Count -eq 1) { $window=$roots[0]; break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($null -eq $window) { throw 'No unique visible Tauri main window within 45 seconds' }
  if (![StringComparer]::OrdinalIgnoreCase.Equals($product.Path,$binary) -or $product.StartTime.ToUniversalTime().ToString('o') -cne $creation) { throw 'Owned application identity mismatch' }
  $startup.Stop()
  Phase ($Prefix + 'native-window-observed') @{hwnd=$window.hwnd;title=$window.title;className=$window.className;image=$product.Path;creationUtc=$creation;launchToNativeWindowMs=$startup.Elapsed.TotalMilliseconds;measurementBoundary='unique visible Tauri window only; not first paint, Mermaid ready or interactive'}
  $healthSession=$null
  if ($RepairHealth) {
    $healthPhase=if ($Prefix) {'after'} else {'before'}
    $healthRun=[WindowsMermaidStandardUser]::RunNodeScript(
      $NodeExecutable,
      [string[]]@((Join-Path $PSScriptRoot 'repair-health.mjs'),$healthPhase,$driverPort,$debugPort,$document,$EvidenceDirectory,$DocumentHealth.ToString().ToLowerInvariant(),$product.Id,$creationTicks,$binary),
      $PSScriptRoot,(Join-Path $EvidenceDirectory "health-$healthPhase.stdout.log"),(Join-Path $EvidenceDirectory "health-$healthPhase.stderr.log"),190000)
    Phase ($Prefix + 'health-node-exit') $healthRun
    if ($healthRun.status -cne 'passed') {
      try {
        $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($product.Id)" | Select-Object -First 16 | ForEach-Object { @{pid=$_.ProcessId;parentPid=$_.ParentProcessId;image=$_.ExecutablePath;creation=$_.CreationDate;hasExpectedDebugPort=($_.CommandLine -match ("--remote-debugging-port=" + $debugPort + '(\s|$)'));hasExpectedProfile=($_.CommandLine -like ('*' + $healthProfile + '*'))} })
        Phase ($Prefix + 'health-failure-child-diagnostics') $children
      } catch { Phase ($Prefix + 'health-diagnostics-error') @{error=$_.Exception.Message} }
      throw "Real installed repair health failed: $healthPhase"
    }
    $health=Get-Content -LiteralPath (Join-Path $EvidenceDirectory "repair-health-$healthPhase.json") -Raw | ConvertFrom-Json
    if ($health.status -cne 'passed' -or !$health.sessionId -or !$health.saved.sha256) { throw 'Complete repair health evidence required' }
    $healthSession=$health.sessionId
    $script:documentHash=(Get-FileHash -LiteralPath $document -Algorithm SHA256).Hash
    if ($script:documentHash.ToLowerInvariant() -cne $health.saved.sha256) { throw 'Health saved document mismatch' }
    Phase ($Prefix + 'real-document-plugin-health') @{report="repair-health-$healthPhase.json";savedSha256=$health.saved.sha256;pluginBefore=$health.pluginBefore.checked;pluginAfter=$health.pluginAfter.checked}
  }
  if ($DocumentHealth -and $Prefix) {
    if ($health.documentHealth.status -cne 'passed-ui-await-native-exit-and-pdf-audit' -or !$health.documentHealth.close.saveRequested) { throw 'Document close-save UI proof required' }
    Phase 'document-health-await-normal-close' @{report='installed-document-health.json';closeRequestedByRealUi=$true;pdfTextAudit='pending'}
  } else { [MilkupInstallWindow]::Close($window.hwnd,$product.Id,$creationTicks,$binary) }
  if (!$product.WaitForExit(15000)) { throw 'Application did not close normally within 15 seconds' }
  if ($product.ExitCode -ne 0) { throw 'Application close was not successful' }
  Phase ($Prefix + 'normal-close') @{exitCode=$product.ExitCode}
  if ($healthSession) {
    try { $null=Invoke-RestMethod -Uri "http://127.0.0.1:$driverPort/session/$healthSession" -Method Delete -TimeoutSec 10 }
    catch { Phase ($Prefix + 'driver-detach-diagnostic') @{error=$_.Exception.Message;afterNormalProductExit=$true} }
  }
}
$product=$null
$healthDriver=$null
function FreeLocalPort {
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
  try { $listener.Start(); return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}
try {
  # Presence is diagnostic only: Office 16 also includes newer Office editions,
  # and an installed language does not prove that a real IME composition worked.
  $environment=[ordered]@{wordExecutables=@();inputLanguages=@();errors=@()}
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (!$base) { continue }
    foreach ($suffix in @('Microsoft Office/root/Office16/WINWORD.EXE','Microsoft Office/Office16/WINWORD.EXE')) {
      $word=Join-Path $base $suffix
      if (Test-Path -LiteralPath $word -PathType Leaf) {
        $version=(Get-Item -LiteralPath $word).VersionInfo
        $environment.wordExecutables+=@{path=$word;fileVersion=$version.FileVersion;productVersion=$version.ProductVersion}
      }
    }
  }
  try {
    $environment.inputLanguages=@(Get-WinUserLanguageList | Select-Object -First 16 | ForEach-Object { @{languageTag=$_.LanguageTag;inputMethodTips=@($_.InputMethodTips)} })
  } catch { $environment.errors+=('input-language-probe: ' + $_.Exception.Message) }
  Phase 'available-input-and-office-environment' $environment
  if ($RepairHealth) {
    if (-not ('WindowsMermaidStandardUser' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot '../ci/WindowsMermaidStandardUser.cs') }
    $healthHost=[WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($PID))[0]
    Phase 'health-host-token' $healthHost
    if (!$healthHost.ContainsKey('token') -or $healthHost.token.elevated -ne $false -or $healthHost.token.integrityRid -ne 8192) {
      $record['healthEnvironmentBlocked']='Requires an observed medium-integrity coordinator; WebView2 Runtime 150+ drops environment debug overrides in an elevated host'
      throw $record.healthEnvironmentBlocked
    }
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
  }
  if ($RepairHealth) {
    $receiptFile=Join-Path $EvidenceDirectory 'verified-receipt.json'
    $receiptRun=[WindowsMermaidStandardUser]::RunNodeScript(
      $NodeExecutable,
      [string[]]@((Join-Path $PSScriptRoot 'verify-candidate.mjs'),$Directory,$SourceSha,$Variant),
      $PSScriptRoot,$receiptFile,(Join-Path $EvidenceDirectory 'receipt.stderr.log'),30000)
    Phase 'receipt-verifier-exit' $receiptRun
    if ($receiptRun.status -cne 'passed' -or (Get-Item -LiteralPath $receiptFile).Length -gt 64KB) { throw 'Bounded installer receipt verification failed' }
    $raw=Get-Content -LiteralPath $receiptFile -Raw
  } else {
    $raw=& node scripts/release/verify-candidate.mjs $Directory $SourceSha $Variant
    if ($LASTEXITCODE -ne 0) { throw 'Installer receipt verification failed' }
  }
  $receipt=$raw | ConvertFrom-Json
  $record['receipt']=$receipt
  $install=Join-Path $env:RUNNER_TEMP "milkup-install-$Variant"
  if ((Test-Path -LiteralPath $install) -or $install -match '\s') { throw 'Install path must be new and unambiguous' }
  Phase 'verified-installer' $receipt.installer
  OwnedMaintenance $receipt.installer.path @('/S',"/D=$install")
  $binary=Join-Path $install 'milkup-desktop.exe'
  if (!(Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'Installed application missing' }
  $record['installedBinary']=@{path=$binary;sha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant();version=(Get-Item -LiteralPath $binary).VersionInfo.FileVersion}
  $document=Join-Path $EvidenceDirectory 'unchanged-document.md'
  [IO.File]::WriteAllText($document,"# Installed candidate`n`n中文与 emoji 😀`n",[Text.UTF8Encoding]::new($false))
  if ($RepairHealth) {
    $healthText=@('# Installed repair health','','中文与 emoji 😀','','```mermaid','flowchart LR',' A[Before] --> B[After]','```','','Outside diagram','') -join "`n"
    [IO.File]::WriteAllText($document,$healthText,[Text.UTF8Encoding]::new($false))
  }
  $documentHash=(Get-FileHash -LiteralPath $document -Algorithm SHA256).Hash
  VerifyOwnedStartupAndClose '' 'startupWindows'
  if ($RepairSameVersion) {
    # This intentionally damages only our fresh ephemeral installation, after
    # normal process exit, retaining the original bytes as failure evidence.
    # It is not signed recovery authorization or a user-data migration test.
    if (!$product.HasExited -or $product.ExitCode -ne 0) { throw 'Repair requires normal prior exit' }
    $backup=Join-Path $env:RUNNER_TEMP "milkup-repair-original-$Variant.bin"
    if (Test-Path -LiteralPath $backup) { throw 'Repair backup must be new' }
    Copy-Item -LiteralPath $binary -Destination $backup
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant() -cne $record.installedBinary.sha256) { throw 'Repair backup identity mismatch' }
    # Revalidate original installer bytes immediately before repair; do not use
    # the quarantined executable or a different rebuilt installer as repair input.
    if ((Get-FileHash -LiteralPath $receipt.installer.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $receipt.installer.sha256) { throw 'Repair installer changed' }
    Remove-Item -LiteralPath $binary
    if (Test-Path -LiteralPath $binary) { throw 'Missing-file fault was not established' }
    Phase 'repair-missing-application-established' @{missingPath=$binary;backupSha256=$record.installedBinary.sha256;installerSha256=$receipt.installer.sha256;documentSha256=$documentHash.ToLowerInvariant()}
    OwnedMaintenance $receipt.installer.path @('/S',"/D=$install")
    if (!(Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'Same-version repair did not restore application' }
    $repairedHash=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($repairedHash -cne $record.installedBinary.sha256) { throw 'Repair did not restore exact original executable' }
    if ((Get-FileHash -LiteralPath $document -Algorithm SHA256).Hash -cne $documentHash) { throw 'Repair changed fixture document' }
    Phase 'repair-exact-application-restored' @{sha256=$repairedHash;documentUnchanged=$true}
    VerifyOwnedStartupAndClose 'repair-' 'repairStartupWindows'
    $record.sameVersionRepair='exact-binary-and-window-close-passed'
    $record.recoveryHealth=if ($RepairHealth) {'real-edit-save-and-persisted-diagrams-switch-passed; not all configuration or migration health'} else {'native-window-only; document-open-edit-save and plugin/config restoration not verified'}
    # Retain hash/receipt evidence, not an extra runnable application artifact.
    Remove-Item -LiteralPath $backup
  }
  if ($StartupComparison) {
    & (Join-Path $PSScriptRoot 'startup-comparison.ps1') -Binary $binary -Document $document -EvidenceDirectory $EvidenceDirectory -NodeExecutable $NodeExecutable -DriverPort $driverPort -RuntimeVersion $runtime.Name -SourceSha $SourceSha
    Phase 'installed-startup-comparison' @{report='startup-comparison.json';completed=$true;inputs=0}
  }
  $uninstaller=Join-Path $install 'uninstall.exe'
  $copy=Join-Path $EvidenceDirectory 'owned-uninstaller.exe'
  Copy-Item -LiteralPath $uninstaller -Destination $copy
  if ((Get-FileHash $copy).Hash -cne (Get-FileHash $uninstaller).Hash) { throw 'Uninstaller copy mismatch' }
  OwnedMaintenance $copy @('/S',"_?=$install")
  if (Test-Path -LiteralPath $binary) { throw 'Application still installed after uninstall' }
  if ((Get-FileHash -LiteralPath $document -Algorithm SHA256).Hash -cne $documentHash) { throw 'Fixture document changed' }
  Remove-Item -LiteralPath $copy
  Phase 'uninstall-and-document-preservation' @{applicationRemoved=$true;documentSha256=$documentHash.ToLowerInvariant()}
  $record.status='passed'
} catch {
  $record.status='failed'; $record['error']=$_ | Out-String; throw
} finally {
  # A failure is never converted into normal product cleanup or a passing close.
  if ($null -ne $product -and !$product.HasExited) {
    $record.forcedCleanup=$true
    try { $product.Kill($true); $null=$product.WaitForExit(5000) } catch { $record['cleanupError']=$_ | Out-String }
  }
  if ($null -ne $healthDriver -and !$healthDriver.HasExited) {
    try {
      $healthDriver.Refresh()
      if ($healthDriver.StartTime.ToUniversalTime().Ticks -ne $driverBirth -or ![StringComparer]::OrdinalIgnoreCase.Equals($healthDriver.Path,$driverExe)) { throw 'Driver cleanup identity mismatch' }
      $healthDriver.Kill(); if (!$healthDriver.WaitForExit(5000)) { throw 'Owned driver did not exit' }
    } catch { $record.status='failed'; $record['driverCleanupError']=$_ | Out-String; Persist; throw }
  }
  Persist
}
