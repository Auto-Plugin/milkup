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
   $location=[IO.Path]::GetFullPath($value.InstallLocation).TrimEnd('\')
   if (![StringComparer]::OrdinalIgnoreCase.Equals($location,$InstallDirectory.TrimEnd('\'))) { continue }
   $report.uninstallEntries+=@{key=$key.Name;displayName=$value.DisplayName;displayVersion=$value.DisplayVersion;installLocation=$value.InstallLocation;uninstallString=$value.UninstallString}
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
   $items=if($isFile){@(Get-Item -LiteralPath $source)}else{@(Get-ChildItem -LiteralPath $source -Recurse -Force)}
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
 $report.status='passed'
} catch { $report['error']=$_ | Out-String;throw } finally {
 $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory ('cross-version-'+$Label+'.json')) -Encoding utf8
}
