# Cross-platform compilation/contract checks. These do not claim WinEvent,
# actual desktop visibility, SendInput, or positive-control execution passed.
[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
    [string]$SyntheticLifetimeOutput = ''
)
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
# MOUSEINPUT alignment for both filename keystrokes and native button clicks.
$private = [Reflection.BindingFlags]::NonPublic
$expectedInput = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
$inputType = [WindowsMermaidGuiObserver].GetNestedType('Input', $private)
Assert ([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($inputType)) -eq $expectedInput) 'SendInput ABI size mismatch'
$startupType = [WindowsMermaidGuiObserver].GetNestedType('StartupInfoEx', $private)
$expectedStartup = if ([IntPtr]::Size -eq 8) { 112 } else { 72 }
Assert ([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($startupType)) -eq $expectedStartup) 'STARTUPINFOEX ABI size mismatch'
$placementType = [WindowsMermaidGuiObserver].GetNestedType('WindowPlacement', $private)
Assert ([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($placementType)) -eq 44) 'Windows WINDOWPLACEMENT must exclude the SDK _MAC-only rcDevice field'
$observer = [WindowsMermaidGuiObserver]::new()
try {
    Rejects { $null = $observer.Phase('before-start') } 'Phase command ran before observer start'
    Rejects { $null = $observer.PositiveControl() } 'Positive control ran before observer start'
    Rejects { $null = $observer.ChooseFile($inside) } 'Native input ran before observer start'
    Rejects { $null = $observer.MeasureProduct() } 'Native measurement ran before product registration'
    Rejects { $null = $observer.AwaitProductWindow() } 'Native readiness ran before observer startup'
    Rejects { $null = $observer.ResizeProduct('normal', 800, 560) } 'Native window mutation ran before product registration'
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
    $parent = [Activator]::CreateInstance($windowType, $true); $parent.Handle = [IntPtr]700
    $childOfParent = [Activator]::CreateInstance($windowType, $true); $childOfParent.Handle = [IntPtr]701; $childOfParent.KnownChild = $true; $childOfParent.ObservedRoot = [IntPtr]700
    $unrelatedChild = [Activator]::CreateInstance($windowType, $true); $unrelatedChild.Handle = [IntPtr]702; $unrelatedChild.KnownChild = $true; $unrelatedChild.ObservedRoot = [IntPtr]900
    foreach ($item in @($parent, $childOfParent, $unrelatedChild)) { $null = $cacheMethod.Invoke($observer, @($item, $false)) }
    $null = $cacheMethod.Invoke($observer, @($parent, $true))
    Assert ($cache.Count -eq 1 -and $cache.ContainsKey([long]702)) 'Parent DESTROY must retire only its proven descendants without requiring individual child DESTROY events'
    $null = $cacheMethod.Invoke($observer, @($unrelatedChild, $true))
    $changedMethod = [WindowsMermaidGuiObserver].GetMethod('WindowStateChanged', $staticFlags)
    $oldWindow = [Activator]::CreateInstance($windowType, $true); $oldWindow.Identity = 'same'; $oldWindow.Attribution = 'product'; $oldWindow.Visible = $true; $oldWindow.CurrentVisible = $true
    $newWindow = [Activator]::CreateInstance($windowType, $true); $newWindow.Identity = 'same'; $newWindow.Attribution = 'unattributed'; $newWindow.Visible = $true; $newWindow.CurrentVisible = $true
    Assert ([bool]$changedMethod.Invoke($null, @($oldWindow, $newWindow))) 'Attribution-only poll changed counts without a corresponding raw event'
    $newWindow.Attribution = 'product'
    Assert (-not [bool]$changedMethod.Invoke($null, @($oldWindow, $newWindow))) 'Identical poll state should not consume evidence budget'
    $newWindow.CurrentVisible = $false
    Assert ([bool]$changedMethod.Invoke($null, @($oldWindow, $newWindow))) 'Desktop/cloaking visibility transition was omitted from raw evidence'
    $resizeRequest = [WindowsMermaidGuiObserver].GetMethod('ValidResizeRequest', $staticFlags)
    Assert ([bool]$resizeRequest.Invoke($null, @('normal', 800, 560, 1024, 768))) 'Native dimensions fitting the observed desktop were rejected'
    Assert (-not [bool]$resizeRequest.Invoke($null, @('normal', 1280, 560, 1024, 768))) 'Out-of-desktop native dimensions accepted'
    Assert (-not [bool]$resizeRequest.Invoke($null, @('maximize', 800, 560, 1024, 768))) 'State-only operation accepted hidden dimensions'
    Assert (-not [bool]$resizeRequest.Invoke($null, @('unknown', 0, 0, 1024, 768))) 'Open-ended native window operation accepted'
    $rectType = [WindowsMermaidGuiObserver].GetNestedType('Rect', $private)
    $desktopRect = [Activator]::CreateInstance($rectType, $true)
    $desktopRect.left = -100; $desktopRect.top = -50; $desktopRect.right = 901; $desktopRect.bottom = 451
    $mouseMethod = [WindowsMermaidGuiObserver].GetMethod('Mouse', $staticFlags)
    $mouse = $mouseMethod.Invoke($null, @(900, 450, $desktopRect, [uint32]0xc001))
    Assert ($mouse.data.mouse.x -eq 65535 -and $mouse.data.mouse.y -eq 65535) 'Native mouse coordinates must include negative virtual-desktop origin'
    Rejects { $null = $mouseMethod.Invoke($null, @(901, 450, $desktopRect, [uint32]0xc001)) } 'Native click outside the measured desktop was accepted'
    $stableWindow = [WindowsMermaidGuiObserver].GetMethod('SameMeasuredWindowState', $staticFlags)
    function New-WindowMeasurement {
        $result = [Collections.Generic.Dictionary[string, object]]::new()
        $result['pid'] = [uint32]42; $result['creationFileTime'] = '123'; $result['hwnd'] = '0x10'
        $result['dpi'] = [uint32]96; $result['maximized'] = $false; $result['minimized'] = $false
        foreach ($field in @('windowRect', 'clientRect')) {
            $rect = [Collections.Generic.Dictionary[string, object]]::new()
            $rect['left'] = 0; $rect['top'] = 0; $rect['right'] = 800; $rect['bottom'] = 560; $rect['width'] = 800; $rect['height'] = 560
            $result[$field] = $rect
        }
        return ,$result
    }
    $firstMeasurement = New-WindowMeasurement; $nextMeasurement = New-WindowMeasurement
    Assert ([bool]$stableWindow.Invoke($null, @($firstMeasurement, $nextMeasurement))) 'Stable registered native window was rejected'
    $nextMeasurement['clientRect']['height'] = 550
    Assert (-not [bool]$stableWindow.Invoke($null, @($firstMeasurement, $nextMeasurement))) 'Changing native client size was declared ready'
    $nextMeasurement = New-WindowMeasurement; $nextMeasurement['creationFileTime'] = '124'
    Assert (-not [bool]$stableWindow.Invoke($null, @($firstMeasurement, $nextMeasurement))) 'Reused product PID was declared stable'
    $nextMeasurement = New-WindowMeasurement; $nextMeasurement['dpi'] = [uint32]144
    Assert (-not [bool]$stableWindow.Invoke($null, @($firstMeasurement, $nextMeasurement))) 'Changing observed DPI was declared stable'
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
function New-NativeDictionary([hashtable]$Values) {
    $dictionary = [Collections.Generic.Dictionary[string, object]]::new()
    foreach ($key in $Values.Keys) { $dictionary[$key] = $Values[$key] }
    return ,$dictionary
}
# Nested callbacks can finish enqueueing before the outer callback. The actual
# drainer must retain entry order and original timestamps, not completion order.
$queueObserver = [WindowsMermaidGuiObserver]::new()
try {
    $noticeType = [WindowsMermaidGuiObserver].GetNestedType('NativeNotice', [Reflection.BindingFlags]::NonPublic)
    $queue = [WindowsMermaidGuiObserver].GetField('nativeNotices', $instanceFlags).GetValue($queueObserver)
    $dequeue = [WindowsMermaidGuiObserver].GetMethod('DequeueNativeNotice', $instanceFlags)
    foreach ($order in @(3, 2, 1)) {
        $notice = [Activator]::CreateInstance($noticeType, $true)
        $notice.Order = [long]$order; $notice.Time = [uint32](100 + $order); $notice.Tick = [long](110 + $order)
        $queue.Enqueue($notice)
    }
    foreach ($order in 1..3) {
        $notice = $dequeue.Invoke($queueObserver, @())
        Assert ($notice.Order -eq $order -and $notice.Time -eq (100 + $order) -and $notice.Tick -eq (110 + $order)) 'Nested callback completion reordered or rewrote native evidence'
    }
    Assert ($queue.Count -eq 0) 'Ordered native drain duplicated a notice'
} finally { $queueObserver.Dispose() }
# Exercise the actual C# journal/reconciler and export its own raw records for
# independent JavaScript replay. No native API or real desktop is simulated.
$lifetimeObserver = [WindowsMermaidGuiObserver]::new()
try {
    $recordLife = [WindowsMermaidGuiObserver].GetMethod('RecordLifeEvent', $instanceFlags)
    $lifeList = [WindowsMermaidGuiObserver].GetField('windowLives', $instanceFlags).GetValue($lifetimeObserver)
    $shows = [WindowsMermaidGuiObserver].GetField('childShowEvidence', $instanceFlags).GetValue($lifetimeObserver)
    $matchLife = [WindowsMermaidGuiObserver].GetMethod('MatchesLifeProof', $instanceFlags)
    $reconcile = [WindowsMermaidGuiObserver].GetMethod('ReconcileChildShows', $instanceFlags)
    $expandTick = [WindowsMermaidGuiObserver].GetMethod('ExpandEventTick', $staticFlags)
    Assert ($expandTick.Invoke($null, @([uint32]4294967280, [long]4294967328)) -eq [long]4294967280) 'Native uptime wrap was not expanded from the callback anchor'
    Assert ($null -eq $expandTick.Invoke($null, @([uint32]101, [long]100))) 'Future native event time was accepted'
    Assert ($null -eq $expandTick.Invoke($null, @([uint32]100, [long]2101))) 'Event beyond the fixed 2000 ms proof window was accepted'
    $null = $recordLife.Invoke($lifetimeObserver, @([IntPtr]16, 'create', [uint32]100, [uint32]11, [long]101, [long]1))
    $rootLife = $lifeList[0]
    $rootLife.Confirmation = New-NativeDictionary @{ sequence = [long]2; callbackTick = [long]102; className = 'Tauri Window'; rootHwnd = '0x10'; rootLifeId = $null; pid = [uint32]100; processCreationFileTime = '1000'; threadId = [uint32]11; threadCreationFileTime = '1010'; doubleReadMatched = $true }
    $null = $recordLife.Invoke($lifetimeObserver, @([IntPtr]17, 'create', [uint32]110, [uint32]12, [long]111, [long]3))
    $childLife = $lifeList[1]
    $childLife.Confirmation = New-NativeDictionary @{ sequence = [long]4; callbackTick = [long]112; className = 'Button'; rootHwnd = '0x10'; rootLifeId = [long]1; pid = [uint32]101; processCreationFileTime = '1100'; threadId = [uint32]12; threadCreationFileTime = '1110'; doubleReadMatched = $true }
    $null = $recordLife.Invoke($lifetimeObserver, @([IntPtr]16, 'destroy', [uint32]200, [uint32]11, [long]230, [long]6))
    Assert ($rootLife.Retirement['reason'] -eq 'destroy' -and $childLife.Retirement['reason'] -eq 'parent-destroy' -and $childLife.Retirement['parentLifeId'] -eq 1) 'Parent destruction did not retain exact child retirement evidence'
    $rootLife.Released = [long]2230; $childLife.Released = [long]2230
    $proof = New-NativeDictionary @{
        capturedAtTick = [long]220; threadId = [uint32]12; threadCreationFileTime = '1110'; pid = [uint32]101; processCreationFileTime = '1100'; heldThreadVerified = $true; heldProcessVerified = $true
        heldThreadWait = (New-NativeDictionary @{ result = [uint32]0; exitFileTime = '1200' })
        heldProcessWait = (New-NativeDictionary @{ result = [uint32]258; exitFileTime = $null })
        currentThread = (New-NativeDictionary @{ status = 'same-identity'; threadCreationFileTime = '1110'; pid = [uint32]101; processCreationFileTime = '1100' })
    }
    $show = New-NativeDictionary @{ id = [long]1; hwnd = '0x11'; sequence = [long]5; nativeEventUptimeMs32 = [uint32]150; nativeTick = [long]150; callbackTick = [long]220; eventThreadId = [uint32]12; status = 'unresolved'; scope = 'child'; lifeId = $null; proof = $proof; reason = 'synthetic retained native identity' }
    $shows.Add($show)
    function Test-ExactLife {
        $arguments = @($childLife, $show)
        if ($matchLife.GetParameters().Length -eq 3) { $arguments += $false }
        return [bool]$matchLife.Invoke($lifetimeObserver, $arguments)
    }
    Assert (Test-ExactLife) 'A uniquely measured child lifetime rejected its in-interval late SHOW'
    $originalShow = $show
    $liveChildProof = [Collections.Generic.Dictionary[string, object]]::new($proof)
    $liveChildProof['capturedAtTick'] = [long]250
    $liveChildProof['heldThreadWait'] = New-NativeDictionary @{ result = [uint32]258; exitFileTime = $null }
    $liveRootProof = [Collections.Generic.Dictionary[string, object]]::new($liveChildProof)
    foreach ($key in @('pid', 'threadId', 'processCreationFileTime', 'threadCreationFileTime')) { $liveRootProof[$key] = $rootLife.Confirmation[$key] }
    $liveRootProof['currentThread'] = New-NativeDictionary @{ status = 'same-identity'; pid = [uint32]100; processCreationFileTime = '1000'; threadCreationFileTime = '1010' }
    function New-LiveSnapshot($life) {
        $snapshot = New-NativeDictionary @{ hwnd = ('0x' + $life.Hwnd.ToInt64().ToString('x')); isWindow = $true; beginTick = [long]250; endTick = [long]250 }
        foreach ($key in @('pid', 'threadId', 'className', 'rootHwnd')) { $snapshot[$key] = $life.Confirmation[$key] }
        return ,$snapshot
    }
    $post = New-NativeDictionary @{ childLifeId = [long]2; rootLifeId = [long]1; doubleReadMatched = $true; endSequence = [long]8; childFirst = (New-LiveSnapshot $childLife); childSecond = (New-LiveSnapshot $childLife); rootFirst = (New-LiveSnapshot $rootLife); rootSecond = (New-LiveSnapshot $rootLife); childProof = $liveChildProof; rootProof = $liveRootProof }
    $show = New-NativeDictionary @{ id = [long]2; hwnd = '0x11'; sequence = [long]7; nativeEventUptimeMs32 = [uint32]240; nativeTick = [long]240; callbackTick = [long]240; eventThreadId = [uint32]12; scope = 'child'; proof = $liveChildProof; postParentDestroy = $post }
    $childLife.DirectDestroy = New-NativeDictionary @{ sequence = [long]10; nativeEventUptimeMs32 = [uint32]250; nativeTick = [long]250; callbackTick = [long]250; eventThreadId = [uint32]12; eventKind = 'destroy'; processingWindow = (New-NativeDictionary @{ hwnd = '0x11' }) }
    Assert (Test-ExactLife) 'Live teardown continuity with subsequent same-tick child DESTROY was rejected'
    $post['childSecond']['isWindow'] = $false
    Assert (-not (Test-ExactLife)) 'Child disappearing during double read was accepted'
    $post['childSecond']['isWindow'] = $true
    $post['rootSecond']['className'] = 'ConsoleWindowClass'
    Assert (-not (Test-ExactLife)) 'Changed root identity was accepted'
    $post['rootSecond']['className'] = 'Tauri Window'
    $childLife.DirectDestroy['sequence'] = [long]7
    Assert (-not (Test-ExactLife)) 'DESTROY preceding completion of live reads was accepted'
    $childLife.DirectDestroy = $null
    Assert (-not (Test-ExactLife)) 'Missing direct child destruction boundary was accepted'
    $show = $originalShow

    $show['nativeTick'] = [long]110
    Assert (Test-ExactLife) 'Same-tick CREATE/SHOW with exact FIFO entry order and an actual in-generation snapshot was rejected'
    $show['nativeTick'] = [long]109
    Assert (-not (Test-ExactLife)) 'A SHOW predating the native CREATE borrowed a later HWND generation'
    $show['nativeTick'] = [long]150; $childLife.Confirmation['callbackTick'] = [long]200
    Assert (-not (Test-ExactLife)) 'A snapshot at the native retirement boundary classified the old window'
    $childLife.Confirmation['callbackTick'] = [long]112
    $show['nativeTick'] = [long]200
    Assert (-not (Test-ExactLife)) 'A SHOW at the retirement boundary borrowed the old child lifetime'
    $show['nativeTick'] = [long]150; $show['sequence'] = [long]7
    Assert (-not (Test-ExactLife)) 'A SHOW entering after retirement was assigned to the earlier generation'
    $show['sequence'] = [long]5
    $show['nativeTick'] = [long]150; $proof['threadCreationFileTime'] = '1111'
    Assert (-not (Test-ExactLife)) 'Reused TID birth was accepted as the historical thread'
    $proof['threadCreationFileTime'] = '1110'; $childLife.Create['nativeTick'] = $null
    Assert (-not (Test-ExactLife)) 'Unresolved child CREATE time was accepted'
    $childLife.Create['nativeTick'] = [long]110; $rootLife.Create['nativeTick'] = $null
    Assert (-not (Test-ExactLife)) 'Unresolved root CREATE time was accepted'
    $rootLife.Create['nativeTick'] = [long]100
    $null = $reconcile.Invoke($lifetimeObserver, @())
    Assert ($show['status'] -eq 'resolved-child' -and $show['lifeId'] -eq 2) 'Final C# reconciliation did not preserve the exact life reference'
    $raw = New-NativeDictionary @{
        childLifeVersion = 1; windowLifetimes = @($rootLife.Record(), $childLife.Record()); childShowEvidence = @($show)
        observationStoppedAtTick = 2500; workingGenerationPeak = 2; sharedRecordCount = 3
        events = @(); unresolvedEvents = @(); resolvedChildEvents = @()
        knownChildShowEvents = [WindowsMermaidGuiObserver].GetField('knownChildShowEvents', $instanceFlags).GetValue($lifetimeObserver)
        knownWindowShowEvents = [WindowsMermaidGuiObserver].GetField('knownWindowShowEvents', $instanceFlags).GetValue($lifetimeObserver)
        processes = @(@{ pid = 100; parentPid = 1; creationFileTime = '1000'; image = 'product.exe' }, @{ pid = 101; parentPid = 100; creationFileTime = '1100'; image = 'webview.exe' })
    }
    if ($SyntheticLifetimeOutput) {
        [IO.File]::WriteAllText([IO.Path]::GetFullPath($SyntheticLifetimeOutput), ($raw | ConvertTo-Json -Depth 30))
        $show['nativeTick'] = [long]110; $show['nativeEventUptimeMs32'] = [uint32]110
        $null = $reconcile.Invoke($lifetimeObserver, @())
        Assert ($show['status'] -eq 'resolved-child') 'C# final reconciliation rejected CREATE/SHOW same tick despite proven FIFO generation'
        [IO.File]::WriteAllText([IO.Path]::ChangeExtension([IO.Path]::GetFullPath($SyntheticLifetimeOutput), '.same-tick.json'), ($raw | ConvertTo-Json -Depth 30))
        $show['nativeTick'] = [long]150; $show['nativeEventUptimeMs32'] = [uint32]150
    }
    $null = $recordLife.Invoke($lifetimeObserver, @([IntPtr]17, 'create', [uint32]300, [uint32]12, [long]310, [long]8))
    Assert ($lifeList.Count -eq 3 -and $lifeList[2].Generation -eq 2) 'Same-HWND CREATE did not retain a new generation barrier'
    $lifeList[2].Create['nativeTick'] = $null
    Assert (-not (Test-ExactLife)) 'An unknown later CREATE barrier was ignored'
    $retainedEvents = [WindowsMermaidGuiObserver].GetField('events', $instanceFlags).GetValue($lifetimeObserver)
    foreach ($number in 1..2044) { $retainedEvents.Add((New-NativeDictionary @{})) }
    $sharedCount = [WindowsMermaidGuiObserver].GetMethod('SharedRecordCount', $instanceFlags)
    Assert ($sharedCount.Invoke($lifetimeObserver, @()) -eq 2048) 'Shared records were counted inconsistently'
    $null = $recordLife.Invoke($lifetimeObserver, @([IntPtr]18, 'create', [uint32]400, [uint32]12, [long]410, [long]9))
    Assert ($lifeList.Count -eq 3 -and [bool][WindowsMermaidGuiObserver].GetField('overflow', $instanceFlags).GetValue($lifetimeObserver)) 'Shared journal exhaustion did not fail without exceeding its bound'
} finally { $lifetimeObserver.Dispose() }
$generationBudget = [WindowsMermaidGuiObserver]::new()
try {
    foreach ($number in 1..257) { $null = $recordLife.Invoke($generationBudget, @([IntPtr]$number, 'create', [uint32]($number * 3), [uint32]12, [long]($number * 3 + 1), [long]$number)) }
    $boundedLives = [WindowsMermaidGuiObserver].GetField('windowLives', $instanceFlags).GetValue($generationBudget)
    Assert ($boundedLives.Count -eq 256 -and [bool][WindowsMermaidGuiObserver].GetField('overflow', $instanceFlags).GetValue($generationBudget)) 'Working native generation bound was exceeded or silently dropped without failure'
} finally { $generationBudget.Dispose() }
$retiredBudget = [WindowsMermaidGuiObserver]::new()
try {
    foreach ($number in 1..300) {
        $null = $recordLife.Invoke($retiredBudget, @([IntPtr]$number, 'create', [uint32]($number * 3), [uint32]12, [long]($number * 3), [long]($number * 2)))
        $null = $recordLife.Invoke($retiredBudget, @([IntPtr]$number, 'destroy', [uint32]($number * 3 + 1), [uint32]12, [long]($number * 3 + 1), [long]($number * 2 + 1)))
    }
    $retiredLives = [WindowsMermaidGuiObserver].GetField('windowLives', $instanceFlags).GetValue($retiredBudget)
    Assert ($retiredLives.Count -eq 300 -and -not [bool][WindowsMermaidGuiObserver].GetField('overflow', $instanceFlags).GetValue($retiredBudget)) 'Unconfirmed dead windows consumed held-proof slots after retirement'
    Assert ($retiredLives[0].Released -eq 4 -and $retiredLives[0].Create['sequence'] -eq 2) 'Unconfirmed release discarded or rewrote its original CREATE barrier'
} finally { $retiredBudget.Dispose() }
[pscustomobject]@{ passed = $true; csharpCompiled = $true; powershellParsed = $true; pointerBytes = [IntPtr]::Size; inputBytes = $expectedInput; startupInfoExBytes = $expectedStartup; nativeWindowsExecution = $false } | ConvertTo-Json -Compress

# Exercise the real PowerShell writer and Node decoder, including a report that
# exceeded the former raw-size gate. No records or identity fields are removed.
$codecTokens = $null; $codecErrors = $null
$codecAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $RepositoryRoot 'scripts/ci/run-windows-mermaid-gui-observer.ps1'), [ref]$codecTokens, [ref]$codecErrors)
$codecFunction = $codecAst.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Save-NativeReport' }, $true)
Invoke-Expression $codecFunction.Extent.Text
$EvidenceDirectory = Join-Path ([IO.Path]::GetTempPath()) ('milkup-codec-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($EvidenceDirectory) | Out-Null
try {
    $script:identityContext = @{ codecTest = $true }
    $codecReport = @{ events = @(1..5000 | ForEach-Object { @{ sequence = $_; proof = ('identity' * 90) } }); childShowEvidence = @(); complete = $true }
    $null = Save-NativeReport $codecReport
    $codecCheck = @'
const assert=require('node:assert/strict'),fs=require('node:fs'),url=require('node:url');
(async()=>{const {decodeGuiEvidence}=await import(url.pathToFileURL(process.argv[1]));
const bytes=fs.readFileSync(process.argv[2]);const raw=decodeGuiEvidence(bytes,'window');
assert(raw.length>2*1024*1024);assert(bytes.length<2*1024*1024);
assert.equal(JSON.parse(raw).events.length,5000);assert.equal(JSON.parse(raw).events[4999].sequence,5000);
})().catch(e=>{console.error(e);process.exitCode=1});
'@
    & node -e $codecCheck (Join-Path $RepositoryRoot 'tests/windows/mermaid-gui-contract.mjs') (Join-Path $EvidenceDirectory 'native-window-events.json')
    Assert ($LASTEXITCODE -eq 0) 'PowerShell/Node lossless evidence round trip failed'
    Rejects { Save-NativeReport @{ events = @(); padding = ('x' * 9MB) } } 'Expanded report above hard limit was accepted'
} finally { Remove-Item -LiteralPath $EvidenceDirectory -Recurse -Force }
