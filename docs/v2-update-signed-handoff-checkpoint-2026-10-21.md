# 更新签名交接：持久原字节与只读重启核对（2026-10-21）

从 `5dd78a4fc06078c2259b54a4c4895cc3a6ded075` 在 `dot/milkup-v2-update-health-contract` 继续。**本轮补齐原始签名声明跨重启丢失的代码缺口，未接入真实安装或应用启动。** 内部协调入口串起原始 envelope 保存、重新验签、当前水位授权、事务复核与当前映像观测；没有可信安装完成事实时只能返回有限观察及待核对。

## 正常编译的实际实现

现有 updater 之前只保存已解析 release。本轮在已验签并成功解析响应时，保留原始响应字节。`Update::verified_envelope()` 只有完整 release 与版本/URL/包签名/target 绑定仍有效时才返回它；不从 raw_json 重新序列化 envelope。

本地 vendor 新增 **native Rust 数据接口** `verify_signed_manifest`，复用原有 minisign 验签器与严格 schema/product/channel/规范版本检查；不是插件 SDK 或 IPC。它返回字段私有、不可反序列化的 `VerifiedManifest`，仅含只读原字节与 release，**没有下载或安装方法，也不构造 Update**。离线验签不运行更新版本比较器，因此目标等于当前版本可以核对身份；原安装路径的升级比较器与降级拒绝保持原样。

`update_handoff.rs` 的正常生产入口为 `retain` 和 `inspect_restart`。它们固定使用宿主渠道配置、宿主时钟及真实当前映像观测函数，不接受外部公钥、时钟、路径 hash/version 自报或完成消息。当前 `release/update-channel.json` 仍未配置；本轮没有调用这些入口操作真实用户目录，也没有安装/启动接线。测试通过私有适配器使用公开测试 key、固定时钟与惰性样本。

## 单文件事务与兼容

复用前一轮 Store 的独占 OS 租约、revision CAS、同目录暂存、原子替换、必要同步和结果不确定后的重新读取。交接包嵌入同一 `transaction.json`，没有第二份需协调提交的数据文件。

| 持久内容      | 约束                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| 原始 envelope | UTF-8 字符串无损保存原字节；1 至 256 KiB；保留前后空白，不规范化原响应                                              |
| 事务绑定      | transaction ID、当前 revision；attach 必须匹配旧 token 且处于 Prepared；提交及每次后续状态转换一起递增绑定 revision |
| 声明绑定      | 完整 release 摘要、基础平台、原选中平台 key、安装器摘要；与事务意图及重新验签结果核对                               |
| schema 1      | 旧的无交接包记录继续限长 4 KiB；不能提供新证明                                                                      |
| schema 2      | 必须有完整交接包，序列化总量上限 2 MiB，容纳 JSON 转义开销；不是扩大原始 envelope 上限                              |

没有持久 `verified` 标志可供信任。未知字段/schema、损坏或错配保留原文件并拒绝；不从孤立暂存文件恢复，不清空原记录。旧读取器遇到 schema 2 会拒绝，不能静默把它按 schema 1 降级处理；本轮只在合成临时目录创建 schema 2。绑定元数据是本地事务约束，不是额外签名，仍不抵御 OS 账户所有者回退或篡改整套本地状态。

`retain` 在写入前重新验签和授权，写入后再次检查授权与取消。取消若先于提交，不写交接包；若在实际提交期间或最后授权中到达，返回失败但保留 Prepared 阶段证据，不能宣布成功、自动删除证据或推进安装。相同意图需要续期时，只能在 Prepared 阶段按新 revision 再授权、提交，不接受旧调用迟到覆盖。

## 重启核对严格只读

新增 `Store::inspect`/Inspection 复用原目录/文件检查和读取器，以只读方式打开已有锁文件并持有共享 OS 租约；缺失时不创建文件，不 fsync，不写 NeedsReview，也没有 mutation 方法。既有 `Store::open` 的持久待核对行为保留，两个入口语义明确分开。

