# Windows 中文 IME 手动验收操作手册 - 2026-07-06

这份文档给实际执行验收的人使用。当前 Windows 本机剩余只需要验证 **M16 Windows Chinese IME**；Windows 文件对话框、真实 OS Save As、Ctrl 快捷键、file watcher 和 external editor conflict 已经有独立 pass 报告，不需要重复操作。

## 最简单的启动方式

在资源管理器中双击：

```text
D:\me\milkup2.0\scripts\open-manual-verification-windows.cmd
```

这个入口会自动：

- 创建本次验收用的临时目录。
- 生成一份带日期的中文 IME 报告草稿。
- 预填 OS、架构、输入法列表、app 路径和 fixture 路径。
- 打开本操作手册。
- 打开报告草稿。
- 启动 milkup desktop app。

如果脚本提示找不到 debug app，再运行：

```powershell
D:\me\milkup2.0\scripts\open-manual-verification-windows.ps1 -BuildIfMissing
```

## 验收范围

只覆盖：

- M16 Windows Chinese IME。

不覆盖且不需要重复：

- M6 native Save As OS dialog interaction。
- M6 native file dialog manual verification。
- M16 Windows Ctrl shortcuts。
- M16 file watcher on Windows。
- M16 external editor conflict。

## 需要记录的信息

报告草稿已经自动预填大部分信息。实际验收时请补充：

- 验收人。
- 当前实际使用的中文输入法名称和版本，例如 Microsoft Pinyin。
- 键盘布局。
- 截图或录屏路径，如果有。
- 每个 IME 场景的 pass/fail 和观察结果。

## 启动 App

如果你使用上面的 `.cmd` 入口，可以跳过本节。需要手动启动时，运行：

```powershell
& "D:\me\milkup2.0\apps\desktop\src-tauri\target\x86_64-pc-windows-gnu\debug\milkup-desktop.exe"
```

## Windows 中文 IME

使用 Microsoft Pinyin 或当前已安装的中文输入法。请记录准确输入法名称。

### Source Mode

1. 切换到 source mode。
2. 输入中文、标点和中英混排，例如：

   ```text
   中文输入，test。
   ```

3. 确认 composition text 不会提前提交到正文。
4. 确认最终提交文本在 Markdown source 中只出现一次。
5. 执行一次 undo，记录该 composition commit 是否作为一个逻辑编辑被撤销。

### Live Mode

1. 切换到 live mode。
2. 在普通文本中重复 composition。
3. 在列表项中重复 composition。
4. 在 inline Markdown marker 附近重复 composition，例如 `**bold**` 附近。
5. composition 后切换 source/live/preview mode，确认文本、selection 和 history 都保留。

## 报告字段

在脚本生成的报告草稿中填写这些字段：

- IME 名称/版本。
- Source mode composition 是否不会提前提交。
- Source mode 最终提交文本是否只出现一次。
- Source mode undo 行为。
- Live mode 普通文本。
- Live mode 列表项。
- Live mode inline marker 附近。
- Composition 后 mode switch 是否保留文本/selection/history。
- 备注。
- 截图。

## 更新 Checklist

填完报告后，先验证报告：

```powershell
pnpm manual:validate docs/manual-verification-windows-<stamp>.md
```

确认 dry-run 只会更新 Windows Chinese IME：

```powershell
pnpm manual:apply docs/manual-verification-windows-<stamp>.md
```

确认无误后再写入：

```powershell
pnpm manual:apply docs/manual-verification-windows-<stamp>.md --write
```

macOS/Linux 项必须保持未勾选，直到对应平台报告存在。
