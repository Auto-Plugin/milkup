# Windows beta.2 手测交付检查点（2026-10-21）

当前未完成安装包交付。上传到 `Auto-Plugin/milkup` Actions artifacts 及本对话的批准已经生效；打包入口失败正在修复；2026-10-21 10:20 UTC 用户已撤销累计 CI 时间限制，不再把时间预算作为停工条件。四轮均无 artifacts，没有执行安装器、发布 Release 或合并分支。

候选分支为 `dot/milkup-v2-windows-manual-candidate`，从 `40e53428e64a4effef2378ea6cbcab8f3be3b11a` 建立；其受测产品基线为 `edca2e7d00c7d3e2db32248473f24e2d2b964b27`。通过本轮完整 Windows 源码检查的提交是 `8fc8b27ad1c007b9864d5d42d09358c7fa573a09`。之后的打包预检补丁尚未 Windows 验证，不能把它视为已通过的安装包候选。

源码版本统一为 `2.0.0-beta.2`，公开 SDK 仍为 `0.3.7`；已核对历史版本、远端标签及 Release 无此 beta 冲突。除版本标识外没有改动应用实现；大纲仅修正测试中跨扫描区间的异步就绪断言，未改变 1.3.3 实现或引入 1.3.4。未纳入后续 debug/health/identity/handoff 实验，未改变外部 Cargo 依赖、NSIS 钩子、安装布局、签名密钥或更新端点。

预装插件为 outline 1.3.3、updates 1.0.1、workspace/preferences/shortcuts/formatting/images/math/management 各 1.0.0、footnotes 1.0.1、diagrams 1.1.1。最后一轮已独立构建、测试并核验 11 个归档；diagrams 使用冻结 SDK 0.3.4，其他十个 Worker 按既有非冻结独立构建合同验证，不能宣称全部依赖闭包冻结。Windows DOM 后端关闭，因此 diagrams 在 Windows 不可用。

