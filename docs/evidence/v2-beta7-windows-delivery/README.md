# beta.7 Windows 手测包交付证据

本目录保存已下载 Actions 手测包的校验结果与原始清单。交付版本 `2.0.0-beta.7`，分支 `dot/milkup-v2-beta7-appearance-menu`。

- [构建 run 39927529410](https://github.com/Auto-Plugin/milkup/actions/runs/39927529410) 已成功；[artifact 12490808970](https://github.com/Auto-Plugin/milkup/actions/runs/39927529410/artifacts/12490808970) 到期时间为 **2026-10-24 09:13:45 UTC**（下载时元数据）。
- [交付源码 `4f88dfe78e7687377bbfb9d8c0b770a8c62969ca`](https://github.com/Auto-Plugin/milkup/commit/4f88dfe78e7687377bbfb9d8c0b770a8c62969ca)；[产品基线 `cc2cfc1d44b937e56cfcbd6e8f3cdcf3ded10189`](https://github.com/Auto-Plugin/milkup/commit/cc2cfc1d44b937e56cfcbd6e8f3cdcf3ded10189)。
- 实际校验的 ZIP 为 `artifact-connector.zip`，4,710,652 字节，SHA256 `8aba935e501a86c4c5fc0be3c3c84fc5b68ae41d266172a77421f143d79751fb`。一次直接下载失败留下的 0 字节 `artifact.zip` 未用于验包，也未归档。
- 安装器 `milkup-2.0.0-beta.7-windows-x64-4f88dfe78e76-setup.exe` 为 4,417,540 字节、未签名，SHA256 `ffaafda897b70fc85e5bb2c970076478026fc9232be718d56c251627b7828c9f`。

[下载验包证明](download-verification.json) 为 `passed`：核对 ZIP 元数据、CRC、路径、18 个文件、17 条校验和、精确提交中的源清单及 CI 构建记录。[内嵌前端证明](embedded-frontend-proof.json) 为 `passed`：从安装器只读提取应用与 12 个前端资源，检查应用 SHA、NSIS 的 3 字节标记变换、实际入口脚本和特征标记。后者同时绑定前者与原 manifest 的原字节 SHA；这些静态检查没有执行安装器或 Windows 程序。

10 个预装插件均保留 Worker 实现，实际 SDK 版本均为 `0.3.8`；各包哈希、权限及 `legacy-non-frozen` 构建方式见原始 [plugins.json](payload/plugins.json)。

| 插件 ID | 版本 |
| --- | --- |
| milkup.diagrams | 1.2.0 |
| milkup.footnotes | 1.0.1 |
| milkup.formatting | 1.0.1 |
| milkup.images | 1.0.0 |
| milkup.management | 1.0.0 |
| milkup.math | 1.0.0 |
| milkup.outline | 1.3.3 |
| milkup.preferences | 1.0.0 |
| milkup.shortcuts | 1.0.0 |
| milkup.workspace | 1.0.1 |

原生交互证据独立保留在 [44712833bc6a2e74ae4707fc557e38f2c5e825aa 的证据目录](https://github.com/Auto-Plugin/milkup/tree/44712833bc6a2e74ae4707fc557e38f2c5e825aa/docs/evidence/v2-beta7-input-appearance)：Linux 候选冻结输入 525 项、无漂移；列表最终轮 12/12 功能、64 个命名保存阶段、12 次空任务光标几何检查通过。外观第 06 轮 26/26 功能与 16/16 配置通过，但末尾清理工具断言使整轮退出 1；随后只读核验所属进程已消失，原失败记录保留。

**真实 Windows GUI、系统 IME、系统 DPI，以及实际安装/升级/回退仍未验。** IME 证据范围为 Chromium 浏览器组件与合成事件测试。完整官方 Mermaid 原型没有集成进本包；Diagrams 仍是有限 Worker 图形实现，现有夹具通过不代表完整官方语法兼容。

归档规则：`payload/manifest.json`、`payload/plugins.json`、`payload/SHA256SUMS.txt` 与两份证明保留原字节。`artifact-metadata.json` 来自原 metadata，仅删除 `archive_download_url` 字段并重新格式化；原 metadata SHA256 为 `1edf915f6981c59859319d156f1a99a9d147751f82524daecdc19851f8f16cc5`。没有保存临时下载地址或 token。原包的 `payload/SHA256SUMS.txt` 描述完整交付包，不能直接用于这个精简证据目录；这里未复制安装器、ZIP、插件包、前端资源或大日志。

`tools/verify-download.py` 和 `tools/extract-embedded.py` 是实际验包工具的原字节副本，运行时需另行提供已经取得的完整 ZIP/安装器和精确源提交；提取工具使用现有系统 `libbrotlidec.so.1`，均不会下载或执行 Windows 代码。本目录自身的文件完整性可在目录内检查：

```bash
sha256sum -c EVIDENCE-SHA256SUMS.txt
```

该命令仅验证归档字节，不重跑构建或产品验收。