重启入口检查预期事务 ID、记录结构和阶段，从原始 envelope **重新**验签当前宿主信任根/product/channel；核对 release 摘要、平台、选中项、版本和安装器摘要，再用现有只读 policy 授权检查有效期及当前最高水位。随后读取映像，比较签名身份，最后再核对水位/有效期、完整事务快照和取消。读取期间正常 Store 写入被共享租约排斥；测试还验证了不遵守锁的合成外部改写不会使迟到结果通过。

仅 AwaitingCompletion 或 NeedsReview 可得到有限观察；Prepared、取消、缺包、损坏等安全拒绝。成功对象的 disposition 为 NeedsReview，verification 永远为 Unverified，既不写健康也不写安装完成。它是一次观察，不是可长期缓存、跨进程转交或授权安装的凭证；未来异步发布结果时仍必须由宿主核对活跃 generation/事务 revision。

## 测试与失败记录

正常非测试库构建通过。Linux 完整 Rust 库 **238 通过、0 失败、5 项既有忽略**，新增 3 项聚合测试；vendor 来源/依赖闭包测试 **2 通过、0 失败**。正常构建依赖包含 handoff 模块并排除其测试文件；格式和差异检查通过。原测试 unused import 及 loopback HTTP 警告保留，没有放宽生产 HTTPS。

- 精确 256 KiB、带首尾空白的签名 envelope 经真实网络测试驱动接收，持久后逐字节相等；重启从文件重新验签。超限、错误 key、可变 Update 绑定被改和旧 revision 均拒绝。
- 新增测试启动 **20 个真实测试子进程**：14 个重启场景、2 个持锁写入进程、2 个争用进程、2 个写入中断后的只读进程。其中 2 个写入进程由父测试在替换前/后终止。所有文件位于独占临时目录；不启动或安装候选程序。
- 14 个重启场景覆盖同版本、缺包、混事务、未重签改包、过期、水位前进、开始前取消、读取后取消/到期/水位变化/事务变化、旧映像、错误事务 ID、截断记录。正常只读核对前后磁盘内容不变；模拟水位/事务变化的写入由测试显式注入。
- 替换前终止留下旧 schema 1 记录和孤立原字节暂存；替换后终止留下完整 schema 2 记录。两者都仍为 Prepared，不可当成已启动或健康；孤立文件不晋升。**这是 kill/reopen，不是断电耐久性验收。**
- 取消在保存前、实际提交期间和提交后的最后授权检查中到达，均不发布成功。最后一种回归先真实失败（0 通过、1 失败）；补充最终取消检查后，完整测试通过。该 RED 日志保留，不把新内部代码的缺陷说成真实产品事故。

“同版本重启”的版本/映像正例使用合成安装上下文和惰性 ASCII 文件，实际子进程是测试程序。本轮没有执行目标版本应用。前轮 Linux `/proc/self/exe` 实测只证明测试进程自身读取；两者都不是正式签名发行、实际安装成功或完整载荷证明。

证据包：[v2-update-signed-handoff-20261021.zip](./evidence/v2-update-signed-handoff-20261021.zip)，87,868 bytes、25 个成员，SHA-256 `998222bcd0794c5a54de6b6af101c1575bdd6fe7f2202a18c1e838b4f6ed21cf`。包含初次定向测试、迟到取消 RED、最终测试/构建、源码、vendor 差异/来源审计与官方资料核对摘要，index.json 校验各成员。没有可执行文件、安装器、正式密钥或凭据；官方文档只保留链接/摘要/获取元数据，不整篇再分发。

## Windows/macOS 官方原语核查：本轮到此停止扩展

