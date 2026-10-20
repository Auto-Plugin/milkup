# W0 UDP 诊断证据（2026-10-20）

完整结论见 [UDP 诊断报告](../../v2-windows-w0-udp-diagnosis-2026-10-20.md)。**D01 观察器故障，实验无效；D02/D03 有效对照下网络隔离失败。D03 在受限原生 helper 启动自己的 Runtime 前，已复现重复 UDP 送达。产品 DOM/PDF 保持关闭。**

`evidence.zip` 冻结 123 个文件，包括三次原始 Actions 日志 ZIP、逐字节对应的解压日志、解析 JSON、精确源码和 Git blob 清单、GitHub 身份/运行/零 artifact 元数据、本地检查日志与分析/解析脚本。没有安装器、Runtime、可执行程序或用户文档。

- 基点：`1d095d4def531e73578902ad36591e13ed1d8d58`
- 最终实测源码：`6af70966994927e116d58de40c46398d1ccf0e43`
- ZIP：10,454,592 字节
- SHA-256：`55cca6fd8b8d1be0b91878ac2d0b61c4d2d4052f17e1fd0b1fb67b47c6fee7e2`

执行 `python3 docs/evidence/win-w0-udp-20261020/verify.py` 可核对 ZIP 和逐文件哈希、原始嵌套 ZIP 与解压日志、源码 blob、提交身份、解析来源、收据归属、普通正对照、重复发送反例、有效策略前后快照和清理结果。校验器不解压文件、不运行归档脚本或二进制。

D01 的 CI success 与错误的狭窄 canary=true 保持原样，其 `interpretation.json` 明确标为无效。D02 的 JSON 组中混入一行 native stderr；D03 混入一行 native stderr 和五行 PowerShell exception。每行的精确内容与组内位置均在对应 `windows-w0-matrix-parse-provenance.json`，校验器从原始日志重新解析后逐项比较；没有编辑原始日志或将 failure 改写成通过。

`analysis.json` 是便于阅读的派生数据。关键结论由校验器直接从 `windows-w0-matrix.json` 的原始收据重算，不依赖派生分析的计数。原来的 [M01/M02 证据](../win-w0-isolation-20261020/README.md)未覆盖或重写。
