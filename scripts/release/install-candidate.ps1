# Run only on an ephemeral hosted Windows runner. This is a single runner-account
# install/window/close/uninstall smoke test, not dual-account or missing-Runtime acceptance.
param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][string]$SourceSha,[Parameter(Mandatory=$true)][string]$Variant,[Parameter(Mandatory=$true)][string]$EvidenceDirectory,[switch]$RepairSameVersion)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows') { throw 'Requires ephemeral Windows Actions runner' }
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
  $script:product=Start-Process -FilePath $binary -ArgumentList @($document) -PassThru
  $creation=$product.StartTime.ToUniversalTime().ToString('o')
  $creationTicks=$product.StartTime.ToUniversalTime().Ticks
  Phase ($Prefix + 'application-start') @{pid=$product.Id;creationUtc=$creation;image=$binary}
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
  [MilkupInstallWindow]::Close($window.hwnd,$product.Id,$creationTicks,$binary)
  if (!$product.WaitForExit(15000)) { throw 'Application did not close normally within 15 seconds' }
  if ($product.ExitCode -ne 0) { throw 'Application close was not successful' }
  Phase ($Prefix + 'normal-close') @{exitCode=$product.ExitCode}
}
$product=$null
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
  $raw=& node scripts/release/verify-candidate.mjs $Directory $SourceSha $Variant
  if ($LASTEXITCODE -ne 0) { throw 'Installer receipt verification failed' }
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
    $record.recoveryHealth='native-window-only; document-open-edit-save and plugin/config restoration not verified'
    # Retain hash/receipt evidence, not an extra runnable application artifact.
    Remove-Item -LiteralPath $backup
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
  Persist
}
