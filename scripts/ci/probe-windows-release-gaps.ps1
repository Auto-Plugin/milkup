param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true') { throw 'Isolated Actions only' }
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$report=[ordered]@{schema=1;harnessSha=$env:GITHUB_SHA;image=$env:ImageOS;imageVersion=$env:ImageVersion;status='running';productTested=$false;systemSettingsChanged=$false;checks=@{};errors=@();limitations=@()}
function Persist { $report | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $EvidenceDirectory 'capabilities.json') }
function Probe([string]$Name,[scriptblock]$Operation) {
  try { $report.checks[$Name]=& $Operation } catch { $report.errors+=@{check=$Name;error=$_.Exception.Message} }
  Persist
}
Probe 'languages' { @(Get-WinUserLanguageList | ForEach-Object { @{tag=$_.LanguageTag;tips=@($_.InputMethodTips)} }) }
Probe 'chineseLanguageCapability' { @(Get-WindowsCapability -Online -Name 'Language.Basic~~~zh-CN~*' | Select-Object Name,State) }
Probe 'chineseTextServices' {
  $rows=@()
  foreach($base in @('HKLM:\SOFTWARE\Microsoft\CTF\TIP','HKLM:\SOFTWARE\WOW6432Node\Microsoft\CTF\TIP')) {
    if (!(Test-Path $base)) { continue }
    foreach($tip in Get-ChildItem $base) {
      foreach($language in @('0x00000804','0x00000404')) {
        $profiles=Join-Path $tip.PSPath ('LanguageProfile\'+$language)
        if (Test-Path $profiles) {
          foreach($profile in Get-ChildItem $profiles) {
            $props=Get-ItemProperty $profile.PSPath
            $rows+=@{tip=$tip.PSChildName;language=$language;profile=$profile.PSChildName;description=$props.Description;enabled=$props.Enable;registryView=$base}
          }
        }
      }
    }
  }
  $rows
}
Probe 'pinyinEngineFiles' {
  @('System32\InputMethod\CHS\ChsIME.exe','System32\InputMethod\CHS\ChsIME.dll','System32\IME\IMEZH\IMSCUI.exe') | ForEach-Object {
    $p=Join-Path $env:windir $_
    @{relativePath=$_;present=(Test-Path -LiteralPath $p -PathType Leaf);version=$(if(Test-Path -LiteralPath $p -PathType Leaf){(Get-Item $p).VersionInfo.FileVersion}else{$null})}
  }
}
Probe 'word' {
  $rows=@()
  foreach($base in @($env:ProgramFiles,${env:ProgramFiles(x86)})) {
    foreach($part in @('Microsoft Office\root\Office16\WINWORD.EXE','Microsoft Office\Office16\WINWORD.EXE')) {
      $p=Join-Path $base $part
      if(Test-Path -LiteralPath $p -PathType Leaf){$v=(Get-Item $p).VersionInfo;$rows+=@{fileVersion=$v.FileVersion;productVersion=$v.ProductVersion;productName=$v.ProductName}}
    }
  }
  $rows
}
Probe 'webviewRuntimes' {
  $rows=@()
  foreach($base in @($env:ProgramFiles,${env:ProgramFiles(x86)})) {
    $p=Join-Path $base 'Microsoft\EdgeWebView\Application'
    if(Test-Path $p){$rows+=@(Get-ChildItem $p -Directory | Where-Object {Test-Path (Join-Path $_.FullName 'msedgewebview2.exe')} | ForEach-Object { @{version=$_.Name;sha256=(Get-FileHash (Join-Path $_.FullName 'msedgewebview2.exe') -Algorithm SHA256).Hash.ToLowerInvariant()} })}
  }
  $rows
}
Probe 'cleanGuestFacilities' {
  @(Get-WindowsOptionalFeature -Online | Where-Object {$_.FeatureName -match 'Containers-DisposableClientVM|Microsoft-Hyper-V|VirtualMachinePlatform'} | Select-Object FeatureName,State)
}
Probe 'networkAdapterStates' { @(Get-NetAdapter | Select-Object Status,InterfaceDescription) }
Probe 'nativeDisplay' {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GapNativeDisplay {
 [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [DllImport("user32.dll")] public static extern int GetKeyboardLayoutList(int size, [Out] IntPtr[] values);
 public static string[] Layouts(){int n=GetKeyboardLayoutList(0,null);if(n<0||n>64)throw new Exception("Keyboard layout bound");var v=new IntPtr[n];n=GetKeyboardLayoutList(n,v);var s=new string[n];for(int i=0;i<n;i++)s[i]=v[i].ToInt64().ToString("x");return s;}
}
'@
  $old=[GapNativeDisplay]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
  $form=[Windows.Forms.Form]::new()
  try {
    $form.Text='Milkup isolated capability probe';$form.Width=640;$form.Height=320
    $form.Show();[Windows.Forms.Application]::DoEvents()
    @{systemDpi=[GapNativeDisplay]::GetDpiForSystem();probeWindowDpi=[GapNativeDisplay]::GetDpiForWindow($form.Handle);keyboardLayouts=[GapNativeDisplay]::Layouts();screens=@([Windows.Forms.Screen]::AllScreens | ForEach-Object {@{primary=$_.Primary;width=$_.Bounds.Width;height=$_.Bounds.Height;bitsPerPixel=$_.BitsPerPixel}});scope='Owned probe window only; not candidate DPI acceptance'}
  } finally {$form.Close();$form.Dispose();if($old -ne [IntPtr]::Zero){[GapNativeDisplay]::SetThreadDpiAwarenessContext($old)|Out-Null}}
}
$report.limitations=@('Presence does not prove real IME composition or candidate-window behavior.','Observed desktop DPI is not a high-DPI/multi-monitor matrix.','An existing Runtime cannot prove missing-Runtime or offline deployment.','No Runtime removed, network disabled, optional feature enabled, or default printer changed.','Office16 presence alone cannot identify Word 2016.')
$report.status='capabilities-observed-not-product-accepted';Persist
$report | ConvertTo-Json -Depth 12