| Run                                                                           | 受测提交                                   | 实际结果                                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| [39558332317](https://github.com/Auto-Plugin/milkup/actions/runs/39558332317) | `9638c965624fc9ff50250c8b23b922e892716798` | 工具准备断言失败；没有打印捕获的编译器值，不能推断其精确差异。恢复此前验证的 Rust 1.99.0 配置流程。                                   |
| [39558595205](https://github.com/Auto-Plugin/milkup/actions/runs/39558595205) | `56dbdedf82c0fa7d5ba6f633f655fb4c95e4b11d` | 大纲测试在最终可见行刷新前捕获 Grandchild 动作；39/40 通过。补充完整四个导航动作的有界就绪断言。                                      |
| [39559962514](https://github.com/Auto-Plugin/milkup/actions/runs/39559962514) | `90aabf4d86c4f70d010579afbd24c73f9e8e32e8` | Setext 跨区间测试提前断言两行；39/40 通过。保留原断言并等待对应可见状态，同样修正重试后的 Last 标题断言。没有放宽超时或增加测试重试。 |
| [39561309306](https://github.com/Auto-Plugin/milkup/actions/runs/39561309306) | `8fc8b27ad1c007b9864d5d42d09358c7fa573a09` | 15 项源码检查全部通过；打包入口报 `Unexpected source state`，在调用 Tauri/NSIS 之前终止；上传跳过。                                   |

最后一轮通过的检查包括锁定依赖恢复、updater vendor 来源、源码合同、SDK、11 个独立插件构建/测试/类型/归档入包、全仓测试/类型/构建、Rust 全目标检查、2 项缺失 EXE 的更新启动测试、Rust 库测试及生产链接和 tracked diff 检查。Rust 为 201 通过、3 个独立夹具入口 ignored，不能把这些夹具算作额外通过用例。CI 内编译的应用 EXE SHA-256 为 `5e5719ee4ce8596afe0b0fe8b0c9f92b3f5a177a1cec3ede3af3b0daa9dc1605`，只完成应用 manifest 检查；它不是安装器哈希，也不是可下载交付件。PE ProductVersion、NSIS 版本、安装器提取后的应用映像一致性均尚未执行。

打包旧入口同时检查 SHA 与 `git status --porcelain`，没有打印触发值。完整日志显示两个生成 schema 的 LF/CRLF 警告，但 tracked diff 为零；这些信息不足以证明触发文件就是 schema。新补丁先固定仓库根目录，打印并保存实际/预期 SHA 和完整 porcelain 状态；打包后再次核对 HEAD，并复用已有 `verify-build-tree.mjs`：只接受四个既定 schema 路径及有效、有界 JSON，记录状态和摘要，拒绝其他源码修改或未知文件。没有清空工作区、恢复文件或扩大允许列表。14 项相关合同测试通过；若下一轮发现未知文件，仍须定位并拒绝，不能直接豁免。

本地全仓 2,565 项 Vitest 加 4 项 DOM 引导测试、类型检查、生产前端构建通过；大纲 40 项通过；公开 SDK 归档下 updates 构建及 19 项测试通过。格式检查的原始样本警告已通过单文件排除处理，因为格式化会把嵌套星号改成下划线并拆开长代码行。此前依赖链接、SDK 来源门禁、首次就绪断言错误等本地失败均保留。交付材料脚本的合成验证确认正常 19 文件及哈希一致，篡改插件字节或额外 EXE 会拒绝；合成结果不是实际安装包验证。

已准备 [中文手测指南](./manual-windows-beta2/README.md)、[反馈模板](./manual-windows-beta2/FEEDBACK.md)及[基本样本](../tests/fixtures/manual-beta2/basic.md)。交付脚本将另生成较大文档、11 个插件归档、清单和 SHA256SUMS；只允许一次受限 Actions artifact，原始体积小于 49 MiB、预留 ZIP 开销后上限 50 MiB、保留一天。当前未上传任何文件。

四轮作业实际累计 **2,480 秒（41 分 20 秒）**，仅是历史耗时事实。用户已明确要求持续完成，不再申请累计时间额度；单次作业保留 60 分钟挂死检测上限，失败后诊断修复继续。最后源码阶段约 18 分 20 秒，Rust 共约 14 分钟，其中 release 编译链接 7 分 51 秒、全目标检查 3 分 39 秒、updater 测试 1 分 33 秒、库测试 56 秒；工作区恢复仅约 6 秒、11 插件约 76 秒。旧诊断模式会在插件失败后继续 Rust，交付模式现新增可选 FailFast：先保存失败阶段，再停止该轮昂贵计算，其他诊断分支保持原行为。最终检查仍完整执行。

交叉审查发现打包脚本传入 `packaged-production-binary`，而 manifest 校验参数只接受另外两种名称；扩展这个内部证据名称，保留编译与打包后两份记录。源码检查前新增 PowerShell 解析、参数绑定元数据、现成 7z/Windows SDK manifest 工具和源码状态门禁测试。源码检查与 Tauri 打包已共享同一个 Cargo target、Windows target 和 release 配置；旧 runner 已销毁且未建立可复用缓存，不把缓存当成通过证据，也不为约 6 秒依赖恢复新增缓存上传。若实际打包重复编译，按真实构建指纹继续定位。当前这些补丁仍待 Windows 实际执行。

继续保持仓库只读 CI 权限、标准 runner、既定小包和同一 artifact 目的地；不增加 Runtime、产品依赖、凭据、付费 runner、真实签名端点、安装器执行、合并或发行。

第五轮 [39584544969](https://github.com/Auto-Plugin/milkup/actions/runs/39584544969) 受测 `0274ba65623cd9cafb23012b0e0dd3da9ecf4c03`：完整源码 17 分 16 秒通过；实际 NSIS 已构建（5,683,130 bytes），版本和未签名检查通过、7z 提取 9 文件，但原始编译映像与安装载荷全哈希比较失败，故上传仍为零。日志明确显示本轮 SHA 相等、porcelain 报 desktop/windows 两个 schema 修改，而 Git 规范化 diff 为空；这是本轮直接证据，不能补造上一轮缺失的触发值。

已定位安装载荷比对假设错误：[Tauri CLI 2.11.4 bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs) 在打包前把完整 bundle token 的末尾 `UNK` 改为 `NSS`，完成后恢复原始编译映像。新检查只在内存构造此唯一完整标记变换的预期字节，再与提取文件全字节比较，拒绝任何额外变化、长度差异、缺失/多个源标记或多个匹配文件；不修改任何 EXE、不取消一致性门禁。六项合成测试通过，实际 Windows 待重跑。清单分别记录编译映像与实际载荷、预期和实际哈希、标记偏移，不再宣称未打包映像与安装载荷哈希相等。打包后会核对实际载荷的版本、未签名状态及 manifest。

此轮 Tauri 打包复用已有依赖，只重编译 milkup-desktop，耗时 2 分 03 秒；NSIS 下载及 makensis 约 9 秒。剩余耗时主要是每个全新 runner 的 Rust 检查/测试/release 编译，并非安装器压缩或插件测试。继续修复后重跑，不因累计时间暂停。

剩余产品边界：这是沿用原应用标识的非便携安装器，可能覆盖旧安装并复用设置；默认小包不包含完整 WebView2 Runtime。未签名告警应记录反馈，不指导绕过防护。Windows GUI/中文 IME/真实保存重开/系统 DPI 由用户按样本手测；Windows DOM/PDF 仍关闭，实际更新、健康确认及回滚未验收。

[证据摘要](./evidence/v2-windows-manual-beta2/summary.json)、[15 项通过记录](./evidence/v2-windows-manual-beta2/run-39561309306-phases.json)、[11 个插件证明](./evidence/v2-windows-manual-beta2/run-39561309306-public-plugins.json)和原始日志保存在同一证据目录。普通 `gh run view --log` 遗漏了长 JSON 行之后的部分输出；已另取完整原始日志 ZIP 并保留其中完整源码日志，不能以截断输出替代证据。
