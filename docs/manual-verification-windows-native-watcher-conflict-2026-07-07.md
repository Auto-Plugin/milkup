# Windows 文件监听与外部冲突验收报告 - 2026-07-07

本报告记录 2026-07-07 在当前 Windows 工作区重跑真实 Tauri WebDriver native smoke 的结果。它覆盖 Windows file watcher 和 same-file external-write conflict 行为；不覆盖 IME、macOS watcher、macOS Cmd shortcuts 或 Windows Ctrl shortcut 完整矩阵。

## 摘要

- 日期/时间：2026-07-07
- 验收人：Codex automated native smoke
- 平台：Windows
- OS 名称/版本：Microsoft Windows 11 Pro / Windows NT 10.0.22631
- 架构：x64
- 显示缩放：不适用，本报告不覆盖视觉人工检查
- 输入法：不适用，本报告不覆盖 IME
- 键盘布局：不适用，本报告不覆盖快捷键矩阵
- App build 路径：D:\me\milkup2.0\apps\desktop\src-tauri\target\x86_64-pc-windows-gnu\debug\milkup-desktop.exe
- 启动命令：pnpm test:native:desktop
- Fixture 目录：脚本运行时在系统临时目录创建 `milkup-native-smoke-<pid>-<timestamp>`，结束后自动清理
- 截图或录屏：未生成
- 总体结果：pass

## Checklist 映射

| coding-plan item             | Result | 证据章节                 | 备注                           |
| ---------------------------- | ------ | ------------------------ | ------------------------------ |
| M16 file watcher on Windows  | pass   | File Watcher             | 真实 Tauri native smoke 覆盖   |
| M16 external editor conflict | pass   | External Editor Conflict | 外部磁盘写入模拟外部编辑器保存 |

## File Watcher

- Result：pass
- 平台：Windows
- Fixture 路径：系统临时目录中的 `open.md` 和 `saved-as.md`，由 `tests/native/tauri-webdriver-smoke.mjs` 创建并清理
- Clean external modification 是否被检测：pass，脚本外部写入 `saved-as.md` 后等待 UI 显示 `modified-clean`
- Clean reload 路径：pass，脚本点击 `重新载入外部更改` 后确认提示为 `已重新载入外部更改`，并确认编辑器内容包含 `external update`
- Dirty external modification 是否进入 conflict：pass，脚本在 dirty 状态下外部写入 `open.md` 后等待 UI 显示 `conflict`
- Conflict 期间普通保存是否被阻止：pass，脚本点击 `保存` 后确认提示包含 `文件已在编辑器外发生变化。`
- Own-save watcher echo 是否被忽略：pass，脚本保存后等待并确认 `external` 状态保持 `none`
- External delete 是否被检测：pass，脚本删除 `saved-as.md` 后等待 UI 显示 `deleted-clean`
- 备注：本报告使用真实 debug Tauri app、tauri-driver、Edge WebDriver 和真实 filesystem watcher events；未使用浏览器 fallback。
- 截图：未生成

证据详情：

```text
命令：pnpm test:native:desktop
结果：Native Tauri WebDriver smoke passed

覆盖代码位于 tests/native/tauri-webdriver-smoke.mjs：
- 保存后等待 1.3 秒并确认 [data-stat="external"] 为 none，证明 own-save watcher echo 被忽略。
- 对 saved-as.md 执行外部写入，等待 [data-stat="external"] 为 modified-clean。
- 点击“重新载入外部更改”，确认 notice 为“已重新载入外部更改”，并确认编辑器包含 external update。
- 删除 saved-as.md，等待 [data-stat="external"] 为 deleted-clean。
- 重新打开 open.md，输入 local dirty，再对同一文件执行外部写入 external conflict，等待 [data-stat="external"] 为 conflict。
- 在 conflict 状态点击“保存”，确认 notice 包含“文件已在编辑器外发生变化。”，并确认磁盘文件仍包含 external conflict。
```

## External Editor Conflict

- Result：pass
- 平台：Windows
- milkup fixture 路径：系统临时目录中的 `open.md`，由 `tests/native/tauri-webdriver-smoke.mjs` 创建并清理
- 外部编辑器：自动化外部磁盘写入，模拟另一个编辑器对同一 Markdown 文件保存
- 外部保存后是否检测到 conflict：pass，dirty 状态下外部写入后 UI 显示 `conflict`
- 普通保存是否被阻止：pass，conflict 状态下普通保存显示阻止提示
- 解决路径：本 smoke 覆盖阻止与保留外部内容，不执行人工 reload/save-as 解决流程
- 外部改动是否保留：pass，保存被阻止后磁盘文件仍包含 `external conflict`
- 备注：该自动化覆盖 same-file external save conflict 的核心数据安全要求；未打开 Notepad 等 GUI 外部编辑器。
- 截图：未生成

证据详情：

```text
命令：pnpm test:native:desktop
结果：Native Tauri WebDriver smoke passed

关键断言：
- waitForText('[data-stat="external"]', 'conflict', { timeoutMs: 6_000 })
- waitForText('[data-stat="notice"]', '文件已在编辑器外发生变化。', { contains: true })
- expectFileContains(openPath, 'external conflict')

结论：当 milkup 有未保存编辑时，同一文件被外部写入后会进入 conflict，普通保存被阻止，并且外部改动没有被静默覆盖。
```

## 最终 Checklist 更新前确认

- 每个要勾选的项目在本报告中都有对应的 Result：pass。
- 报告包含平台、build 路径、启动命令和 fixture 路径说明。
- 本报告不声明 IME、Windows Ctrl shortcut 完整矩阵、macOS Cmd shortcut、macOS file watcher 或 Linux 项完成。
