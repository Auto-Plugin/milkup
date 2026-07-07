# Windows IME 自动化探针报告 - 2026-07-07

本文记录在当前 Windows 工作区尝试自动化真实中文 IME 输入的结果。结论是：当前环境具备中文输入法配置，但 WebDriver/WScript 探针不能作为 M16 Windows Chinese IME 的真实 pass 证据。

## 环境

- 日期：2026-07-07
- 平台：Windows
- OS：Microsoft Windows 11 专业版 / Windows NT 10.0.22631
- 当前 culture：zh-CN
- 已安装输入法：`zh-Hans-CN`，InputMethodTips 包含 `0804:{81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E}{FA550B04-5AD7-411F-A5AC-CA038EC515D7}`
- App build：`D:\me\milkup2.0\apps\desktop\src-tauri\target\x86_64-pc-windows-gnu\debug\milkup-desktop.exe`

## 探针 1：WebDriver 键盘动作

步骤：

1. 启动真实 Tauri debug app。
2. 通过 `tauri-driver` 和 Edge WebDriver 聚焦 `.milkup-input-proxy`。
3. 发送键盘动作 `zhongwen `。
4. 读取 `.milkup-editor-content`。

结果：

```text
{"editorText":"zhongwen # 未命名..."}
```

结论：WebDriver 键盘动作没有经过真实中文 IME composition；它直接把 pinyin 字母写入编辑器。因此该路径不能证明 Windows Chinese IME。

## 探针 2：WScript Shell SendKeys

步骤：

1. 在同一个 Tauri/WebDriver 会话里聚焦编辑器 input。
2. 使用 PowerShell 创建 `WScript.Shell`。
3. 对最新 `milkup-desktop` 进程调用 `AppActivate`。
4. 发送 `zhongwen `。
5. 读取 `.milkup-editor-content`。

结果：

```text
{"editorText":"# 未命名..."}
```

结论：在当前自动化会话中，`WScript.Shell.SendKeys` 没有可靠地把输入送入 Tauri WebView 编辑器，也不能触发可验证的真实中文 IME composition。

## 结论

- 当前系统已安装中文输入法，具备人工验收 Windows Chinese IME 的基本条件。
- 现有 native smoke 中的 synthetic `CompositionEvent` 仍然有价值：它证明编辑器事务路径不会提前提交、会只提交一次、undo 和 mode switch 保留逻辑没有退化。
- 但 synthetic composition、WebDriver key actions 和 WScript SendKeys 都不能替代真实 Microsoft Pinyin 等 IME 的候选窗、composition UI 和 OS 输入法行为。
- WebDriver key actions 和 WScript SendKeys 路径不能关闭 `M16 Windows Chinese IME`；该项后续已由真实桌面控制输入报告 [manual-verification-windows-ime-computer-use-2026-07-07.md](./manual-verification-windows-ime-computer-use-2026-07-07.md) 关闭。
