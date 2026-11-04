# Cross-platform compilation/contract checks. These do not claim WinEvent,
# actual desktop visibility, SendInput, or positive-control execution passed.
[CmdletBinding()]
param([string]$RepositoryRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Rejects([scriptblock]$Action, [string]$Message) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    Assert $rejected $Message
}
$source = Join-Path $RepositoryRoot 'scripts/ci/WindowsMermaidGuiObserver.cs'
$hostPath = Join-Path $RepositoryRoot 'scripts/ci/run-windows-mermaid-gui-observer.ps1'
$parseErrors = $null
$tokens = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($hostPath, [ref]$tokens, [ref]$parseErrors)
Assert ($parseErrors.Count -eq 0) ('PowerShell parse errors: ' + ($parseErrors -join '; '))
Add-Type -Path $source -ErrorAction Stop
foreach ($name in @('ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow')) {
    Assert ([WindowsMermaidGuiObserver]::IsConsoleClass($name)) "Known console class was missed: $name"
}
foreach ($name in @('', 'Chrome_WidgetWin_1', 'ConsoleWindowClassExtra', 'consolewindowclass', '#32770')) {
    Assert (-not [WindowsMermaidGuiObserver]::IsConsoleClass($name)) "Non-console class was accepted: $name"
}
foreach ($name in @('start', 'product-gui-idle', ('a' * 48))) { Assert ([WindowsMermaidGuiObserver]::IsPhaseName($name)) 'Valid phase rejected' }
foreach ($name in @('', '../outside', ('a' * 49), "phase`nnext", 'A', 'phase space')) { Assert (-not [WindowsMermaidGuiObserver]::IsPhaseName($name)) 'Invalid phase accepted' }
$root = Join-Path ([IO.Path]::GetTempPath()) 'milkup-gui-fixture-contract'
$inside = Join-Path $root 'owned.md'
Assert ([WindowsMermaidGuiObserver]::ValidateFixturePath($root, $inside) -eq [IO.Path]::GetFullPath($inside)) 'Owned Markdown path rejected'
foreach ($path in @('relative.md', (Join-Path $root '../escaped.md'), (Join-Path ($root + '-sibling') 'escape.md'), (Join-Path $root 'file.txt'), (Join-Path $root "newline`n.md"))) {
    Rejects { $null = [WindowsMermaidGuiObserver]::ValidateFixturePath($root, $path) } 'Out-of-root or malformed fixture path accepted'
}
# These interop layouts are the Windows ABI: the union must contain the full
# MOUSEINPUT alignment even though this helper sends keyboard INPUT only.
$private = [Reflection.BindingFlags]::NonPublic
$expectedInput = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
$inputType = [WindowsMermaidGuiObserver].GetNestedType('Input', $private)
Assert ([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($inputType)) -eq $expectedInput) 'SendInput ABI size mismatch'
$startupType = [WindowsMermaidGuiObserver].GetNestedType('StartupInfoEx', $private)
$expectedStartup = if ([IntPtr]::Size -eq 8) { 112 } else { 72 }
Assert ([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($startupType)) -eq $expectedStartup) 'STARTUPINFOEX ABI size mismatch'
$observer = [WindowsMermaidGuiObserver]::new()
try {
    Rejects { $null = $observer.Phase('before-start') } 'Phase command ran before observer start'
    Rejects { $null = $observer.PositiveControl() } 'Positive control ran before observer start'
    Rejects { $null = $observer.ChooseFile($inside) } 'Native input ran before observer start'
    Rejects { $null = $observer.Stop() } 'Unstarted observer produced success report'
    if (-not $IsWindows) { Rejects { $null = $observer.Start('/tmp/node.exe', '/tmp', '/tmp') } 'Non-Windows host reached native operations' }
} finally { $observer.Dispose() }
[pscustomobject]@{ passed = $true; csharpCompiled = $true; powershellParsed = $true; pointerBytes = [IntPtr]::Size; inputBytes = $expectedInput; startupInfoExBytes = $expectedStartup; nativeWindowsExecution = $false } | ConvertTo-Json -Compress
