# P8 发行前工程检查点（2026-10-20）

本轮从 P7 `a4d44e680478d7894450f30f3d533dc1c3131974` 继续，在隔离分支 `dot/milkup-v2-product-phase8-readiness` 修复发行前的源码与更新链问题。应用保持 **2.0.0-beta.1**。完整 Windows 源码检查与生产链接已通过；本报告不表示产品或 Windows GUI 已验收，不产生安装器、Runtime、artifact 上传、签名或 Release。

中断后的 15 个工作文件先作带哈希快照再继续，没有重置工作区。代码检查点为 `81e2a97c3e78786c06a2191774d9899627654b89`；Windows 检出修复为 `6353823365b7ee33a37cac3fd9c8be5374b4d711`。第二轮 Windows 真实失败的修复为 `dcb58b768475ec2d326ee9d9d766878c2d6dae1e`。CI03 资源 flush 与测试生命周期修复为 `10af790217307b44f95c62aa6e9d7bf61f259942`。四个源码提交的 GitHub 作者与提交者均核验为指定账户 LarryZhu-dev（ID 40397402），Git 邮箱为 `larryzhu@foxmail.com`。最终文档提交另作远端核验。

## 已修复的工程问题

| 问题                                      | 最终行为与证据边界                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows CRLF 改变 diagrams 冻结输入       | 三个已审查的输入使用精确 LF 属性；哈希校验不放宽。真实临时 Git autocrlf 检出要求普通对照文本转为 CRLF，同时冻结输入保持原字节。                                                                                                            |
| Windows 祖先路径未被 POSIX 分隔符规则拒绝 | 使用当前平台路径分隔符识别 `..` 祖先；测试实际生产 helper，并分别输入 Win32/POSIX 路径。                                                                                                                                                   |
| fresh checkout 缺 diagrams SDK 0.3.4      | 保留既有 22,524 字节的公开 SDK 档案，SHA-256 `1717c0114aa165fa3e48a1bfa7687ffd0d9b2e5392d33e99d8b2dc59a1f3ad4f`。不是改用当前宿主 SDK 或重新打包；来源、四个成员及历史源码关系见 [SDK provenance](../plugins/diagrams/SDK-PROVENANCE.md)。 |
| 非法 SemVer 与 Cargo.lock 漂移            | 拒绝数字前导零等非法版本；仅检查/同步唯一的本地 desktop lock 条目，保留其他依赖和换行。包版本缺失时不得越过普通或缩进 TOML 子表修改依赖版本。                                                                                              |
| 取消下载后迟到成功重新发布                | 每次下载/取消更新独立 attempt epoch；在清除 abort 或发布已验证字节前，验证 release generation 与 epoch。旧成功/旧失败不能影响同 release 的新重试。                                                                                         |
| Windows 安装器启动失败仍清理并退出        | 同版本 tauri-plugin-updater 2.10.1 的窄补丁检查 ShellExecuteW 结果：失败返回错误，OS 接受后才执行既有 cleanup/exit。签名、参数、提取和依赖闭包不变。                                                                                       |
| Windows 完整检出被历史长证据路径阻断      | CI01 保留失败；仅在临时 P8 Windows runner 的 checkout 前启用 Git longpaths，完整输入不删减、不改名。                                                                                                                                       |

更新器补丁来自本地已有的上游 crate，原 SHA 与旧 Cargo.lock 一致，保留原许可证和清单；包数量仍为 480，版本与依赖边未变；仅 updater 来源由 registry 变为本地路径，移除该条目的 source/checksum。原有 29 个文件中仅两处 Rust 文件有改动，另加一个私有 helper。[完整补丁说明](../vendor/tauri-plugin-updater/MILKUP-PATCH.md)、机器校验 provenance 和原始 diff 一并入库。它没有开放新执行 API，OS 接受启动也不等于安装完成。

宿主收到安装错误后解除安装锁、恢复焦点与编辑。重试需要新的确认、脏文档准备和重新下载验签；过期确认不能继续使用。浏览器中的这些断言采用模拟 native transport，不能代替 Windows 实机证据。

## 回归与本地验收

保留修复前真实失败，不将后续通过覆盖为一次成功：路径/CRLF 初次测试包含 8 项失败；版本测试初次 3 项失败，后来另加 TOML 跨表与缩进表失败；native 下载发布回归初次 4 失败、1 通过。Windows launch 的 unchecked-result 变体在 Linux 私有策略测试中退出 101；该变体不是运行上游 Windows API。

