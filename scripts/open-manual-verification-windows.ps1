param(
  [switch]$BuildIfMissing,
  [switch]$PrepareOnly,
  [string]$Stamp
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$appPath = Join-Path $repoRoot "apps\desktop\src-tauri\target\x86_64-pc-windows-gnu\debug\milkup-desktop.exe"
$runbookPath = Join-Path $repoRoot "docs\manual-verification-windows-runbook-2026-07-06.md"

if (!(Test-Path -LiteralPath $appPath)) {
  if (!$BuildIfMissing) {
    Write-Host "没有找到 desktop debug app:" -ForegroundColor Yellow
    Write-Host "  $appPath"
    Write-Host ""
    Write-Host "请重新运行并附加 -BuildIfMissing，或者先让 Codex 构建 debug app。"
    Read-Host "按 Enter 退出"
    exit 1
  }

  $winlibs = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$winlibs;$env:PATH"
  $env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
  $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = "x86_64-w64-mingw32-gcc.exe"

  Push-Location $repoRoot
  try {
    pnpm --filter "@milkup/desktop" tauri build --debug --target x86_64-pc-windows-gnu
  } finally {
    Pop-Location
  }
}

if (!(Test-Path -LiteralPath $appPath)) {
  throw "构建后仍未找到 app: $appPath"
}

$stamp = if ($Stamp) { $Stamp } else { Get-Date -Format "yyyyMMdd-HHmmss" }
$fixtureRoot = Join-Path $env:TEMP "milkup-manual-$stamp"
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null

$imeScratchFile = Join-Path $fixtureRoot "windows-ime-notes.md"
$reportPath = Join-Path $repoRoot "docs\manual-verification-windows-$stamp.md"

Set-Content -LiteralPath $imeScratchFile -Value "# Windows IME manual notes`n`n" -Encoding UTF8

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$languageSummary = try {
  (Get-WinUserLanguageList | ForEach-Object {
    $tips = if ($_.InputMethodTips.Count -gt 0) { $_.InputMethodTips -join ", " } else { "未列出" }
    "$($_.LanguageTag) / $($_.EnglishName) / input: $tips"
  }) -join "; "
} catch {
  "无法自动读取，请填写"
}
$displayScale = try {
  $scaleLogPixels = Get-ItemProperty -Path "HKCU:\Control Panel\Desktop\WindowMetrics" -Name AppliedDPI -ErrorAction Stop
  if ($scaleLogPixels.AppliedDPI) {
    "$([Math]::Round(($scaleLogPixels.AppliedDPI / 96) * 100))%"
  } else {
    "无法自动读取，请填写"
  }
} catch {
  "无法自动读取，请填写"
}
$launchCommand = "scripts\open-manual-verification-windows.cmd"
$nowText = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
$operator = if ($env:USERNAME) { $env:USERNAME } else { "请填写" }

$report = @"
# Windows 中文 IME 手动验收报告 - $stamp

本报告由 scripts\open-manual-verification-windows.ps1 预生成。当前 Windows 本机剩余只需要验收 M16 Windows Chinese IME；Windows 文件对话框、Ctrl 快捷键、file watcher 和 external editor conflict 已有独立 pass 报告，不需要在本报告中重复填写。请在实际验收后把 pending 改成 pass、fail 或 skipped，并填写观察结果。只有明确 pass 且有证据说明的项目，才能更新 coding-plan.md。

## 摘要

- 日期/时间：$nowText
- 验收人：$operator
- 平台：Windows
- OS 名称/版本：$($os.Caption) $($os.Version)
- 架构：$($os.OSArchitecture)
- 设备型号：$($computer.Manufacturer) $($computer.Model)
- 显示缩放：$displayScale
- 输入法/语言列表：$languageSummary
- 键盘布局：请填写
- App build 路径：$appPath
- 启动命令：$launchCommand
- Fixture 目录：$fixtureRoot
- IME 记录草稿：$imeScratchFile
- Windows 操作手册：$runbookPath
- 截图或录屏：请填写
- 总体结果：pending

## Checklist 映射

| coding-plan item        | Result  | 证据章节 | 备注 |
| ----------------------- | ------- | -------- | ---- |
| M16 Windows Chinese IME | pending | IME      |      |

## IME

- Result：pending
- 平台：Windows
- IME 名称/版本：请填写
- Source mode composition 是否不会提前提交：
- Source mode 最终提交文本是否只出现一次：
- Source mode undo 行为：
- Live mode 普通文本：
- Live mode 列表项：
- Live mode inline marker 附近：
- Composition 后 mode switch 是否保留文本/selection/history：
- 备注：
- 截图：

证据详情：

~~~text
请填写真实观察结果。建议至少记录：
- source mode 输入的最终中文/标点/中英混排文本。
- composition 期间是否没有提前写入正文。
- compositionend 后文本是否只出现一次。
- undo 是否能撤销本次提交。
- live mode 普通文本、列表项、inline marker 附近是否正常。
- composition 后切换 source/live/preview 时文本、selection 和 history 是否保留。
~~~

## 最终 Checklist 更新前确认

- 每个要勾选的项目在本报告中都有对应的 Result：pass。
- 报告包含平台、build 路径、启动命令和 fixture 路径。
- 失败步骤附有说明或截图。
- macOS/Linux 项、Windows 文件对话框、Windows Ctrl 快捷键、Windows file watcher 和 external editor conflict 没有在本报告中声明完成。
- 最终报告文件名带日期，并已保存到 docs/。
"@

Set-Content -LiteralPath $reportPath -Value $report -Encoding UTF8

Write-Host ""
Write-Host "Milkup Windows 手动验收环境已准备好。" -ForegroundColor Green
Write-Host ""
Write-Host "请先看这份中文操作手册："
Write-Host "  $runbookPath"
Write-Host ""
Write-Host "本次 fixture 目录："
Write-Host "  $fixtureRoot"
Write-Host ""
Write-Host "本次报告草稿："
Write-Host "  $reportPath"
Write-Host ""
if ($PrepareOnly) {
  Write-Host "PrepareOnly 已启用：不会打开操作手册、报告草稿或 app。"
  Write-Host "已生成报告草稿：$reportPath"
  exit 0
}

Write-Host "接下来会打开操作手册、报告草稿和 milkup desktop app。"
Write-Host "如果 app 里曾经残留自动化测试路径，请按操作手册清理 app data 后再记录最终结果。"
Write-Host ""

if (Test-Path -LiteralPath $runbookPath) {
  Start-Process -FilePath $runbookPath
}

if (Test-Path -LiteralPath $reportPath) {
  Start-Process -FilePath $reportPath
}

Start-Process -FilePath $appPath -WorkingDirectory (Split-Path -Parent $appPath)

Write-Host "已启动。完成验收后，把结果填入报告草稿即可。"
Read-Host "按 Enter 关闭这个窗口"



