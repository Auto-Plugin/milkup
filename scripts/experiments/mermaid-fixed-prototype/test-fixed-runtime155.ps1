# Synthetic metadata tests only. Does not download, expand or execute a Runtime,
# create an account, change ACLs, or assert real Authenticode/rendering success.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fixed-runtime155.ps1')
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Reject([scriptblock]$Action, [string]$Message) {
    $rejected = $false
    try { $null = & $Action } catch { $rejected = $true }
    Require $rejected $Message
}

# Refuse new top-level statements in this download module: dot-sourcing must
# remain side-effect free, even in the Windows preflight stage.
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'fixed-runtime155.ps1'), [ref]$tokens, [ref]$parseErrors)
Require ($parseErrors.Count -eq 0) 'Fixed Runtime module parse failed'
Require ($null -eq $ast.BeginBlock -and $null -eq $ast.ProcessBlock -and $null -eq $ast.ParamBlock) 'Unexpected module top-level block'
foreach ($statement in $ast.EndBlock.Statements) {
    Require ($statement -is [Management.Automation.Language.FunctionDefinitionAst]) 'Module gained a top-level executable statement'
}

$spec = Get-FixedRuntime155Spec
Require ($spec.url -ceq 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/232cf50b-3980-4531-afbb-779f446d7de1/Microsoft.WebView2.FixedVersionRuntime.155.0.4283.62.x64.cab') 'Pinned official URL changed'
Require ($spec.bytes -eq 310492238 -and $spec.sha256 -ceq 'cf54aa717a0ebd05b40e87620724583cb6eb0a5b8b64764cc11e42822f68bf6c') 'Pinned CAB identity changed'
Require ($spec.files -eq 256 -and $spec.totalBytes -eq 705180320) 'Pinned complete inventory changed'
Assert-Runtime155Digest $spec.bytes $spec.sha256 $spec.bytes $spec.sha256
Reject { Assert-Runtime155Digest ($spec.bytes - 1) $spec.sha256 $spec.bytes $spec.sha256 } 'Truncated CAB accepted'
Reject { Assert-Runtime155Digest ($spec.bytes + 1) $spec.sha256 $spec.bytes $spec.sha256 } 'Oversized CAB accepted'
Reject { Assert-Runtime155Digest $spec.bytes ('0' * 64) $spec.bytes $spec.sha256 } 'Wrong digest accepted'
Reject { Assert-Runtime155Digest $spec.bytes ($spec.sha256.ToUpperInvariant()) $spec.bytes $spec.sha256 } 'Unnormalized digest accepted'

foreach ($name in @('msedgewebview2.exe', 'Trust Protection Lists/Mu/example-file.1', 'EBWebView/x86/EmbeddedBrowserWebView.dll')) {
    Require ((ConvertTo-Runtime155RelativePath $name) -ceq $name) 'Safe package path changed'
}
Require ((ConvertTo-Runtime155RelativePath 'dir\child.dll') -ceq 'dir/child.dll') 'Manifest slash normalization failed'
foreach ($name in @('', '/a', '\a', '//server/a', 'C:\a', '../a', 'a/../b', './a', 'a//b', 'a/',
    'a:stream', 'a?.dll', 'a*.dll', 'a|b', 'a<b', 'a>b', 'a"b', 'a.', 'a ', ' a', 'a/ b',
    'CON', 'Con.dll', 'nul.a', 'COM1.dll', 'lpt9', "a`nb", "a`0b", 'é.dll', ('a' * 1025))) {
    Reject { ConvertTo-Runtime155RelativePath $name } ('Unsafe package path accepted: ' + $name.Replace("`0", '<NUL>'))
}
Assert-Runtime155EntryIdentity 'x64' '155.0.4283.62' '155.0.4283.62'
Reject { Assert-Runtime155EntryIdentity 'x86' '155.0.4283.62' '155.0.4283.62' } 'Wrong entry architecture accepted'
Reject { Assert-Runtime155EntryIdentity 'x64' '155.0.4283.61' '155.0.4283.62' } 'Wrong file version accepted'
Reject { Assert-Runtime155EntryIdentity 'x64' '155.0.4283.62' '156.0.0.0' } 'Wrong product version accepted'
Require (Test-Runtime155MicrosoftSigner 'Microsoft Corporation' "CN=Microsoft Corporation`nO=Microsoft Corporation`nC=US") 'Exact Microsoft identity refused'
Require (Test-Runtime155MicrosoftSigner 'Microsoft Windows Publisher' "CN=Microsoft Windows Publisher`r`nO=Microsoft Corporation`r`nC=US") 'CRLF Microsoft identity refused'
foreach ($pair in @(
    @('Microsoft Corporation lookalike', "CN=Microsoft Corporation lookalike`nO=Microsoft Corporation"),
    @('Microsoft Corporation', "CN=Microsoft Corporation`nO=Other Publisher"),
    @('Microsoft Corporation', "CN=Microsoft Corporation`nO=Microsoft Corporation Other"),
    @('Microsoft Corporation', "CN=Microsoft Corporation`nO=Microsoft Corporation`nO=Other Publisher"),
    @('Google LLC', "CN=Google LLC`nO=Google LLC")
)) { Require (-not (Test-Runtime155MicrosoftSigner $pair[0] $pair[1])) 'Untrusted publisher accepted as Microsoft' }

function Write-SyntheticCab([string]$Path, [object[]]$Entries, [int]$Flags = 0, [int]$DeclaredCount = -1, [int]$TrailerBytes = 0) {
    # A file-table-only fixture, deliberately not a runnable/extractable package.
    $memory = [IO.MemoryStream]::new()
    $writer = [IO.BinaryWriter]::new($memory, [Text.Encoding]::UTF8, $true)
    try {
        $writer.Write([uint32]0x4643534d); $writer.Write([uint32]0); $writer.Write([uint32]0)
        $writer.Write([uint32]0); $writer.Write([uint32]44); $writer.Write([uint32]0)
        $writer.Write([byte]3); $writer.Write([byte]1); $writer.Write([uint16]1)
        $count = if ($DeclaredCount -ge 0) { $DeclaredCount } else { $Entries.Count }
        $writer.Write([uint16]$count); $writer.Write([uint16]$Flags); $writer.Write([uint16]0); $writer.Write([uint16]0)
        $writer.Write([uint32]44); $writer.Write([uint16]0); $writer.Write([uint16]0)
        foreach ($entry in $Entries) {
            $writer.Write([uint32]$entry.bytes); $writer.Write([uint32]0)
            $folder = if ($entry.ContainsKey('folder')) { $entry.folder } else { 0 }
            $writer.Write([uint16]$folder); $writer.Write([uint16]0); $writer.Write([uint16]0); $writer.Write([uint16]0x80)
            $writer.Write([Text.Encoding]::UTF8.GetBytes($entry.name)); $writer.Write([byte]0)
        }
        $payloadBytes = [uint32]$memory.Length
        $memory.Position = 8; $writer.Write($payloadBytes)
        $memory.Position = $memory.Length
        if ($TrailerBytes -gt 0) { $writer.Write([byte[]]::new($TrailerBytes)) }
        [IO.File]::WriteAllBytes($Path, $memory.ToArray())
    } finally { $writer.Dispose(); $memory.Dispose() }
}

function Write-SyntheticPe([string]$Path, [uint16]$Machine, [uint16]$Magic) {
    $memory = [IO.MemoryStream]::new()
    $writer = [IO.BinaryWriter]::new($memory, [Text.Encoding]::ASCII, $true)
    try {
        $writer.Write([byte[]]::new(90)); $memory.Position = 0; $writer.Write([uint16]0x5a4d)
        $memory.Position = 60; $writer.Write([uint32]64)
        $memory.Position = 64; $writer.Write([uint32]0x00004550); $writer.Write($Machine)
        $memory.Position = 84; $writer.Write([uint16]2)
        $memory.Position = 88; $writer.Write($Magic)
        [IO.File]::WriteAllBytes($Path, $memory.ToArray())
    } finally { $writer.Dispose(); $memory.Dispose() }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('milkup-runtime-metadata-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $testRoot) { throw 'Synthetic test directory unexpectedly exists' }
$null = New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop
try {
    $cab = Join-Path $testRoot 'synthetic.cab'
    Write-SyntheticCab $cab @(@{ name = 'package\msedgewebview2.exe'; bytes = 10 }, @{ name = 'package/Trust Protection Lists/list'; bytes = 20 }) -TrailerBytes 8
    $metadata = Read-Runtime155CabinetEntries $cab
    Require ($metadata.files.Count -eq 2 -and $metadata.totalBytes -eq 30 -and
        $metadata.cabinetBytes -eq (Get-Item -LiteralPath $cab).Length - 8) 'Valid CAB table/signature-tail accounting failed'
    Require ($metadata.files[0].path -ceq 'package/msedgewebview2.exe') 'CAB path normalization failed'
    foreach ($case in @(
        @{ entries = @(@{ name = '../escape'; bytes = 1 }) },
        @{ entries = @(@{ name = 'a'; bytes = 1 }, @{ name = 'A'; bytes = 1 }) },
        @{ entries = @(@{ name = 'a'; bytes = 1 }, @{ name = 'a/b'; bytes = 1 }) },
        @{ entries = @(@{ name = 'large'; bytes = [uint32]2147483649 }) },
        @{ entries = @(@{ name = 'a'; bytes = [uint32]2147483648 }, @{ name = 'b'; bytes = 1 }) },
        @{ entries = @(@{ name = 'a'; bytes = 1; folder = 1 }) },
        @{ entries = @(@{ name = 'a'; bytes = 1; folder = 65533 }) }
    )) {
        Write-SyntheticCab $cab $case.entries
        Reject { Read-Runtime155CabinetEntries $cab } 'Invalid CAB metadata accepted'
    }
    Write-SyntheticCab $cab @(@{ name = 'a'; bytes = 1 }) -DeclaredCount 10001
    Reject { Read-Runtime155CabinetEntries $cab } 'Over-budget CAB count accepted'
    Write-SyntheticCab $cab @(@{ name = 'a'; bytes = 1 }) -Flags 1
    Reject { Read-Runtime155CabinetEntries $cab } 'Linked CAB accepted'
    Write-SyntheticCab $cab @(@{ name = 'a'; bytes = 1 }) -DeclaredCount 2
    Reject { Read-Runtime155CabinetEntries $cab } 'Truncated file table accepted'
    Write-SyntheticCab $cab @(@{ name = 'a'; bytes = 1 })
    $bytes = [IO.File]::ReadAllBytes($cab); $bytes[$bytes.Length - 1] = 97; [IO.File]::WriteAllBytes($cab, $bytes)
    Reject { Read-Runtime155CabinetEntries $cab } 'Unterminated CAB filename accepted'
    Write-SyntheticCab $cab @(@{ name = 'a'; bytes = 1 })
    $bytes = [IO.File]::ReadAllBytes($cab); $bytes[16] = 1; [IO.File]::WriteAllBytes($cab, $bytes)
    Reject { Read-Runtime155CabinetEntries $cab } 'CAB file table overlapping header accepted'

    $pe = Join-Path $testRoot 'synthetic-pe.bin'
    Write-SyntheticPe $pe 0x8664 0x020b
    Require ((Get-Runtime155PeInfo $pe).architecture -ceq 'x64') 'x64 header not recognized'
    Write-SyntheticPe $pe 0x014c 0x010b
    Require ((Get-Runtime155PeInfo $pe).architecture -ceq 'x86') 'Official mixed x86 header not recognized'
    Write-SyntheticPe $pe 0x8664 0x010b
    Reject { Get-Runtime155PeInfo $pe } 'Wrong optional header accepted'
    [IO.File]::WriteAllBytes($pe, [byte[]]@(77, 90))
    Reject { Get-Runtime155PeInfo $pe } 'Truncated MZ header accepted'
    Write-SyntheticPe $pe 0x8664 0x020b
    $bytes = [IO.File]::ReadAllBytes($pe); $bytes[60] = 255; [IO.File]::WriteAllBytes($pe, $bytes)
    Reject { Get-Runtime155PeInfo $pe } 'Out-of-bounds PE header accepted'
    Write-SyntheticPe $pe 0x8664 0x020b
    $bytes = [IO.File]::ReadAllBytes($pe); $bytes[64] = 0; [IO.File]::WriteAllBytes($pe, $bytes)
    Reject { Get-Runtime155PeInfo $pe } 'Invalid PE signature accepted'
    [IO.File]::WriteAllBytes($pe, [byte[]]@(1, 2, 3))
    Require ($null -eq (Get-Runtime155PeInfo $pe)) 'Non-PE resource treated as executable'
    $inventory = Get-Runtime155TreeFiles $testRoot
    Require ($inventory.files.Count -eq 2 -and $inventory.totalBytes -eq ((Get-Item -LiteralPath $cab).Length + 3)) 'Plain tree inventory failed'
} finally {
    Assert-Runtime155PlainPath $testRoot
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction Stop
}
Write-Output 'Fixed Runtime synthetic checks passed: side-effect-free module, pinned identity, path/name refusals, CAB budgets/truncation/aliases, PE architecture, entry version and publisher predicates. No download, extraction, real signature, Runtime execution or rendering is asserted.'
