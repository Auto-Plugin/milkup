# Windows 中文 IME 验收报告 - 2026-07-07

本报告记录 2026-07-07 在当前 Windows 工作区通过 Windows 桌面控制能力操作真实 Tauri debug app 的结果。输入通过真实窗口逐键发送 pinyin，并由当前 Windows 中文输入法候选窗提交中文文本；本报告只覆盖 M16 Windows Chinese IME，不覆盖 macOS/Linux 项。

## 摘要

- 日期/时间：2026-07-07 10:58:00 +08:00
- 验收人：Codex desktop-control native IME run
- 平台：Windows
- OS 名称/版本：Microsoft Windows 11 专业版 / Windows NT 10.0.22631
- 架构：x64
- 显示缩放：100%
- 输入法：zh-Hans-CN，InputMethodTips `0804:{81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E}{FA550B04-5AD7-411F-A5AC-CA038EC515D7}`
- 键盘布局：Windows zh-CN primary keyboard layout
- App build 路径：D:\me\milkup2.0\apps\desktop\src-tauri\target\x86_64-pc-windows-gnu\debug\milkup-desktop.exe
- 启动命令：Windows desktop-control launch of the debug Tauri app
- Fixture 目录：不使用文件 fixture；在未保存的新文档中验收
- 截图或录屏：Windows desktop-control snapshots captured during the run
- 总体结果：pass

## Checklist 映射

| coding-plan item        | Result | 证据章节 | 备注                    |
| ----------------------- | ------ | -------- | ----------------------- |
| M16 Windows Chinese IME | pass   | IME      | 真实 Windows 输入法路径 |

## IME

- Result：pass
- 平台：Windows
- IME 名称/版本：zh-Hans-CN Windows Chinese IME / Microsoft Pinyin TIP
- Source mode composition 是否不会提前提交：pass，逐键输入 `zhongwen` 且尚未按 space 时，文档状态显示 `0 字符`，accessibility tree 中没有 committed `文本 zhongwen`；候选窗显示中文候选。
- Source mode 最终提交文本是否只出现一次：pass，按 space 后 source mode 中出现一次 `文本 中文`，文档状态显示 `2 字符`。
- Source mode undo 行为：pass，`Ctrl+Z` 后 `文本 中文` 消失，文档状态回到 `0 字符`。
- Live mode 普通文本：pass，live mode 普通文本位置逐键输入 `zhongwen` 并按 space 后出现一次 `文本 中文`。
- Live mode 列表项：pass，live mode 中在 `- ` 列表项后逐键输入 `liebiao` 并按 space，提交为 `列表`。
- Live mode inline marker 附近：pass，live mode 中在 `**bold**` 附近逐键输入 `zhongwen` 并按 space，提交为 `中文`，并保留 `bold` 文本。
- Composition 后 mode switch 是否保留文本/selection/history：pass，在 live mode 输入列表和 inline marker 附近中文后，切换 preview、source、live，均保留 `列表` 和 `中文`；source mode 中可见 `- 列表` 与 `**bold** 中文`。
- 备注：本报告使用 Windows desktop-control input 注入到真实 Tauri 窗口，不使用 WebDriver text injection 或 synthetic `CompositionEvent` 作为 pass 证据。
- 截图：运行期间 Windows desktop-control 自动捕获窗口状态截图。

证据详情：

```text
环境：
- Get-WinUserLanguageList 返回 zh-Hans-CN，InputMethodTips 包含 0804:{81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E}{FA550B04-5AD7-411F-A5AC-CA038EC515D7}
- Get-Culture / Get-UICulture 均为 zh-CN。

Source mode：
- 清空编辑器后逐键发送 z h o n g w e n，不按 space。
- 观察到 Windows 中文输入法候选窗，候选包含“中文”。
- committed document 状态仍为“0 字符”，accessibility tree 中没有 committed “文本 zhongwen”。
- 按 space 后，accessibility tree 出现一次“文本 中文”，状态为“2 字符”。
- 按 Ctrl+Z 后，“文本 中文”消失，状态回到“0 字符”。

Live mode：
- 普通文本位置逐键发送 z h o n g w e n + space，出现一次“文本 中文”。
- 列表项中先输入 "- "，再逐键发送 l i e b i a o + space，出现“列表”。
- inline marker 附近先输入 "**bold** "，再逐键发送 z h o n g w e n + space，出现“bold”和“中文”。
- 切换 preview、source、live 后，文本仍保留；source mode accessibility excerpt 包含：
  文本 - 列表
  文本 **bold** 中文
```

## 最终 Checklist 更新前确认

- 每个要勾选的项目在本报告中都有对应的 Result：pass。
- 报告包含平台、build 路径、启动命令和 fixture 路径说明。
- 本报告不声明 macOS Chinese IME、Linux IME、macOS Cmd shortcuts 或 macOS file watcher 完成。
