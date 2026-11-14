# 手动验收协议

本文定义桌面端和跨平台 checklist 项目所需的手动验收证据。

## 证据格式

每次手动验收都应记录：

- 日期和验收人。
- OS 名称/版本、架构、显示缩放、输入法、键盘布局、app build 路径。
- 启动 app 使用的准确命令。
- fixture 文件路径，以及 fixture 是临时文件还是保留文件。
- 每个步骤的 pass/fail 结果。
- 失败步骤的截图或简短说明。

手动结果必须先写入 `docs/` 下带日期的报告，再勾选 `docs/coding-plan.md` 中对应 checkbox。建议从 [manual-verification-report-template.md](./manual-verification-report-template.md) 复制一份报告模板开始填写，确保每条结果都能映射回它证明的 checklist 项目。平台相关的执行步骤请使用 [manual-verification-windows-runbook-2026-07-06.md](./manual-verification-windows-runbook-2026-07-06.md) 或 [manual-verification-cross-platform-runbook-2026-07-06.md](./manual-verification-cross-platform-runbook-2026-07-06.md)。

## Native Save As Dialog

平台：先验收 Windows，之后在有环境时验收 macOS 和 Linux。

步骤：

- 启动 packaged 或 debug desktop app，确保 local storage 中没有 `milkup.desktop.nativeTestPaths`。
- 创建一个新的未保存文档。
- 输入唯一内容，例如 `manual save-as <timestamp>`。
- 点击 `Save As`。
- 确认出现 OS 原生保存对话框。
- 通过对话框选择一个新的 `.md` 路径。
- 确认 app 中显示的路径更新为所选路径。
- 在 app 外打开该文件，验证内容确实写入。
- 再执行一次 Save As，在 OS 对话框中取消，确认路径和内容没有变化。

完成条件要求真实 OS dialog 交互；WebDriver 自动化使用的 deterministic test-path override 不能替代这项验收。

## IME Matrix

平台：

- Windows Chinese IME。
- macOS Chinese IME。
- Linux IME。

步骤：

- 在 source mode 中输入中文、标点和中英混排组合输入。
- 确认 composition text 不会提前提交。
- 确认最终提交文本在 Markdown source 中只出现一次。
- 执行一次 undo，确认 composition commit 在适用场景下作为一个逻辑编辑被撤销。
- 在 live mode 的普通文本、列表项、inline marker 附近重复验收。
- composition 后切换 mode，确认文本、selection 和 history 都保留。

## Shortcut Matrix

平台：

- macOS Cmd shortcuts。
- Windows Ctrl shortcuts。

步骤：

- 在编辑器聚焦时验证 select all、copy、paste、undo、redo、save、save-as 快捷键。
- 切换 source/live/preview mode 后重复验证相同快捷键。
- 打开或创建另一个文档后，确认快捷键仍作用于 active document。
- 确认 OS dialog 聚焦时快捷键不会触发文档 mutation。

## File Watcher Matrix

平台：

- Windows。
- macOS。

步骤：

- 在 desktop app 中打开一个文件。
- 当 app 中的文档为 clean 时，从外部修改该文件。
- 确认 app 检测到变更，并提供或执行 clean reload 路径。
- 当 app 中的文档为 dirty 时，从外部修改该文件。
- 确认 app 进入 conflict state，并阻止普通保存覆盖外部内容。
- 在 app 中保存，确认 app 忽略自己的 watcher echo。
- 从外部删除文件，确认 app 显示 deleted-file state。

## External Editor Conflict

步骤：

- 在 milkup 和另一个编辑器中打开同一个 Markdown 文件。
- 当 milkup 有未保存编辑时，在外部编辑器中编辑并保存该文件。
- 确认 milkup 将 session 标记为 conflict。
- 尝试在 milkup 中普通保存，确认保存被阻止。
- 根据当前产品流程通过 reload 或 save-as 解决冲突。
- 验证没有外部改动被静默丢失。
