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
    Rejects { $null = $observer.MeasureProduct() } 'Native measurement ran before product registration'
    Rejects { $null = $observer.Stop() } 'Unstarted observer produced success report'
    if (-not $IsWindows) { Rejects { $null = $observer.Start('/tmp/node.exe', '/tmp', '/tmp') } 'Non-Windows host reached native operations' }
    $instanceFlags = [Reflection.BindingFlags]'Instance,NonPublic'
    $staticFlags = [Reflection.BindingFlags]'Static,NonPublic'
    $windowType = [WindowsMermaidGuiObserver].GetNestedType('WindowFact', $private)
    $processType = [WindowsMermaidGuiObserver].GetNestedType('ProcessFact', $private)
    $cacheMethod = [WindowsMermaidGuiObserver].GetMethod('CacheWindow', $instanceFlags)
    $rememberMethod = [WindowsMermaidGuiObserver].GetMethod('RememberProcess', $instanceFlags)
    $cache = [WindowsMermaidGuiObserver].GetField('previous', $instanceFlags).GetValue($observer)
    # The real baseline exhausted 256 slots with dead windows. More than the
    # entire lifetime budget may turn over, but only live identities occupy it.
    foreach ($number in 1..600) {
        $window = [Activator]::CreateInstance($windowType, $true)
        $window.Handle = [IntPtr]$number
        $null = $cacheMethod.Invoke($observer, @($window, $false))
        Assert ($cache.Count -eq 1) 'A newly live window was not cached'
        $null = $cacheMethod.Invoke($observer, @($window, $true))
        Assert ($cache.Count -eq 0) 'A destroyed window retained its live cache slot'
    }
    $first = [Activator]::CreateInstance($processType, $true)
    $first.Pid = 42; $first.Parent = 1; $first.Creation = 100; $first.Image = 'first.exe'
    $second = [Activator]::CreateInstance($processType, $true)
    $second.Pid = 42; $second.Parent = 2; $second.Creation = 200; $second.Image = 'second.exe'
    $null = $rememberMethod.Invoke($observer, @($first))
    $null = $rememberMethod.Invoke($observer, @($second))
    $history = [WindowsMermaidGuiObserver].GetField('processEvidence', $instanceFlags).GetValue($observer)
    Assert ($history.Count -eq 2 -and $history['42:100'].Image -eq 'first.exe' -and $history['42:200'].Image -eq 'second.exe') 'Reused PID overwrote historical evidence'
    $first.Image = 'changed-after-event.exe'
    Assert ($history['42:100'].Image -eq 'first.exe') 'Evidence borrowed mutable cache state'
    $ordered = [WindowsMermaidGuiObserver].GetMethod('OrderedIdentity', $staticFlags)
    Assert ([bool]$ordered.Invoke($null, @([long]100, [long]100, [long]200))) 'Ordered exact ancestry rejected'
    Assert (-not [bool]$ordered.Invoke($null, @([long]100, [long]200, [long]300))) 'A reused ancestor PID was accepted'
    Assert (-not [bool]$ordered.Invoke($null, @([long]200, [long]200, [long]100))) 'Parent created after child was accepted'
    $snapshotIdentity = [WindowsMermaidGuiObserver].GetMethod('ExistedBeforeSnapshot', $staticFlags)
    Assert ([bool]$snapshotIdentity.Invoke($null, @([long]100, [long]200))) 'Process predating snapshot was rejected'
    Assert (-not [bool]$snapshotIdentity.Invoke($null, @([long]300, [long]200))) 'PID reused after snapshot borrowed an old parent PID'
    $sameThread = [WindowsMermaidGuiObserver].GetMethod('SameThreadOwner', $staticFlags)
    $child = [Activator]::CreateInstance($windowType, $true)
    $child.KnownChild = $true; $child.Pid = 42; $child.ThreadId = 9; $child.Process = $history['42:100']
    Assert ([bool]$sameThread.Invoke($null, @($child, [uint32]9, $history['42:100']))) 'Proven child thread identity rejected'
    Assert (-not [bool]$sameThread.Invoke($null, @($child, [uint32]9, $second))) 'Reused PID was accepted as an old child control'
    Assert (-not [bool]$sameThread.Invoke($null, @($child, [uint32]10, $history['42:100']))) 'Different event thread was accepted as known child'
    Assert (-not [bool]$sameThread.Invoke($null, @($child, [uint32]9, $null))) 'Unavailable thread identity was accepted as known child'
    foreach ($number in 1..257) {
        $window = [Activator]::CreateInstance($windowType, $true); $window.Handle = [IntPtr]$number
        $null = $cacheMethod.Invoke($observer, @($window, $false))
    }
    Assert ($cache.Count -eq 256) 'Live window cache exceeded its fixed budget'
    Assert ([bool][WindowsMermaidGuiObserver].GetField('overflow', $instanceFlags).GetValue($observer)) 'Live-cache exhaustion did not invalidate acceptance'
} finally { $observer.Dispose() }
[pscustomobject]@{ passed = $true; csharpCompiled = $true; powershellParsed = $true; pointerBytes = [IntPtr]::Size; inputBytes = $expectedInput; startupInfoExBytes = $expectedStartup; nativeWindowsExecution = $false } | ConvertTo-Json -Compress
