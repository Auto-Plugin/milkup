# One normal installed launch, owned byte-stream capture and strict normal-close proof.
param([string]$Binary,[string]$Document,[string]$EvidenceDirectory,[string]$NodeExecutable,[int]$DriverPort,[int]$DebugPort,[string]$Profile,[string]$RuntimeVersion,[string]$SourceSha)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -Path (Join-Path $PSScriptRoot 'InstalledStartupProcess.cs')
$prefix=Join-Path $EvidenceDirectory 'mermaid-visible'
$summary=[ordered]@{status='running';sourceSha=$SourceSha;harnessSha=$env:GITHUB_SHA;forcedCleanup=$false;normalClose=$false;imageSha256=(Get-FileHash $Binary -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save {$summary | ConvertTo-Json -Depth 20 | Set-Content "$prefix-native.json" -Encoding utf8}
# Attempt close and complete evidence even if observation failed. Failures are
# aggregated only after close/EOF/audit, never converted to a passing receipt.
function Complete-LatencySession {
 param($Summary,[scriptblock]$Observe,[scriptblock]$Close,[scriptblock]$Drain,[scriptblock]$Audit,[scriptblock]$Persist)
 $failures=[Collections.Generic.List[string]]::new()
 foreach($stage in @(@{name='observe';action=$Observe},@{name='close';action=$Close},@{name='drain';action=$Drain},@{name='audit';action=$Audit})) {
  try { & $stage.action } catch { $failures.Add($stage.name+': '+$_.Exception.Message) }
  $Summary.stageFailures=@($failures.ToArray()); & $Persist
 }
 if($failures.Count) { throw ($failures -join "`n") }
}
$capture=$null;$process=$null;$birth=$null
try {
 $writer=[WindowsMermaidStandardUser]::RunNodeScript($NodeExecutable,[string[]]@((Join-Path $PSScriptRoot 'mermaid-visible-session.mjs'),'fixture',$Document),$PSScriptRoot,"$prefix-fixture.stdout.log","$prefix-fixture.stderr.log",10000)
 if ($writer.status -cne 'passed') {throw 'Exact latency fixture creation failed'}
 $documentHash=(Get-FileHash $Document -Algorithm SHA256).Hash.ToLowerInvariant()
 $summary.documentSha256=$documentHash
 $context=[WindowsMermaidStandardUser]::ObserveCurrentContext()
 $launchEnv=@{WEBVIEW2_USER_DATA_FOLDER=$Profile;MILKUP_MERMAID_NATIVE_AUDIT='1';WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$DebugPort --remote-debugging-address=127.0.0.1";TAURI_WEBVIEW_AUTOMATION='true'}
 $capture=[InstalledStartupProcess]::Start($Binary,$Document,$launchEnv,"$prefix-product.stdout.log","$prefix-product.stderr.log")
 $process=$capture.Product;$birth=$process.StartTime.ToUniversalTime().Ticks
 $spec=@{schema=1;pid=$process.Id;creationTicks=$birth.ToString();creationFileTime=$process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();creationUtc=$process.StartTime.ToUniversalTime().ToString('o');sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;session=$context.sessionId;image=$Binary;imageSha256=$summary.imageSha256;document=$Document;documentSha256=$documentHash;sourceSha=$SourceSha;harnessSha=$env:GITHUB_SHA;stderr="$prefix-product.stderr.log";stdout="$prefix-product.stdout.log";report="$prefix-observation.json";driverPort=$DriverPort;debugPort=$DebugPort;runtimeVersion=$RuntimeVersion}
 $spec | ConvertTo-Json -Depth 8 | Set-Content "$prefix-spec.json" -Encoding utf8
 $summary.identity=$spec;Save
 Complete-LatencySession -Summary $summary -Persist ${function:Save} -Observe {
  $summary.observer=[WindowsMermaidStandardUser]::RunNodeScript($NodeExecutable,[string[]]@((Join-Path $PSScriptRoot 'mermaid-visible-session.mjs'),'observe',"$prefix-spec.json"),$PSScriptRoot,"$prefix-node.stdout.log","$prefix-node.stderr.log",240000)
  if ($summary.observer.status -cne 'passed') {throw 'Visible session observation failed'}
  $observation=Get-Content "$prefix-observation.json" -Raw | ConvertFrom-Json
  if ($observation.status -cne 'observed-await-normal-close' -or !$observation.sessionId) {throw 'Observation incomplete'}
 } -Close {
  $windows=@([MilkupInstallWindow]::Observe($process.Id,$birth,$Binary))
  $roots=@($windows | Where-Object {$_.productRoot})
  if ($roots.Count -ne 1) {throw 'Unique held product root required'}
  $summary.windows=$windows
  [MilkupInstallWindow]::Close($roots[0].hwnd,$process.Id,$birth,$Binary)
  if (!$process.WaitForExit(15000) -or $process.ExitCode -ne 0) {throw 'Normal installed close failed'}
  $summary.normalClose=$true;$summary.exitCode=$process.ExitCode
 } -Drain {
  if (!$capture.Drain(5000)) {throw 'Product stdout/stderr EOF not proven'}
  $summary.capture=@{stdoutBytes=$capture.StdoutBytes;stderrBytes=$capture.StderrBytes;stdoutEof=$capture.StdoutEof;stderrEof=$capture.StderrEof;overflow=$capture.Overflow}
 } -Audit {
  $summary.verifier=[WindowsMermaidStandardUser]::RunNodeScript($NodeExecutable,[string[]]@((Join-Path $PSScriptRoot 'mermaid-visible-session.mjs'),'verify',"$prefix-spec.json"),$PSScriptRoot,"$prefix-verify.json","$prefix-verify.stderr.log",10000)
  if ($summary.verifier.status -cne 'passed') {throw 'Final complete frontend audit failed'}
 }
 $observation=Get-Content "$prefix-observation.json" -Raw | ConvertFrom-Json
 if ((Get-FileHash $Document -Algorithm SHA256).Hash.ToLowerInvariant() -cne $documentHash) {throw 'Diagnostic changed source bytes'}
 try {$null=Invoke-RestMethod -Uri "http://127.0.0.1:$DriverPort/session/$($observation.sessionId)" -Method Delete -TimeoutSec 5} catch {$summary.detachDiagnostic=$_.Exception.Message}
 $summary.status='passed'
} catch {
 $summary.status='failed';$summary.error=$_ | Out-String
 # Try the real close even after a measurement failure; never relabel failure as
 # acceptance or use Job cleanup as its proof. Identity uncertainty stays closed.
 if ($null -ne $process -and !$process.HasExited) {
  try {
   $roots=@([MilkupInstallWindow]::Observe($process.Id,$birth,$Binary) | Where-Object {$_.productRoot})
   if ($roots.Count -ne 1) {throw 'No unique owned root for failure close'}
   $summary.failureUiCloseAttempted=$true
   [MilkupInstallWindow]::Close($roots[0].hwnd,$process.Id,$birth,$Binary)
   $summary.failureUiCloseExited=$process.WaitForExit(15000)
   if ($summary.failureUiCloseExited) {$summary.failureUiCloseExitCode=$process.ExitCode}
  } catch {$summary.failureUiCloseError=$_.Exception.Message}
 }
 throw
}
finally {
 if ($null -ne $process -and !$process.HasExited) {
  $summary.forcedCleanup=$true
  if ($process.StartTime.ToUniversalTime().Ticks -ne $birth -or ![StringComparer]::OrdinalIgnoreCase.Equals($process.Path,$Binary)) {throw 'Owned cleanup identity changed'}
  $process.Kill($true);$null=$process.WaitForExit(5000)
 }
 if ($null -ne $capture) {try {$summary.finalDrain=$capture.Drain(5000)} catch {$summary.drainError=$_.Exception.Message};$capture.Dispose()}
 Save
}
