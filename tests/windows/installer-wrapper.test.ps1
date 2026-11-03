# Pure local regression: parses only selected wrapper functions. Does not run an
# installer, create an account, load a profile or call any Windows native API.
[CmdletBinding()]
param([string]$OutputPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../../scripts/ci/WindowsMermaidStandardUser.cs')
$wrapper = Join-Path $PSScriptRoot '../../scripts/ci/run-windows-mermaid-product-e2e.ps1'
$parseErrors = $null; $tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($wrapper, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$wanted = @('Assert-PlainPath', 'Assert-Contained', 'Read-SmallJson', 'Write-Json', 'File-Proof', 'Assert-Hash', 'Get-ChildEvidenceNames', 'Assert-InstallationManifest', 'Invoke-StandardInstallation')
foreach ($name in $wanted) {
    $node = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name }, $true))
    if ($node.Count -ne 1) { throw "Missing or ambiguous wrapper function: $name" }
    . ([scriptblock]::Create($node[0].Extent.Text))
}
$results = [Collections.Generic.List[object]]::new()
function Assert-True([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Case([string]$Name, [scriptblock]$Body) {
    & $Body
    $results.Add(@{ name = $Name; passed = $true })
}
$commit = 'a' * 40; $built = 'b' * 64; $image = 'c' * 64; $version = '2.0.0-beta.8'
function New-Manifest {
    return @{
        schema = 1; candidateSha = $commit; version = $version; builtBinarySha256 = $built
        expectedInstalledBinarySha256 = $image; installMode = 'currentUser'; webviewInstallMode = 'skip'
        resources = @(@{ relativePath = 'file.ico'; bytes = 123; sha256 = 'd' * 64 })
        bundledPlugins = @(@{ id = 'milkup.diagrams'; version = '1.3.0'; archiveFile = 'milkup.diagrams-1.3.0.milkup-plugin'; bytes = 456; sha256 = 'e' * 64 })
    }
}
function Reject-Manifest([scriptblock]$Change) {
    $value = New-Manifest
    & $Change $value
    $rejected = $false
    try { Assert-InstallationManifest $value $commit $version $built } catch { $rejected = $true }
    Assert-True $rejected 'Unsafe package manifest was accepted'
}
Case 'accept exact candidate identity and bounded sealed package inventory' { Assert-InstallationManifest (New-Manifest) $commit $version $built }
Case 'version follows workflow input rather than beta constant' {
    $value = New-Manifest; $value.version = '3.1.4-rc.2'; Assert-InstallationManifest $value $commit '3.1.4-rc.2' $built
}
Case 'reject different source' { Reject-Manifest { param($m) $m.candidateSha = 'f' * 40 } }
Case 'reject different built binary' { Reject-Manifest { param($m) $m.builtBinarySha256 = 'f' * 64 } }
Case 'reject malformed installed image hash' { Reject-Manifest { param($m) $m.expectedInstalledBinarySha256 = 'unverified' } }
Case 'reject machine-wide install mode' { Reject-Manifest { param($m) $m.installMode = 'perMachine' } }
Case 'reject runtime bootstrap installation' { Reject-Manifest { param($m) $m.webviewInstallMode = 'downloadBootstrapper' } }
Case 'reject path-traversing resource' { Reject-Manifest { param($m) $m.resources[0].relativePath = '../file.ico' } }
Case 'reject additional resource' { Reject-Manifest { param($m) $m.resources += $m.resources[0] } }
Case 'reject oversized icon' { Reject-Manifest { param($m) $m.resources[0].bytes = 4MB + 1 } }
Case 'reject unbounded plugin inventory' { Reject-Manifest { param($m) $m.bundledPlugins = @($m.bundledPlugins[0]) * 33 } }
Case 'reject duplicate plugin archive' { Reject-Manifest { param($m) $m.bundledPlugins += $m.bundledPlugins[0] } }
Case 'reject plugin archive traversal' { Reject-Manifest { param($m) $m.bundledPlugins[0].archiveFile = '../milkup.diagrams.milkup-plugin' } }
Case 'reject missing reviewed Mermaid package' { Reject-Manifest { param($m) $m.bundledPlugins[0].version = '1.2.0' } }
Case 'reject missing embedded-byte hash' { Reject-Manifest { param($m) $m.bundledPlugins[0].sha256 = '' } }
Case 'retain exact installer evidence names without admitting executables' {
    $names = Get-ChildEvidenceNames
    foreach ($n in @('installation-result.json', 'installed-binary-comparison.json', 'installed-binary-comparison-stderr.log', 'installer-stdout.log', 'installer-stderr.log')) { Assert-True ($names.ContainsKey($n)) ('Missing installer evidence ' + $n) }
    Assert-True (-not $names.ContainsKey('installer.exe')) 'Installer bytes entered evidence whitelist'
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('milkup-installer-wrapper-regression-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $scratch = Join-Path $testRoot 'scratch'; $evidence = Join-Path $testRoot 'evidence'
    New-Item -ItemType Directory -Path $scratch, $evidence | Out-Null
    $sid = 'S-1-5-21-11-22-33-1003'
    $spec = @{ candidateSha = $commit; expectedSid = $sid; expectedSessionId = 2; expectedVersion = $version; expectedAccountKind = 'pure-standard'
        installer = @{ path = (Join-Path $testRoot 'synthetic-never-executed-installer'); sha256 = 'f' * 64 } }
    function New-StandardContext {
        $token = [Collections.Generic.Dictionary[string,object]]::new()
        $privilege = [Collections.Generic.Dictionary[string,object]]::new()
        $privilege['name'] = 'SeChangeNotifyPrivilege'; $privilege['attributes'] = [uint32]3
        foreach ($entry in (@{
            sid = $sid; ownerSid = $sid; ownerIsUser = $true; sessionId = 2; tokenType = 1
            integrityRid = 8192; uiAccess = $false; elevated = $false; elevationType = 1
            administratorsGroupPresentIncludingDenyOnly = $false; administratorsGroupAttributes = $null
            seDebugPrivilegePresent = $false; privilegeCount = 1; hostDisallowedPrivilegeCount = 0; privilegesComplete = $true
            privileges = [Collections.Generic.Dictionary[string,object][]]@($privilege)
        }).GetEnumerator()) { $token[$entry.Key] = $entry.Value }
        return @{ pureStandard = $true; interactive = $true; actualSid = $sid; sessionId = 2
            expectedAccountKind = 'pure-standard'; accountKindVerified = $true; desktop = @{ token = $token } }
    }
    function Invoke-RejectedInstall($Context, [string]$Reason) {
        $record = Invoke-StandardInstallation $spec $Context $scratch $evidence
        Assert-True ($record.status -ceq 'failed' -and $null -eq $record.installerRun) 'Installer started before admission checks'
        Assert-True ($record.error.Contains($Reason)) ('Unexpected rejection: ' + $record.error)
        $saved = Read-SmallJson (Join-Path $evidence 'installation-result.json')
        Assert-True ($saved.status -ceq 'failed' -and $null -eq $saved.installerRun) 'Rejected installation evidence was not retained'
    }
    Case 'reject administrator/non-standard coordinator before process launch' {
        $context = New-StandardContext; $context.pureStandard = $false
        Invoke-RejectedInstall $context 'exact pure-standard'
    }
    Case 'reject another SID before process launch' {
        $context = New-StandardContext; $context.actualSid = 'S-1-5-21-11-22-33-1004'
        Invoke-RejectedInstall $context 'exact pure-standard'
    }
    Case 'reject another session before process launch' {
        $context = New-StandardContext; $context.sessionId = 3
        Invoke-RejectedInstall $context 'exact pure-standard'
    }
    Case 'reject non-interactive coordinator before process launch' {
        Invoke-RejectedInstall @{ pureStandard = $true; interactive = $false; actualSid = $sid; sessionId = 2 } 'exact pure-standard'
    }
    Case 'reject filtered account kind before installer launch' {
        $context = New-StandardContext; $context.expectedAccountKind = 'filtered-admin'
        Invoke-RejectedInstall $context 'exact pure-standard'
    }
    Case 'reject forged kind-verified flag with incomplete actual privileges' {
        $context = New-StandardContext; $context.desktop.token.Remove('privilegesComplete') | Out-Null
        Invoke-RejectedInstall $context 'exact pure-standard'
    }
    Case 'reject elevated token despite legacy standard boolean' {
        $context = New-StandardContext; $context.desktop.token['elevated'] = $true
        Invoke-RejectedInstall $context 'exact pure-standard'
    }
    Case 'reject existing installation without modifying sentinel' {
        $existing = Join-Path $scratch 'install'; New-Item -ItemType Directory -Path $existing | Out-Null
        $sentinel = Join-Path $existing 'foreign.txt'; [IO.File]::WriteAllText($sentinel, 'untouched')
        Invoke-RejectedInstall (New-StandardContext) 'existing directory'
        Assert-True ([IO.File]::ReadAllText($sentinel) -ceq 'untouched') 'Existing installation modified'
    }
} finally { Remove-Item -LiteralPath $testRoot -Recurse -Force }
$report = @{ status = 'passed'; tests = $results.Count; cases = $results.ToArray(); windowsInstallerExecuted = $false; windowsNativeApisCalled = $false }
$json = $report | ConvertTo-Json -Depth 8
if ($OutputPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json + "`n", [Text.UTF8Encoding]::new($false)) }
Write-Output $json
