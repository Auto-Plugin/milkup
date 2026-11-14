$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Add-Type -Path (Join-Path $root 'scripts/release/WindowsInstallWindow.cs')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InstallWindowNegativeFixture {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr CreateWindowExW(uint exStyle,string className,string title,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr window);
}
'@
function Reject([scriptblock]$Action) {
    $rejected=$false
    try { & $Action } catch { $rejected=$true }
    if (!$rejected) { throw 'Native window policy accepted invalid identity or target' }
}
$self=[Diagnostics.Process]::GetCurrentProcess()
$birth=$self.StartTime.ToUniversalTime().Ticks
$image=$self.MainModule.FileName
Reject { [MilkupInstallWindow]::Observe($self.Id,$birth+1,$image) }
Reject { [MilkupInstallWindow]::Observe($self.Id,$birth,$image+'.wrong') }
$window=[InstallWindowNegativeFixture]::CreateWindowExW(0,'STATIC','milkup',0x10000000,0,0,80,40,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
if ($window -eq [IntPtr]::Zero) { throw 'Cannot create controlled negative window' }
try {
    $rows=@([MilkupInstallWindow]::Observe($self.Id,$birth,$image))
    $match=@($rows | Where-Object { $_.hwnd -eq $window.ToInt64() })
    if ($match.Count -ne 1) { throw 'Controlled window missing from bounded observation' }
    if (![StringComparer]::OrdinalIgnoreCase.Equals($match[0].className,'STATIC') -or $match[0].productRoot) { throw 'A matching title cannot substitute for the Tauri root class' }
    Reject { [MilkupInstallWindow]::Close($window.ToInt64(),$self.Id,$birth,$image) }
} finally {
    if (![InstallWindowNegativeFixture]::DestroyWindow($window)) { throw 'Controlled negative window cleanup failed' }
    $self.Dispose()
}
'4 native installation window identity/target checks passed'
