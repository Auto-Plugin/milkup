[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$RootProcessId,
    [Parameter(Mandatory)][int]$DebugPort,
    [Parameter(Mandatory)][string]$ProfileDirectory,
    [Parameter(Mandatory)][string]$OutputFile,
    [Parameter(Mandatory)][datetime]$StartedAt
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted Windows only' }
if (Test-Path -LiteralPath $OutputFile) { throw 'Refusing to overwrite startup evidence' }
$result = [ordered]@{ capturedAt = [datetime]::UtcNow.ToString('o'); rootProcessId = $RootProcessId; debugPort = $DebugPort; errors = @() }
try {
    $all = @(Get-CimInstance Win32_Process)
    $owned = [System.Collections.Generic.HashSet[int]]::new()
    [void]$owned.Add($RootProcessId)
    for ($level = 0; $level -lt 8; $level++) {
        foreach ($process in $all) { if ($owned.Contains([int]$process.ParentProcessId)) { [void]$owned.Add([int]$process.ProcessId) } }
    }
    $result.processes = @($all | Where-Object { $owned.Contains([int]$_.ProcessId) } | Select-Object -First 64 | ForEach-Object {
        $record = [ordered]@{ id = $_.ProcessId; parent = $_.ParentProcessId; name = $_.Name; path = $_.ExecutablePath; commandLine = $_.CommandLine; created = $_.CreationDate }
        try {
            $live = Get-Process -Id $_.ProcessId -ErrorAction Stop
            $record.responding = $live.Responding
            $record.windowTitle = $live.MainWindowTitle
            $record.windowHandle = $live.MainWindowHandle.ToInt64()
            $record.workingSet = $live.WorkingSet64
            $record.cpuSeconds = $live.CPU
            $record.threads = @($live.Threads | Select-Object -First 24 | ForEach-Object {
                $thread = [ordered]@{ id = $_.Id; state = $_.ThreadState.ToString() }
                if ($_.ThreadState.ToString() -eq 'Wait') { $thread.waitReason = $_.WaitReason.ToString() }
                $thread
            })
        } catch { $record.inspectionError = $_.Exception.Message }
        $record
    })
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class StartupWindows {
  public delegate bool Callback(IntPtr hwnd, IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, Callback cb, IntPtr arg);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  public class Window { public long handle; public uint pid; public string title, kind; public bool visible; public Rect rect; public List<Window> children; }
  static Window Read(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h,out pid); var text=new StringBuilder(1024); var kind=new StringBuilder(256);
    GetWindowText(h,text,text.Capacity); GetClassName(h,kind,kind.Capacity); Rect rect; GetWindowRect(h,out rect);
    return new Window {handle=h.ToInt64(),pid=pid,title=text.ToString(),kind=kind.ToString(),visible=IsWindowVisible(h),rect=rect};
  }
  public static List<Window> Capture(int[] pids) {
    var ids=new HashSet<int>(pids); var windows=new List<Window>();
    EnumWindows((h,a)=> { var w=Read(h); if(ids.Contains((int)w.pid) && windows.Count<64) {
      w.children=new List<Window>(); EnumChildWindows(h,(c,b)=> {if(w.children.Count<64)w.children.Add(Read(c));return true;},IntPtr.Zero); windows.Add(w);
    } return true; },IntPtr.Zero); return windows;
  }
}
'@
    $relatedUi = @($all | Where-Object { $_.Name -match '^(smartscreen|consent|WerFault|wermgr)\.exe$' -and $_.CreationDate -ge $StartedAt } | Select-Object -First 8)
    $result.relatedUiProcesses = @($relatedUi | Select-Object ProcessId, ParentProcessId, Name, CreationDate)
    $windowIds = [int[]]@(@($owned) + @($relatedUi | ForEach-Object { [int]$_.ProcessId }))
    $result.windows = @([StartupWindows]::Capture($windowIds))
    $result.listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq $DebugPort -or $owned.Contains([int]$_.OwningProcess) } | Select-Object -First 32 LocalAddress, LocalPort, OwningProcess)
    $result.profileExists = Test-Path -LiteralPath $ProfileDirectory
    $result.profileEntries = @(if ($result.profileExists) { Get-ChildItem -LiteralPath $ProfileDirectory -Force | Select-Object -First 32 Name, Mode, Length })
    $result.applicationEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $StartedAt; Id = 1000, 1001, 1002 } -MaxEvents 40 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'milkup-desktop|windows_startup_control|msedgewebview2' } | Select-Object -First 8 | ForEach-Object { @{ time = $_.TimeCreated.ToUniversalTime().ToString('o'); id = $_.Id; message = $_.Message.Substring(0, [Math]::Min($_.Message.Length, 8192)) } })
} catch { $result.errors += $_.Exception.ToString() }
$json = $result | ConvertTo-Json -Depth 10
if ($json.Length -gt 48000) {
    # Preserve valid JSON inside the 64 KiB text-log contract, with explicit loss.
    $result.detailReducedForLogBudget = $true
    if ($result.Contains('processes')) {
        foreach ($record in $result.processes) {
            $record.threads = @()
            if ($record.commandLine -and $record.commandLine.Length -gt 512) { $record.commandLine = $record.commandLine.Substring(0,512) }
        }
        $result.processes = @($result.processes | Select-Object -First 16)
    }
    if ($result.Contains('windows')) { $result.windows = @($result.windows | Select-Object -First 16); foreach ($window in $result.windows) { $window.children.Clear() } }
    if ($result.Contains('applicationEvents')) { $result.applicationEvents = @($result.applicationEvents | Select-Object -First 2) }
    $json = $result | ConvertTo-Json -Depth 10
}
$json | Set-Content -LiteralPath $OutputFile -Encoding utf8