**Windows：没有在本次有限官方资料核查中找到满足当前“已加载主映像 → 只读原文件句柄”合同的普通自查询入口。** [NtQueryInformationProcess](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess)公开说明的 ImageFileName 是名字；其 Telemetry 信息包含进程/映像元数据，不是 SHA-256 或对应文件句柄，并有内部接口兼容性提示。[遥测结构](https://learn.microsoft.com/en-us/windows/win32/devnotes/process_telemetry_id_information_type)里的 checksum/timestamp 不能代替密码学映像绑定。这是本轮核查的限制，不是断言 Windows 所有机制都不可能。

一个有明确官方句柄合同的路线是 [CREATE_PROCESS_DEBUG_INFO.hFile](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ns-minwinbase-create_process_debug_info)：它来自调试创建事件并对应进程映像文件；可能为 NULL，必须拒绝无效句柄。若走这条路线，受信创建方须在启动时接收事件，只读使用/管理该句柄并绑定进程实例和事务，再通过可信通道交接观察。这会引入启动协调、事件生命周期、退出/取消和目标系统行为验证，**不属于当前普通自查询实现，也不是本轮已经验证的生产方案**。没有启用调试权限/模式、附加进程或新增协调程序；不使用路径重开冒充它。

**macOS：动态代码身份有官方可行方向，当前整文件 SHA-256 合同仍未闭合。** [SecCodeCopySelf](<https://developer.apple.com/documentation/security/seccodecopyself(_:_:)>)取得当前运行代码对象，但取得对象不等于签名有效。[SecCodeCheckValidity](<https://developer.apple.com/documentation/security/seccodecheckvalidity(_:_:_:)>)支持带明确 requirement 的动态签名身份校验，并说明能抵抗源文件系统被修改；它只校验建立身份所需的封装组件，不能自动扩张为整个安装载荷证明。[SecCodeCopyStaticCode](<https://developer.apple.com/documentation/security/seccodecopystaticcode(_:_:_:)>)则明确提示运行对象到磁盘静态对象的关联不保证安全，因此不能据此取路径再 hash，宣称与加载映像可靠绑定。

macOS 的最小后续需求是决定是否采用平台代码身份 requirement 合同、把预期身份纳入签名发行数据，再在真实 macOS 上验证 Security.framework 调用、签名样本、替换/重签和架构边界；若坚持当前整文件摘要合同，还须另行证明可靠文件句柄来源。两条路线本轮都未实施，不新增系统 framework 绑定或凭据。官方 DocC Markdown 在 Web 工具中返回不支持内容类型；随后从同一官方站点的三个 DocC JSON 端点成功读取并记录来源，不将获取失败抹去。

## 走向实际 Windows 更新验收不可再推迟的决策

1. **运行映像绑定与协调者。** 选择并评审可证明的 Windows 映像句柄来源及受信协调生命周期。若选择上述创建事件路线，须明确接受启动协调的改动与验证成本；现有旧应用先退出、NSIS 再启动新应用的流程没有自然提供该句柄。未决定前不能声称新程序身份已经可靠验证，也不应继续堆自报消息适配器。
2. **安装完成和可信交接协议。** 明确 NSIS/宿主如何交付原始签名包、事务身份和可鉴别的完成事实，谁存活到新进程开始核对，取消/超时如何处理。命令行上的 transaction ID 本身不构成鉴权。需要评审真实钩子/启动调用和跨进程通道，本轮禁改项保持未动。
3. **测试发行与字节来源。** 确定最终应用映像/最终安装器摘要的生成时点、平台身份合同与旧客户端最低兼容策略；测试环境只使用专用测试 key/声明，不能把外层 PE 版本或合成签名正例当成真实内嵌应用证明。正式密钥/端点不在本轮范围。
4. **真实 Windows 隔离验收资源与授权范围。** 需要可还原的目标系统环境、无真实用户数据的安装目录、两个受控测试版本，以及对实际安装、升级中断、首次启动失败、UAC/取消和多实例场景的明确执行范围。现有 source-only CI 和旧成功记录不能代替这些测试；不自行扩允许名单、预算或上传安装器。

本轮完成到持久原字节和只读重启核对，**不再自动追加 Unverified 外围模块**。下一步应先作上述集成决定。保留现有安装布局；没有 SDK/IPC/插件入口、真实 NSIS/启动参数更改、真实安装、系统权限/凭据/端点变更、新依赖、合并或发布。原信任记录损坏恢复的架构阻塞仍保留，最高水位及降级安装防护未变。