| 检查                       | 实际结果                                | 限定                                                                                                                                          |
| -------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 全仓测试                   | 2561 Vitest / 194 文件，另 4 Node，通过 | Linux；强化后的安装宿主断言另跑 24/24                                                                                                         |
| 全仓类型、构建、格式       | 退出 0                                  | 不包含安装器或 Windows GUI                                                                                                                    |
| P8 源码合同                | 初轮 61/61，CI02 修复后 63/63，通过     | 含版本 7、vendor 2 及 CI/插件合同；CRLF 与实际目录别名回归分别补入；原门禁、哈希和内容拒绝断言不放宽                                          |
| Git 检出与独立插件输入合同 | 恢复检查点 38/38，通过                  | 包含普通文本 CRLF 对照及精确 SDK 档案；后续新增别名回归并入 63 项合同                                                                         |
| native updates             | 带本地补丁依赖重新编译，11/11 通过      | 包括真实公开签名正反向向量及五项确定性迟到/取消测试；Linux 原生，非 Windows API                                                               |
| 更新宿主恢复               | 24/24，通过                             | 模拟安装错误与再次确认/下载，非 OS 测试                                                                                                       |
| 浏览器更新流程             | 14/14，重试 0                           | 实际 Linux system Chromium；项目名称虽为 desktop-msedge，不能称 Edge 或 Windows。普通/窗口化 source/live、明暗/宽窄、Unicode 保存与失败后编辑 |
| 私有启动结果策略           | 1/1，通过                               | Linux 执行生产策略 helper；实际 Windows API 另列                                                                                              |

## Windows 编译与操作系统测试

使用公开仓库的标准 `windows-2025` runner；仅测试和链接，不运行 bundler/NSIS、不安装或下载 WebView2、不上传构建产物。独立构建包含 11 个公开 SDK 插件：10 个 Worker 构建仍明确标注 legacy/non-frozen，diagrams 使用审查过的冻结 SDK 0.3.4 输入，不把前者写成冻结闭包。

