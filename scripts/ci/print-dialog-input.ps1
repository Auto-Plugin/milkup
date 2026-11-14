param([Parameter(Mandatory)][int]$ProductId,[Parameter(Mandatory)][long]$CreationTicks,[Parameter(Mandatory)][string]$Image,[Parameter(Mandatory)][ValidatePattern('^Milkup-Isolated-[a-f0-9]{32}$')][string]$Queue,[Parameter(Mandatory)][ValidatePattern('^MILKUP_SPOOL_[a-f0-9]{32}$')][string]$Marker,[Parameter(Mandatory)][string]$Receipt,[switch]$Cancel)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if(!$IsWindows -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or $env:GITHUB_REF -cne 'refs/heads/dot/print-queue-acceptance-20261114'){throw 'Exact print CI required'}
if(Test-Path -LiteralPath $Receipt){throw 'Fresh receipt required'}
Add-Type -Path (Join-Path $PSScriptRoot 'IsolatedPrintDialog.cs')
Add-Type -Path (Join-Path $PSScriptRoot 'OwnedPrintJob.cs')
$product=[Diagnostics.Process]::GetProcessById($ProductId);$held=$product.Handle
function Identity {$product.Refresh();if($product.HasExited -or $product.StartTime.ToUniversalTime().Ticks -ne $CreationTicks -or ![StringComparer]::OrdinalIgnoreCase.Equals($product.MainModule.FileName,$Image)){throw 'Exact parent product changed'}}
function QueueIdentity {
 $q=Get-Printer -Name $Queue
 if($q.Name -cne $Queue -or $q.Comment -cne ('Owned paused null-device test queue '+$Queue) -or $q.PortName -cne 'NUL:' -or $q.DriverName -cne 'Generic / Text Only' -or $q.Shared -or $q.Published -or !([int]$q.PrinterStatus -band 1)){throw 'Exact paused owned null queue required'}
}
$r=[ordered]@{status='failed';mode=if($Cancel){'native-dialog-cancel'}else{'submit-then-system-single-job-cancel'};productPid=$ProductId;productCreationTicks=$CreationTicks.ToString();queue=$Queue;marker=$Marker;jobSubmitted=$false;systemCancel=$false;applicationRetractedSubmittedJob=$false;physicalPrinted=$false}
$helper=$null;$job=$null
function CancelObservedJob([string]$Purpose) {
  # Recheck the exact captured job generation before any single-job deletion.
  QueueIdentity
  $latest=Get-PrintJob -PrinterName $Queue -ID $job.ID
  if($latest.DocumentName -cne $job.DocumentName -or $latest.UserName -cne $job.UserName -or $latest.SubmittedTime -ne $job.SubmittedTime){throw 'Spool job identity changed before cancel'}
  $r.cancelPurpose=$Purpose
  try{[OwnedPrintJob]::Cancel($Queue,[uint32]$job.ID,$job.DocumentName,$job.UserName,$r.jobOwnerSid,$job.SubmittedTime)}finally{$r.nativeCancel=[OwnedPrintJob]::Last}
  $r.systemCancel=$true;$r.cancelMechanism='ordinary-user WinSpool SetJobW JOB_CONTROL_DELETE with PRINTER_ACCESS_USE, exact queue/job generation; not application cancellation'
  $end=[datetime]::UtcNow.AddSeconds(15)
  do{QueueIdentity;$left=@(Get-PrintJob -PrinterName $Queue);if(!$left.Count){break};Start-Sleep -Milliseconds 100}while([datetime]::UtcNow -lt $end)
  $r.jobsAfter=@($left | Select-Object ID,DocumentName,UserName,SubmittedTime,JobStatus,Size)
  if($left.Count){throw 'Single job removal not proven'}
}
try {
 Identity;QueueIdentity
 if(@(Get-PrintJob -PrinterName $Queue).Count){throw 'Dedicated queue not empty before action'}
 [IO.File]::WriteAllText($Receipt+'.ready','ready')
 $end=[datetime]::UtcNow.AddSeconds(25);$rows=@()
 do {
  Identity
  $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProductId")
  if($children.Count -gt 32){throw 'Direct child observation budget'}
  $r.sameImageChildren=@($children | Where-Object {[StringComparer]::OrdinalIgnoreCase.Equals($_.ExecutablePath,$Image)} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate)
  $rows=@($children | Where-Object {[StringComparer]::OrdinalIgnoreCase.Equals($_.ExecutablePath,$Image) -and $_.CommandLine -match '^"?[^"\r\n]+\.exe"?\s+--milkup-internal-pdf-helper\s*$'})
  if($rows.Count -gt 1){throw 'Ambiguous direct output helper'}
  if($rows.Count -eq 1){break};Start-Sleep -Milliseconds 25
 }while([datetime]::UtcNow -lt $end)
 if($rows.Count -ne 1){throw 'Direct output helper absent'}
 $helper=[Diagnostics.Process]::GetProcessById($rows[0].ProcessId);$helperHeld=$helper.Handle;$helperBirth=$helper.StartTime.ToUniversalTime().Ticks
 if($helperBirth -le $CreationTicks){throw 'Helper predates product'}
 $r.helperParentPid=$rows[0].ParentProcessId
 QueueIdentity
 $r.input=[IsolatedPrintDialog]::SubmitPrint($helper.Id,$helperBirth,$Image,$Queue,[bool]$Cancel)
 Identity
 if($Cancel){
  if(!$helper.WaitForExit(10000)){throw 'Cancelled output helper did not retire'}
  QueueIdentity
  $r.jobsAfter=@(Get-PrintJob -PrinterName $Queue | Select-Object ID,DocumentName,UserName,SubmittedTime,JobStatus,Size)
  if($r.jobsAfter.Count){throw 'Dialog cancellation unexpectedly submitted a job'}
  $r.status='passed-native-dialog-cancel-no-job'
 }else{
  $end=[datetime]::UtcNow.AddSeconds(30);$jobs=@()
  do{Identity;QueueIdentity;$jobs=@(Get-PrintJob -PrinterName $Queue);if($jobs.Count){break};Start-Sleep -Milliseconds 100}while([datetime]::UtcNow -lt $end)
  $r.jobsObserved=@($jobs | Select-Object ID,PrinterName,DocumentName,UserName,SubmittedTime,JobStatus,Size,TotalPages)
  $r | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Receipt -Encoding utf8
  if($jobs.Count -ne 1){throw 'Exactly one spool job required'}
  $job=$jobs[0]
  $current=[Security.Principal.WindowsIdentity]::GetCurrent()
  $owner=[Security.Principal.NTAccount]::new($job.UserName).Translate([Security.Principal.SecurityIdentifier]).Value
  if($owner -cne $current.User.Value -or $job.DocumentName -notlike ('*'+$Marker+'*') -or $job.ID -le 0 -or $job.PrinterName -cne $Queue){throw 'Exact spool job document/owner/queue identity required'}
  $r.jobSubmitted=$true;$r.jobOwnerSid=$owner;$r.jobId=$job.ID
  # Wait for the application output helper to finish submitting the job, while
  # the queue remains paused. Do not race system cancellation against Print().
  if(!$helper.WaitForExit(30000)){throw 'Print helper did not finish submission while queue was paused'}
  $r.helperExitedBeforeSystemCancel=$true;$r.helperExitCode=$helper.ExitCode
  # This backend deliberately stays alive after its framed result; its owner
  # terminates the Job. Exit code is diagnostic, never the success predicate.
  [IO.File]::WriteAllText($Receipt+'.job-observed',$Marker)
  $accepted=$Receipt+'.application-accepted';$end=[datetime]::UtcNow.AddSeconds(25)
  while(!(Test-Path -LiteralPath $accepted) -and [datetime]::UtcNow -lt $end){Identity;QueueIdentity;Start-Sleep -Milliseconds 100}
  if(!(Test-Path -LiteralPath $accepted) -or (Get-Item -LiteralPath $accepted).Length -gt 64 -or [IO.File]::ReadAllText($accepted) -cne $Marker){throw 'Application UI did not confirm successful submission before cancellation'}
  $r.applicationReportedSubmittedBeforeCancel=$true
  $r.completedSpoolJob=Get-PrintJob -PrinterName $Queue -ID $job.ID | Select-Object ID,PrinterName,DocumentName,UserName,SubmittedTime,JobStatus,Size,TotalPages
  if($r.completedSpoolJob.Size -le 0 -or ([int]$r.completedSpoolJob.JobStatus -band 8)){throw 'Complete non-empty spooled data required before successful cancellation acceptance'}
  CancelObservedJob 'acceptance-after-application-reported-submitted'
  $r.status='passed-spooled-and-system-cancelled'
 }
}catch{$r.error=$_|Out-String}finally{
 if($r.jobSubmitted -and !$r.systemCancel -and $null -ne $job){
  try{CancelObservedJob 'failure-cleanup-only';$r.failureCleanupVerified=$true}catch{$r.failureCleanupError=$_|Out-String}
 }

 $r.controlObservation=[IsolatedPrintDialog]::LastObservation
 $r | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $Receipt -Encoding utf8
 if($helper){$helper.Dispose();[GC]::KeepAlive($helperHeld)};$product.Dispose();[GC]::KeepAlive($held)
}
if($r.status -notlike 'passed-*'){throw 'Real native print test failed; see scoped receipt'}
