# 完成度审计 - 2026-07-06

本文集中记录当前 `coding-plan.md` 目标的证据状态。审计口径保持保守：只有当前文件、报告或命令输出能直接证明的要求，才视为完成。

## 当前结论

整体目标尚未完成。实现里程碑、M6 Windows 文件对话框验收、Windows file watcher、same-file external conflict、Windows Ctrl shortcuts 和 Windows Chinese IME 证据已经完成；剩余 blocker 集中在 M16 手动矩阵中的 macOS Chinese IME、Linux IME、macOS Cmd shortcuts 和 macOS watcher 证据。

仍需补齐的证据：

- 一份带日期的手动报告，证明 macOS 中文 IME。
- 一份带日期的手动报告，证明 Linux IME。
- 一份带日期的手动报告，证明 macOS Cmd 快捷键。
- 一份带日期的手动报告，证明 macOS 文件监听行为。

## 里程碑状态审计

| 里程碑                             | 当前状态 | 审计结果           | 主要证据                                                                                                                                                   |
| ---------------------------------- | -------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Repository and Tooling          | Complete | 完成               | `coding-plan.md` 中 M0 checkbox 已完成。                                                                                                                   |
| M1 Core Text Model                 | Complete | 完成               | `coding-plan.md` 中 M1 checkbox 已完成；progress log 多次记录 core tests。                                                                                 |
| M2 Transaction, Selection, History | Complete | 完成               | `coding-plan.md` 中 M2 checkbox 已完成；`core-invariants-audit.md` 汇总了核心不变量证据。                                                                  |
| M3 Markdown CST Parser             | Complete | 完成               | `coding-plan.md` 中 M3 checkbox 已完成；progress log 记录 parser/AST 相关证据。                                                                            |
| M4 DOM View and Input Spike        | Complete | 完成               | `dom-view-m4-closeout.md` 与 `coding-plan.md` M4 checkbox。                                                                                                |
| M5 Live Render Mode                | Complete | 完成               | `coding-plan.md` M5 checkbox，以及 progress log 中的 browser/playground smoke 证据。                                                                       |
| M6 Desktop File Workflow           | Complete | 完成               | 自动化 native desktop smoke 已通过，Windows 真实 OS Save As/native file dialog 手动确认记录在 `manual-verification-windows-os-dialog-user-2026-07-07.md`。 |
| M7 Paste Pipeline and Assets       | Complete | 完成               | M7 checkbox 和验收标准均已完成；状态同步后已通过 `@milkup/input` 与 `@milkup/assets` focused tests/typechecks。                                            |
| M8 V1 Regression Suite             | Complete | 完成               | 必需 regression files 与 policy guard 已存在；状态同步后已通过 `@milkup/regressions` tests/typecheck。                                                     |
| M9 Large File Architecture         | Complete | 完成，但有口径限制 | 256 MiB 与 1 GiB native benchmark 报告存在且 marker verification 通过；当前服务 open 后仍是 full-text-backed，不是真正 lazy streaming。                    |
| M10 Action Registry, CLI, MCP      | Complete | 完成               | `coding-plan.md` M10 checkbox 已完成；attached app CLI protocol 和测试已记录。                                                                             |
| M11 Plugin Runtime                 | Complete | 完成               | `m11-plugin-sandbox-audit.md` 逐项记录 sandbox 证据。                                                                                                      |
| M12 Export Pipeline                | Complete | 完成               | `coding-plan.md` M12 checkbox 已完成；export tests 与 font/PDF strategy 文档已记录。                                                                       |

## 横向能力审计

| 范围         | 审计结果           | 证据                                                                                                                                                                                                               |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 核心不变量   | 完成               | `core-invariants-audit.md` 将 source truth、transaction、history、parser safety、dirty state、mode switch、plugin/render isolation 和 v1 regression 不变量映射到证据。                                             |
| 回归策略     | 完成               | `regression-policy.md` 和 `@milkup/regressions` policy guard。                                                                                                                                                     |
| 大文件声明   | 完成，但有口径限制 | `large-file-benchmark-protocol.md`、`native-large-file-benchmark-256mib-2026-07-06.json` 和 `native-large-file-benchmark-1gib-2026-07-06.json`。公开表述不能宣称 true lazy streaming。                             |
| 手动验收协议 | 已准备，未完成     | 协议、报告模板、Windows IME-only runbook、macOS/Linux runbook 已存在；Windows 文件对话框、Windows watcher/conflict、Windows Ctrl shortcuts 和 Windows Chinese IME 已有 pass 报告，macOS/Linux 目标平台证据仍缺失。 |

