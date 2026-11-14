# Uses the existing held-Job/verified-token coordinator. Only a newly owned user
# and newly created staging directories are changed; existing desktop/UAC ACLs stay intact.
[CmdletBinding(DefaultParameterSetName='Parent')]
param(
 [Parameter(Mandatory,ParameterSetName='Parent')][string]$Directory,
 [Parameter(Mandatory,ParameterSetName='Parent')][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceSha,
 [Parameter(Mandatory,ParameterSetName='Parent')][ValidateSet('windows-standard','windows-offline')][string]$Variant,
 [Parameter(Mandatory,ParameterSetName='Parent')][string]$EvidenceDirectory,
 [Parameter(ParameterSetName='Parent')][switch]$DocumentHealth,
 [Parameter(ParameterSetName='Parent')][switch]$NativeIme,
 [Parameter(ParameterSetName='Parent')][switch]$SignedRecovery,
 [Parameter(ParameterSetName='Parent')][string]$CrossVersionDirectory,
 [Parameter(ParameterSetName='Parent')][string]$InAppUpdateDirectory,
 [Parameter(ParameterSetName='Parent')][string]$InAppUpdateFixtureDirectory,
 [Parameter(ParameterSetName='Parent')][switch]$StartupComparison,
 [Parameter(Mandatory,ParameterSetName='Child')][string]$ChildSpec
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or $env:GITHUB_REF -cnotin @('refs/heads/dot/release-quality-integration-20261112','refs/heads/dot/gap-native-capabilities-20261114')) { throw 'Exact ephemeral candidate runner required' }
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
 if ($env:GITHUB_REF -ceq 'refs/heads/dot/gap-native-capabilities-20261114' -and !($spec.nativeIme -or $spec.signedRecovery -or $spec.inAppUpdate)) { throw 'Native input branch requires its explicit scoped mode' }
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
 $scratch=Join-Path $profile ('.milkup-repair-'+$spec.id)
 NewDir $scratch
 $temp=Join-Path $scratch 'temp';NewDir $temp
 $env:USERPROFILE=$profile;$env:APPDATA=$roaming;$env:LOCALAPPDATA=$local;$env:TEMP=$temp;$env:TMP=$temp;$env:RUNNER_TEMP=$temp
 Json (Join-Path $scratch 'child-identity.json') @{identity=$identity;desktop=$desktop;knownFolders=@{profile=$profile;roaming=$roaming;local=$local};sourceSha=$spec.sourceSha;harnessSha=$spec.harnessSha}
 Set-Location $repo
 $originalLanguages=$null
 $languageAudit=@{scope='Only this newly created ordinary CI account; no language pack install or system defaults';status='not-requested'}
 function LanguageShape($list) { @($list | ForEach-Object { [ordered]@{tag=$_.LanguageTag;tips=@($_.InputMethodTips);spellchecking=$_.Spellchecking;handwriting=$_.Handwriting} }) | ConvertTo-Json -Depth 5 -Compress }
 try {
  if ($spec.nativeIme) {
   $pinyinTip='0804:{81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E}{FA550B04-5AD7-411F-A5AC-CA038EC515D7}'
   $originalLanguages=Get-WinUserLanguageList
   $languageAudit['before']=LanguageShape $originalLanguages
   $temporaryLanguages=Get-WinUserLanguageList
   if (!@($temporaryLanguages | Where-Object {$_.InputMethodTips -ccontains $pinyinTip}).Count) { $temporaryLanguages.Add('zh-CN') }
   Set-WinUserLanguageList -LanguageList $temporaryLanguages -Force
   $observedLanguages=Get-WinUserLanguageList
   $languageAudit['configured']=LanguageShape $observedLanguages
   if (!@($observedLanguages | Where-Object {$_.InputMethodTips -ccontains $pinyinTip}).Count) { throw 'Owned account Chinese input profile unavailable' }
   $languageAudit.status='configured-await-restore'
   Json (Join-Path $scratch 'native-ime-languages.json') $languageAudit
  }

  $crossInput=if ($spec.crossVersion) {$spec.crossInput} else {''}
  $updateInput=if ($spec.inAppUpdate) {$spec.updateInput} else {''}
  $fixtureInput=if ($spec.inAppUpdate) {$spec.fixtureInput} else {''}
  & (Join-Path $repo 'scripts/release/install-candidate.ps1') -Directory $spec.input -SourceSha $spec.sourceSha -Variant $spec.variant -EvidenceDirectory (Join-Path $scratch 'evidence') -RepairSameVersion:(!$spec.inAppUpdate) -RepairHealth -DocumentHealth:([bool]$spec.documentHealth) -StartupComparison:([bool]$spec.startupComparison) -NativeIme:([bool]$spec.nativeIme) -SignedRecovery:([bool]$spec.signedRecovery) -NodeExecutable $spec.node.path -CrossVersionDirectory $crossInput -InAppUpdateDirectory $updateInput -InAppUpdateFixtureDirectory $fixtureInput
  exit 0
 } catch { Json (Join-Path $scratch 'child-error.json') @{error=($_ | Out-String)};exit 1 } finally {
  if ($null -ne $originalLanguages) {
   try {
    Set-WinUserLanguageList -LanguageList $originalLanguages -Force
    $languageAudit['restored']=LanguageShape (Get-WinUserLanguageList)
    if ($languageAudit.restored -cne $languageAudit.before) { throw 'Exact owned user language restoration unconfirmed' }
    $languageAudit.status='restored'
   } catch { $languageAudit.status='failed';$languageAudit['error']=$_ | Out-String;throw } finally { Json (Join-Path $scratch 'native-ime-languages.json') $languageAudit }
  }
 }
}
if ($env:GITHUB_REF -ceq 'refs/heads/dot/gap-native-capabilities-20261114' -and !($NativeIme -or $SignedRecovery -or $InAppUpdateDirectory)) { throw 'Native input branch requires its explicit scoped mode' }
if ($CrossVersionDirectory -and (!$SignedRecovery -or $NativeIme)) { throw 'Cross-version requires explicit signed-recovery mode' }
if ($InAppUpdateDirectory -and (!$InAppUpdateFixtureDirectory -or $SignedRecovery -or $NativeIme -or $CrossVersionDirectory -or $DocumentHealth -or $StartupComparison)) {throw 'Dedicated in-app fixture scope required'}
Plain $Directory
if ((git rev-parse HEAD).Trim() -cne $env:GITHUB_SHA) { throw 'Harness must be exact workflow checkout' }
NewDir $EvidenceDirectory
$id=[guid]::NewGuid().ToString('N');$name='mkrh'+$id.Substring(0,14)
$description='Milkup repair '+$id
$stage=Join-Path $repo ('.tmp/repair-health-'+$id)
$user=$null;$password=[Security.SecureString]::new();$jobEmpty=$true;$profile=$null
$audit=[ordered]@{status='failed';harnessSha=$env:GITHUB_SHA;sourceSha=$SourceSha;id=$id;accountName=$name;accountSid=$null;accountDeleted=$false;profileDeleted=$false;stageRemoved=$false;securityPolicyChanged=$false;existingDesktopAclChanged=$false;outerCleanupProvesProductCleanup=$false;cleanupErrors=@()}
function Persist { Json (Join-Path $EvidenceDirectory 'standard-repair-supervisor.json') $audit }
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
 $files=@('scripts/release/run-repair-health-standard.ps1','scripts/release/install-candidate.ps1','scripts/release/WindowsInstallWindow.cs','scripts/release/repair-health.mjs','scripts/release/startup-comparison.ps1','scripts/release/InstalledStartupProcess.cs','scripts/release/startup-comparison-observe.mjs','scripts/release/startup-comparison-contract.mjs','scripts/release/startup-comparison-verify.mjs','scripts/release/installed-document-health.mjs','scripts/release/installed-dialog-input.ps1','scripts/release/InstalledDialogInput.cs','scripts/release/verify-candidate.mjs','scripts/ci/WindowsMermaidStandardUser.cs','tests/windows/mermaid-product-e2e.mjs','tests/windows/mermaid-frontend-contract.mjs')
 if ($NativeIme) { $files+=@('scripts/ci/windows-owned-ime-input.exe','scripts/ci/native-ime-contract.mjs') }
 if ($SignedRecovery) { $files+=@('scripts/release/test-support/prepare-native-recovery.mjs','scripts/release/test-support/authorize-native-upgrade.mjs','scripts/release/test-support/signing-fixture.mjs','scripts/release/prepare-recovery-kit.mjs','scripts/release/inspect-recovery-installer.ps1','scripts/release/update-readiness.mjs','scripts/release/cross-version-state.ps1','scripts/release/cross-version-path.ps1') }
 if ($InAppUpdateDirectory) { $files+=@('scripts/release/in-app-update-native.ps1','scripts/release/in-app-update-ui.mjs','scripts/release/test-support/in-app-update-server.mjs','scripts/release/test-support/signing-fixture.mjs','scripts/release/cross-version-state.ps1','scripts/release/cross-version-path.ps1') }
 $audit['stagedCode']=@()
 foreach($leaf in $files) {
  $source=Join-Path $repo $leaf;Plain $source
  $target=Join-Path $code $leaf;$null=New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)
  Copy-Item -LiteralPath $source -Destination $target
  $hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -cne $hash) { throw 'Staged code bytes changed' }
  $audit.stagedCode+=@{path=$leaf;sha256=$hash.ToLowerInvariant()}
 }
 $raw=& node (Join-Path $repo 'scripts/release/verify-candidate.mjs') $Directory $SourceSha $Variant
 if ($LASTEXITCODE -ne 0) { throw 'Original installer verification failed' };$receipt=$raw | ConvertFrom-Json
 $inputRoot=Join-Path $stage 'input';NewDir $inputRoot
 foreach($source in @((Join-Path $Directory 'manifest.json'),$receipt.installer.path)) {Plain $source;Copy-Item -LiteralPath $source -Destination $inputRoot}
 $crossInput=''
 if ($CrossVersionDirectory) {
  Plain $CrossVersionDirectory
  $crossRaw=& node (Join-Path $repo 'scripts/release/verify-candidate.mjs') $CrossVersionDirectory '5fd33f2b63de2755268af6d669b0f4b3b1f21b96' $Variant
  if ($LASTEXITCODE -ne 0) { throw 'Cross-version installer verification failed' }
  $crossReceipt=$crossRaw | ConvertFrom-Json
  if ($crossReceipt.installer.sha256 -cne 'e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75') { throw 'Exact cross-version bytes required' }
  $crossInput=Join-Path $stage 'cross-input';NewDir $crossInput
  foreach($source in @((Join-Path $CrossVersionDirectory 'manifest.json'),$crossReceipt.installer.path)) {Plain $source;Copy-Item -LiteralPath $source -Destination $crossInput}
 }
 $updateInput='';$fixtureInput=''
 if ($InAppUpdateDirectory) {
  Plain $InAppUpdateDirectory;Plain $InAppUpdateFixtureDirectory
  $updateRaw=& node (Join-Path $repo 'scripts/release/verify-candidate.mjs') $InAppUpdateDirectory '5fd33f2b63de2755268af6d669b0f4b3b1f21b96' $Variant
  if ($LASTEXITCODE -ne 0) {throw 'In-app target receipt invalid'}
  $updateReceipt=$updateRaw | ConvertFrom-Json
  if ($updateReceipt.installer.sha256 -cne 'e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75') {throw 'Exact existing target bytes required'}
  $updateInput=Join-Path $stage 'update-input';NewDir $updateInput
  foreach($source in @((Join-Path $InAppUpdateDirectory 'manifest.json'),$updateReceipt.installer.path)) {Plain $source;Copy-Item -LiteralPath $source -Destination $updateInput}
  $fixtureInput=Join-Path $stage 'fixture-input';NewDir $fixtureInput
  foreach($leaf in @('fixture-manifest.json','milkup-desktop.exe')) { $source=Join-Path $InAppUpdateFixtureDirectory $leaf;Plain $source;Copy-Item -LiteralPath $source -Destination $fixtureInput }
  $f=Get-Content -LiteralPath (Join-Path $fixtureInput 'fixture-manifest.json') -Raw | ConvertFrom-Json
  if ($f.sourceSha -cne 'dea1f2a437e43303f185d47ad2014156038d8514' -or $f.feature -cne 'ci-update-fixture' -or (Get-FileHash -LiteralPath (Join-Path $fixtureInput 'milkup-desktop.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $f.sha256) {throw 'Exact isolated feature binary required'}
 }
 $specFile=Join-Path $code 'repair-spec.json'
 $node=(Get-Command node -CommandType Application | Select-Object -First 1).Source
 $pwsh=(Get-Command pwsh -CommandType Application | Select-Object -First 1).Source
 Plain $node
 $nodeProof=@{path=$node;sha256=(Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant()}
 $audit['node']=$nodeProof
 Json $specFile @{id=$id;sid=$user.SID.Value;session=$desktop.sessionId;sourceSha=$SourceSha;harnessSha=$env:GITHUB_SHA;input=$inputRoot;variant=$Variant;node=$nodeProof;nativeIme=[bool]$NativeIme;signedRecovery=[bool]$SignedRecovery;crossVersion=[bool]$CrossVersionDirectory;crossInput=$crossInput;inAppUpdate=[bool]$InAppUpdateDirectory;updateInput=$updateInput;fixtureInput=$fixtureInput;documentHealth=[bool]$DocumentHealth;startupComparison=[bool]$StartupComparison}
 $environment=@("SystemRoot=$env:SystemRoot","WINDIR=$env:SystemRoot","SystemDrive=$env:SystemDrive","PATH=$env:SystemRoot\System32;$env:SystemRoot\System32\WindowsPowerShell\v1.0;$(Split-Path -Parent $pwsh);$(Split-Path -Parent $node)",'GITHUB_ACTIONS=true','RUNNER_OS=Windows','RUNNER_ENVIRONMENT=github-hosted','GITHUB_REPOSITORY=Auto-Plugin/milkup',"GITHUB_REF=$env:GITHUB_REF","GITHUB_SHA=$env:GITHUB_SHA")
 if ($env:ProgramFiles) {$environment+="ProgramFiles=$env:ProgramFiles"};if (${env:ProgramFiles(x86)}) {$environment+="ProgramFiles(x86)=${env:ProgramFiles(x86)}"}
 $arguments='-NoLogo -NoProfile -File "'+(Join-Path $code 'scripts/release/run-repair-health-standard.ps1')+'" -ChildSpec "'+$specFile+'"'
 $jobEmpty=$false;Persist
 $audit['supervisor']=[WindowsMermaidStandardUser]::Run($name,$password,$user.SID.Value,[uint32]$desktop.sessionId,'pure-standard',$pwsh,$arguments,$code,$environment,600000)
 $jobEmpty=$audit.supervisor.jobEmpty -eq $true -and $audit.supervisor.cleanupErrors.Count -eq 0
 $key='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\'+$user.SID.Value
 if (Test-Path -LiteralPath $key) {
  $profile=[Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $key).ProfileImagePath);Plain $profile
  $scratch=Join-Path $profile ('.milkup-repair-'+$id)
  if ($jobEmpty -and (Test-Path -LiteralPath $scratch)) {
   $evidenceNames=@('child-identity.json','child-error.json','native-ime-languages.json','evidence/installation.json','evidence/unchanged-document.md','evidence/repair-health-before.json','evidence/repair-health-after.json','evidence/repair-health-before.png','evidence/repair-health-after.png','evidence/repair-health-image.png','evidence/repair-health-initial-image.png','evidence/driver.stdout.log','evidence/driver.stderr.log','evidence/verified-receipt.json','evidence/receipt.stderr.log','evidence/health-before.stdout.log','evidence/health-before.stderr.log','evidence/health-after.stdout.log','evidence/health-after.stderr.log','evidence/installed-document-health.json','evidence/identity-bravo.md','evidence/alpha.html','evidence/alpha.pdf','evidence/bravo.html','evidence/bravo.pdf')
   $evidenceNames+=@('evidence/in-app-update-ui.json','evidence/in-app-target-receipt.json','evidence/target.stderr.log','evidence/endpoint-report.json','evidence/public-fixture.json','evidence/accepted-manifest.json','evidence/endpoint.stdout.log','evidence/endpoint.stderr.log','evidence/in-app-ui.stdout.log','evidence/in-app-ui.stderr.log')
   foreach($i in 0..5){$evidenceNames+=@("evidence/native-dialog-$i.json","evidence/native-dialog-$i.json.log")}
   foreach($label in @('before-upgrade','after-upgrade','before-recovery','after-recovery','after-uninstall','after-in-app-health')) {$evidenceNames+="evidence/cross-version-$label.json"}
   $evidenceNames+=@('evidence/upgrade-authorization.json','evidence/upgrade-authorization.stdout.log','evidence/upgrade-authorization.stderr.log','evidence/upgrade-receipt.json','evidence/upgrade-receipt.stderr.log','evidence/repair-health-upgrade.json','evidence/repair-health-upgrade.png','evidence/repair-health-upgrade-image.png','evidence/repair-health-after-image.png','evidence/health-upgrade.stdout.log','evidence/health-upgrade.stderr.log')
   $evidenceNames+=@('evidence/document-alpha.png','evidence/document-bravo.png','evidence/document-unsaved-close.png')
   $evidenceNames+=@('evidence/startup-comparison.json','evidence/native-recovery-preparation.json','evidence/recovery-preparation.stdout.log','evidence/recovery-preparation.stderr.log','evidence/native-recovery-kit/recovery-receipt.json','evidence/native-recovery-kit/signed-envelope.json','evidence/native-recovery-kit/SHA256SUMS.txt','evidence/native-recovery-kit/RECOVERY.txt')
   foreach($i in 0..5) {foreach($suffix in @('spec.json','observation.json','product.stdout.log','product.stderr.log','node.stdout.log','node.stderr.log','verify.json','verify.stderr.log','catalog-before.json','catalog-after.json')) {$evidenceNames+="evidence/startup-$i.$suffix"}}
   foreach($leaf in $evidenceNames) {
    $file=Join-Path $scratch $leaf
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) {continue};Plain $file
    if ((Get-Item -LiteralPath $file).Length -gt 8MB) {throw 'Health evidence file exceeds bounded budget'}
    Copy-Item -LiteralPath $file -Destination (Join-Path $EvidenceDirectory ([IO.Path]::GetFileName($leaf)))
   }
  }
 }
 if (!$jobEmpty -or !$audit.supervisor.success -or $audit.supervisor.activeBeforeOuterCleanup -ne 0) {throw 'Owned non-elevated health coordinator failed; outer cleanup is not product proof'}
 $result=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'installation.json') -Raw | ConvertFrom-Json
 if ($result.status -cne 'passed' -or $result.accountSid -cne $user.SID.Value -or $result.sourceSha -cne $SourceSha -or $result.forcedCleanup -ne $false) {throw 'Complete same-user installed health proof required'}
 if ($InAppUpdateDirectory) {
  if ($result.inAppUpdate -cne 'real-check-download-verify-protected-save-install-automatic-restart-and-health-passed') {throw 'Complete in-app proof required'}
 } elseif ($result.recoveryHealth -cne 'real-edit-save-and-persisted-diagrams-switch-passed; not all configuration or migration health') {throw 'Complete repair proof required'}
 if ($NativeIme) {
  $languages=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'native-ime-languages.json') -Raw | ConvertFrom-Json
  if ($languages.status -cne 'restored' -or $languages.before -cne $languages.restored) { throw 'Exact temporary language settings restoration required' }
 }
 $expectedSigned=if ($CrossVersionDirectory) {'ephemeral-test-authority-manual-older-version-recovery-and-health-passed; not automatic rollback'} else {'ephemeral-test-authority-same-version-repair-and-health-passed; not production update or rollback'}
 if ($SignedRecovery -and $result.signedRecovery -cne $expectedSigned) { throw 'Real signed recovery use and health proof required' }
 if ($StartupComparison) {
  $comparison=Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'startup-comparison.json') -Raw | ConvertFrom-Json
  if ($comparison.status -cne 'passed' -or $comparison.trials.Count -ne 6 -or @($comparison.trials | Where-Object {$_.status -cne 'passed' -or $_.forcedCleanup}).Count -ne 0) {throw 'Complete six-launch comparison required'}
 }
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
if ($audit.status -cne 'passed') {throw 'Standard-account repair health failed; retained supervisor and child evidence'}
