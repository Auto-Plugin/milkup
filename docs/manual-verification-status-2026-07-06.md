# 手动验收状态 - 2026-07-06

本文记录当前 Windows 本地自动化/手动证据，以及在 `coding-plan.md` 中勾选剩余 native/manual 项目前仍需补齐的跨平台人工证据。

## 环境

- 日期：2026-07-06
- 验收人/代理：Codex automated continuation
- Workspace：`D:\me\milkup2.0`
- Repository state：不是 git repository；`git status --short` 失败，错误为 `fatal: not a git repository (or any of the parent directories): .git`
- OS：Microsoft Windows 11 Pro，Windows NT 10.0.22631.0
- 架构：x64-based PC
- Debug app path：`D:\me\milkup2.0\apps\desktop\src-tauri\target\x86_64-pc-windows-gnu\debug\milkup-desktop.exe`

## 已刷新自动化证据

命令：

```powershell
$winlibs = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
$env:PATH = "$env:USERPROFILE\.cargo\bin;$winlibs;$env:PATH"
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = "x86_64-w64-mingw32-gcc.exe"
pnpm test:native:desktop
```

结果：

- 通过：`Native Tauri WebDriver smoke passed`
- 覆盖范围：通过 WebDriver 启动真实 debug Tauri app，覆盖 native open/save/save-as test path、reload、reveal guard、真实 filesystem watcher events、watcher-backed dirty/conflict regression checks、desktop plugin Worker file broker 路径，以及 `tests/native/tauri-webdriver-smoke.mjs` 中已有的 desktop sidecar smoke 路径。
- 2026-07-06 追加浏览器自动化覆盖：`pnpm test:e2e` 通过 9 个 Playwright 用例，其中 `desktop shell routes primary shortcuts through active document actions` 覆盖 `Ctrl+O`、`Ctrl+S`、`Ctrl+Shift+S`、`Ctrl+1/2/3`、`Ctrl+Z/Y`、`Ctrl+A` 后 cut、dirty close protection、saved close、`Ctrl+N`。该用例证明 desktop shell 的按钮和快捷键已走统一 Action Registry 分发路径；Windows 真实系统键盘、OS dialog、watcher/conflict 和 IME 后续均已有独立 pass 报告。

## 本轮新增 native 快捷键自动化

已更新并实跑 `tests/native/tauri-webdriver-smoke.mjs`。脚本现在会优先使用显式 `TAURI_NATIVE_DRIVER`，其次使用 PATH 中的 `msedgedriver.exe`，最后按本机 Microsoft Edge WebView2 runtime 版本自动下载匹配的 `msedgedriver.exe` 到 `.tmp/`。

本轮真实 Tauri WebDriver smoke 额外覆盖：

- `Ctrl+O` 打开当前 deterministic native test path。
- `Ctrl+S` 保存当前文档。
- `Ctrl+Shift+S` 执行 Save As。
- `Ctrl+N` 新建文档。
- `Ctrl+1/2/3` 切换 source/live/preview。
- `Ctrl+Z/Y` 撤销/重做。
- `Ctrl+A` 后触发 cut，验证选区来自当前 active document。
- `Ctrl+W` 在 dirty 文档上触发 close protection，保存后可关闭。

本轮已通过：

- `node --check tests/native/tauri-webdriver-smoke.mjs`
- `pnpm --filter @milkup/desktop typecheck`
- `pnpm --filter @milkup/desktop test`
- `pnpm test:e2e`
- `pnpm --filter @milkup/desktop build`
- `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`
- `pnpm test:native:desktop`
- `pnpm lint`

本轮曾遇到 `msedgedriver.exe` 缺失和 Edge/WebView2 版本不匹配问题；已改为使用官方新域名 `msedgedriver.microsoft.com`，并按 WebView2 runtime `149.0.4022.98` 自动取得匹配 driver。最终 `pnpm test:native:desktop` 已输出 `Native Tauri WebDriver smoke passed`。

注意：这证明真实 Tauri 窗口内的 deterministic open/save/save-as、watcher/conflict、插件、sidecar 和 Ctrl 快捷键路径可以自动通过。Windows Ctrl 快捷键证据已在 2026-07-07 形成独立报告并应用到 `coding-plan.md`；它仍不替代真人中文 IME 输入、macOS/Linux 平台行为的手动报告。

## 仍需人工证据

以下 `coding-plan.md` 项目仍然未完成，因为项目协议要求先有带日期的手动报告，才能勾选：

- M16：`macOS Chinese IME`
- M16：`Linux IME`
- M16：`macOS Cmd shortcuts`
- M16：`File watcher on macOS`

## Windows IME 报告状态

Windows Chinese IME 已由真实 Windows 桌面控制验收关闭：

