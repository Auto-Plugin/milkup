# Six sequential launches of the same installed image and approved catalogue.
# No editor input; fresh browser profile each time; no attachment in 'none'.
param([string]$Binary,[string]$Document,[string]$EvidenceDirectory,[string]$NodeExecutable,[int]$DriverPort,[string]$RuntimeVersion,[string]$SourceSha)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -TypeDefinition 'public static class StartupComparisonDrain { public static bool Wait(System.Diagnostics.Process p) { return System.Threading.Tasks.Task.Run(() => p.WaitForExit()).Wait(5000); } }'
foreach($name in @('WEBVIEW2_USER_DATA_FOLDER','WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','TAURI_WEBVIEW_AUTOMATION','MILKUP_MERMAID_NATIVE_AUDIT')) {
 if ($null -ne [Environment]::GetEnvironmentVariable($name,'Process')) { throw "Comparison requires a clean coordinator environment: $name" }
}
$catalog=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) 'app.milkup.desktop/plugins/catalog-v1.json'
if (!(Test-Path -LiteralPath $catalog -PathType Leaf) -or (Get-Item -LiteralPath $catalog).Length -gt 16MB) {throw 'Existing approved bounded catalogue required'}
$catalogHash=(Get-FileHash -LiteralPath $catalog -Algorithm SHA256).Hash
$imageHash=(Get-FileHash -LiteralPath $Binary -Algorithm SHA256).Hash
$documentHash=(Get-FileHash -LiteralPath $Document -Algorithm SHA256).Hash
$summary=[ordered]@{status='running';sourceSha=$SourceSha;harnessSha=$env:GITHUB_SHA;imageSha256=$imageHash;catalogSha256=$catalogHash;documentSha256=$documentHash;order=@('early','late','none','none','late','early');trials=@();boundary='Same installed bytes and approved catalogue, fresh browser profiles. OS file cache is not cold/reset. No attachment does not measure DOM decode. Small counterbalanced diagnostic, not causal proof.'}
function SaveComparison {$summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'startup-comparison.json') -Encoding utf8}
SaveComparison
try {
 for($i=0;$i -lt $summary.order.Count;$i++) {
  $mode=$summary.order[$i];$prefix="startup-$i"
  $profile=Join-Path $env:RUNNER_TEMP "$prefix-browser"
  if (Test-Path -LiteralPath $profile) {throw 'Fresh browser profile required'}
  $null=New-Item -ItemType Directory $profile
  foreach($entry in @(@($Binary,$imageHash),@($Document,$documentHash),@($catalog,$catalogHash))) {
   if ((Get-FileHash -LiteralPath $entry[0] -Algorithm SHA256).Hash -cne $entry[1]) {throw 'Controlled input changed between launches'}
  }
  $port=0
  $launchEnv=@{WEBVIEW2_USER_DATA_FOLDER=$profile;MILKUP_MERMAID_NATIVE_AUDIT='1'}
  if ($mode -cne 'none') {
   $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
   try {$listener.Start();$port=$listener.LocalEndpoint.Port} finally {$listener.Stop()}
   $launchEnv.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$port --remote-debugging-address=127.0.0.1"
   $launchEnv.TAURI_WEBVIEW_AUTOMATION='true'
  }
  $stdout=Join-Path $EvidenceDirectory "$prefix.product.stdout.log"
  $stderr=Join-Path $EvidenceDirectory "$prefix.product.stderr.log"
  $specFile=Join-Path $EvidenceDirectory "$prefix.spec.json"
  $reportFile=Join-Path $EvidenceDirectory "$prefix.observation.json"
  $trial=[ordered]@{index=$i;mode=$mode;status='running';forcedCleanup=$false;environment=$launchEnv}
  $summary.trials+=,$trial
  $process=$null;$birth=$null
  try {
   $process=Start-Process -FilePath $Binary -ArgumentList @($Document) -Environment $launchEnv -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
   $birth=$process.StartTime.ToUniversalTime().Ticks
   $trial['identity']=@{pid=$process.Id;creationTicks=$birth;creationUtc=$process.StartTime.ToUniversalTime().ToString('o');image=$Binary}
   $spec=@{schema=1;mode=$mode;pid=$process.Id;creationTicks=$birth.ToString();creationUtc=$trial.identity.creationUtc;image=$Binary;sourceSha=$SourceSha;harnessSha=$env:GITHUB_SHA;document=$Document;documentSha256=$documentHash.ToLowerInvariant();stderr=$stderr;stdout=$stdout;report=$reportFile;driverPort=$DriverPort;debugPort=$port;runtimeVersion=$RuntimeVersion}
   $spec | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $specFile -Encoding utf8
   SaveComparison
   $trial['observer']=[WindowsMermaidStandardUser]::RunNodeScript($NodeExecutable,[string[]]@((Join-Path $PSScriptRoot 'startup-comparison-observe.mjs'),$specFile),$PSScriptRoot,(Join-Path $EvidenceDirectory "$prefix.node.stdout.log"),(Join-Path $EvidenceDirectory "$prefix.node.stderr.log"),50000)
   if ($trial.observer.status -cne 'passed') {throw 'Startup observation failed; no success inferred from cleanup'}
   if ((Get-Item -LiteralPath $reportFile).Length -gt 1MB) {throw 'Observation report budget'}
   $observation=Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
   if ($observation.status -cne 'observed-await-normal-close' -or $observation.inputs -ne 0 -or ($mode -ceq 'none' -and $observation.connectionAttempts -ne 0)) {throw 'Required observation/zero-input boundary missing'}
   $windows=@([MilkupInstallWindow]::Observe($process.Id,$birth,$Binary))
   $roots=@($windows | Where-Object {$_.productRoot})
   if ($roots.Count -ne 1) {throw 'Unique visible owned Tauri window required'}
   $trial['windows']=$windows
   [MilkupInstallWindow]::Close($roots[0].hwnd,$process.Id,$birth,$Binary)
   if (!$process.WaitForExit(15000) -or $process.ExitCode -ne 0) {throw 'Comparison application did not close normally'}
   # Parameterless wait additionally drains Start-Process redirected stream handlers.
   if (![StartupComparisonDrain]::Wait($process)) {throw 'Redirected product streams did not drain in 5 seconds'}
   $trial['normalExitCode']=$process.ExitCode
   if ($mode -cne 'none') {
    try {$null=Invoke-RestMethod -Uri "http://127.0.0.1:$DriverPort/session/$($observation.sessionId)" -Method Delete -TimeoutSec 5}
    catch {$trial['detachDiagnostic']=$_.Exception.Message}
   }
   $trial['verification']=[WindowsMermaidStandardUser]::RunNodeScript($NodeExecutable,[string[]]@((Join-Path $PSScriptRoot 'startup-comparison-verify.mjs'),$specFile),$PSScriptRoot,(Join-Path $EvidenceDirectory "$prefix.verify.json"),(Join-Path $EvidenceDirectory "$prefix.verify.stderr.log"),10000)
   if ($trial.verification.status -cne 'passed') {throw 'Complete post-exit startup log verification failed'}
   foreach($entry in @(@($Binary,$imageHash),@($Document,$documentHash),@($catalog,$catalogHash))) {
    if ((Get-FileHash -LiteralPath $entry[0] -Algorithm SHA256).Hash -cne $entry[1]) {throw 'Controlled input changed after launch'}
   }
   $trial['nativeFirstReadyFromCreationMs']=$observation.nativeFirstReadyFromCreationMs
   $trial.status='passed'
  } catch {$trial.status='failed';$trial['error']=$_ | Out-String;throw}
  finally {
   if ($null -ne $process) {
    if (!$process.HasExited) {
     $trial.forcedCleanup=$true
     if ($process.StartTime.ToUniversalTime().Ticks -ne $birth -or ![StringComparer]::OrdinalIgnoreCase.Equals($process.Path,$Binary)) {throw 'Comparison cleanup identity mismatch'}
     $process.Kill($true);$null=$process.WaitForExit(5000)
    }
    $process.Dispose()
   }
   SaveComparison
  }
 }
 $summary.status='passed'
} catch {$summary.status='failed';$summary['error']=$_ | Out-String;throw}
finally {SaveComparison}
