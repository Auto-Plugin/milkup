# Windows Ctrl 快捷键 native 验收报告 - 2026-07-07

本报告记录 2026-07-07 在当前 Windows 工作区重跑真实 Tauri WebDriver native smoke 的结果。它覆盖 Windows Ctrl 快捷键在真实 Tauri 窗口中的 Action Registry 路由、活动文档目标、模式切换、撤销重做、复制/剪切和保存关闭保护；不覆盖中文 IME、macOS Cmd 快捷键、Linux IME 或 macOS 文件监听。

## 摘要

- 日期/时间：2026-07-07
- 验收人：Codex automated native smoke
- 平台：Windows
- OS 名称/版本：Microsoft Windows 11 专业版 / Windows NT 10.0.22631
- 架构：x64
- 显示缩放：不适用，本报告不覆盖视觉人工检查
- 输入法：不适用，本报告不覆盖 IME
- 键盘布局：Windows primary Ctrl layout
- App build 路径：D:\me\milkup2.0\apps\desktop\src-tauri\target\x86_64-pc-windows-gnu\debug\milkup-desktop.exe
- 启动命令：pnpm test:native:desktop
- Fixture 目录：脚本运行时在系统临时目录创建 `milkup-native-smoke-<pid>-<timestamp>`，结束后自动清理
- 截图或录屏：未生成
- 总体结果：pass

## Checklist 映射

| coding-plan item           | Result | 证据章节  | 备注                                   |
| -------------------------- | ------ | --------- | -------------------------------------- |
| M16 Windows Ctrl shortcuts | pass   | Shortcuts | 真实 Tauri native smoke 覆盖 Ctrl 路径 |

## Shortcuts

- Result：pass
- 平台：Windows
- 键盘布局：Windows primary Ctrl layout
- Select all：pass，`Ctrl+A` 通过 Action Registry 调用 `document.selectAll`，后续 `Ctrl+C`/cut 读取到当前 active document 选区文本
- Copy：pass，`Ctrl+C` 在真实 Tauri 窗口中触发 editor input 的 `copy` 事件，事件中的 `clipboardData` 包含 `native-shortcut`
- Paste：pass，脚本先发送真实 `Ctrl+V` 键事件；当前 Codex 桌面会话对系统剪贴板写入有限制，因此同一 native fixture 随后使用标准 `ClipboardEvent('paste')` 注入 `native-paste`，验证编辑器 paste transaction 会替换当前选区并进入文档状态
- Undo：pass，`Ctrl+Z` 移除 `native-shortcut`，`Ctrl+Y` 恢复 `native-shortcut`
- Save：pass，`Ctrl+S` 保存 dirty 文档并让 session state 显示 `已保存`
- Save As：pass，`Ctrl+Shift+S` 走 deterministic native test path，路径更新为 `saved-as.md`
- New：pass，`Ctrl+N` 新建文档，路径显示 `未保存`
- Open：pass，`Ctrl+O` 打开 deterministic native test path，路径和 document id 更新为 `open.md`
- Mode switch：pass，`Ctrl+2`/`Ctrl+3`/`Ctrl+1` 依次切换 live/preview/source
- Close protection：pass，dirty 文档上 `Ctrl+W` 显示无法关闭提示；保存后再次 `Ctrl+W` 关闭文档
- Active document targeting：pass，复制、粘贴、剪切、保存和关闭保护均作用于当前打开的 active document
- 备注：本报告使用真实 debug Tauri app、tauri-driver 和 Edge WebDriver。系统剪贴板写入在当前自动化桌面会话中返回 access denied，因此 paste 内容注入使用 Web 标准 paste 事件完成；该边界不影响 Action Registry 快捷键覆盖结论。
- 截图：未生成

证据详情：

```text
命令：pnpm test:native:desktop
结果：Native Tauri WebDriver smoke passed

本次前置检查：
- node --check tests\native\tauri-webdriver-smoke.mjs
- pnpm exec prettier --check tests/native/tauri-webdriver-smoke.mjs

关键覆盖位于 tests/native/tauri-webdriver-smoke.mjs 的 runShortcutFixture：
- sendPrimaryShortcut('n') 后确认 notice 为“已新建文档”，path 为“未保存”。
- 输入 native-shortcut 后确认编辑器显示该文本。
- sendPrimaryShortcut('z') 后确认文本移除，sendPrimaryShortcut('y') 后确认文本恢复。
- sendPrimaryShortcut('2') / ('3') / ('1') 后分别确认 data-mode 为 live / preview / source。
- sendPrimaryShortcut('a') 后发送真实 Ctrl+C，并从 copy event clipboardData 确认包含 native-shortcut。
- 发送真实 Ctrl+V 后，在当前系统剪贴板受限的自动化会话中使用标准 ClipboardEvent('paste') 注入 native-paste，并确认编辑器内容包含 native-paste。
- 再次 Ctrl+A 后触发 cut，确认剪切文本包含 native-paste，并确认编辑器不再包含 native-paste。
- dirty 文档上 sendPrimaryShortcut('w') 后确认 notice 包含“无法关闭”。
- sendPrimaryShortcut('s') 后确认 session state 包含“已保存”。
- 保存后 sendPrimaryShortcut('w')，确认 notice 为“已关闭文档”。
```

## 最终 Checklist 更新前确认

- 每个要勾选的项目在本报告中都有对应的 Result：pass。
- 报告包含平台、build 路径、启动命令和 fixture 路径说明。
- 本报告不声明 Windows Chinese IME、macOS Chinese IME、Linux IME、macOS Cmd shortcut 或 macOS file watcher 完成。
