$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$tokens=$null; $errors=$null
$file=Join-Path $PSScriptRoot '../../scripts/release/run-repair-health-standard.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
# Execute the actual parent verification blocks without running account creation.
$blocks=@($ast.FindAll({param($node)
 $node -is [Management.Automation.Language.IfStatementAst] -and
 ($node.Extent.Text.StartsWith('if ($result.status') -or $node.Extent.Text.StartsWith('if ($InstallOnly)'))
},$true))
if ($blocks.Count -ne 2) { throw 'Expected exact common and install-only verifier blocks' }
$verify=[scriptblock]::Create(($blocks | ForEach-Object {$_.Extent.Text}) -join "`n")
function Fixture {
 return '{"status":"passed","accountSid":"test-owned-sid","sourceSha":"test-sha","forcedCleanup":false,"sameVersionRepair":"not-run","recoveryHealth":"not-run","phases":[{"name":"normal-close","detail":{"exitCode":0}},{"name":"uninstall-and-document-preservation","detail":{"applicationRemoved":true}}]}' | ConvertFrom-Json
}
$user=[pscustomobject]@{SID=[pscustomobject]@{Value='test-owned-sid'}}
$SourceSha='test-sha'; $InstallOnly=$true
$result=Fixture; & $verify
$mutations=@(
 { $result.accountSid='other' },
 { $result.sourceSha='other' },
 { $result.status='failed' },
 { $result.forcedCleanup=$true },
 { $result.phases[0].detail.exitCode=$null },
 { $result.phases[0].detail.exitCode=1 },
 { $result.phases=@($result.phases[1]) },
 { $result.phases+=@($result.phases[0]) },
 { $result.phases[1].detail.applicationRemoved=$false },
 { $result.recoveryHealth='claimed' },
 { $result.sameVersionRepair='unexpected' }
)
foreach ($change in $mutations) {
 $result=Fixture; . $change; $rejected=$false
 try { & $verify } catch { $rejected=$true }
 if (!$rejected) { throw "Verifier accepted invalid evidence: $change" }
}
$InstallOnly=$false; $result=Fixture; $rejected=$false
try { & $verify } catch { $rejected=$true }
if (!$rejected) { throw 'Install-only evidence must not satisfy repair health' }
$result.recoveryHealth='real-edit-save-and-persisted-diagrams-switch-passed; not all configuration or migration health'
& $verify
'Install-only and unchanged repair verifier: 2 positive, 12 rejection cases passed'
