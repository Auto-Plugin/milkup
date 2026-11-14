# A discovered process (like NSIS's automatic restart) must retain a native
# handle before exit. Test real exit 0/nonzero and wrong-birth/image rejection.
$ErrorActionPreference='Stop'
if (!$IsWindows) {throw 'Native Windows exit witness test required'}
Add-Type -Path (Join-Path $PSScriptRoot 'WindowsInstallWindow.cs')
$shell=(Get-Process -Id $PID).Path
$root=Join-Path ([IO.Path]::GetTempPath()) ('milkup-exit-witness-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $root
$results=@()
try {
 foreach ($code in @(0,17)) {
  $signal=Join-Path $root "exit-$code"
  $script="`$until=[DateTime]::UtcNow.AddSeconds(15);while (!(Test-Path -LiteralPath '$($signal.Replace("'","''"))')) {if ([DateTime]::UtcNow -gt `$until) {exit 99};Start-Sleep -Milliseconds 20};exit $code"
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $started=Start-Process -FilePath $shell -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -PassThru -WindowStyle Hidden
  $discovered=Get-Process -Id $started.Id
  $birth=$discovered.StartTime.ToUniversalTime().Ticks
  $witness=$null
  try {
   foreach($wrong in @(@{birth=$birth+1;image=$shell},@{birth=$birth;image=$shell+'.wrong'})) {
    $rejected=$false
    try {$bad=[MilkupInstallWindow+ExitWitness]::new($discovered.Id,$wrong.birth,$wrong.image);$bad.Dispose()} catch {$rejected=$true}
    if (!$rejected) {throw 'Wrong generation/image accepted'}
   }
   $witness=[MilkupInstallWindow+ExitWitness]::new($discovered.Id,$birth,$shell)
   $pending=$witness.Wait(0)
   if ($pending.exited -or $null -ne $pending.exitCode) {throw 'Live process falsely claimed successful exit'}
   # Release the launcher's handle. The witness must independently retain status.
   $started.Dispose()
   [IO.File]::WriteAllText($signal,'exit')
   $proof=$witness.Wait(15000)
   if (!$proof.exited -or $proof.exitCode -ne $code -or !$proof.heldProcessHandle) {throw 'Exact native exit code lost'}
   $results+=@{expectedExitCode=$code;proof=$proof;wrongBirthRejected=$true;wrongImageRejected=$true}
  } finally {if($witness){$witness.Dispose()};$discovered.Dispose();$started.Dispose()}
 }
 $results | ConvertTo-Json -Depth 5
} finally {Remove-Item -LiteralPath $root -Recurse -Force}
