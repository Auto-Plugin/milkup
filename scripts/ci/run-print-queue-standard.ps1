# Uses the existing held-Job/verified-token coordinator. Only a newly owned user
# and newly created staging directories are changed; existing desktop/UAC ACLs stay intact.
[CmdletBinding(DefaultParameterSetName='Parent')]
param(
 [Parameter(Mandatory,ParameterSetName='Parent')][string]$Binary,
 [Parameter(Mandatory,ParameterSetName='Parent')][ValidatePattern('^Milkup-Isolated-[a-f0-9]{32}$')][string]$Queue,
 [Parameter(Mandatory,ParameterSetName='Parent')][string]$EvidenceDirectory,
 [Parameter(Mandatory,ParameterSetName='Child')][string]$ChildSpec
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or $env:GITHUB_REF -cne 'refs/heads/dot/print-queue-acceptance-20261114') { throw 'Exact ephemeral candidate runner required' }
function Plain([string]$Path) {
 $item=Get-Item -LiteralPath $Path -Force
 do { if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse input/ancestor rejected' }; $item=if ($item -is [IO.DirectoryInfo]) {$item.Parent} else {$item.Directory} } while ($null -ne $item)
}
function NewDir([string]$Path) { if(Test-Path -LiteralPath $Path){throw 'Owned path already exists'}; $null=New-Item -ItemType Directory -Path $Path; Plain $Path }
function Json([string]$Path,$Value) { $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8 }
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Add-Type -Path (Join-Path $repo 'scripts/ci/WindowsMermaidStandardUser.cs')
if ($PSCmdlet.ParameterSetName -ceq 'Child') {
 Plain $ChildSpec
 if ((Get-Item -LiteralPath $ChildSpec).Length -gt 16384) { throw 'Bounded immutable spec required' }
 $spec=Get-Content -LiteralPath $ChildSpec -Raw | ConvertFrom-Json
 if ($spec.harnessSha -cne $env:GITHUB_SHA -or $spec.id -cnotmatch '^[a-f0-9]{32}$') { throw 'Child spec candidate mismatch' }
 Plain $spec.node.path
 if (![IO.Path]::IsPathFullyQualified($spec.node.path) -or (Get-FileHash -LiteralPath $spec.node.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $spec.node.sha256) { throw 'Exact parent-verified Node image required' }
 $identity=[WindowsMermaidStandardUser]::ObserveProcesses([uint32[]]@($PID))[0]
 if (!$identity.ContainsKey('token') -or $identity.token.sid -cne $spec.sid -or ![WindowsMermaidStandardUser]::MatchesExpectedAccountKind($identity.token,'pure-standard') -or $identity.token.sessionId -ne $spec.session) { throw 'Exact child identity gate failed' }
 $desktop=[WindowsMermaidStandardUser]::ObserveCurrentContext()
 if (!$desktop.desktopEligible) { throw 'Existing interactive desktop inaccessible; no ACL fallback' }
 $profile=[Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
 $roaming=[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
 $local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
 foreach ($folder in @($profile,$roaming,$local)) { if (![IO.Path]::IsPathFullyQualified($folder)) {throw 'KnownFolder unavailable'};Plain $folder }
 $scratch=Join-Path $profile ('.milkup-print-'+$spec.id)
 NewDir $scratch
 $temp=Join-Path $scratch 'temp';NewDir $temp
 $env:USERPROFILE=$profile;$env:APPDATA=$roaming;$env:LOCALAPPDATA=$local;$env:TEMP=$temp;$env:TMP=$temp;$env:RUNNER_TEMP=$temp
 Json (Join-Path $scratch 'child-identity.json') @{identity=$identity;desktop=$desktop;knownFolders=@{profile=$profile;roaming=$roaming;local=$local};sourceSha=$spec.sourceSha;harnessSha=$spec.harnessSha}
 Set-Location $repo
 try {
  & (Join-Path $repo 'scripts/ci/run-print-queue-child.ps1') -Binary $spec.binary.path -BinarySha256 $spec.binary.sha256 -Queue $spec.queue -Marker $spec.marker -EvidenceDirectory (Join-Path $scratch 'evidence') -NodeExecutable $spec.node.path
  exit 0
 } catch { Json (Join-Path $scratch 'child-error.json') @{error=($_ | Out-String)};exit 1 }
}
$SourceSha='b877746f5dfd236dfc13f718ed23d837b8e4f89d'
Plain $Binary
if ((git rev-parse HEAD).Trim() -cne $env:GITHUB_SHA) { throw 'Harness must be exact workflow checkout' }
NewDir $EvidenceDirectory
$id=[guid]::NewGuid().ToString('N');$name='mkpq'+$id.Substring(0,14)
$description='Milkup print '+$id
$stage=Join-Path $repo ('.tmp/print-queue-'+$id)
$user=$null;$password=[Security.SecureString]::new();$jobEmpty=$true;$profile=$null
$audit=[ordered]@{status='failed';harnessSha=$env:GITHUB_SHA;sourceSha=$SourceSha;id=$id;accountName=$name;accountSid=$null;accountDeleted=$false;profileDeleted=$false;stageRemoved=$false;securityPolicyChanged=$false;existingDesktopAclChanged=$false;outerCleanupProvesProductCleanup=$false;cleanupErrors=@()}
function Persist { Json (Join-Path $EvidenceDirectory 'standard-print-supervisor.json') $audit }
try {
 $desktop=[WindowsMermaidStandardUser]::ObserveCurrentContext();$audit['runnerDesktop']=$desktop
 if (!$desktop.desktopEligible) { throw 'No existing interactive desktop' }
 if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { throw 'Generated account exists' }
 foreach($c in 'aA1!'.ToCharArray()){$password.AppendChar($c)}
 $alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%_-'
 1..44 | ForEach-Object {$password.AppendChar($alphabet[[Security.Cryptography.RandomNumberGenerator]::GetInt32($alphabet.Length)])};$password.MakeReadOnly()
 $user=New-LocalUser -Name $name -Password $password -Description $description -AccountExpires (Get-Date).AddDays(1) -UserMayNotChangePassword
 $audit.accountSid=$user.SID.Value
 Add-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]'S-1-5-32-545') -Member $user
 $groups=@(Get-LocalGroup | Where-Object {@(Get-LocalGroupMember -Group $_ | Where-Object {$_.SID.Value -ceq $user.SID.Value}).Count -gt 0} | ForEach-Object {$_.SID.Value})
 if ($groups.Count -ne 1 -or $groups[0] -cne 'S-1-5-32-545') { throw 'Fresh user must belong only to Users' }
 NewDir $stage
 # ACL changes apply only to this newly created, exact owned staging root.
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
 }
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user.SID,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))
 Set-Acl -LiteralPath $stage -AclObject $acl
 $code=Join-Path $stage 'code';NewDir $code
 $files=@('scripts/ci/run-print-queue-standard.ps1','scripts/ci/run-print-queue-child.ps1','scripts/ci/print-queue-ui.mjs','scripts/ci/print-dialog-input.ps1','scripts/ci/IsolatedPrintDialog.cs','scripts/release/WindowsInstallWindow.cs','scripts/ci/WindowsMermaidStandardUser.cs','tests/windows/mermaid-product-e2e.mjs','tests/windows/mermaid-frontend-contract.mjs')
 $audit['stagedCode']=@()
 foreach($leaf in $files) {
  $source=Join-Path $repo $leaf;Plain $source
  $target=Join-Path $code $leaf;$null=New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)
  Copy-Item -LiteralPath $source -Destination $target
  $hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -cne $hash) { throw 'Staged code bytes changed' }
  $audit.stagedCode+=@{path=$leaf;sha256=$hash.ToLowerInvariant()}
 }
 $inputRoot=Join-Path $stage 'input';NewDir $inputRoot
 $binaryTarget=Join-Path $inputRoot 'milkup-desktop.exe';Copy-Item -LiteralPath $Binary -Destination $binaryTarget
 $binaryHash=(Get-FileHash -LiteralPath $Binary).Hash.ToLowerInvariant()
 if((Get-FileHash -LiteralPath $binaryTarget).Hash.ToLowerInvariant() -cne $binaryHash){throw 'Staged binary bytes differ'}
 $audit['binarySha256']=$binaryHash
 $specFile=Join-Path $code 'print-spec.json'
 $node=(Get-Command node -CommandType Application | Select-Object -First 1).Source
 $pwsh=(Get-Command pwsh -CommandType Application | Select-Object -First 1).Source
 Plain $node
 $nodeProof=@{path=$node;sha256=(Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant()}
 $audit['node']=$nodeProof
 Json $specFile @{id=$id;sid=$user.SID.Value;session=$desktop.sessionId;sourceSha=$SourceSha;harnessSha=$env:GITHUB_SHA;binary=@{path=$binaryTarget;sha256=$binaryHash};queue=$Queue;marker=('MILKUP_SPOOL_'+$id);node=$nodeProof}
 $environment=@("SystemRoot=$env:SystemRoot","WINDIR=$env:SystemRoot","SystemDrive=$env:SystemDrive","PATH=$env:SystemRoot\System32;$(Split-Path -Parent $pwsh);$(Split-Path -Parent $node)",'GITHUB_ACTIONS=true','RUNNER_OS=Windows','RUNNER_ENVIRONMENT=github-hosted','GITHUB_REPOSITORY=Auto-Plugin/milkup',"GITHUB_REF=$env:GITHUB_REF","GITHUB_SHA=$env:GITHUB_SHA")
 if ($env:ProgramFiles) {$environment+="ProgramFiles=$env:ProgramFiles"};if (${env:ProgramFiles(x86)}) {$environment+="ProgramFiles(x86)=${env:ProgramFiles(x86)}"}
 $arguments='-NoLogo -NoProfile -File "'+(Join-Path $code 'scripts/ci/run-print-queue-standard.ps1')+'" -ChildSpec "'+$specFile+'"'
 $jobEmpty=$false;Persist
 $audit['supervisor']=[WindowsMermaidStandardUser]::Run($name,$password,$user.SID.Value,[uint32]$desktop.sessionId,'pure-standard',$pwsh,$arguments,$code,$environment,600000)
 $jobEmpty=$audit.supervisor.jobEmpty -eq $true -and $audit.supervisor.cleanupErrors.Count -eq 0
 $key='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\'+$user.SID.Value
 if (Test-Path -LiteralPath $key) {
  $profile=[Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $key).ProfileImagePath);Plain $profile
  $scratch=Join-Path $profile ('.milkup-print-'+$id)
  if ($jobEmpty -and (Test-Path -LiteralPath $scratch)) {
   $evidenceNames=@('child-identity.json','child-error.json')
   $evidencePath=Join-Path $scratch 'evidence'
   if(Test-Path -LiteralPath $evidencePath){$items=@(Get-ChildItem -LiteralPath $evidencePath -File);if($items.Count -gt 32){throw 'Evidence file-count budget'};foreach($item in $items){$evidenceNames+=('evidence/'+$item.Name)}}
   foreach($leaf in $evidenceNames) {
    $file=Join-Path $scratch $leaf
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) {continue};Plain $file
    if ((Get-Item -LiteralPath $file).Length -gt 8MB) {throw 'Health evidence file exceeds bounded budget'}
    Copy-Item -LiteralPath $file -Destination (Join-Path $EvidenceDirectory ([IO.Path]::GetFileName($leaf)))
   }
  }
 }
 if (!$jobEmpty -or !$audit.supervisor.success -or $audit.supervisor.activeBeforeOuterCleanup -ne 0) {throw 'Owned non-elevated health coordinator failed; outer cleanup is not product proof'}
 $result=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'print-child.json') -Raw | ConvertFrom-Json
 if($result.status -cne 'passed' -or $result.accountSid -cne $user.SID.Value -or $result.binarySha256 -cne $binaryHash -or $result.forcedCleanup -ne $false -or !$result.normalExit -or !$result.defaultUnchanged){throw 'Complete ordinary-user application queue evidence required'}
 $audit.status='passed'
} catch {$audit['error']=$_ | Out-String} finally {
 if ($null -ne $user -and $jobEmpty) {
  try {
   $actual=Get-LocalUser -SID $user.SID
   if ($actual.Name -cne $name -or $actual.Description -cne $description) {throw 'Temporary account ownership changed'}
   $key='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\'+$user.SID.Value
   if (Test-Path -LiteralPath $key) {
    $profile=[Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $key).ProfileImagePath)
    for($i=0;$i -lt 5;$i++) {try {[WindowsMermaidStandardUser]::DeleteTemporaryProfile($user.SID.Value);break}catch {if($i -eq 4){throw};Start-Sleep -Milliseconds 250}}
   }
   if ((Test-Path -LiteralPath $key) -or ($profile -and (Test-Path -LiteralPath $profile)) -or (Test-Path -LiteralPath ('Registry::HKEY_USERS\'+$user.SID.Value))) {throw 'Exact profile removal unconfirmed'}
   $audit.profileDeleted=$true
   Remove-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]'S-1-5-32-545') -Member $user
   Remove-LocalUser -SID $user.SID
   if ((Get-LocalUser -SID $user.SID -ErrorAction SilentlyContinue) -or @(Get-LocalGroupMember -SID 'S-1-5-32-545' | Where-Object {$_.SID.Value -ceq $user.SID.Value}).Count) {throw 'Exact account/group cleanup unconfirmed'}
   $audit.accountDeleted=$true
  } catch {$audit.cleanupErrors+=($_ | Out-String)}
 }
 if ($jobEmpty -and (Test-Path -LiteralPath $stage)) {try {Plain $stage;Remove-Item -LiteralPath $stage -Recurse -Force;$audit.stageRemoved=!(Test-Path -LiteralPath $stage)}catch {$audit.cleanupErrors+=($_ | Out-String)}}
 $password.Dispose()
 if ($audit.cleanupErrors.Count -or !$audit.accountDeleted -or !$audit.profileDeleted -or !$audit.stageRemoved) {$audit.status='failed'}
 Persist
}
if ($audit.status -cne 'passed') {throw 'Standard-account application print failed; retained supervisor and child evidence'}
