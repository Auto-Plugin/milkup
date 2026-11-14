# Windows beta.2 手测包交付（2026-10-21）

已完成真实 Windows x64 NSIS 小包构建、批准目的地上传及下载后校验。[下载 Actions artifact](https://github.com/Auto-Plugin/milkup/actions/runs/39587536643/artifacts/12340664920)，需登录有仓库访问权限的 GitHub 账号；保留至 **2026-10-22 11:09:57 UTC**。ZIP 共 19 个文件、7,538,406 bytes，包含安装器、中文手测指南、反馈模板、两份样本、11 个插件归档与清单/校验表。没有发布 Release、合并分支、运行安装器或上传到 Library。

受测源码为 **`32b55aa4dfd2806433a649eca2c9d7ad2262d3bc`**，分支 `dot/milkup-v2-windows-manual-candidate`；基线 `40e53428e64a4effef2378ea6cbcab8f3be3b11a`，此前受测产品线 `edca2e7d00c7d3e2db32248473f24e2d2b964b27`。[CI 39587536643](https://github.com/Auto-Plugin/milkup/actions/runs/39587536643) 已成功；作者与提交者均经 GitHub 核对为 LarryZhu-dev，邮箱 larryzhu@foxmail.com。报告归档提交与安装器受测提交应分别识别。

安装器为 `milkup-2.0.0-beta.2-windows-x64-32b55aa4dfd2-setup.exe`，5,683,497 bytes，版本资源 ProductVersion/FileVersion 均为 `2.0.0-beta.2`，未签名。安装器 SHA-256：

```text
81d87e3631c26bf1197633cd7f0f1eef886c88719fe368bd5a2ee3700606c0b0
```

ZIP SHA-256 为 `ed91b981a743b2b6825c39f81809c683bb5e3e1659fcab50bdc872de0b5023e0`。GitHub 直接下载重定向在本执行器返回 HTTP 403，空文件正确被摘要检查拒绝；标准 `gh run download` 也失败。随后通过已连接 GitHub 的只读 artifact 下载接口取得同一 ZIP，在本地核对其摘要与 GitHub API 一致，并校验全部 19 个文件、安装器版本记录、源码 SHA、11 个插件清单和归档摘要。没有因下载运输失败重新构建或重复上传；临时下载 URL 未写入报告/仓库。

预装归档：outline **1.3.3**、updates **1.0.1**、diagrams **1.1.1**、footnotes **1.0.1**；workspace/preferences/shortcuts/formatting/images/math/management 各 **1.0.0**。公开 SDK 保持 **0.3.7**；diagrams 按既有冻结 SDK 0.3.4 合同，十个 Worker 按既有非冻结独立构建合同测试，不能宣称全部依赖闭包冻结。Windows DOM 后端关闭，diagrams/Mermaid 不可用。旧用户安装的插件/禁用状态可能继续保留，应记录管理界面实际版本。

完整 Windows 验证：15 个源码阶段通过，含 11 插件独立构建/测试/类型和归档入包，全仓测试/类型/构建，Rust 全目标检查，2 项 updater 依赖启动回归，Rust 库 **201 通过、3 个夹具入口 ignored**，生产链接与 manifest 检查。新增 NSIS 字节转换的 6 项合成测试在本地及 Windows 预检通过；下载验收逻辑另以一致输入、错误转换证明和被篡改安装器做合成测试。真实安装包随后完成版本、未签名状态、7z 只读提取和实际应用 manifest 检查；这不等于安装/启动/GUI/IME 验收。

| Run                                                                           | 受测提交   | 结果及原因                                                                                                        |
| ----------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| [39558332317](https://github.com/Auto-Plugin/milkup/actions/runs/39558332317) | `9638c965` | 工具链断言失败，捕获版本未打印，不能补造具体差异；恢复此前验证的固定编译器准备流程。                              |
| [39558595205](https://github.com/Auto-Plugin/milkup/actions/runs/39558595205) | `56dbdedf` | 大纲异步可见行尚未完成就捕获 Grandchild 操作，39/40 通过；等待原有完整导航断言。                                  |
| [39559962514](https://github.com/Auto-Plugin/milkup/actions/runs/39559962514) | `90aabf4d` | Setext 跨扫描区间提前断言两行，39/40 通过；保留原断言并等待对应就绪状态，无增加重试/放宽超时。                    |
| [39561309306](https://github.com/Auto-Plugin/milkup/actions/runs/39561309306) | `8fc8b27a` | 15 项源码全部通过，旧打包入口笼统报 Unexpected source state，实际触发值未记录，根因不能完全还原。                 |
| [39584544969](https://github.com/Auto-Plugin/milkup/actions/runs/39584544969) | `0274ba65` | 源码通过且 NSIS 首次实际构建，原始编译映像与安装载荷直接哈希比较失败；确认验收脚本忽略了 Tauri 的 NSIS 标记转换。 |
| [39587536643](https://github.com/Auto-Plugin/milkup/actions/runs/39587536643) | `32b55aa4` | 全部检查、NSIS 构建/提取/严格转换比对及唯一 artifact 上传成功，下载后校验通过。                                   |

前五轮均为零 artifacts。另在静态预检发现 `packaged-production-binary` 不在 manifest 检查参数允许值内，已提前修正并加入 Windows 参数元数据预检；没有把未执行到的潜在错误伪称为某次实际失败。

[Tauri CLI 2.11.4 bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs) 会将完整 bundle token 的 `UNK` 改为 `NSS`，打包后恢复编译目录的原映像。因此原始哈希直接相等的验收假设错误。新校验仅在内存构造唯一完整标记变换后的预期字节，与提取文件全字节比较，拒绝任何额外差异、长度变化、缺失/多个源标记或多个匹配文件；不修改任何 EXE。实际应用哈希为 `0f75ef6beb4836155d1a59ff3720e4e13fcc3a04757803c9370141f81173b1f6`，打包后恢复的编译映像为 `603d9d91795ee1c9bf3a1ba4f2556f57aac9c0931501daccc0a8fbc11bfe0e62`，清单明确区分二者及唯一标记偏移，不宣称二者相等，也不把后者冒称更早源码阶段生产映像的相同字节。

源码状态诊断已记录实际/预期 SHA、完整 porcelain 及构建前后检查。门禁仍拒绝四类既定生成 schema 之外的 Git 内容变更与意外文件。本轮 Git 规范化内容 diff 为空，porcelain 仍记录 schema（打包后还包括 Cargo.toml）的状态/换行痕迹；不宣称整个检出目录逐字节未变，也没有 reset/删除文件来制造干净状态。之前只有 schema LF/CRLF 警告的旧日志，不能替代本轮实际诊断。

耗时原因：此前诊断模式在插件失败后仍继续 Rust，浪费后续约 7–8 分钟；本次交付模式首错保存证据后停止该轮，其他诊断模式保留。编译前先检查 PowerShell 解析、证据参数、现有 7z/Windows SDK 工具和门禁回归。历史成功源码轮 Rust 共约 14 分钟，依赖恢复约 6 秒、独立插件约 76 秒；每轮新 runner 未建立跨作业 Rust 缓存。最终作业 **19 分 25 秒**，源码 **15 分 25 秒**，构建及检查 **1 分 57 秒**，上传 **2 秒**。同一作业内已复用 Cargo 目录；第五轮打包只重编译应用约 2 分 03 秒，NSIS 下载/压缩约 9 秒。用户于 10:20 UTC 撤销累计 CI 停工预算后持续推进至成功；60 分钟仅为单次作业挂死检测，并非累计任务截止。

本地此前全仓 2,565 项 Vitest 加 4 项 DOM 引导测试、类型、前端生产构建通过，大纲 40 项和公开 SDK 归档下 updates 19 项通过。格式检查保留原始 Markdown 回归样本（不将嵌套星号改写成下划线或折行长代码）；新增脚本/文档格式和相关 20 项合同检查通过。所有前序失败、成功与下载运输边界均保留原始记录或脱敏说明。

手测从随包 README 开始，另见[中文指南](./manual-windows-beta2/README.md)、[反馈模板](./manual-windows-beta2/FEEDBACK.md)。先校验 EXE SHA256，只用全新样本副本，按启动、保存重开、中文 IME、任务列表/撤销、粗斜体/表格/长代码、大纲/插件、浅深主题及 100/125/150/200% 宽窄窗口顺序测试。默认小包不含完整 WebView2 Runtime；沿用应用标识，可能覆盖旧安装并复用设置/插件及文件关联。遇未签名、安全软件或权限警告请记录并反馈，不关闭防护或绕过警告。

Windows DOM/PDF 仍关闭，真实安装、GUI/IME、升级、健康确认及回滚均未验收。没有纳入未接受的 debug/health/identity/handoff 实验、修改 NSIS 钩子/安装布局、配置真实密钥/端点、新增产品依赖、扩大系统权限或发布正式版本。

最新机器可读结果见[交付结果](./evidence/v2-windows-manual-beta2/delivery-result.json)、[下载核验](./evidence/v2-windows-manual-beta2/download-verification.json)、[最终源码阶段](./evidence/v2-windows-manual-beta2/run-39587536643-phases.json)和[证据索引](./evidence/v2-windows-manual-beta2/index.json)。旧 `summary.json` 是恢复执行前的历史检查点，其旧预算和阻塞状态不是当前结论。
