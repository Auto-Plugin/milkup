# Dot-sourced only by the owned ordinary-user install harness. Reuses its strict
# process/window identity, driver, maintenance and normal-close helpers.
function InvokeInAppUpdate {
 if (!$RepairHealth -or $RepairSameVersion -or $SignedRecovery -or $CrossVersionDirectory -or !$InAppUpdateFixtureDirectory) { throw 'Dedicated in-app acceptance only' }
 $fixture=Get-Content -LiteralPath (Join-Path $InAppUpdateFixtureDirectory 'fixture-manifest.json') -Raw | ConvertFrom-Json
 $fixtureBinary=Join-Path $InAppUpdateFixtureDirectory 'milkup-desktop.exe'
 if ($fixture.sourceSha -cne 'dea1f2a437e43303f185d47ad2014156038d8514' -or $fixture.feature -cne 'ci-update-fixture' -or $fixture.version -cne '2.0.0-beta.10' -or (Get-FileHash -LiteralPath $fixtureBinary -Algorithm SHA256).Hash.ToLowerInvariant() -cne $fixture.sha256) { throw 'Exact instrumented fixture required' }
 # The installed resources remain the exact b877 package. Only this temporary
 # installation receives the explicitly recorded feature binary, before launch.
 Copy-Item -LiteralPath $fixtureBinary -Destination $binary -Force
 if ((Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() -cne $fixture.sha256) { throw 'Fixture copy mismatch' }
 $record['inAppFixture']=$fixture
 $targetReceiptFile=Join-Path $EvidenceDirectory 'in-app-target-receipt.json'
 $verified=[WindowsMermaidStandardUser]::RunNodeScript($NodeExecutable,[string[]]@((Join-Path $PSScriptRoot 'verify-candidate.mjs'),$InAppUpdateDirectory,'5fd33f2b63de2755268af6d669b0f4b3b1f21b96',$Variant),$PSScriptRoot,$targetReceiptFile,(Join-Path $EvidenceDirectory 'target.stderr.log'),30000)
 if ($verified.status -cne 'passed') { throw 'Target receipt invalid' }
 $target=Get-Content -LiteralPath $targetReceiptFile -Raw | ConvertFrom-Json
 if ($target.version -cne '2.0.0-beta.11' -or $target.installer.sha256 -cne 'e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75') { throw 'Exact existing target required' }
 $record['inAppTarget']=$target
 $currentShell=[WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($PID))[0]
 $pwsh=$currentShell.image
 if (![IO.Path]::IsPathFullyQualified($pwsh) -or ![StringComparer]::OrdinalIgnoreCase.Equals($pwsh,(Join-Path $PSHOME 'pwsh.exe')) -or !$currentShell.stillActive) {throw 'Exact current PowerShell image required'}
 Phase 'in-app-certificate-tool' @{path=$pwsh;sha256=(Get-FileHash -LiteralPath $pwsh -Algorithm SHA256).Hash.ToLowerInvariant();processIdentity=$currentShell}
 $endpoint=$null;$oldFixtureEnvironment=$env:MILKUP_CI_UPDATE_FIXTURE
 try {
  # Paths are owned, quote-free Windows paths; no user command text is interpolated.
  $arguments=@((Join-Path $PSScriptRoot 'test-support/in-app-update-server.mjs'),$EvidenceDirectory,$target.installer.path,$pwsh)
  if (@($arguments | Where-Object {$_ -match '["\r\n]'}).Count) { throw 'Ambiguous process arguments' }
  $endpoint=Start-Process -FilePath $NodeExecutable -ArgumentList ($arguments | ForEach-Object {'"'+$_+'"'}) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDirectory 'endpoint.stdout.log') -RedirectStandardError (Join-Path $EvidenceDirectory 'endpoint.stderr.log')
  $endpointBirth=$endpoint.StartTime.ToUniversalTime().Ticks
  $env:MILKUP_CI_UPDATE_FIXTURE=Join-Path $EvidenceDirectory 'public-fixture.json'
  $until=[DateTime]::UtcNow.AddSeconds(25)
  while (!(Test-Path -LiteralPath $env:MILKUP_CI_UPDATE_FIXTURE) -and [DateTime]::UtcNow -lt $until -and !$endpoint.HasExited) { Start-Sleep -Milliseconds 100 }
  if (!(Test-Path -LiteralPath $env:MILKUP_CI_UPDATE_FIXTURE) -or $endpoint.HasExited) { throw 'Scoped HTTPS endpoint unavailable' }
  VerifyOwnedStartupAndClose '' 'startupWindows'
  $launch=@{FilePath=$binary;ArgumentList=@($document);PassThru=$true;Environment=@{WEBVIEW2_USER_DATA_FOLDER=$healthProfile;WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$debugPort --remote-debugging-address=127.0.0.1";TAURI_WEBVIEW_AUTOMATION='true'}}
  $script:product=Start-Process @launch
  $oldPid=$product.Id;$oldBirth=$product.StartTime.ToUniversalTime().Ticks
  $oldIdentity=[WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($oldPid))[0]
  if ($oldIdentity.token.sid -cne $record.accountSid -or ![WindowsMermaidStandardUser]::MatchesExpectedAccountKind($oldIdentity.token,'pure-standard')) {throw 'Old application token mismatch'}
  Phase 'in-app-old-process' @{pid=$oldPid;creationTicks=$oldBirth.ToString([Globalization.CultureInfo]::InvariantCulture);identity=$oldIdentity;image=$binary;sha256=$fixture.sha256}
  $ui=[WindowsMermaidStandardUser]::RunNodeScript($NodeExecutable,[string[]]@((Join-Path $PSScriptRoot 'in-app-update-ui.mjs'),$driverPort,$debugPort,$document,$EvidenceDirectory,$binary),$PSScriptRoot,(Join-Path $EvidenceDirectory 'in-app-ui.stdout.log'),(Join-Path $EvidenceDirectory 'in-app-ui.stderr.log'),190000)
  Phase 'in-app-ui-exit' $ui
  if ($ui.status -cne 'passed') { throw 'Real in-app update UI failed' }
  $uiProof=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'in-app-update-ui.json') -Raw | ConvertFrom-Json
  if ($uiProof.status -cne 'passed-ui-await-native-restart' -or $uiProof.cases.Count -ne 3 -or @($uiProof.cases | Where-Object {$_.oldImageSha256 -cne $fixture.sha256}).Count) { throw 'Negative cases did not preserve exact old binary' }
  if (!$product.WaitForExit(60000) -or $product.ExitCode -ne 0) { throw 'Updater did not normally exit old application' }
  Phase 'in-app-old-normal-exit' @{pid=$oldPid;creationTicks=$oldBirth.ToString([Globalization.CultureInfo]::InvariantCulture);exitCode=$product.ExitCode}
  try { $null=Invoke-RestMethod -Uri "http://127.0.0.1:$driverPort/session/$($uiProof.sessionId)" -Method Delete -TimeoutSec 10 } catch { Phase 'in-app-old-detach' @{error=$_.Exception.Message} }
  $restart=$null;$until=[DateTime]::UtcNow.AddSeconds(120)
  do {
   $matches=@(Get-Process -Name 'milkup-desktop' -ErrorAction SilentlyContinue | Where-Object {try { [StringComparer]::OrdinalIgnoreCase.Equals($_.Path,$binary) -and $_.StartTime.ToUniversalTime().Ticks -gt $oldBirth } catch {$false}})
   if ($matches.Count -gt 1) { throw 'Ambiguous restarted application' }
   if ($matches.Count -eq 1) {$restart=$matches[0];break}
   Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $until)
  if ($null -eq $restart) { throw 'No automatic application restart; no test relaunch fallback' }
  $restartIdentity=[WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($restart.Id))[0]
  if ($restartIdentity.token.sid -cne $record.accountSid -or ![WindowsMermaidStandardUser]::MatchesExpectedAccountKind($restartIdentity.token,'pure-standard')) {throw 'Restarted token mismatch'}
  $newHash=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($newHash -cne 'b129fd49f988eb700db8e606990c7c1f00be92b3fab0d99b4f1bf7070a6c82f6') { throw 'Restarted image is not exact accepted beta.11 target' }
  Phase 'in-app-automatic-restart' @{identity=$restartIdentity;pid=$restart.Id;creationTicks=$restart.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);image=$binary;sha256=$newHash;productVersion=(Get-Item -LiteralPath $binary).VersionInfo.ProductVersion;harnessStartedNewProcess=$false}
  & (Join-Path $PSScriptRoot 'cross-version-state.ps1') -InstallDirectory $install -Binary $binary -Version '2.0.0-beta.11' -Document $document -EvidenceDirectory $EvidenceDirectory -Label 'after-upgrade'
  VerifyOwnedStartupAndClose 'in-app-restarted-' 'inAppRestartWindows' 'upgrade' $restart
  & (Join-Path $PSScriptRoot 'cross-version-state.ps1') -InstallDirectory $install -Binary $binary -Version '2.0.0-beta.11' -Document $document -EvidenceDirectory $EvidenceDirectory -Label 'after-in-app-health'
  $documentHash=(Get-FileHash -LiteralPath $document -Algorithm SHA256).Hash
  $uninstaller=Join-Path $install 'uninstall.exe';$copy=Join-Path $EvidenceDirectory 'owned-uninstaller.exe'
  Copy-Item -LiteralPath $uninstaller -Destination $copy
  if ((Get-FileHash -LiteralPath $copy).Hash -cne (Get-FileHash -LiteralPath $uninstaller).Hash) {throw 'Uninstaller copy mismatch'}
  OwnedMaintenance $copy @('/S',"_?=$install")
  if ((Test-Path -LiteralPath $binary) -or (Get-FileHash -LiteralPath $document -Algorithm SHA256).Hash -cne $documentHash) {throw 'Test cleanup changed document or left application'}
  & (Join-Path $PSScriptRoot 'cross-version-state.ps1') -InstallDirectory $install -Binary $binary -Version '2.0.0-beta.11' -Document $document -EvidenceDirectory $EvidenceDirectory -Label 'after-uninstall' -Uninstalled -PriorConfigurationLabel 'after-in-app-health'
  Remove-Item -LiteralPath $copy
  $record['inAppUpdate']='real-check-download-verify-protected-save-install-automatic-restart-and-health-passed'
  $record.status='passed'
 } finally {
  $env:MILKUP_CI_UPDATE_FIXTURE=$oldFixtureEnvironment
  if ($null -ne $endpoint) {
   [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'endpoint-stop'),'stop')
   if (!$endpoint.WaitForExit(10000)) {
    $record.status='failed';$record['endpointForcedCleanup']=$true
    if ($endpoint.StartTime.ToUniversalTime().Ticks -ne $endpointBirth -or ![StringComparer]::OrdinalIgnoreCase.Equals($endpoint.Path,$NodeExecutable)) {throw 'Endpoint identity changed'}
    $endpoint.Kill();$null=$endpoint.WaitForExit(5000)
    throw 'Endpoint did not stop normally'
   }
   if ($endpoint.ExitCode -ne 0) {$record.status='failed';throw 'Endpoint process failed'}
  }
  Persist
 }
}
