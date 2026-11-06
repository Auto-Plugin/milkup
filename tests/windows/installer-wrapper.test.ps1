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
$wanted = @('Set-ProcessEnvironmentValue', 'Assert-AccountMode', 'Assert-PlainPath', 'Assert-Contained', 'Read-SmallJson', 'Write-Json', 'File-Proof', 'Assert-Hash', 'Get-ChildEvidenceNames', 'Get-LifecycleBaselineIdentity', 'Assert-PinnedDeliveredLifecycle', 'Assert-InstallationManifest', 'Assert-SourcePluginInventory', 'Assert-InstallationCoordinator', 'Write-LifecycleProgress', 'Invoke-StandardInstallation')
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
Case 'actual child receives absent optional inventory after null removal, not an empty string' {
    $name = 'MILKUP_TEST_OPTIONAL_PLUGIN_INVENTORY'
    $prior = [Environment]::GetEnvironmentVariable($name, 'Process')
    try {
        Set-ProcessEnvironmentValue $name 'stale inherited value'
        Set-ProcessEnvironmentValue $name $null
        $json = & node -e 'process.stdout.write(JSON.stringify({present:Object.hasOwn(process.env,"MILKUP_TEST_OPTIONAL_PLUGIN_INVENTORY"),value:process.env.MILKUP_TEST_OPTIONAL_PLUGIN_INVENTORY??null}))'
        Assert-True ($LASTEXITCODE -eq 0) 'Environment probe child failed'
        $child = $json | ConvertFrom-Json
        Write-Host ('MILKUP_OPTIONAL_ENV_NULL_CHILD ' + ($child | ConvertTo-Json -Compress))
        Assert-True (-not $child.present -and $null -eq $child.value) 'Null became an empty or inherited child input'
        Set-ProcessEnvironmentValue $name ''
        $json = & node -e 'process.stdout.write(JSON.stringify({present:Object.hasOwn(process.env,"MILKUP_TEST_OPTIONAL_PLUGIN_INVENTORY"),value:process.env.MILKUP_TEST_OPTIONAL_PLUGIN_INVENTORY??null}))'
        Assert-True ($LASTEXITCODE -eq 0) 'Empty environment probe child failed'
        $child = $json | ConvertFrom-Json
        # Older runtimes may remove an empty value. Either behavior must remain
        # distinguishable from nonempty JSON; the strict Node parser is unchanged.
        Assert-True (($child.present -and $child.value -ceq '') -or (-not $child.present -and $null -eq $child.value)) 'Empty forwarding produced an unexpected value'
        Write-Host ('MILKUP_OPTIONAL_ENV_PROBE ' + (@{ nullRemoved = $true; emptyPresent = $child.present; emptyValue = $child.value } | ConvertTo-Json -Compress))
        $inventory = '[{"id":"milkup.diagrams","version":"1.3.0"}]'
        Set-ProcessEnvironmentValue $name $inventory
        $json = & node -e 'process.stdout.write(JSON.stringify(process.env.MILKUP_TEST_OPTIONAL_PLUGIN_INVENTORY))'
        Assert-True ($LASTEXITCODE -eq 0) 'Nonempty environment probe child failed'
        Assert-True (($json | ConvertFrom-Json) -ceq $inventory) 'Nonempty inventory changed during child forwarding'
    } finally { Set-ProcessEnvironmentValue $name $prior }
}
Case 'migration preparation uses the null-preserving setter for install and restoration' {
    $node = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Prepare-RealOldPluginChoice' }, $true))
    Assert-True ($node.Count -eq 1) 'Missing actual migration preparation function'
    $body = $node[0].Extent.Text
    Assert-True ($body.Contains('MILKUP_WINDOWS_MERMAID_EXPECTED_PLUGIN_INVENTORY = $null')) 'Old preparation inherited the new package inventory'
    Assert-True (([regex]::Matches($body, 'Set-ProcessEnvironmentValue \$entry.Key \$entry.Value')).Count -eq 2) 'Preparation or restoration bypassed null-preserving forwarding'
    Assert-True (-not $body.Contains('[string]$entry.Value')) 'Preparation reintroduced empty-string coercion'
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
# Exercise the actual closed parent identity guards, without evaluating the
# surrounding hosted-runner, account creation or process-launch statements.
$identityGuardPrefixes = @(
    'if ($HarnessMode -ceq ''product'' -and $ApplicationCandidateSha',
    'if (-not $ApplicationCandidateSha)',
    'if ($FrontendBoundaryProbe -and ($HarnessMode -cne ''gui-regression''',
    'if ($ApplicationCandidateSha -cne $ExpectedCommit',
    'if ($PinnedDeliveredLifecycle)'
)
$identityGuardScripts = foreach ($prefix in $identityGuardPrefixes) {
    $matches = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text.StartsWith($prefix, [StringComparison]::Ordinal) })
    Assert-True ($matches.Count -eq 1) ('Missing or ambiguous actual identity guard: ' + $prefix)
    [scriptblock]::Create($matches[0].Extent.Text)
}
function Invoke-IdentityAdmission([hashtable]$Changes = @{}) {
    $PinnedDeliveredLifecycle = $false; $RendererMode = 'native'; $LifecycleBaselineInstaller = ''; $MigrationChoice = ''
    $HarnessMode = 'product'; $ApplicationCandidateSha = ''; $ExpectedCommit = $commit
    $FrontendBoundaryProbe = $false; $installerMode = $true
    $ExpectedInstallerSha256 = 'f' * 64; $ExpectedBinarySha256 = $built; $ExpectedVersion = $version
    foreach ($entry in $Changes.GetEnumerator()) {
        Assert-True ($entry.Key -cin @('PinnedDeliveredLifecycle', 'RendererMode', 'LifecycleBaselineInstaller', 'MigrationChoice', 'HarnessMode', 'ApplicationCandidateSha', 'ExpectedCommit', 'FrontendBoundaryProbe', 'installerMode', 'ExpectedInstallerSha256', 'ExpectedBinarySha256', 'ExpectedVersion')) 'Unknown synthetic identity input'
        Set-Variable -Name $entry.Key -Value $entry.Value -Scope Local
    }
    foreach ($guard in $identityGuardScripts) { . $guard }
    return $ApplicationCandidateSha
}
$baselineSource = 'a5556beea5cdd1570361c528b2326bc0ad8ba0c4'
$baselineInstaller = 'f7fe28275477e8957653649924348bc06e24b4b49d63f6e1d6a6f08ed65c6fbf'
$baselineBuilt = '6cb3cdf7fc31f064d7b0582f89fc67efbad94772f94434b54fb1063437d593eb'
$baselineImage = '5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84'
function New-DeliveredAdmission {
    return @{ PinnedDeliveredLifecycle = $true; RendererMode = 'frontend'; LifecycleBaselineInstaller = 'pinned-beta9.exe'; MigrationChoice = 'enabled'
        ApplicationCandidateSha = '7bb507a161104d4fa6f1aa41ad64f2191642c145'
        ExpectedInstallerSha256 = 'b961f08a9d7e33df81542681e30e9196a1c37540c0ad9e4455faac0ad88865bc'
        ExpectedBinarySha256 = '76db5708fadaf413f13fda13a5d8b0ac5b6db34b0703a0fd5769aa137ab9b45d'; ExpectedVersion = '2.0.0-beta.10' }
}
Case 'pinned lifecycle accepts only the already delivered package with separate harness identity' {
    Assert-True ((Invoke-IdentityAdmission (New-DeliveredAdmission)) -ceq '7bb507a161104d4fa6f1aa41ad64f2191642c145') 'Exact delivered lifecycle rejected'
}
foreach ($field in @('ApplicationCandidateSha','ExpectedInstallerSha256','ExpectedBinarySha256','ExpectedVersion','HarnessMode','RendererMode','LifecycleBaselineInstaller','MigrationChoice','installerMode','PinnedDeliveredLifecycle')) {
    Case "pinned lifecycle rejects changed $field" {
        $value = New-DeliveredAdmission
        $value[$field] = $(if ($field -cin @('installerMode','PinnedDeliveredLifecycle')) { $false } else { '' })
        $rejected = $false
        try { Invoke-IdentityAdmission $value | Out-Null } catch { $rejected = $true }
        Assert-True $rejected 'Changed delivered lifecycle identity was accepted'
    }
}
function New-BaselineAdmission {
    return @{ HarnessMode = 'gui-regression'; ApplicationCandidateSha = $baselineSource
        ExpectedInstallerSha256 = $baselineInstaller; ExpectedBinarySha256 = $baselineImage; ExpectedVersion = '2.0.0-beta.9' }
}
Case 'ordinary product identity defaults to current candidate without an application override' {
    Assert-True ((Invoke-IdentityAdmission) -ceq $commit) 'Default product identity stopped binding the current source'
}
Case 'ordinary product mode rejects even an equal explicit application override' {
    $rejected = $false
    try { Invoke-IdentityAdmission @{ ApplicationCandidateSha = $commit } | Out-Null } catch { $rejected = $_.Exception.Message.Contains('explicit GUI regression mode') }
    Assert-True $rejected 'Ordinary product admission accepted a separate application identity'
}
Case 'explicit GUI baseline admits only the exact delivered installer and extracted image' {
    Assert-True ((Invoke-IdentityAdmission (New-BaselineAdmission)) -ceq $baselineSource) 'Pinned delivered baseline was not admitted'
}
foreach ($change in @('source', 'installer', 'image', 'version', 'linked-binary', 'product-mode', 'frontend-probe')) {
    Case "explicit GUI baseline rejects $change mismatch before process launch" {
        $value = New-BaselineAdmission
        switch ($change) {
            'source' { $value.ApplicationCandidateSha = 'f' * 40 }
            'installer' { $value.ExpectedInstallerSha256 = 'f' * 64 }
            'image' { $value.ExpectedBinarySha256 = $baselineBuilt }
            'version' { $value.ExpectedVersion = '2.0.0-beta.10' }
            'linked-binary' { $value.installerMode = $false }
            'product-mode' { $value.HarnessMode = 'product' }
            'frontend-probe' { $value.FrontendBoundaryProbe = $true }
        }
        $rejected = $false
        try { Invoke-IdentityAdmission $value | Out-Null } catch { $rejected = $true }
        Assert-True $rejected ('Baseline accepted invalid ' + $change)
    }
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
function New-SourcePluginSpec {
    return @{ harnessMode = 'gui-regression'; mode = 'linked-binary'; candidateSha = $commit
        applicationCandidateSha = $commit; binary = @{ sha256 = $built } }
}
function New-SourcePluginInventory {
    return @{
        schema = 1; kind = 'linked-gui-source-inventory'; candidateSha = $commit; binarySha256 = $built; platform = 'win32'
        canonicalSource = 'release/bundled-plugins.json'; stagedSource = 'apps/desktop/src/bundled-plugins'
        canonicalSourceSha256 = 'd' * 64; producerSha256 = 'e' * 64
        plugins = @(@{ id = 'milkup.diagrams'; version = '1.3.0'; archiveFile = 'milkup.diagrams-1.3.0.milkup-plugin'
            bytes = 456; sha256 = 'f' * 64; sourceManifestSha256 = 'c' * 64 })
    }
}
function Reject-SourcePluginInventory([scriptblock]$Mutation) {
    $value = New-SourcePluginInventory; $caseSpec = New-SourcePluginSpec
    & $Mutation $value $caseSpec
    $rejected = $false
    try { Assert-SourcePluginInventory $value $caseSpec | Out-Null } catch { $rejected = $true }
    Assert-True $rejected 'Invalid source plugin inventory was accepted'
}
Case 'linked GUI source inventory binds current candidate binary and canonical sealed plugin record' {
    Assert-SourcePluginInventory (New-SourcePluginInventory) (New-SourcePluginSpec) | Out-Null
}
Case 'linked GUI source inventory accepts multiple distinct exact Windows plugin archives' {
    $value = New-SourcePluginInventory
    $value.plugins += @{ id = 'milkup.footnotes'; version = '1.0.1'; archiveFile = 'milkup.footnotes-1.0.1.milkup-plugin'
        bytes = 123; sha256 = 'd' * 64; sourceManifestSha256 = 'e' * 64 }
    Assert-SourcePluginInventory $value (New-SourcePluginSpec) | Out-Null
}
foreach ($change in @('product-mode', 'installer-mode', 'mixed-source-baseline', 'source-mismatch', 'binary-mismatch', 'malformed-source', 'malformed-binary')) {
    Case "linked GUI source inventory rejects $change" {
        Reject-SourcePluginInventory {
            param($value, $caseSpec)
            switch ($change) {
                'product-mode' { $caseSpec.harnessMode = 'product' }
                'installer-mode' { $caseSpec.mode = 'nsis-current-user' }
                'mixed-source-baseline' { $caseSpec.applicationCandidateSha = $baselineSource }
                'source-mismatch' { $value.candidateSha = 'f' * 40 }
                'binary-mismatch' { $value.binarySha256 = 'f' * 64 }
                'malformed-source' { $value.candidateSha = $caseSpec.candidateSha = $caseSpec.applicationCandidateSha = 'not-a-source-sha' }
                'malformed-binary' { $value.binarySha256 = $caseSpec.binary.sha256 = 'not-a-binary-sha' }
            }
        }
    }
}
foreach ($field in @('schema', 'kind', 'candidateSha', 'binarySha256', 'platform', 'canonicalSource', 'stagedSource', 'canonicalSourceSha256', 'producerSha256', 'plugins')) {
    Case "source inventory rejects missing top-level $field" {
        Reject-SourcePluginInventory { param($value) $value.Remove($field) }
    }
}
foreach ($change in @('unknown-schema', 'unknown-kind', 'unknown-field', 'non-Windows-platform', 'wrong-canonical-source', 'wrong-staged-source', 'invalid-canonical-hash', 'invalid-producer-hash', 'empty-plugins', 'oversized-inventory', 'duplicate-id', 'duplicate-archive', 'missing-reviewed-Mermaid')) {
    Case "source inventory rejects $change" {
        Reject-SourcePluginInventory {
            param($value)
            switch ($change) {
                'unknown-schema' { $value.schema = 2 }
                'unknown-kind' { $value.kind = 'unreviewed-inventory' }
                'unknown-field' { $value.additionalPermission = 'file:write' }
                'non-Windows-platform' { $value.platform = 'linux' }
                'wrong-canonical-source' { $value.canonicalSource = '../bundled-plugins.json' }
                'wrong-staged-source' { $value.stagedSource = 'apps/desktop/src/../other-plugins' }
                'invalid-canonical-hash' { $value.canonicalSourceSha256 = 'unverified' }
                'invalid-producer-hash' { $value.producerSha256 = '' }
                'empty-plugins' { $value.plugins = @() }
                'oversized-inventory' {
                    $value.plugins += @(1..32 | ForEach-Object {
                        @{ id = "milkup.fixture$_"; version = '1.0.0'; archiveFile = "milkup.fixture$_-1.0.0.milkup-plugin"
                            bytes = 1; sha256 = 'd' * 64; sourceManifestSha256 = 'e' * 64 }
                    })
                }
                'duplicate-id' {
                    $other = $value.plugins[0].Clone(); $other.version = '1.3.1'; $other.archiveFile = 'milkup.diagrams-1.3.1.milkup-plugin'
                    $value.plugins += $other
                }
                'duplicate-archive' { $value.plugins += $value.plugins[0].Clone() }
                'missing-reviewed-Mermaid' {
                    $value.plugins[0].id = 'milkup.footnotes'; $value.plugins[0].version = '1.0.1'
                    $value.plugins[0].archiveFile = 'milkup.footnotes-1.0.1.milkup-plugin'
                }
            }
        }
    }
}
foreach ($field in @('id', 'version', 'archiveFile', 'bytes', 'sha256', 'sourceManifestSha256')) {
    Case "source inventory rejects missing plugin $field" {
        Reject-SourcePluginInventory { param($value) $value.plugins[0].Remove($field) }
    }
}
foreach ($change in @('unknown-plugin-field', 'invalid-id', 'invalid-version', 'archive-traversal', 'archive-filename-mismatch', 'zero-byte-archive', 'oversized-archive', 'fractional-byte-count', 'invalid-archive-hash', 'invalid-manifest-hash', 'wrong-Mermaid-version')) {
    Case "source inventory rejects plugin $change" {
        Reject-SourcePluginInventory {
            param($value)
            $plugin = $value.plugins[0]
            switch ($change) {
                'unknown-plugin-field' { $plugin.networkOrigins = @('*') }
                'invalid-id' { $plugin.id = '../milkup.diagrams' }
                'invalid-version' { $plugin.version = '1.3' }
                'archive-traversal' { $plugin.archiveFile = '../milkup.diagrams-1.3.0.milkup-plugin' }
                'archive-filename-mismatch' { $plugin.archiveFile = 'milkup.diagrams-1.3.1.milkup-plugin' }
                'zero-byte-archive' { $plugin.bytes = 0 }
                'oversized-archive' { $plugin.bytes = 32MB + 1 }
                'fractional-byte-count' { $plugin.bytes = 1.5 }
                'invalid-archive-hash' { $plugin.sha256 = 'not-a-hash' }
                'invalid-manifest-hash' { $plugin.sourceManifestSha256 = '' }
                'wrong-Mermaid-version' { $plugin.version = '1.2.0'; $plugin.archiveFile = 'milkup.diagrams-1.2.0.milkup-plugin' }
            }
        }
    }
}
Case 'retain exact installer evidence names without admitting executables' {
    $names = Get-ChildEvidenceNames
    foreach ($n in @('installation-result.json', 'installed-binary-comparison.json', 'installed-binary-comparison-stderr.log', 'installer-stdout.log', 'installer-stderr.log')) { Assert-True ($names.ContainsKey($n)) ('Missing installer evidence ' + $n) }
    Assert-True (-not $names.ContainsKey('installer.exe')) 'Installer bytes entered evidence whitelist'
    foreach ($fixture in @('many', 'manyScroll')) {
        $name = 'fixture-gui-' + $fixture + '.md'
        Assert-True ($names[$name] -ceq ($name + '.log')) 'Exact multi-diagram fixture evidence missing'
    }
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('milkup-installer-wrapper-regression-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    Case 'bounded compact report round trips all observations at exactly 1 MiB' {
        $file = Join-Path $testRoot 'bounded-report.json'
        $prefix = '{"status":"passed","nativeAudit":[{"phase":"finished","resourceReleaseProven":true}],"padding":"'
        $suffix = '"}' + "`n"
        $padding = 1MB - [Text.Encoding]::UTF8.GetByteCount($prefix + $suffix)
        [IO.File]::WriteAllText($file, $prefix + ('x' * $padding) + $suffix, [Text.UTF8Encoding]::new($false))
        $read = Read-SmallJson $file
        Assert-True ($read.status -ceq 'passed' -and $read.nativeAudit.Count -eq 1 -and $read.nativeAudit[0].resourceReleaseProven) 'Complete proof was not retained'
        Assert-True ($read.padding.Length -eq $padding) 'Evidence was truncated'
    }
    Case 'reject one byte over the same 1 MiB report budget' {
        $file = Join-Path $testRoot 'bounded-report.json'
        [IO.File]::AppendAllText($file, ' ', [Text.UTF8Encoding]::new($false))
        $rejected = $false
        try { Read-SmallJson $file | Out-Null } catch { $rejected = $_.Exception.Message -clike '*exceeds its budget*' }
        Assert-True $rejected 'Oversized report accepted'
    }
    Case 'reject truncated compact report even with a passed prefix' {
        $file = Join-Path $testRoot 'truncated-report.json'
        [IO.File]::WriteAllText($file, '{"status":"passed","nativeAudit":[{"phase":"finished"', [Text.UTF8Encoding]::new($false))
        $rejected = $false
        try { Read-SmallJson $file | Out-Null } catch { $rejected = $true }
        Assert-True $rejected 'Truncated evidence accepted'
    }
    $scratch = Join-Path $testRoot 'scratch'; $evidence = Join-Path $testRoot 'evidence'
    New-Item -ItemType Directory -Path $scratch, $evidence | Out-Null
    $sid = 'S-1-5-21-11-22-33-1003'
    $spec = @{ candidateSha = $commit; applicationCandidateSha = $commit; harnessMode = 'product'; frontendBoundaryProbe = $false
        additionalHarnessFiles = @(); binaryRole = 'compiledCandidate'
        expectedSid = $sid; expectedSessionId = 2; expectedVersion = $version; expectedAccountKind = 'pure-standard'
        installer = @{ path = (Join-Path $testRoot 'synthetic-never-executed-installer'); sha256 = 'f' * 64 } }
    # Execute only the actual baseline comparison branch with synthetic hashes.
    # This writes a bounded JSON record; it does not create or run an EXE.
    $baselineBranches = @($ast.FindAll({ param($n)
        $n -is [Management.Automation.Language.IfStatementAst] -and
        $n.Extent.Text.StartsWith('if ($baseline) {', [StringComparison]::Ordinal) -and
        $n.Extent.Text.Contains('compiledInThisRun')
    }, $true))
    Assert-True ($baselineBranches.Count -eq 1) 'Missing or ambiguous actual baseline comparison branch'
    $baselineComparison = [scriptblock]::Create(($baselineBranches[0].Clauses[0].Item2.Statements.Extent.Text -join "`n"))
    function Invoke-BaselineComparison([scriptblock]$Mutation = {}) {
        $Spec = @{ binaryRole = 'extractedExpectedImage'; installer = @{ sha256 = $baselineInstaller }
            binary = @{ path = 'synthetic-extracted-image-not-an-executable'; sha256 = $baselineImage; bytes = 1234 } }
        $proof = @{ sha256 = $baselineImage; bytes = 1234 }
        $record = @{ binaryComparison = $null; comparisonRun = $null }
        & $Mutation $Spec $proof
        . $baselineComparison
        return $record
    }
    Case 'baseline comparison records a reinstalled extracted image and never a new compilation' {
        $record = Invoke-BaselineComparison
        Assert-True ($record.binaryComparison.compiledInThisRun -eq $false) 'Baseline falsely claimed a current compilation'
        Assert-True ($record.binaryComparison.comparisonKind -ceq 'reinstalled-to-pinned-extracted-image') 'Baseline comparison kind was not explicit'
        Assert-True ($record.binaryComparison.historicalSourceRunId -ceq '41713129442' -and $record.binaryComparison.historicalSourceCandidate -ceq $baselineSource) 'Historical source binding was lost'
        Assert-True ($null -eq $record.comparisonRun -and $record.extractedExpectedImage.sha256 -ceq $baselineImage) 'Baseline was relabeled or used a compiled-image comparison'
        $saved = Read-SmallJson (Join-Path $evidence 'installed-binary-comparison.json')
        Assert-True ($saved.installedSha256 -ceq $baselineImage -and $saved.compiledInThisRun -eq $false) 'Retained baseline comparison differs from the actual check'
    }
    foreach ($change in @('compiled-role', 'installer', 'expected-image', 'actual-image', 'actual-bytes')) {
        Case "baseline exact image comparison rejects $change mismatch" {
            $rejected = $false
            try {
                Invoke-BaselineComparison {
                    param($caseSpec, $actual)
                    switch ($change) {
                        'compiled-role' { $caseSpec.binaryRole = 'compiledCandidate' }
                        'installer' { $caseSpec.installer.sha256 = 'f' * 64 }
                        'expected-image' { $caseSpec.binary.sha256 = $baselineBuilt }
                        'actual-image' { $actual.sha256 = 'f' * 64 }
                        'actual-bytes' { $actual.bytes++ }
                    }
                } | Out-Null
            } catch { $rejected = $_.Exception.Message.Contains('Exact delivered baseline image comparison failed') }
            Assert-True $rejected ('Invalid baseline comparison accepted: ' + $change)
        }
    }
    function New-AccountContext([string]$Kind = 'pure-standard') {
        $filtered = $Kind -ceq 'filtered-admin'
        $token = [Collections.Generic.Dictionary[string,object]]::new()
        $privilege = [Collections.Generic.Dictionary[string,object]]::new()
        $privilege['name'] = 'SeChangeNotifyPrivilege'; $privilege['attributes'] = [uint32]3
        foreach ($entry in (@{
            sid = $sid; ownerSid = $sid; ownerIsUser = $true; sessionId = 2; tokenType = 1
            integrityRid = 8192; uiAccess = $false; elevated = $false; elevationType = $(if ($filtered) { 3 } else { 1 })
            administratorsGroupPresentIncludingDenyOnly = $filtered; administratorsGroupAttributes = $(if ($filtered) { [uint32]16 } else { $null })
            seDebugPrivilegePresent = $false; privilegeCount = 1; hostDisallowedPrivilegeCount = 0; privilegesComplete = $true
            privileges = [Collections.Generic.Dictionary[string,object][]]@($privilege)
        }).GetEnumerator()) { $token[$entry.Key] = $entry.Value }
        return @{ pureStandard = -not $filtered; filteredAdmin = $filtered; interactive = $true; actualSid = $sid; sessionId = 2
            expectedAccountKind = $Kind; accountKindVerified = $true; desktop = @{ token = $token } }
    }
    function Invoke-RejectedInstall($Context, [string]$Reason, [string]$Kind = 'pure-standard') {
        $caseSpec = $spec.Clone(); $caseSpec.expectedAccountKind = $Kind
        $record = Invoke-StandardInstallation $caseSpec $Context $scratch $evidence
        Assert-True ($record.status -ceq 'failed' -and $null -eq $record.installerRun) 'Installer started before admission checks'
        Assert-True ($record.error.Contains($Reason)) ('Unexpected rejection: ' + $record.error)
        $saved = Read-SmallJson (Join-Path $evidence 'installation-result.json')
        Assert-True ($saved.status -ceq 'failed' -and $null -eq $saved.installerRun -and $saved.expectedAccountKind -ceq $Kind) 'Rejected installation evidence or selected account kind was not retained'
    }
    foreach ($kind in @('pure-standard', 'filtered-admin')) {
        Case "admit exact non-elevated $kind coordinator using actual token facts" {
            $caseSpec = $spec.Clone(); $caseSpec.expectedAccountKind = $kind
            $context = New-AccountContext $kind
            Assert-InstallationCoordinator $caseSpec $context
            Assert-True ($context.pureStandard -eq ($kind -ceq 'pure-standard')) 'Filtered account was relabeled pure-standard'
        }
        foreach ($change in @('elevated', 'full-token', 'enabled-admin', 'high-integrity', 'wrong-token-sid', 'wrong-token-session', 'unknown-privileges')) {
            Case "$kind installer rejects $change before process launch" {
                $context = New-AccountContext $kind
                switch ($change) {
                    'elevated' { $context.desktop.token['elevated'] = $true }
                    'full-token' { $context.desktop.token['elevationType'] = 2 }
                    'enabled-admin' { $context.desktop.token['administratorsGroupPresentIncludingDenyOnly'] = $true; $context.desktop.token['administratorsGroupAttributes'] = [uint32]4 }
                    'high-integrity' { $context.desktop.token['integrityRid'] = 12288 }
                    'wrong-token-sid' { $context.desktop.token['sid'] = 'S-1-5-21-11-22-33-1004'; $context.desktop.token['ownerSid'] = $context.desktop.token['sid'] }
                    'wrong-token-session' { $context.desktop.token['sessionId'] = 3 }
                    'unknown-privileges' { $context.desktop.token.Remove('privilegesComplete') | Out-Null }
                }
                Invoke-RejectedInstall $context 'exact verified' $kind
            }
        }
    }
    Case 'reject inconsistent legacy account flag before process launch' {
        $context = New-AccountContext; $context.pureStandard = $false
        Invoke-RejectedInstall $context 'exact verified'
    }
    Case 'reject another SID before process launch' {
        $context = New-AccountContext; $context.actualSid = 'S-1-5-21-11-22-33-1004'
        Invoke-RejectedInstall $context 'exact verified'
    }
    Case 'reject another session before process launch' {
        $context = New-AccountContext; $context.sessionId = 3
        Invoke-RejectedInstall $context 'exact verified'
    }
    Case 'reject non-interactive coordinator before process launch' {
        $context = New-AccountContext; $context.interactive = $false
        Invoke-RejectedInstall $context 'exact verified'
    }
    Case 'reject mismatched selected account kind before installer launch' {
        Invoke-RejectedInstall (New-AccountContext 'filtered-admin') 'exact verified' 'pure-standard'
        Invoke-RejectedInstall (New-AccountContext 'pure-standard') 'exact verified' 'filtered-admin'
    }
    Case 'reject forged kind-verified flag with incomplete actual privileges' {
        $context = New-AccountContext; $context.desktop.token.Remove('privilegesComplete') | Out-Null
        Invoke-RejectedInstall $context 'exact verified'
    }
    Case 'reject elevated token despite legacy standard boolean' {
        $context = New-AccountContext; $context.desktop.token['elevated'] = $true
        Invoke-RejectedInstall $context 'exact verified'
    }
    Case 'reject existing installation without modifying sentinel' {
        $existing = Join-Path $scratch 'install'; New-Item -ItemType Directory -Path $existing | Out-Null
        $sentinel = Join-Path $existing 'foreign.txt'; [IO.File]::WriteAllText($sentinel, 'untouched')
        Invoke-RejectedInstall (New-AccountContext 'pure-standard') 'existing directory' 'pure-standard'
        Invoke-RejectedInstall (New-AccountContext 'filtered-admin') 'existing directory' 'filtered-admin'
        Assert-True ([IO.File]::ReadAllText($sentinel) -ceq 'untouched') 'Existing installation modified'
    }
} finally { Remove-Item -LiteralPath $testRoot -Recurse -Force }
Case 'frontend installer identity cannot silently fall back to a native contract' {
    $manifest = New-Manifest
    $rejected = $false
    try { Assert-InstallationManifest $manifest $commit $version $built 'frontend' } catch { $rejected = $true }
    Assert-True $rejected 'Missing frontend manifest identity passed'
    $manifest.rendererMode = 'frontend'
    Assert-InstallationManifest $manifest $commit $version $built 'frontend'
    $manifest.rendererMode = 'native'
    $rejected = $false
    try { Assert-InstallationManifest $manifest $commit $version $built 'frontend' } catch { $rejected = $true }
    Assert-True $rejected 'Wrong renderer identity passed'
}
Case 'exact historical beta.10 profile is bound independently from the new target installer' {
    $legacy = Get-LifecycleBaselineIdentity 'beta9' 'enabled'
    $prior = Get-LifecycleBaselineIdentity 'delivered-beta10' 'enabled'
    Assert-True ($legacy.binary -ceq '5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84' -and $legacy.renderer -ceq 'native') 'Legacy baseline changed'
    Assert-True ($prior.installer -ceq 'd6d02410a7165a2f06ef3e5ceca00e70f3a78b14570f353e59d5b569da5d1e91' -and
        $prior.binary -ceq 'c58cb0f5d9413da42373e3d659fa196a4c65adc89ef964f03b5055ac9c189192' -and
        $prior.candidate -ceq '40c66b69eddf371cc158c7e25499113ab980ce94' -and $prior.renderer -ceq 'frontend') 'Delivered baseline identity changed'
    Assert-True ((Get-LifecycleBaselineIdentity 'delivered-beta10' 'disabled').binary -ceq $prior.binary) 'Disabled profile uses another application'
    foreach ($pair in @(@('unknown','enabled'),@('delivered-beta10','same-version'),@('delivered-beta10','startup-failure'),@('beta9','unknown'))) {
        $rejected = $false
        try { Get-LifecycleBaselineIdentity $pair[0] $pair[1] | Out-Null } catch { $rejected = $true }
        Assert-True $rejected 'Unpinned historical profile was accepted'
    }
}

$report = @{ status = 'passed'; tests = $results.Count; cases = $results.ToArray(); windowsInstallerExecuted = $false; windowsNativeApisCalled = $false }
$json = $report | ConvertTo-Json -Depth 8


if ($OutputPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json + "`n", [Text.UTF8Encoding]::new($false)) }
Write-Output $json
