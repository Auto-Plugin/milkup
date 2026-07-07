# 手动验收报告模板

执行手动验收前，将本模板复制成带日期的报告文件，例如 `docs/manual-verification-macos-2026-07-07.md` 或 `docs/manual-verification-linux-2026-07-07.md`。请先填写具体证据；只有相关章节为 `Result: pass` 且说明足以证明 checklist 项目时，才能更新 `coding-plan.md`。

当前仍未完成的手动项只有：

- M16 macOS Chinese IME。
- M16 Linux IME。
- M16 macOS Cmd shortcuts。
- M16 file watcher on macOS。

Windows 文件对话框、真实 OS Save As、Windows Ctrl shortcuts、Windows file watcher、external editor conflict 和 Windows Chinese IME 已有独立 pass 报告，不要在新报告中重复声明。

## 摘要

- 日期/时间：
- 验收人：
- 平台：
- OS 名称/版本：
- 架构：
- 显示缩放：
- 输入法：
- 键盘布局：
- App build 路径：
- 启动命令：
- Fixture 目录：
- 截图或录屏：
- 总体结果：

## Checklist 映射

记录本报告证明了哪些 `coding-plan.md` 项目。未测试的行请删除或保留为 `pending`。不要根据 `pending`、skipped、partial 或 failed 的行勾选 `coding-plan.md`。

| coding-plan item          | Result  | 证据章节     | 备注 |
| ------------------------- | ------- | ------------ | ---- |
| M16 macOS Chinese IME     | pending | IME          |      |
| M16 Linux IME             | pending | IME          |      |
| M16 macOS Cmd shortcuts   | pending | Shortcuts    |      |
| M16 file watcher on macOS | pending | File Watcher |      |

## IME

- Result：
- 平台：
- IME 名称/版本：
- Input source：
- Desktop environment：
- Display server：
- IME framework：
- Input method：
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

```text
在这里粘贴准确观察结果。
```

## Shortcuts

- Result：
- 平台：
- 键盘布局：
- Cmd+A/C/V/Z/Shift+Z 行为：
- Cmd+S 行为：
- Save As/dialog-focus 行为：
- Mode switch 后行为：
- Active document 定向：
- OS dialog 聚焦时行为：
- Select all：
- Copy：
- Paste：
- Undo：
- Redo：
- Save：
- 备注：
- 截图：

证据详情：

```text
在这里粘贴准确观察结果。
```

## File Watcher

- Result：
- 平台：
- Fixture 路径：
- Clean external modification 是否被检测：
- Clean reload 路径：
- Dirty external modification 是否进入 conflict：
- Conflict 期间普通保存是否被阻止：
- Own-save watcher echo 是否被忽略：
- External delete 是否被检测：
- 备注：
- 截图：

证据详情：

```text
在这里粘贴准确观察结果。
```

## 最终 Checklist 更新前确认

更新 `coding-plan.md` 前，确认：

- 每个要勾选的项目在本报告中都有对应的 `Result: pass` 行。
- 报告包含平台、build 路径、启动命令和 fixture 路径。
- 失败步骤附有说明或截图。
- 平台项只能由对应平台报告证明；Windows 报告不能证明 macOS/Linux 项。
- 最终报告文件名带日期，并已保存到 `docs/`。