- 证据报告：[manual-verification-windows-ime-computer-use-2026-07-07.md](./manual-verification-windows-ime-computer-use-2026-07-07.md)
- 验收方式：在真实 Tauri debug app 窗口中逐键输入 pinyin，观察 Windows 中文输入法候选窗，并用 space 提交中文文本。
- 覆盖范围：source mode composition 不提前提交、最终提交一次、undo 可撤销；live mode 普通文本、列表项、inline marker 附近输入；preview/source/live mode switch 后保留中文内容。
- 已验证：`pnpm manual:validate docs/manual-verification-windows-ime-computer-use-2026-07-07.md`
- 已应用：`pnpm manual:apply docs/manual-verification-windows-ime-computer-use-2026-07-07.md --write`

历史上的 Windows 手动验收入口仍可用于重新生成 IME-only 草稿，但它不再是当前 blocker：

- 入口：`scripts/open-manual-verification-windows.cmd`
- PowerShell 脚本：`scripts/open-manual-verification-windows.ps1`
- 当前行为：创建 fixture 目录，生成只包含 `M16 Windows Chinese IME` 的带日期中文报告草稿，预填 OS、架构、显示缩放、输入法列表、app build 路径和 fixture 路径，然后打开中文 IME 操作手册、报告草稿和 desktop app。
- 验证命令：`pnpm manual:windows -- -PrepareOnly -Stamp codex-ime-only-smoke` 已能生成格式正确的 IME-only 中文报告草稿；测试草稿和临时 fixture 已清理。
- 报告验证器：`pnpm manual:validate <报告路径>` 会检查 checklist 映射、摘要字段、章节 `Result：pass` 和关键证据字段；草稿结构检查可加 `--allow-pending`。验证器已用 pending 草稿和 `.tmp` 中的最小 pass 报告 smoke 通过，测试文件已清理。
- 平台保护：`pnpm manual:validate` 现在只允许平台匹配的 pass 报告用于勾选平台项，例如 Windows OS 生成的 Linux/macOS pass 报告会被拒绝；pending 草稿仍可用 `--allow-pending` 做结构检查。
- Checklist 应用器：`pnpm manual:apply <报告路径>` 会先运行同一套验证，再 dry-run 显示将勾选的 `coding-plan.md` 项；只有追加 `--write` 才会修改计划。应用器已用 `.tmp` 临时计划验证 dry-run 和 `--write` 路径，并确认 pending 报告会被拒绝；测试文件已清理。
- 模板状态：[manual-verification-report-template.md](./manual-verification-report-template.md) 已收缩到当前剩余 4 个跨平台 M16 项；早期全量 pending 草稿 `manual-verification-windows-20260706-140048.md` 已删除，避免误作为当前入口。

当前 `coding-plan.md` 中的 `M16 Windows Chinese IME` 已勾选；后续只在需要重新验收 Windows IME 时再使用该入口。

## Windows 文件对话框手动验收状态

Windows native file dialog / real OS Save As 部分已由用户在 2026-07-07 明确确认通过：

- 用户已反馈：打开、保存、另存为、新建等基本操作和 OS 交互没问题。
- 用户随后补充：真实 OS Save As 对话框也是好的。
- 证据报告：[manual-verification-windows-os-dialog-user-2026-07-07.md](./manual-verification-windows-os-dialog-user-2026-07-07.md)
- 已验证：`pnpm manual:validate docs/manual-verification-windows-os-dialog-user-2026-07-07.md`
- 已应用：`pnpm manual:apply docs/manual-verification-windows-os-dialog-user-2026-07-07.md --write`

因此 M6 native Save As OS dialog interaction 和 M6 native file dialogs manually verified 已从剩余 blocker 中移除。

## Windows 文件监听与外部冲突状态

Windows file watcher 和 same-file external conflict 已由当前真实 Tauri native smoke 证明：

- 命令：`pnpm test:native:desktop`
- 结果：`Native Tauri WebDriver smoke passed`
- 证据报告：[manual-verification-windows-native-watcher-conflict-2026-07-07.md](./manual-verification-windows-native-watcher-conflict-2026-07-07.md)
- 已验证：`pnpm manual:validate docs/manual-verification-windows-native-watcher-conflict-2026-07-07.md`
- 已应用：`pnpm manual:apply docs/manual-verification-windows-native-watcher-conflict-2026-07-07.md --write`

该报告覆盖 clean external modification、clean reload、own-save watcher echo、external delete、dirty external conflict、conflict 状态普通保存阻止，以及外部写入内容未被静默覆盖。因此 M16 File watcher on Windows 和 M16 External editor conflict 已从剩余 blocker 中移除。

## Windows Ctrl 快捷键状态

Windows Ctrl shortcuts 已由当前真实 Tauri native smoke 证明：

- 命令：`pnpm test:native:desktop`
- 结果：`Native Tauri WebDriver smoke passed`
- 证据报告：[manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md](./manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md)
- 已验证：`pnpm manual:validate docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md`
- 已应用：`pnpm manual:apply docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md --write`

