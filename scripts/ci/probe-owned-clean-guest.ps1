param([Parameter(Mandatory)][string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup') {throw 'Isolated official CI only'}
New-Item -ItemType Directory $EvidenceDirectory | Out-Null
$r=[ordered]@{status='running';sha=$env:GITHUB_SHA;image=$env:ImageOS;productTested=$false;guestOsBooted=$false;runtimeRemoved=$false;networkOrSecurityChanged=$false;cleanup=@();errors=@()}
function Persist {$r|ConvertTo-Json -Depth 12|Set-Content -Encoding utf8 (Join-Path $EvidenceDirectory 'clean-guest.json')}
$name='milkup-capability-'+[guid]::NewGuid().ToString('N');$vm=$null;$root=Join-Path $env:RUNNER_TEMP $name
try {
 $r['hypervisor']=Get-CimInstance Win32_ComputerSystem|Select-Object HypervisorPresent
 $r['processor']=@(Get-CimInstance Win32_Processor|Select-Object VirtualizationFirmwareEnabled,VMMonitorModeExtensions,SecondLevelAddressTranslationExtensions)
 $r['vmService']=Get-Service vmms|Select-Object Name,@{n='status';e={$_.Status.ToString()}}
 $r['host']=Get-VMHost|Select-Object LogicalProcessorCount,MemoryCapacity
 $r['existingVmCount']=@(Get-VM).Count
 $r['existingGuestImages']=@()
 foreach($path in @('C:\ProgramData\Microsoft\Windows\Containers\BaseImages','C:\ProgramData\Microsoft\Windows\Virtual Hard Disks')) {
  if(Test-Path $path){$r.existingGuestImages+=@(Get-ChildItem -LiteralPath $path -File -Filter '*.vhd*'|Select-Object Name,Length)}
 }
 if(Test-Path $root){throw 'Owned path exists'}
 New-Item -ItemType Directory $root|Out-Null
 $vm=New-VM -Name $name -Generation 2 -MemoryStartupBytes 256MB -NoVHD -Path $root
 $r['vmId']=$vm.Id.ToString();Persist
 Get-VMNetworkAdapter -VM $vm|Remove-VMNetworkAdapter
 if(@(Get-VMNetworkAdapter -VM $vm).Count -ne 0){throw 'Owned VM has adapter'}
 Start-VM -VM $vm|Out-Null
 $actual=Get-VM -Id $vm.Id;$r['observedState']=$actual.State.ToString();Persist
 if($actual.State.ToString() -cne 'Running'){throw 'Blank VM did not start'}
 $r.status='blank-vm-started-not-windows-installation-accepted'
} catch {$r.errors+=($_|Out-String);$r.status='capability-blocked'} finally {
 if($null -ne $vm){try{
  $actual=Get-VM -Id $vm.Id
  if($actual.Name -cne $name -or $actual.Path.TrimEnd('\') -cne $root.TrimEnd('\')){throw 'Owned VM identity/path changed'}
  if($actual.State.ToString() -cne 'Off'){Stop-VM -VM $actual -TurnOff -Force -Confirm:$false}
  Remove-VM -VM $actual -Force
  if(Get-VM -Id $vm.Id -ErrorAction SilentlyContinue){throw 'Owned VM still exists'}
  $r.cleanup+='exact-owned-vm-removed'
 } catch {$r.errors+=($_|Out-String);$r.status='cleanup-failed'}}
 if(Test-Path $root){try{
  if((Get-Item $root).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Owned path became reparse'}
  if($null -ne $vm -and (Get-VM -Id $vm.Id -ErrorAction SilentlyContinue)){throw 'VM still exists'}
  Remove-Item -LiteralPath $root -Recurse -Force;$r.cleanup+='owned-storage-removed'
 } catch {$r.errors+=($_|Out-String);$r.status='cleanup-failed'}}
 Persist
}
$r|ConvertTo-Json -Depth 12
if($r.status -cne 'blank-vm-started-not-windows-installation-accepted'){exit 1}
