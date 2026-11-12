$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../../scripts/release/InstalledStartupProcess.cs')
$root=Join-Path ([IO.Path]::GetTempPath()) ('milkup-startup-capture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory $root
$capture=$null
try {
 $script=Join-Path $root 'stream.cjs'
 [IO.File]::WriteAllText($script,"process.stderr.write('中'.repeat(8192));setTimeout(()=>{process.stderr.write('\nEND\n');process.stdout.write(process.env.MILKUP_CAPTURE_TEST)},25)",[Text.UTF8Encoding]::new($false))
 $out=Join-Path $root 'stdout';$err=Join-Path $root 'stderr'
 $node=(Get-Command node -CommandType Application | Select-Object -First 1).Source
 $wrapped=Join-Path $root 'owned'
 $capture=[InstalledStartupProcess]::Start($node,$script,@{MILKUP_CAPTURE_TEST=$wrapped},$out,$err)
 if (!$capture.Product.WaitForExit(10000) -or $capture.Product.ExitCode -ne 0) {throw 'Owned capture fixture did not exit'}
 if (!$capture.Drain(5000) -or !$capture.StdoutEof -or !$capture.StderrEof -or $capture.Overflow) {throw 'Complete stream EOF required'}
 $expected=('中'*8192)+"`nEND`n"
 if ([IO.File]::ReadAllText($err) -cne $expected -or [IO.File]::ReadAllText($out) -cne $wrapped -or $capture.StderrBytes -ne [Text.Encoding]::UTF8.GetByteCount($expected)) {throw 'Exact fragmented UTF8 bytes and wrapped environment value must survive native capture'}
 $capture.Dispose();$capture=$null
 [IO.File]::WriteAllText($script,"process.stderr.write('x'.repeat(1024*1024+1))")
 $capture=[InstalledStartupProcess]::Start($node,$script,@{},(Join-Path $root 'overflow-out'),(Join-Path $root 'overflow-err'))
 $null=$capture.Product.WaitForExit(5000)
 $rejected=$false
 try {$rejected= !$capture.Drain(5000)} catch {$rejected=$true}
 if (!$rejected -or !$capture.Overflow) {throw 'Oversized capture must fail closed'}
 if ((Get-Item -LiteralPath (Join-Path $root 'overflow-err')).Length -gt 1MB) {throw 'Stored bytes exceeded budget'}
 Write-Output 'Byte capture exact UTF8/EOF and overflow negative control passed'
} finally {
 if ($null -ne $capture) {
  if (!$capture.Product.HasExited) {$capture.Product.Kill();$null=$capture.Product.WaitForExit(5000)}
  $capture.Dispose()
 }
 Remove-Item -LiteralPath $root -Recurse -Force
}
