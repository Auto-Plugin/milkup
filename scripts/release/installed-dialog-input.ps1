param([Parameter(Mandatory)][int]$ProductId,[Parameter(Mandatory)][long]$CreationTicks,[Parameter(Mandatory)][string]$Image,[Parameter(Mandatory)][string]$FixtureRoot,[Parameter(Mandatory)][string]$Target,[Parameter(Mandatory)][ValidateSet('open','html','pdf')][string]$Mode,[Parameter(Mandatory)][string]$Receipt)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if (!$IsWindows) { throw 'Windows native input required' }
$root=[IO.Path]::GetFullPath($FixtureRoot).TrimEnd('\')+'\'
$file=[IO.Path]::GetFullPath($Target)
if (![IO.Path]::GetFullPath($Receipt).StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $Receipt) -or (Test-Path -LiteralPath ($Receipt+'.ready'))) { throw 'Fresh owned native input receipt required' }
if (!$file.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or $file.IndexOfAny([char[]]@(0,10,13,34)) -ge 0 -or $file.Length -gt 1024) { throw 'Exact bounded owned fixture target required' }
for($dir=Get-Item -LiteralPath (Split-Path $file -Parent);$null -ne $dir;$dir=$dir.Parent) { if($dir.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse fixture ancestor rejected'} }
if($Mode -ceq 'open') { if(!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Existing plain input required'} }
elseif((Test-Path -LiteralPath $file) -or [IO.Path]::GetExtension($file) -cne ('.'+$Mode)){throw 'New exact-format output required'}
Add-Type -Path (Join-Path $PSScriptRoot 'InstalledDialogInput.cs')
$product=[Diagnostics.Process]::GetProcessById($ProductId)
function Identity {
 $product.Refresh()
 if($product.HasExited -or $product.StartTime.ToUniversalTime().Ticks -ne $CreationTicks -or ![StringComparer]::OrdinalIgnoreCase.Equals($product.MainModule.FileName,$Image)){throw 'Exact product process changed'}
}
Identity
$held=$product.Handle
$result=[ordered]@{status='running';productPid=$ProductId;productCreationTicks=$CreationTicks.ToString();mode=$Mode;path=$file}
try {
 [IO.File]::WriteAllText($Receipt+'.ready','ready')
 $targetProcess=$product;$title=''
 if($Mode -cne 'open') {
  $end=[DateTime]::UtcNow.AddSeconds(20);$matches=@()
  do {
   Identity
   $matches=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProductId" | Where-Object { [StringComparer]::OrdinalIgnoreCase.Equals($_.ExecutablePath,$Image) -and $_.CommandLine -match '^"?[^"\r\n]+\.exe"?\s+--milkup-internal-output-helper\s*$' })
   if($matches.Count -gt 1){throw 'Ambiguous native output helper'}
   if($matches.Count -eq 1){break};Start-Sleep -Milliseconds 25
  } while([DateTime]::UtcNow -lt $end)
  if($matches.Count -ne 1){throw 'Exact direct output helper absent'}
  $targetProcess=[Diagnostics.Process]::GetProcessById($matches[0].ProcessId)
  if($targetProcess.StartTime.ToUniversalTime().Ticks -le $CreationTicks){throw 'Output helper predates current product'}
  $title=if($Mode -ceq 'pdf'){'Export PDF'}else{'Export HTML'}
  $result['helperParentPid']=$matches[0].ParentProcessId
 }
 $result['input']=[InstalledDialogInput]::Submit($targetProcess.Id,$targetProcess.StartTime.ToUniversalTime().Ticks,$Image,$file,$title)
 Identity
 $result.status='passed'
} catch {$result.status='failed';$result['error']=$_ | Out-String;throw}
finally {$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Receipt -Encoding utf8;$product.Dispose();[GC]::KeepAlive($held)}