该报告覆盖 `Ctrl+O`、`Ctrl+S`、`Ctrl+Shift+S`、`Ctrl+N`、`Ctrl+1/2/3`、`Ctrl+Z/Y`、`Ctrl+A`、`Ctrl+C`、paste transaction、cut、dirty close protection 和 saved close。当前 Codex 桌面会话的系统剪贴板写入受限，因此 paste 内容注入使用 Web 标准 paste event 完成，报告中已记录该自动化边界。因此 M16 Windows Ctrl shortcuts 已从剩余 blocker 中移除。

## Windows IME 自动化边界状态

Windows Chinese IME 已由真实输入报告关闭；同时，当前 native smoke 仍保留合成 composition 回归，降低后续代码退化风险：

- 命令：`pnpm test:native:desktop`
- 结果：`Native Tauri WebDriver smoke passed`
- 覆盖：source mode composition update 不写入文档、compositionend 只提交一次、undo 可撤销；live mode 中列表/inline marker 附近 composition 提交一次，并在 source/live/preview mode switch 后保留文本。
- 边界：该自动化使用 WebView `CompositionEvent`，不能替代 Microsoft Pinyin 等真实 IME 的候选窗、composition UI 和 OS 输入法行为。

此前额外尝试的 WebDriver/WScript 输入探针见 [windows-ime-automation-probe-2026-07-07.md](./windows-ime-automation-probe-2026-07-07.md)：

- 当前 Windows 用户语言列表包含 `zh-Hans-CN` 和中文输入法 TIP，具备人工验收基本条件。
- WebDriver 键盘动作发送 `zhongwen ` 时，编辑器得到的是原始 `zhongwen`，没有经过真实中文 IME composition。
- `WScript.Shell.SendKeys` 在当前 Tauri/WebDriver 会话中没有可靠输入到 WebView 编辑器。
- 因此 WebDriver key actions 和 WScript SendKeys 不能作为 Windows IME pass 证据；真正关闭该项的是后续的 [manual-verification-windows-ime-computer-use-2026-07-07.md](./manual-verification-windows-ime-computer-use-2026-07-07.md)。

## macOS/Linux 手动报告入口状态

跨平台手动验收入口已准备为按平台裁剪的预填草稿流程：

- 入口：`scripts/open-manual-verification-cross-platform.mjs`
- pnpm 脚本：`pnpm manual:cross-platform -- --platform macos` 或 `pnpm manual:cross-platform -- --platform linux`
- 当前行为：macOS 草稿只包含 macOS Chinese IME、macOS Cmd shortcuts 和 macOS file watcher，并创建 `watcher.md`；Linux 草稿只包含 Linux IME，不再生成无关的 Shortcuts/File Watcher 章节。
- 2026-07-07 入口改进：草稿生成后会直接打印真实 desktop app 启动命令、报告验证命令、dry-run apply 命令和 `--write` 应用命令；生成的中文报告草稿也包含同一组下一步。
- 结构验证：`pnpm manual:cross-platform -- --platform macos --prepare-only --stamp codex-cross-trim-smoke`、`pnpm manual:cross-platform -- --platform linux --prepare-only --stamp codex-cross-trim-smoke` 以及对应 `pnpm manual:validate ... --allow-pending` 已通过；测试草稿和临时 fixture 已清理。
- 防误更新验证：`pnpm manual:apply` 会拒绝这类 pending-only 草稿，不会更新 `coding-plan.md`；macOS/Linux smoke 草稿已验证该拒绝路径。

这不会自动关闭 macOS/Linux 手动项；它只是把目标平台上的报告准备过程压缩为一条命令，等真实观察结果填入报告后再更新 checklist。

## 为什么本报告不能关闭手动项

- macOS 和 Linux 项无法从当前 Windows workspace 验证，仍需要目标平台报告。
- Windows 文件对话框、watcher、external-editor conflict、Ctrl shortcuts 和 Chinese IME 已有带日期的 pass 报告并已应用到 `coding-plan.md`。

## 下一份需要的手动报告

执行 `manual-verification-protocol.md` 中的步骤后，在 `docs/` 下保存带日期的报告。当前剩余项目只需要 macOS/Linux 目标平台报告，使用 [manual-verification-cross-platform-runbook-2026-07-06.md](./manual-verification-cross-platform-runbook-2026-07-06.md)。只有报告完成后，才更新对应的 `coding-plan.md` checkbox。

剩余 pass 报告应包含：

- macOS Chinese IME：source mode 和 live mode composition 场景。
- Linux IME：source mode 和 live mode composition 场景。
- macOS Cmd shortcuts：focus/mode/active-document/dialog 状态下的 Cmd 快捷键。
- File watcher on macOS：clean reload、dirty conflict、own-save echo 和 external delete。
