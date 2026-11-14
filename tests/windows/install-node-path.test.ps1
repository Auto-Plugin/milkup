$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Parse([string]$Name) {
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "../../scripts/release/$Name"),[ref]$tokens,[ref]$errors)
 if ($errors.Count) {throw ($errors | Out-String)}
 return $ast
}
$install=Parse 'install-candidate.ps1'
$branches=@($install.FindAll({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.StartsWith('if ($NodeExecutable)')},$true))
if ($branches.Count -ne 1 -or !$branches[0].Clauses[0].Item2.Extent.Text.Contains('[WindowsMermaidStandardUser]::RunNodeScript(')) {throw 'Absolute Node must select bounded receipt path independently of RepairHealth'}
$RepairHealth=$false;$NodeExecutable='absolute-tested-node'
if (!(& ([scriptblock]::Create($branches[0].Clauses[0].Item1.Extent.Text)))) {throw 'Install-only must select exact Node path'}
$parent=Parse 'run-repair-health-standard.ps1'
$calls=@($parent.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.Extent.Text.StartsWith('& (Join-Path') -and $n.Extent.Text.Contains("'scripts/release/install-candidate.ps1'")},$true))
if ($calls.Count -ne 2) {throw 'Expected install-only and repair paths'}
foreach($call in $calls) {
 if (!$call.Extent.Text.Contains('-NodeExecutable $spec.node.path')) {throw 'Every isolated child path must pass parent-verified Node'}
}
# Actual native process launch without shell/PATH lookup. Parent hashing and
# RunNodeScript's Win32 identity checks are exercised by the following real smoke.
$node=(Get-Command node -CommandType Application | Select-Object -First 1).Source
$info=[Diagnostics.ProcessStartInfo]::new($node)
$info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
$info.Environment['PATH']=''
$info.ArgumentList.Add('-e');$info.ArgumentList.Add('process.stdout.write("absolute-node-ok")')
$p=[Diagnostics.Process]::Start($info)
try {
 if (!$p.WaitForExit(10000)) {$p.Kill();throw 'Bounded Node probe timed out'}
 if ($p.ExitCode -ne 0 -or $p.StandardOutput.ReadToEnd() -cne 'absolute-node-ok') {throw 'Absolute Node launch failed with empty PATH'}
} finally {$p.Dispose()}
'Non-repair branch and isolated child retain exact Node; empty-PATH process probe passed'
