[CmdletBinding()]
param([Parameter(Mandatory)][string]$EvidenceDirectory,[scriptblock]$TestAction)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if (!$IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or $env:GITHUB_REF -cne 'refs/heads/dot/print-queue-acceptance-20261114') {throw 'Exact isolated runner required'}
$proof=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'print-capabilities.json') -Raw | ConvertFrom-Json
if ($proof.status -cne 'queried' -or $proof.sourceSha -cne $env:GITHUB_SHA -or $proof.defaultPrinters.Count -ne 1) {throw 'Current capability proof and existing default required'}
$name='Milkup-Isolated-'+[guid]::NewGuid().ToString('N')
$driver='Generic / Text Only';$port='NUL:';$description='Owned paused null-device test queue '+$name
$r=[ordered]@{schema=1;sourceSha=$env:GITHUB_SHA;applicationBaseline=$proof.applicationBaseline;status='failed';queue=$name;port=$port;driver=$driver;queueCreated=$false;driverRegistered=$false;portCreated=$false;paused=$false;jobSubmitted=$false;applicationCancellation='not-run';systemJobCancellation='not-run';physicalPrinting='not-run';defaultBefore=@($proof.defaultPrinters);cleanupErrors=@()}
$queueOwned=$false;$portOwned=$false;$driverOwned=$false
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OwnedPrintCleanup {
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool DeletePortW(string server,IntPtr window,string port);
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool DeletePrinterDriverW(string server,string environment,string driver);
 public static int Port(){return DeletePortW(null,IntPtr.Zero,"NUL:")?0:Marshal.GetLastWin32Error();}
 public static int Driver(){return DeletePrinterDriverW(null,"Windows x64","Generic / Text Only")?0:Marshal.GetLastWin32Error();}
}
'@
function Persist {$r|ConvertTo-Json -Depth 16|Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'print-queue.json') -Encoding utf8}
function OwnedQueue {
 $q=Get-Printer -Name $name -ErrorAction Stop
 if ($q.Name -cne $name -or $q.DriverName -cne $driver -or $q.PortName -cne $port -or $q.Comment -cne $description -or $q.Shared -or $q.Published) {throw 'Temporary queue identity changed'}
 return $q
}
try {
 if ((Get-Service Spooler).Status -ne 'Running') {throw 'Existing Spooler is not running'}
 if (Get-Printer -Name $name -ErrorAction SilentlyContinue) {throw 'Generated queue already exists'}
 $installed=@(Get-PrinterDriver | Where-Object {$_.Name -ceq $driver -and $_.PrinterEnvironment -ceq 'Windows x64'})
 if (!$installed.Count) {
  $defs=@($proof.inboxGenericTextDefinitions | Where-Object {$_.path -match 'prnge001\.inf_amd64_[^\\]+\\prnge001\.inf$' -and $_.provider -ceq 'Microsoft' -and $_.inbox})
  if($defs.Count -ne 1){throw 'Exactly one existing Microsoft inbox x64 text driver definition required'}
  if((Get-FileHash -LiteralPath $defs[0].path).Hash.ToLowerInvariant() -cne $defs[0].sha256){throw 'Inbox driver definition changed'}
  Add-PrinterDriver -Name $driver -InfPath $defs[0].path
  $driverOwned=$true;$r.driverRegistered=$true
 }
 $installed=@(Get-PrinterDriver | Where-Object {$_.Name -ceq $driver -and $_.PrinterEnvironment -ceq 'Windows x64'})
 if($installed.Count -ne 1 -or $installed[0].InfPath -notmatch 'prnge001\.inf'){throw 'Exact registered inbox driver required'}
 $origin=@($proof.inboxGenericTextDefinitions | Where-Object {[StringComparer]::OrdinalIgnoreCase.Equals($_.path,$installed[0].InfPath) -and $_.provider -ceq 'Microsoft' -and $_.inbox})
 if($origin.Count -ne 1 -or (Get-FileHash -LiteralPath $installed[0].InfPath).Hash.ToLowerInvariant() -cne $origin[0].sha256){throw 'Registered driver must match the unchanged existing Microsoft inbox package'}
 $r.registeredDriver=$installed[0] | Select-Object Name,Manufacturer,InfPath,PrinterEnvironment,MajorVersion
 $existingPort=@(Get-PrinterPort | Where-Object Name -CEQ $port)
 if(!$existingPort.Count){Add-PrinterPort -Name $port;$portOwned=$true;$r.portCreated=$true}
 $actualPort=@(Get-PrinterPort | Where-Object Name -CEQ $port)
 if($actualPort.Count -ne 1 -or $actualPort[0].PortMonitor -cne 'Local Monitor'){throw 'Exact local null-device port required'}
 Add-Printer -Name $name -DriverName $driver -PortName $port -Comment $description
 $queueOwned=$true;$r.queueCreated=$true
 $q=OwnedQueue
 if(@(Get-PrintJob -PrinterName $name).Count){throw 'Fresh queue unexpectedly has a job'}
 $native=@(Get-CimInstance Win32_Printer | Where-Object Name -CEQ $name)
 if($native.Count -ne 1){throw 'Unique native temporary queue required'}
 $pause=Invoke-CimMethod -InputObject $native[0] -MethodName Pause
 if($pause.ReturnValue -ne 0){throw "Dedicated queue pause failed: $($pause.ReturnValue)"}
 $q=OwnedQueue
 if(!([int]$q.PrinterStatus -band 1)){throw 'Queue pause not observed'}
 $r.paused=$true;$r.pausedQueue=$q | Select-Object Name,DriverName,PortName,Shared,Published,PrinterStatus,Comment
 Persist
 if($TestAction){
  $null=& $TestAction $name $EvidenceDirectory
  $supervisor=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'standard/standard-print-supervisor.json') -Raw|ConvertFrom-Json
  $spool=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'standard/print-spool.json') -Raw|ConvertFrom-Json
  if($supervisor.status -cne 'passed' -or $spool.status -cne 'passed-spooled-and-system-cancelled' -or $spool.queue -cne $name -or !$spool.jobSubmitted -or !$spool.systemCancel -or $spool.jobsAfter.Count){throw 'Complete standard-user single-job evidence required'}
  $r.jobSubmitted=$true;$r.spoolJobId=$spool.jobId;$r.applicationCancellation='native-dialog-cancel-before-submit; no job';$r.systemJobCancellation='ordinary-user exact queue/job removal verified';$r.status='passed-spool-not-physical-print'
 }else{$r.status='queue-capability-passed-no-job-submitted'}
} catch {$r.error=$_ | Out-String} finally {
 if($queueOwned){try {
  $null=OwnedQueue
  if(@(Get-PrintJob -PrinterName $name).Count){throw 'Jobs remain: no purge or ambiguous job cancellation permitted'}
  Remove-Printer -Name $name
  if(Get-Printer -Name $name -ErrorAction SilentlyContinue){throw 'Owned queue removal unconfirmed'}
  $r.queueRemoved=$true
 }catch{$r.cleanupErrors+=($_ | Out-String)}}
 if($portOwned){try {
  if(@(Get-Printer | Where-Object PortName -CEQ $port).Count){throw 'Owned port still referenced; preserving'}
  $code=[OwnedPrintCleanup]::Port();$r.portRemovalWin32=$code
  if($code -ne 0){throw "Exact local null port removal failed Win32=$code"}
  $r.portRemoved=@(Get-PrinterPort | Where-Object Name -CEQ $port).Count -eq 0
  if(!$r.portRemoved){throw 'Owned port removal unconfirmed'}
 }catch{$r.cleanupErrors+=($_ | Out-String)}}
 if($driverOwned){try {
  if(@(Get-Printer | Where-Object DriverName -CEQ $driver).Count){throw 'Newly registered driver still referenced; preserving'}
  # DeletePrinterDriver removes the registration, not inbox driver-store files.
  # A recently deleted queue can briefly retain its reference; never restart Spooler.
  $r.driverRemovalAttempts=@()
  for($attempt=0;$attempt -lt 20;$attempt++) {
   if(@(Get-Printer | Where-Object DriverName -CEQ $driver).Count){throw 'Driver gained another queue reference'}
   $code=[OwnedPrintCleanup]::Driver();$r.driverRemovalAttempts+=@{attempt=$attempt;win32=$code}
   if($code -eq 0){break};if($code -ne 3001){throw "Exact driver registration removal failed Win32=$code"};Start-Sleep -Milliseconds 250
  }
  if($code -ne 0){throw 'Owned driver remained busy after bounded cleanup'}
  $r.driverUnregistered=@(Get-PrinterDriver | Where-Object {$_.Name -ceq $driver -and $_.PrinterEnvironment -ceq 'Windows x64'}).Count -eq 0
  if(!$r.driverUnregistered){throw 'Driver registration removal unconfirmed'}
 }catch{$r.cleanupErrors+=($_ | Out-String)}}
 $r.defaultAfter=@(Get-CimInstance Win32_Printer | Where-Object Default | Select-Object -ExpandProperty Name)
 $r.defaultUnchanged=($r.defaultAfter.Count -eq 1 -and $r.defaultAfter[0] -ceq $r.defaultBefore[0])
 if(!$r.defaultUnchanged -or $r.cleanupErrors.Count){$r.status='failed'}
 Persist
}
if($r.status -ceq 'failed'){throw 'Isolated queue capability failed; see exact retained report'}
