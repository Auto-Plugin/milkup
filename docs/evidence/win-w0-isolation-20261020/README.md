# W0 隔离证据（2026-10-20）

完整说明见 [W0 报告](../../v2-windows-w0-isolation-2026-10-20.md)。这个里程碑**未通过网络隔离门槛**，产品 DOM/PDF 未启用。

`evidence.zip` 包含 72 个文件：M01/M02 的原始 Actions 日志 ZIP、解压日志、解析 JSON、精确源码快照、提交/运行/零 artifact 元数据，以及本地验证记录。无安装器、Runtime、可执行程序或用户文档。M01 的 DNS/选择器无有效正对照以及 M02 的真实网络送达失败均保留。

- 精确验证源码：`3d14a5672698fdd658d821c887a30bfb8567133b`
- 基点：`e37e9b43e0f8481074872a7514c62246e1cd0d0f`
- ZIP：2,893,879 字节
- SHA-256：`97125a8e35b8e3aa20b93285e071680f795497bb6ea61415dd0c8cf28b62fad8`

运行 `python3 docs/evidence/win-w0-isolation-20261020/verify.py` 可验证 ZIP 和逐文件哈希、从原始日志重新解析 JSON、失败 canary 的进程/令牌关联、清理结果、提交身份及 artifact=0。校验器不解压文件、不运行二进制。`index.json` 的哈希覆盖原始包成员；解析来源和唯一被分离的 stderr 行在 `M02/parse-provenance.json` 中说明。
