#Requires -Version 7.2
# Pure report fixtures and local process stubs. Never runs a native token probe.
[CmdletBinding()]
param([string]$OutputPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $PSScriptRoot '../../scripts/ci/run-windows-mermaid-token-probe.ps1'
$helper = Join-Path $PSScriptRoot '../../scripts/ci/WindowsMermaidStandardUser.cs'
Add-Type -Path $helper
$errors = $null; $tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($wrapper, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Assert-PlainPath', 'Assert-Contained', 'Read-BoundedText', 'Read-SmallJson', 'Write-Json', 'Read-BoundedEvidenceProof', 'Test-ProbeInteger', 'Read-TokenProbeMarker', 'Assert-ProbeFlag', 'Assert-TokenProbeObservation', 'Copy-TokenProbeEvidence')) {
    $function = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name }, $true))
    if ($function.Count -ne 1) { throw 'Missing or ambiguous probe function' }
    . ([scriptblock]::Create($function[0].Extent.Text))
}
$results = [Collections.Generic.List[object]]::new()
function Case([string]$CaseLabel, [scriptblock]$Body) {
    try { & $Body } catch { throw ($CaseLabel + ': ' + $_.Exception.Message) }
    $results.Add(@{ name = $CaseLabel; passed = $true })
}
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Reject([scriptblock]$Body) { $caught = $false; try { & $Body } catch { $caught = $true }; Assert-True $caught 'Invalid probe evidence was admitted' }
function New-Observation {
    return @{
        schema = 1; status = 'observed'; accountKind = 'pure-standard'; failedStage = $null; parentPid = 101; childPid = 102
        diagnosticOnly = $true; renderPolicyChanged = $false; mermaidSourceBytes = 0
        comStarted = $false; webviewStarted = $false; javascriptStarted = $false
        hostPolicyAccepted = $true; creationTimeJobVerified = $true; childExitCode = 0
        parentAndSelfIdentityMatch = $true; parentAndSelfPrivilegesMatch = $false
        suspendedParentView = @{ complete = $true; caller = 'parent-suspended-child'; requestedSourceTokenAccess = 8; observerPid = 101; subjectPid = 102
            callerThreadToken = @{ present = $false; complete = $true; win32Error = 1008; token = $null; handleClosed = $true } }
        childSelfView = @{ complete = $true; caller = 'appcontainer-self'; requestedSourceTokenAccess = 8; observerPid = 102; subjectPid = 102
            callerThreadToken = @{ present = $false; complete = $true; win32Error = 1008; token = $null; handleClosed = $true } }
        cleanup = @{ jobCreated = $true; jobEmpty = $true; profileCreated = $true; profileDeleted = $true
            privateTreeCreated = $true; privateTreeRemoved = $true; ipcCompleted = $true; errors = @()
            joins = @(@{ stream = 'stdout'; finished = $true; cancelRequested = $false; panicked = $false },
                      @{ stream = 'stderr'; finished = $true; cancelRequested = $false; panicked = $false }) }
    }
}
$root = Join-Path ([IO.Path]::GetTempPath()) ('mermaid-token-probe-regression-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try {
    Case 'accept completed observation without asserting identical runtime privilege-use flags' { Assert-TokenProbeObservation (New-Observation) 101 }
    foreach ($name in @('diagnosticOnly', 'hostPolicyAccepted', 'creationTimeJobVerified', 'parentAndSelfIdentityMatch')) {
        Case "reject missing or false $name" {
            $value = New-Observation; $value[$name] = $false; Reject { Assert-TokenProbeObservation $value 101 }
            $value.Remove($name); Reject { Assert-TokenProbeObservation $value 101 }
        }
    }
    Case 'reject text masquerading as native boolean or numeric fact' {
        foreach ($pair in @(@('diagnosticOnly', 'true'), @('childExitCode', $false), @('mermaidSourceBytes', '0'))) {
            $value = New-Observation; $value[$pair[0]] = $pair[1]; Reject { Assert-TokenProbeObservation $value 101 }
        }
        $value = New-Observation; $value.childSelfView.requestedSourceTokenAccess = '8'; Reject { Assert-TokenProbeObservation $value 101 }
    }
    foreach ($name in @('renderPolicyChanged', 'comStarted', 'webviewStarted', 'javascriptStarted')) {
        Case "reject prohibited activity $name" { $value = New-Observation; $value[$name] = $true; Reject { Assert-TokenProbeObservation $value 101 } }
    }
    foreach ($name in @('jobCreated', 'jobEmpty', 'profileCreated', 'profileDeleted', 'privateTreeCreated', 'privateTreeRemoved', 'ipcCompleted')) {
        Case "reject incomplete native cleanup $name" { $value = New-Observation; $value.cleanup[$name] = $false; Reject { Assert-TokenProbeObservation $value 101 } }
    }
    Case 'reject another actual parent process or an inconsistent child observer PID' {
        Reject { Assert-TokenProbeObservation (New-Observation) 999 }
        $value = New-Observation; $value.childSelfView.observerPid = 103; Reject { Assert-TokenProbeObservation $value 101 }
    }
    Case 'reject present or unobserved caller thread tokens' {
        $value = New-Observation; $value.childSelfView.callerThreadToken.present = $true; Reject { Assert-TokenProbeObservation $value 101 }
        $value = New-Observation; $value.suspendedParentView.callerThreadToken.win32Error = 5; Reject { Assert-TokenProbeObservation $value 101 }
        $value = New-Observation; $value.childSelfView.callerThreadToken.Remove('token'); Reject { Assert-TokenProbeObservation $value 101 }
    }
    Case 'reject cancelled joins, duplicate streams and cleanup errors' {
        $value = New-Observation; $value.cleanup.joins[0].cancelRequested = $true; Reject { Assert-TokenProbeObservation $value 101 }
        $value = New-Observation; $value.cleanup.joins[1].stream = 'stdout'; Reject { Assert-TokenProbeObservation $value 101 }
        $value = New-Observation; $value.cleanup.errors = @(@{ stage = 'profile' }); Reject { Assert-TokenProbeObservation $value 101 }
    }
    $stdout = Join-Path $root 'marker.log'
    $marker = 'MILKUP_MERMAID_TOKEN_DIAGNOSTIC ' + ((New-Observation) | ConvertTo-Json -Depth 12 -Compress)
    Case 'read exactly one standalone native JSON marker amid libtest output' {
        [IO.File]::WriteAllText($stdout, "running 1 test`n$marker`ntest result: ok`n")
        $actual = Read-TokenProbeMarker $stdout 'pure-standard'; Assert-TokenProbeObservation $actual 101
    }
    Case 'read marker after the fixed libtest test-name prefix' {
        [IO.File]::WriteAllText($stdout, ('test ' + [WindowsMermaidStandardUser]::TokenProbeParentTest + " ... $marker`n"))
        $actual = Read-TokenProbeMarker $stdout 'pure-standard'; Assert-TokenProbeObservation $actual 101
    }
    Case 'reject duplicate markers and another account kind' {
        [IO.File]::WriteAllText($stdout, "$marker`n$marker`n"); Reject { Read-TokenProbeMarker $stdout 'pure-standard' }
        [IO.File]::WriteAllText($stdout, "$marker`n"); Reject { Read-TokenProbeMarker $stdout 'filtered-admin' }
    }
    Case 'retain a failed native report without relabeling it observed' {
        $value = New-Observation; $value.status = 'failed'; $value.failedStage = 'self-token'
        [IO.File]::WriteAllText($stdout, 'MILKUP_MERMAID_TOKEN_DIAGNOSTIC ' + ($value | ConvertTo-Json -Depth 12 -Compress) + "`n")
        Assert-True ((Read-TokenProbeMarker $stdout 'pure-standard').status -ceq 'failed') 'Original failed diagnostic altered'
    }
    Case 'reject oversized and invalid UTF8 output before JSON parsing' {
        [IO.File]::WriteAllBytes($stdout, [byte[]]::new(2MB + 1)); Reject { Read-TokenProbeMarker $stdout 'pure-standard' }
        [IO.File]::WriteAllBytes($stdout, [byte[]]@(255, 254, 253)); Reject { Read-TokenProbeMarker $stdout 'pure-standard' }
    }
    $source = Join-Path $root 'child-evidence'; $destination = Join-Path $root 'retained'
    New-Item -ItemType Directory -Path $source, $destination | Out-Null
    foreach ($name in @('token-probe-context.json', 'token-probe-child-result.json', 'token-probe-result.json')) { [IO.File]::WriteAllText((Join-Path $source $name), '{}') }
    [IO.File]::WriteAllText((Join-Path $source 'token-probe-stderr.log'), 'bounded diagnostic stderr')
    [IO.File]::WriteAllBytes((Join-Path $source 'token-probe-stdout.log'), [byte[]]::new(2MB + 1))
    [IO.File]::WriteAllText((Join-Path $source 'unapproved-private.txt'), 'never copied')
    Case 'oversized output preserves other exact approved evidence but remains incomplete' {
        $copy = Copy-TokenProbeEvidence $source $destination
        Assert-True (-not $copy.complete -and $copy.files.Count -eq 4 -and $copy.rejected.Count -eq 1) 'Partial evidence outcome is incorrect'
        Assert-True (-not (Test-Path (Join-Path $destination 'token-probe-stdout.log')) -and -not (Test-Path (Join-Path $destination 'unapproved-private.txt'))) 'Oversized or unknown output retained'
    }
    Case 'destination collisions never remove an unowned existing file' {
        $other = Join-Path $root 'collision'; New-Item -ItemType Directory -Path $other | Out-Null
        $held = Join-Path $other 'token-probe-child-result.json'; [IO.File]::WriteAllText($held, '{"sentinel":true}')
        $copy = Copy-TokenProbeEvidence $source $other
        Assert-True (-not $copy.complete -and [IO.File]::ReadAllText($held) -ceq '{"sentinel":true}') 'Unowned collision file removed or replaced'
    }
    # Unix-only shebang stubs observe the fixed C# argv and actual process wait.
    # They are newly authored local scripts, not the Windows libtest executable.
    if (-not $IsWindows) {
        $node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
        foreach ($entry in @(@('success', 0, 120, 5000), @('nonzero', 37, 200, 5000), @('timeout', 0, 60000, 150))) {
            Case "fixed parent-test process $($entry[0])" {
                $file = Join-Path $root ('probe-' + $entry[0])
                $body = '#!' + $node + "`nconsole.log(JSON.stringify(process.argv.slice(2)));process.stderr.write('probe stub');setTimeout(()=>process.exit(" + $entry[1] + '),' + $entry[2] + ');'
                [IO.File]::WriteAllText($file, $body)
                [IO.File]::SetUnixFileMode($file, [IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite -bor [IO.UnixFileMode]::UserExecute)
                $out = Join-Path $root ($entry[0] + '.out'); $err = Join-Path $root ($entry[0] + '.err')
                $run = [WindowsMermaidStandardUser]::RunOwnedTokenProbe($file, $root, $out, $err, $entry[3])
                $arguments = @([IO.File]::ReadAllText($out) | ConvertFrom-Json)
                $expected = @('--exact', 'launcher::token_diagnostic::parent_observes_suspended_and_self_tokens', '--ignored', '--nocapture', '--test-threads=1')
                Assert-True (($arguments | ConvertTo-Json -Compress) -ceq ($expected | ConvertTo-Json -Compress)) 'Probe arguments were not the fixed parent test'
                Assert-True ($run.tool -ceq 'TokenProbe' -and -not $run.forcedNodeTermination -and $run.exited) 'Wrong process identity or exit observation'
                if ($entry[0] -ceq 'timeout') { Assert-True ($run.status -ceq 'failed' -and $run.timedOut -and $run.forcedProcessTermination) 'Timeout did not fail closed' }
                else { Assert-True ($run.exitCode -eq $entry[1] -and $run.streamsDrained -and $run.elapsedMs -ge $entry[2]) 'Actual delayed exit or output EOF missing' }
            }
        }
    }
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
$report = @{ status = 'passed'; tests = $results.Count; cases = $results.ToArray()
    wrapperSha256 = (Get-FileHash $wrapper -Algorithm SHA256).Hash.ToLowerInvariant()
    helperSha256 = (Get-FileHash $helper -Algorithm SHA256).Hash.ToLowerInvariant()
    nativeTokenProbeExecuted = $false; windowsAccountOperations = $false; remoteTasksTriggered = $false }
$json = $report | ConvertTo-Json -Depth 8
if ($OutputPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json + "`n", [Text.UTF8Encoding]::new($false)) }
Write-Output $json
