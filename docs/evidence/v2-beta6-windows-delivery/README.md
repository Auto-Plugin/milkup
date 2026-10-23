# beta.6 Windows 交付证据

对应源码 `6b3eeebad7ec433c6420bf5bbfadcf6a6710d20f`、run `39896049662`、artifact `12477447032`。详见[交付报告](../../v2-beta6-windows-delivery-2026-10-23.md)。本目录只含非二进制验证材料；不含安装器、应用、插件归档或完整 artifact ZIP。

- `artifact-readback-summary.json.txt`：最终摘要与明确未验边界。
- `run-terminal.json.txt`、`jobs-terminal.json.txt`、`run.log.txt`：真实 Windows 终态与完整日志；`timings.json.txt` 按阶段计算耗时。
- `download-verification.json.txt`、`deliverable/`：实际下载和清单/插件/哈希验证。
- `embedded/embedded-frontend-proof.json.txt`：真实 NSIS/PE/Brotli 提取、前端入口与标记。仅静态证明，没有运行 Windows 程序。
- `verify-download-initial-failure.log.txt`、`manual-material-byte-review.json.txt`、`manual-line-ending-verifier.diff.txt`：初始手册字节断言失败及三文件精确 LF→CRLF 的复核，保留两侧 hash。
- `local-preflight.json.txt`、`milkup-beta6-ui-packaging-preflight*.txt`：本地子进程限制失败与 29 项未改断言重跑。
- `verify-download.py` 与 `extraction-tool/`：可复核的受限验证脚本，包含原提取器、适配差异及静态校验；输入必须另取相同 Actions 包，不能执行包内程序。

原始记录加 `.txt` 后缀用于保留字节，内容未重新格式化。`extraction-tool` 保留原文件名和其嵌套 SHA 清单。根 `SHA256SUMS.txt` 覆盖本目录除自身外所有文件，`.gitattributes` 禁止换行转换。用 `sha256sum -c SHA256SUMS.txt` 核验。

本次 Windows GUI/IME、系统剪贴板和 DPI 未验；完整 Mermaid 原型不在包内，临时标准账户授权仍待答复。之前 Linux/浏览器交互证据见相邻 `v2-beta6-context` 目录。
