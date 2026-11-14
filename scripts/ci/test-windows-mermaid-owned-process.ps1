#Requires -Version 7.2
# Local process regression only: never executes a Windows installer or changes accounts.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$helperPath = Join-Path $PSScriptRoot 'WindowsMermaidStandardUser.cs'
Add-Type -Path $helperPath
$builder=[WindowsMermaidStandardUser].GetMethod('InstallerArguments',[Reflection.BindingFlags]'Static,NonPublic')
$argumentCases=@()
foreach($destination in @('C:\Users\Fresh Standard User\scratch\install','D:\test\中文 directory\install')){
 $actual=$builder.Invoke($null,@($destination))
 if($actual-cne ('/S /D='+$destination) -or $actual.Contains('"')){throw 'NSIS /D last/unquoted contract failed'}
 $argumentCases += @{destination=$destination;arguments=$actual;exact=$true}
}
$rejected=0
foreach($destination in @($null,'','relative\install','\\server\share\install','C:\folder"\install',"C:\folder`r`ninstall",("C:\folder"+[char]0+'install'),'C:\trailing-space ')){
 $failed=$false;try{$null=$builder.Invoke($null,@($destination))}catch{$failed=$true}
 if(-not $failed){throw 'Unsafe NSIS directory accepted'};$rejected++
}
$uninstallBuilder=[WindowsMermaidStandardUser].GetMethod('UninstallerArguments',[Reflection.BindingFlags]'Static,NonPublic')
foreach($destination in @('C:\Users\Fresh Standard User\scratch\install','D:\test\中文 directory\install')){
 $actual=$uninstallBuilder.Invoke($null,@($destination))
 if($actual-cne ('/S _?='+$destination) -or $actual.Contains('"')){throw 'NSIS _? last/unquoted wait contract failed'}
}
foreach($destination in @('relative\install','\\server\share\install','C:\folder"\install')){
 $failed=$false;try{$null=$uninstallBuilder.Invoke($null,@($destination))}catch{$failed=$true}
 if(-not $failed){throw 'Unsafe NSIS uninstaller directory accepted'}
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mermaid-owned-installer-helper-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($root)|Out-Null
$node=(Get-Command node -CommandType Application|Select-Object -First 1).Source
$cases=[ordered]@{}
$invalidInstallerKinds=@()
try{
 $argumentFixture=Join-Path $root 'arguments script.mjs'
 [IO.File]::WriteAllText($argumentFixture,"console.log(JSON.stringify(process.argv.slice(2)));setTimeout(()=>process.exit(0),100)")
 $argsToCheck=[string[]]@('argument with spaces','中文路径','literal & not a shell','literal "quote"')
 $cases.multiArgumentNode=[WindowsMermaidStandardUser]::RunNodeScript($node,[string[]](@($argumentFixture)+$argsToCheck),$root,(Join-Path $root 'argv.out'),(Join-Path $root 'argv.err'),5000)
 $actual=@([IO.File]::ReadAllText((Join-Path $root 'argv.out'))|ConvertFrom-Json)
 if(($actual|ConvertTo-Json -Compress)-cne ($argsToCheck|ConvertTo-Json -Compress)){throw 'ArgumentList did not preserve exact independent arguments'}
 if($cases.multiArgumentNode.status-cne 'passed' -or $cases.multiArgumentNode.exitCode-ne 0 -or -not $cases.multiArgumentNode.streamsDrained){throw 'Node script did not wait for exit/EOF'}
 if($null-ne $cases.multiArgumentNode.expectedAccountKind -or $cases.multiArgumentNode.identityRequired -or $cases.multiArgumentNode.identityVerified){throw 'Node dispatch inherited installer identity requirements'}
 $fixtures=[ordered]@{
  delayed37="import fs from 'node:fs';for(let i=0;i<64;i++){fs.writeSync(1,Buffer.alloc(8192,65));fs.writeSync(2,Buffer.alloc(8192,66));}setTimeout(()=>process.exit(37),450);"
  fastZero="process.exit(0)"
  timeout="process.stdout.write('before timeout');setTimeout(()=>process.exit(0),60000)"
  oversized="import fs from 'node:fs';fs.writeSync(1,Buffer.alloc(3*1024*1024,67));setTimeout(()=>process.exit(0),60000)"
 }
 foreach($fixture in $fixtures.GetEnumerator()){
  $path=Join-Path $root ($fixture.Key+'.mjs');[IO.File]::WriteAllText($path,$fixture.Value)
  $budget=$(if($fixture.Key-ceq 'timeout'){300}else{5000})
  $cases[$fixture.Key]=[WindowsMermaidStandardUser]::RunNodeHarness($node,$path,$root,(Join-Path $root ($fixture.Key+'.out')),(Join-Path $root ($fixture.Key+'.err')),$budget)
  if(-not $cases[$fixture.Key].exited -or $cases[$fixture.Key].cleanupErrors.Count){throw 'Legacy API process exit/cleanup failed'}
  if($null-ne $cases[$fixture.Key].expectedAccountKind -or $cases[$fixture.Key].identityRequired -or $cases[$fixture.Key].identityVerified){throw 'Node harness acquired installer identity requirements'}
 }
 if($cases.delayed37.status-cne 'failed' -or $cases.delayed37.exitCode-ne 37 -or $cases.delayed37.elapsedMs-lt 400 -or -not $cases.delayed37.streamsDrained -or $cases.delayed37.stdoutBytes-ne 512KB -or $cases.delayed37.stderrBytes-ne 512KB -or $cases.delayed37.forcedProcessTermination){throw 'Delayed nonzero paired-pipe regression failed'}
 if($cases.fastZero.status-cne 'passed' -or $cases.fastZero.exitCode-ne 0 -or -not $cases.fastZero.streamsDrained){throw 'Fast Node exit was not actually observed'}
 if($cases.timeout.status-cne 'failed' -or -not $cases.timeout.timedOut -or -not $cases.timeout.forcedProcessTermination -or $cases.timeout.elapsedMs-gt 5000){throw 'Timeout did not fail closed'}
 if($cases.oversized.status-cne 'failed' -or -not $cases.oversized.captureExceeded -or $cases.oversized.stdoutBytes-ne 2MB){throw 'Output cap failed'}
 # Invalid kinds are rejected by the public entry before any platform check,
 # native identity API, log creation or process launch, including on Windows.
 foreach($kind in @($null,'','administrator','Pure-standard','FILTERED-admin','filtered-admin ',("pure-standard"+[char]0))){
  $failed=$false
  try{
   $null=[WindowsMermaidStandardUser]::RunOwnedInstaller('C:\test\installer.exe','C:\Users\Fresh Standard User\scratch\install',$root,(Join-Path $root 'invalid-installer.out'),(Join-Path $root 'invalid-installer.err'),'S-1-5-21-1-2-3-1003',2,$kind,120000)
  }catch{
   $kindFailure=$_.Exception
   while($null-ne $kindFailure.InnerException){$kindFailure=$kindFailure.InnerException}
   if($kindFailure-isnot [ArgumentException] -or $kindFailure.Message-cne 'Unknown expected installer account kind'){throw}
   $failed=$true
  }
  if(-not $failed -or (Test-Path (Join-Path $root 'invalid-installer.out')) -or (Test-Path (Join-Path $root 'invalid-installer.err'))){throw 'Invalid installer kind reached execution or log creation'}
  $invalidInstallerKinds += @{expectedAccountKind=$kind;rejectedBeforeStart=$true}
 }
 # The Linux guard rejects before opening logs, starting a process or invoking
 # any Windows native identity API. This is not a Windows installer execution.
 if(-not $IsWindows){
  foreach($kind in @('pure-standard','filtered-admin')){
   $key='nonWindowsInstaller-'+$kind
   $stdout=Join-Path $root ($key+'.out');$stderr=Join-Path $root ($key+'.err')
   $cases[$key]=[WindowsMermaidStandardUser]::RunOwnedInstaller('C:\test\installer.exe','C:\Users\Fresh Standard User\scratch\install',$root,$stdout,$stderr,'S-1-5-21-1-2-3-1003',2,$kind,120000)
   $record=$cases[$key]
   if($record.status-cne 'failed' -or $record.started -or $record.identityVerified -or $null-ne $record.exitCode -or
      $record.expectedAccountKind-cne $kind -or -not $record.identityRequired -or $null-ne $record.callerIdentity -or $null-ne $record.startedProcess -or
      $record.error-cne 'Owned NSIS execution requires Windows' -or (Test-Path $stdout) -or (Test-Path $stderr)){
    throw 'Unavailable native installer path fabricated execution or identity'
   }
  }
 }
 [ordered]@{status='passed';powershell=$PSVersionTable.PSVersion.ToString();csharpCompiled=$true;helperSha256=(Get-FileHash -LiteralPath $helperPath -Algorithm SHA256).Hash.ToLowerInvariant();nsisArgumentCases=$argumentCases;unsafeNsisArgumentsRejected=$rejected;invalidInstallerKinds=$invalidInstallerKinds;processCases=$cases;windowsInstallerExecuted=$false;windowsIdentityApisExecuted=$false;accountsChanged=$false;remoteTasksTriggered=$false}|ConvertTo-Json -Depth 12
}finally{Remove-Item -LiteralPath $root -Recurse -Force}
