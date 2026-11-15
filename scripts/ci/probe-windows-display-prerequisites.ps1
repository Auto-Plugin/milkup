param([Parameter(Mandatory)][string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup'){throw 'Isolated official CI only'}
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
$r=[ordered]@{schema=1;status='running';harnessSha=$env:GITHUB_SHA;image=$env:ImageOS;imageVersion=$env:ImageVersion;productTested=$false;scaleChanged=$false;driversInstalled=$false;systemSecurityChanged=$false;runtimeRemoved=$false;guestStarted=$false;errors=@()}
try {
 Add-Type -Path (Join-Path $PSScriptRoot 'WindowsDisplayPrerequisites.cs')
 $r.display=[WindowsDisplayPrerequisites]::Capture()
 $r.caller=[ordered]@{sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;administrator=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);scope='Probe caller only, not a product token'}
 $r.facilities=[ordered]@{mstscPresent=(Test-Path "$env:windir\System32\mstsc.exe");vmConnectPresent=(Test-Path "$env:windir\System32\vmconnect.exe");displaySettingsPresent=(Test-Path "$env:windir\ImmersiveControlPanel\SystemSettings.exe");hypervisorPresent=(Get-CimInstance Win32_ComputerSystem).HypervisorPresent;guestImages=@();runtimeVersions=@()}
 # Known CI-owned provisioning roots only. Presence is not a boot/license claim.
 foreach($p in @('C:\ProgramData\Microsoft\Windows\Containers\BaseImages','C:\ProgramData\Microsoft\Windows\Virtual Hard Disks')){
  if(Test-Path $p){$r.facilities.guestImages+=@(Get-ChildItem -LiteralPath $p -File -Filter '*.vhd*' | Select-Object Name,Length)}
 }
 foreach($base in @($env:ProgramFiles,${env:ProgramFiles(x86)})){
  $p=Join-Path $base 'Microsoft\EdgeWebView\Application'
  if(Test-Path $p){$r.facilities.runtimeVersions+=@(Get-ChildItem $p -Directory | Where-Object {Test-Path (Join-Path $_.FullName 'msedgewebview2.exe')} | ForEach-Object {$_.Name})}
 }
 $r.status='capabilities-observed-not-product-accepted'
} catch {$r.status='probe-failed';$r.errors+=($_ | Out-String)} finally {
 $r|ConvertTo-Json -Depth 16|Set-Content -Encoding utf8 (Join-Path $EvidenceDirectory 'display-prerequisites.json')
}
$r|ConvertTo-Json -Depth 16
if($r.status -ne 'capabilities-observed-not-product-accepted'){exit 1}