## 剩余 Checkbox

`coding-plan.md` 1.1-1.3 中未勾选的流程项是可复用开发协议模板，不是项目完成 blocker。

剩余项目 blocker 如下：

| coding-plan 项目          | 所需证明                                                                                                    | 已准备的辅助文档                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| M16 macOS Chinese IME     | 带日期的 macOS 手动报告，包含 input source 和 source/live mode composition 结果。                           | `manual-verification-cross-platform-runbook-2026-07-06.md` |
| M16 Linux IME             | 带日期的 Linux 手动报告，包含桌面环境、display server、IME framework 和 source/live mode composition 结果。 | `manual-verification-cross-platform-runbook-2026-07-06.md` |
| M16 macOS Cmd shortcuts   | 带日期的 macOS 手动报告，覆盖 focus/mode/active-document/dialog 状态下的 Cmd 快捷键。                       | `manual-verification-cross-platform-runbook-2026-07-06.md` |
| M16 File watcher on macOS | 带日期的 macOS 手动报告，覆盖 clean reload、dirty conflict、own-save echo 和 external delete。              | `manual-verification-cross-platform-runbook-2026-07-06.md` |

## 最近验证过的命令

最近几轮 continuation 已验证：

- `pnpm --filter @milkup/desktop typecheck`
- `pnpm --filter @milkup/desktop test`
- `pnpm test:e2e`
- `pnpm --filter @milkup/desktop build`
- `node --check tests/native/tauri-webdriver-smoke.mjs`
- `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`
- `pnpm test:native:desktop`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-manual-verification-windows.ps1 -PrepareOnly -Stamp codex-smoke-ps5-final`
- `cmd /c scripts\open-manual-verification-windows.cmd -PrepareOnly -Stamp codex-smoke-cmd-final`
- `pnpm manual:windows -- -PrepareOnly -Stamp codex-smoke-pnpm-final`
- `pnpm manual:validate <generated Windows pending draft> --allow-pending`（测试草稿已清理）
- `pnpm manual:validate <generated .tmp pass smoke report>`（测试报告已清理）
- `pnpm manual:apply <generated .tmp pass smoke report> --plan <temporary coding-plan copy>` dry-run 和 `--write`（测试报告和临时计划已清理）
- `pnpm manual:apply <generated Windows pending draft> --plan <temporary coding-plan copy>` 拒绝 pending-only 报告（测试草稿和临时计划已清理）
- `node --check scripts\open-manual-verification-cross-platform.mjs`
- `pnpm manual:cross-platform -- --platform macos --prepare-only --stamp codex-cross-pnpm-smoke`
- `pnpm manual:cross-platform -- --platform linux --prepare-only --stamp codex-cross-pnpm-smoke`
- `pnpm manual:validate docs/manual-verification-macos-codex-cross-pnpm-smoke.md --allow-pending`（测试草稿已清理）
- `pnpm manual:validate docs/manual-verification-linux-codex-cross-pnpm-smoke.md --allow-pending`（测试草稿已清理）
- `pnpm manual:cross-platform -- --platform macos --prepare-only --stamp codex-cross-trim-smoke`
- `pnpm manual:cross-platform -- --platform linux --prepare-only --stamp codex-cross-trim-smoke`
- `pnpm manual:validate docs/manual-verification-macos-codex-cross-trim-smoke.md --allow-pending`（测试草稿和临时 fixture 已清理）
- `pnpm manual:validate docs/manual-verification-linux-codex-cross-trim-smoke.md --allow-pending`（测试草稿和临时 fixture 已清理）
- `pnpm manual:validate .tmp/manual-platform-mismatch-linux-pass.md` 按预期拒绝 Windows OS 冒充 Linux pass 报告（测试报告已清理）
- `pnpm manual:validate .tmp/manual-platform-mismatch-macos-section-pass.md` 按预期拒绝章节平台与 macOS checklist 不一致的 pass 报告（测试报告已清理）
- `pnpm manual:validate docs/manual-verification-linux-codex-platform-guard-smoke.md --allow-pending`、`docs/manual-verification-macos-codex-platform-guard-smoke.md --allow-pending`、`docs/manual-verification-windows-codex-platform-guard-smoke.md --allow-pending` 均通过 pending 草稿结构检查（测试草稿和临时 fixture 已清理）
- `node .tmp\probe-native-ime-webdriver.mjs` 探测 WebDriver 键盘动作与 WScript SendKeys 路径，结果记录在 `windows-ime-automation-probe-2026-07-07.md`；临时探针脚本已清理
- `pnpm manual:apply docs/manual-verification-macos-codex-cross-pnpm-smoke.md` 拒绝 pending-only 报告（测试草稿和临时 fixture 已清理）
- `pnpm manual:apply docs/manual-verification-linux-codex-cross-pnpm-smoke.md` 拒绝 pending-only 报告（测试草稿和临时 fixture 已清理）
- `pnpm manual:validate docs/manual-verification-windows-os-dialog-user-2026-07-07.md`
- `pnpm manual:apply docs/manual-verification-windows-os-dialog-user-2026-07-07.md`
- `pnpm manual:apply docs/manual-verification-windows-os-dialog-user-2026-07-07.md --write`
- `pnpm test:native:desktop`
- `pnpm manual:validate docs/manual-verification-windows-native-watcher-conflict-2026-07-07.md`
- `pnpm manual:apply docs/manual-verification-windows-native-watcher-conflict-2026-07-07.md`
- `pnpm manual:apply docs/manual-verification-windows-native-watcher-conflict-2026-07-07.md --write`
- `pnpm manual:validate docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md`
- `pnpm manual:apply docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md`
- `pnpm manual:apply docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md --write`
- `pnpm manual:windows -- -PrepareOnly -Stamp codex-ime-only-smoke`
- `pnpm manual:validate docs/manual-verification-windows-codex-ime-only-smoke.md --allow-pending`（测试草稿和临时 fixture 已清理）
- `pnpm manual:validate docs/manual-verification-windows-ime-computer-use-2026-07-07.md`
- `pnpm manual:apply docs/manual-verification-windows-ime-computer-use-2026-07-07.md`
- `pnpm manual:apply docs/manual-verification-windows-ime-computer-use-2026-07-07.md --write`
- `node --check scripts/open-manual-verification-cross-platform.mjs`
- `pnpm manual:cross-platform -- --platform macos --prepare-only --stamp codex-cross-nextstep-smoke`
- `pnpm manual:cross-platform -- --platform linux --prepare-only --stamp codex-cross-nextstep-smoke`
- `pnpm manual:validate docs/manual-verification-macos-codex-cross-nextstep-smoke.md --allow-pending`（测试草稿和临时 fixture 已清理）
- `pnpm manual:validate docs/manual-verification-linux-codex-cross-nextstep-smoke.md --allow-pending`（测试草稿和临时 fixture 已清理）
- `pnpm --filter @milkup/input test`
- `pnpm --filter @milkup/assets test`
- `pnpm --filter @milkup/regressions test`
- `pnpm --filter @milkup/input typecheck`
- `pnpm --filter @milkup/assets typecheck`
- `pnpm --filter @milkup/regressions typecheck`
- `pnpm format`
- `pnpm lint`

注意：最新 `pnpm test:native:desktop` 已通过。native smoke 脚本现在会按 WebView2 runtime 版本自动准备 `msedgedriver.exe`，并覆盖真实 Tauri 窗口中的 deterministic open/save/save-as、watcher/conflict、插件、sidecar、Ctrl 快捷键路径，以及 synthetic IME composition 事务路径。`windows-ime-automation-probe-2026-07-07.md` 记录了 WebDriver/WScript 路径无法触发真实中文 IME composition 的原因；Windows Chinese IME 已由 `manual-verification-windows-ime-computer-use-2026-07-07.md` 关闭，但当前 Windows 证据仍不能替代 macOS/Linux 跨平台人工报告。

## 完成目标所需的下一步

执行手动验收，并在 `docs/` 下添加带日期的报告：

1. 在 macOS 上使用 `pnpm manual:cross-platform -- --platform macos` 产出 macOS 报告。
2. 在 Linux 上使用 `pnpm manual:cross-platform -- --platform linux` 产出 Linux 报告。

每份报告都包含具体通过证据后，只更新对应的 `coding-plan.md` checkbox。只有上表所有剩余手动项目都有直接 pass 证据后，整体目标才能标记完成。
