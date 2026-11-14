[CmdletBinding()]
param([Parameter(Mandatory)][string]$EvidenceDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or $env:GITHUB_REF -cne 'refs/heads/dot/print-queue-acceptance-20261114') { throw 'Exact isolated Windows runner required' }
New-Item -ItemType Directory -Path $EvidenceDirectory -ErrorAction Stop | Out-Null
$r=[ordered]@{schema=1;purpose='read-only print capability preflight';sourceSha=$env:GITHUB_SHA;applicationBaseline='b877746f5dfd236dfc13f718ed23d837b8e4f89d';status='failed';startedUtc=[datetime]::UtcNow.ToString('o');imageVersion=$env:ImageVersion;queueCreated=$false;jobSubmitted=$false;defaultPrinterChanged=$false;securitySettingsChanged=$false;driverInstalled=$false;physicalPrintAccepted=$false}
try {
 $service=Get-Service -Name Spooler
 $r.spooler=@{status=[string]$service.Status;startType=[string]$service.StartType}
 $r.commands=@(Get-Command Get-Printer,Get-PrinterDriver,Get-PrinterPort,Add-Printer,Add-PrinterDriver,Add-PrinterPort,Get-PrintJob,Remove-PrintJob -ErrorAction Stop | ForEach-Object {$_.Name})
 if ($service.Status -ne 'Running') { throw 'Spooler is not running; no service or policy changes authorized by this probe' }
 $printers=@(Get-Printer)
 if($printers.Count -gt 64){throw 'Printer inventory budget'}
 $r.printers=@($printers | Select-Object Name,DriverName,PortName,Shared,Type,PrinterStatus)
 $r.defaultPrinters=@(Get-CimInstance Win32_Printer | Where-Object Default | Select-Object -ExpandProperty Name)
 $drivers=@(Get-PrinterDriver)
 if($drivers.Count -gt 128){throw 'Driver inventory budget'}
 $r.installedDrivers=@($drivers | Select-Object Name,Manufacturer,InfPath,PrinterEnvironment,MajorVersion)
 $r.ports=@(Get-PrinterPort | Select-Object Name,Description,PortMonitor)
 if($r.ports.Count -gt 128){throw 'Port inventory budget'}
 $inbox=@(Get-WindowsDriver -Online -All | Where-Object {$_.ClassName -ceq 'Printer' -and $_.Inbox -eq $true -and $_.ProviderName -match '^Microsoft'} | Select-Object -First 64)
 $r.inboxPrinterPackages=@($inbox | Select-Object Driver,OriginalFileName,ProviderName,Inbox,ClassName,Version)
 $r.inboxGenericTextDefinitions=@()
 foreach($package in $inbox){
  $inf=[string]$package.OriginalFileName
  if(![IO.Path]::IsPathFullyQualified($inf) -or !$inf.StartsWith((Join-Path $env:SystemRoot 'System32/DriverStore/'),[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $inf -PathType Leaf)){continue}
  if((Get-Item -LiteralPath $inf).Length -gt 4MB){continue}
  if(Select-String -LiteralPath $inf -SimpleMatch 'Generic / Text Only' -Quiet){$r.inboxGenericTextDefinitions+=@{path=$inf;sha256=(Get-FileHash $inf).Hash.ToLowerInvariant();provider=$package.ProviderName;inbox=$package.Inbox}}
 }
 $r.status='queried'
} catch {$r.error=$_.Exception.Message;$r.errorType=$_.Exception.GetType().FullName}
finally {$r.finishedUtc=[datetime]::UtcNow.ToString('o');$r|ConvertTo-Json -Depth 10|Set-Content (Join-Path $EvidenceDirectory 'print-capabilities.json') -Encoding utf8}
if($r.status -cne 'queried'){throw 'Read-only print capability preflight failed; see retained exact evidence'}
