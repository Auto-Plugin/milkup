$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Join-Path $PSScriptRoot '../..'
foreach($leaf in @('scripts/release/run-repair-health-standard.ps1','scripts/release/install-candidate.ps1','scripts/release/mermaid-visible-session.ps1')) {
 $tokens=$null;$errors=$null
 $null=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root $leaf),[ref]$tokens,[ref]$errors)
 if ($errors.Count) {throw ($errors | Out-String)}
}
# Exercise the actual new post-exit verifier with no account/process mutation.
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts/release/run-repair-health-standard.ps1'),[ref]$tokens,[ref]$errors)
$block=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.StartsWith('if ($InstallOnly)')},$true))
if ($block.Count -ne 1) {throw 'Exact installed result verifier required'}
$verify=[scriptblock]::Create($block[0].Extent.Text)
$EvidenceDirectory='unused';$InstallOnly=$false;$MermaidLatency=$true
$script:fixture='{"status":"passed","forcedCleanup":false,"normalClose":true,"exitCode":0,"capture":{"stdoutEof":true,"stderrEof":true,"overflow":false},"verifier":{"status":"passed"}}' | ConvertFrom-Json
function Get-Content { param([string]$LiteralPath,[switch]$Raw) return ($script:fixture | ConvertTo-Json -Depth 10) }
$result=[pscustomobject]@{sameVersionRepair='not-run';recoveryHealth='not-run';mermaidLatency='measured-not-a-performance-threshold-pass'}
& $verify
foreach($change in @({$script:fixture.forcedCleanup=$true},{$script:fixture.normalClose=$false},{$script:fixture.capture.stderrEof=$false},{$script:fixture.capture.overflow=$true},{$script:fixture.verifier.status='failed'})) {
 $saved=$script:fixture | ConvertTo-Json -Depth 10
 . $change
 $rejected=$false;try {& $verify} catch {$rejected=$true}
 if (!$rejected) {throw 'Invalid normal close/EOF/audit was accepted'}
 $script:fixture=$saved | ConvertFrom-Json
}
'Latency wiring: parsed; positive and 5 negative native-result fixtures passed'

# Invoke the exact production harness orchestration with bounded fixture actions.
# Exercise observation and final-contract failures while close and EOF succeed.
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts/release/mermaid-visible-session.ps1'),[ref]$tokens,[ref]$errors)
$fn=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Complete-LatencySession'},$true))
if($fn.Count -ne 1){throw 'Exact finalization function required'}
. ([scriptblock]::Create($fn[0].Extent.Text))
foreach($failStage in @('none','observe','audit','close','drain')) {
 $script:order=[Collections.Generic.List[string]]::new();$summary=[ordered]@{normalClose=$false;forcedCleanup=$false}
 $thrown=$false
 try {
  Complete-LatencySession -Summary $summary -Persist {} -Observe { $script:order.Add('observe');if($failStage -ceq 'observe'){throw 'cursor evidence failed'} } -Close { $script:order.Add('close');if($failStage -ceq 'close'){throw 'UI close failed'};$summary.normalClose=$true } -Drain {$script:order.Add('drain');if($failStage -ceq 'drain'){throw 'EOF failed'}} -Audit {$script:order.Add('audit');if($failStage -ceq 'audit'){throw 'cursor contract failed'}}
 } catch {$thrown=$true}
 if(($script:order -join ',') -cne 'observe,close,drain,audit'){throw 'A failed stage skipped close or evidence'}
 if($thrown -ne ($failStage -cne 'none')){throw 'Failure was lost or invented'}
 if($failStage -cin @('observe','audit') -and (!$summary.normalClose -or $summary.forcedCleanup -or $summary.stageFailures.Count -ne 1)){throw 'Observation failure lost independent normal close proof'}
}
'Latency finalization: stage failure retained; close, EOF and audit always attempted; 5 cases passed'
