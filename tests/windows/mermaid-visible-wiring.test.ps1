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
