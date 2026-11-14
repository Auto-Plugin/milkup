# Read exact installed/uninstall identity; optional backup copies only this new
# test account's document/application data. Never restore or rewrite user data.
param(
 [Parameter(Mandatory)][string]$InstallDirectory,
 [Parameter(Mandatory)][string]$Binary,
 [Parameter(Mandatory)][string]$Version,
 [Parameter(Mandatory)][string]$Document,
 [Parameter(Mandatory)][string]$EvidenceDirectory,
 [Parameter(Mandatory)][ValidateSet('before-upgrade','after-upgrade','before-recovery','after-recovery','after-uninstall')][string]$Label,
 [switch]$Backup,[switch]$Uninstalled
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'cross-version-path.ps1')
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:GITHUB_REF -cne 'refs/heads/dot/gap-native-capabilities-20261114') { throw 'Exact isolated native acceptance required' }
$report=[ordered]@{status='failed';label=$Label;version=$Version;uninstalled=[bool]$Uninstalled;uninstallEntries=@();backup=$null}
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Plain([string]$Path) {
 $item=Get-Item -LiteralPath $Path -Force
 do { if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point rejected' };$item=if($item -is [IO.DirectoryInfo]){$item.Parent}else{$item.Directory} } while($null -ne $item)
}
try {
 Plain $Document
 $report['documentSha256']=Hash $Document
 foreach($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
  if (!(Test-Path -LiteralPath $root)) { continue }
  foreach($key in Get-ChildItem -LiteralPath $root) {
   $value=Get-ItemProperty -LiteralPath $key.PSPath
   if (!$value.PSObject.Properties['InstallLocation'] -or !$value.InstallLocation) { continue }
   $location=ConvertFrom-NsisInstallLocation $value.InstallLocation
   if (![StringComparer]::OrdinalIgnoreCase.Equals($location,$InstallDirectory.TrimEnd('\'))) { continue }
   $report.uninstallEntries+=@{key=$key.Name;displayName=$value.DisplayName;displayVersion=$value.DisplayVersion;installLocation=$value.InstallLocation;normalizedInstallLocation=$location;uninstallString=$value.UninstallString}
  }
 }
 if ($Uninstalled) {
  if ((Test-Path -LiteralPath $Binary) -or $report.uninstallEntries.Count -ne 0) { throw 'Installed image or matching uninstall entry remained' }
 } else {
  Plain $Binary
  $resource=(Get-Item -LiteralPath $Binary).VersionInfo
  $report['binary']=@{sha256=(Hash $Binary);productVersion=$resource.ProductVersion;fileVersion=$resource.FileVersion}
  if ($resource.ProductVersion -cne $Version -or $report.uninstallEntries.Count -ne 1 -or $report.uninstallEntries[0].displayVersion -cne $Version) { throw 'Exact binary and unique uninstall version required' }
 }
 if ($Backup) {
  $target=Join-Path $EvidenceDirectory 'owned-data-backup'
  if (Test-Path -LiteralPath $target) { throw 'Backup must be new' }
  $null=New-Item -ItemType Directory $target
  $rows=@();[long]$bytes=0
  $roots=@{document=$Document;roaming=(Join-Path $env:APPDATA 'app.milkup.desktop');local=(Join-Path $env:LOCALAPPDATA 'app.milkup.desktop')}
  if ($healthProfile) { $roots['browser']=$healthProfile }
  foreach($name in $roots.Keys) {
   $source=$roots[$name]
   if (!(Test-Path -LiteralPath $source)) { continue }
   Plain $source
   $isFile=Test-Path -LiteralPath $source -PathType Leaf
   $items=@(if($isFile){Get-Item -LiteralPath $source}else{Get-ChildItem -LiteralPath $source -Recurse -Force})
   if($items.Count -gt 8192){throw 'Backup entry bound exceeded'}
   foreach($item in $items) {
    Plain $item.FullName
    if($item.PSIsContainer){continue}
    $bytes+=$item.Length
    if ($rows.Count -ge 8192 -or $bytes -gt 256MB) { throw 'Backup byte/count bound exceeded' }
    $relative=if($isFile){$item.Name}else{[IO.Path]::GetRelativePath($source,$item.FullName)}
    $destination=Join-Path (Join-Path $target $name) $relative
    $null=New-Item -ItemType Directory -Force (Split-Path -Parent $destination)
    $before=Hash $item.FullName
    Copy-Item -LiteralPath $item.FullName -Destination $destination
    if ((Hash $destination) -cne $before -or (Hash $item.FullName) -cne $before) { throw 'Backup source/copy changed' }
    $rows+=@{root=$name;relative=$relative;bytes=$item.Length;sha256=$before}
   }
  }
  if (!@($rows | Where-Object {$_.root -cin @('roaming','local')}).Count) { throw 'No application configuration captured' }
  $report.backup=@{status='copied-and-hash-verified';bytes=$bytes;files=$rows;restored=$false;scope='Owned test document, application config and custom WebView profile only; no arbitrary-user compatibility claim'}
 }
 if ($Label -cin @('after-recovery','after-uninstall')) {
  $config=@();[long]$configBytes=0
  foreach($entry in @(@{name='roaming';path=(Join-Path $env:APPDATA 'app.milkup.desktop')},@{name='local';path=(Join-Path $env:LOCALAPPDATA 'app.milkup.desktop')})) {
   if (!(Test-Path -LiteralPath $entry.path)) { continue }
   Plain $entry.path
   foreach($item in @(Get-ChildItem -LiteralPath $entry.path -Recurse -Force)) {
    Plain $item.FullName
    if($item.PSIsContainer){continue}
    $configBytes+=$item.Length
    if ($config.Count -ge 8192 -or $configBytes -gt 256MB) { throw 'Configuration evidence bound exceeded' }
    $config+=@{root=$entry.name;relative=[IO.Path]::GetRelativePath($entry.path,$item.FullName);bytes=$item.Length;sha256=(Hash $item.FullName)}
   }
  }
  if (!$config.Count) { throw 'Application configuration unexpectedly absent' }
  $report['configurationFiles']=@($config | Sort-Object { $_.root + '/' + $_.relative })
  if ($Uninstalled) {
   $prior=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'cross-version-after-recovery.json') -Raw | ConvertFrom-Json
   $expected=@($prior.configurationFiles | ForEach-Object { $_.root+'|'+$_.relative+'|'+$_.bytes+'|'+$_.sha256 })
   $actual=@($report.configurationFiles | ForEach-Object { $_.root+'|'+$_.relative+'|'+$_.bytes+'|'+$_.sha256 })
   if (($expected -join "`n") -cne ($actual -join "`n")) { throw 'Uninstall changed retained application configuration bytes' }
   $report['configurationPreservedAfterUninstall']=$true
  }
 }
 $report.status='passed'
} catch { $report['error']=$_ | Out-String;throw } finally {
 $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory ('cross-version-'+$Label+'.json')) -Encoding utf8
}