- [CI01](https://github.com/Auto-Plugin/milkup/actions/runs/39352255854)：SHA `81e2a97c…`，checkout 因 36 条 `Filename too long` 失败；未执行任何测试/编译，artifact 数量 0。
- [CI02](https://github.com/Auto-Plugin/milkup/actions/runs/39352674495)：SHA `63538233…`，整体失败，15 阶段中 10 通过、5 失败，artifact 数量 0。11 个独立插件构建/432 项测试/类型、预装输入、workspace 测试/类型/构建，以及真实 Windows updater 两个回归通过。源码合同为 59 通过、2 失败：SDK 测试将真实 canonical path 与 `RUNNER~1` 别名直接比较，workflow 测试仅按 LF 分割。desktop check、lib test、release build 均在 `output.rs:248` 的 `Result<Option<_>, _>` 类型推断处退出 101，未执行 desktop lib 测试或链接生产程序；tracked-source 检查发现过时 Windows schema，退出 1。
- [CI03](https://github.com/Auto-Plugin/milkup/actions/runs/39354629655)：SHA `dcb58b76…`，整体失败，15 阶段中 14 通过、1 失败，artifact 数量 0。63/63 源码合同、完整编译、生产链接/manifest、源码未漂移均通过；两个 updater 回归与新增输出拒绝回归实际通过。完整 desktop lib 为 **127 通过、22 失败、1 个既有忽略项**。生产 exe SHA-256 为 `d7ff7eeb39c109e6c5cde2123392eb4c857529a96d50b43334d941091e9dcbad`，只保留日志内哈希，未下载或上传该 exe。
- [CI04](https://github.com/Auto-Plugin/milkup/actions/runs/39356753734)：SHA `10af7902…`，**15/15 阶段全部通过**，artifact 数量 0。源码合同 **63/63**，完整 Windows desktop lib **152 通过、0 失败、1 个既有忽略项、0 filtered**，两个 updater 专项测试通过；完整 desktop check、生产编译/链接及源码未漂移检查通过。唯一忽略项仍为显式性能基准 `search_profile_baseline::profile_legacy_search_windows`。11 个独立插件构建/432 项测试/类型，以及全仓 2561 Vitest + 4 Node、类型、构建均通过。CI03 的 22 个失败与 3 个新增回归已逐名核对为通过。生产 exe SHA-256 为 `88ed7a81a0e00eec34b579c1495d1e8d885e6b844fe79add40124057dde6d44f`；提取 manifest 退出 0，Common-Controls 为 6.0.0.0，提取前后 exe 哈希相同。只归档文字证据，未下载或上传 exe。

CI02 后只作对应修复：SDK 测试以真实 realpath 严格比较，另用 symlink/Windows junction 别名验证相同身份以及篡改拒绝；workflow 测试同时接受真实 LF/CRLF，并证明两者缺门禁仍拒绝。两者均保留本地修复前 RED。输出选择添加显式 `Result<Option<Target>>` 类型，不实现新平台后端；非 Linux 新回归验证 unsupported、lease 结束且不能获取写入目标。Linux 原有输出保护 7/7 再通过。Windows schema 同步为 CI02 实际生成的 Git blob `93d835e4e0bdc2b9c2728343d4a68d99d974c343`，与既有 desktop schema 相同，只增加九个 updater 权限定义，未改变 capabilities 或授予 updater 权限。

CI03 的 22 个失败分开定位，未用 skip 或忽略清理错误处理：

- **8 个资源/恢复失败是实现问题**：写入后对只读目录句柄调用 `sync_all`，Windows FlushFileBuffers 要求 GENERIC_WRITE，因此返回 OS 5。新私有 helper 严格 flush 文件，再验证目录身份与重解析点；Unix 继续目录 fsync。Windows 沿用已接受 P6 的文件 flush + 被保护目录身份验证边界，不承诺 POSIX 目录元数据持久化或任意断电安全，不扩大句柄共享权限、不忽略文件 flush 错误。依据见 [Microsoft FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) 和现有 `plugin_catalog_windows.rs` 模块合同。新增真实 Windows 测试确认只读目录 flush 的 OS 5、可写文件成功、只读文件 flush 错误仍传播以及目录重命名仍被 OS 32 拒绝；另有跨平台目录身份错配拒绝测试。
- **12 个 lib 测试是生命周期问题**：业务断言已完成，但静态资源 registry 的文档句柄仍保护目录。现于全部原断言后显式关闭注册文档、丢弃局部 registry，再严格删除目录；生产代码和共享标志未改。新增回归验证丢弃局部 registry 不会替代关闭文档，关闭前保护仍在、关闭后不可再获取资源且允许目录移动。
- **2 个 workspace 测试是平台语义问题**：文件路径以真实 canonical path 比较；Unix 保留活跃根替换后的身份拒绝，Windows 验证活跃根及未释放 lease 阻止 rename，撤销并释放最后引用后允许替换，旧 token 继续失效。生产 workspace 代码字节未变。

这轮修改后完整 Linux lib **188 通过、0 失败、5 个既有忽略项**，包含资源/恢复、保存冲突、Unicode 与目录身份等原回归；没有新增 ignored；五项分别为两个需要真实 WebKit/display 的用例、两个由外部 native harness 启动的私有 helper，以及显式性能基准。精确名称见证据包 `windows-compile/recovery06-combined/result.json`。CI04 另有真实 Windows 152 通过；两个平台的结果分别记录。

Windows 私有 updater 测试先列出并确认两个测试名称，再真正运行，避免空过滤通过；CI02 至 CI04 两项均实际通过。OS 测试使用私有临时目录内不存在的 Unicode/空格路径调用生产 ShellExecuteW helper 两次，不创建可执行文件、不启动安装器。这些 Windows 结果验证了失败返回、进程存活且 cleanup/exit 回调未调用；真实 GUI、UAC/策略拒绝及安装成功路径仍未验。

## 仍然开放的门槛

完整逐项关闭条件见 [P8 清单](v2-product-phase8-readiness-checklist.md)。本轮不改变这些事实：

- Windows/macOS DOM 与受控输出相关后端未实现；sidecar 激活仍不支持。
- P5 保持现有 WebKit 依赖。PDF 精确 Unicode 复制/搜索、长块分页和历史 Print04 超时仍是已知失败；本轮没有采用 Chromium 运行依赖。
- P7 密集折叠 p95 256 ms 超出 250 ms；个体尾延迟和首次搜索失败保留。真实系统 IME、读屏、DPI 和 Windows/macOS GUI 未验。
- 正式渠道/签名尚未配置，元数据版本绑定、有界清单获取、应用自动回滚和真实安装/升级/卸载/文件关联仍开放。
- 标准小安装包仍是优先方向，可选离线包只属于未来单独批准的交付。本轮没有消费历史已用上传预算，也没有上传 Windows 编译产物。

原始日志、失败回归、四轮 Windows CI 及源码/身份校验收录于 [证据索引](evidence/p8-20261020/README.md)、[证据 ZIP](evidence/p8-20261020/evidence.zip) 和 [逐成员 SHA-256 清单](evidence/p8-20261020/manifest.json)。P8 的本轮源码工程检查点已完成；安装与产品门槛仍按清单开放。
