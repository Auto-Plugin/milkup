# beta.4 用户复测修复

独立分支 `dot/milkup-v2-beta4-feedback`，产品基线 `f40ff18dba33b42754af160739342faa3b4359a2`，起点报告提交 `546d096b6567d90543da180b3adb49506fb7d55b`。作者 LarryZhu-dev；不合并主线、不发布 Release。

## 最终实现

- 卡片开关是宿主启禁入口。一次显式手势在同一生命周期队列中绑定 revision、transaction、generation 和能力指纹，内部批准后受限试运行、提交。后台恢复与公共 `plugin.enable` action 不因此获得自动批准能力。详情移除审批、拒绝、撤销审批和启禁按钮；reload 仅重载已经启用的 active，不提升 pending。
- 卡片直接提供控制面板，更多菜单提供插件命令及宿主动作；统一 Lucide 图标。移除主菜单插件面板分组，保留窄窗、键盘焦点、SVG 点击和异步切换焦点。
- 更新为 About 内置单例，启动前先完成旧 `milkup.updates` 保留数据的退出迁移。旧 ID 隐藏并拒绝重导入；迁移失败不启动新检查。检查失败或未配置不误报最新/不亮红点；取消、晚结果、下载校验和安装前保存保护仍复用既有原生链。没有配置真实发布端点或密钥。
- Windows 使用独立 `milkup.diagrams` 1.2.0 Worker 归档；Linux 保留 1.1.1 官方完整 DOM 引擎。平台库存每次仅选择一个同 ID 归档。Worker 使用可追溯的固定 Mermaid 12.2.0 parser 字节和受限布局，输出现有封闭 typed vector；不执行完整 Mermaid DOM 渲染器，不改 DOM/PDF 门禁。

## 图表和旧安装边界

支持基础 TD/TB/LR 无环流程图、简单时序图；未知语法、循环、跨层边、复杂布局、HTML/Markdown 标签、链接、配置和超额输入明确回退到完整源码。正文最多 8192 UTF-16 字符、128 行、20 节点、32 边、6 参与者、16 消息、24 字符标签，布局最多 4096×4096；输出仍通过宿主验证，既有独立 Worker 2 秒期限不变。静态输出本身不替代生成过程的隔离证明。

旧 beta.3 Diagrams receipt 只按宿主显式历史路径名单识别。卡片 ON 才从闭合随包索引选取更高版本；不替换用户自装 pending、tombstone 或不明来源。原生 prepare 的可选内部 replacement 在同锁、同 revision 下核对旧 transaction、generation、fingerprint、source 后暂存新 sealed 包，再一次保存替换候选。记录真实新来源及旧来源审计，不用旧文件名冒充新包来源。不确定 IPC 结果回读权威，但该次失败手势不继续批准。

损坏旧 sealed 候选安全拒绝；stage/save 失败可留下未引用暂存目录，由已有 GC 回收。用户 data/storage 不删除。没有新增 SDK/插件调用权限或新的 Tauri command。

## 验证记录

红绿日志、像素截图和后续产物记录见 `docs/evidence/v2-beta4-feedback/`。当前代码检查包括：2697 项工作区 Vitest、4 项 DOM bootstrap JS、140 项相关 TS、41 项 native catalog Rust 与 4 项跨进程用例；全仓类型及格式检查。Diagrams 仓库外 public SDK 0.3.8 构建、48 项测试及实际 Chromium Worker RPC/EditorView 通过，入口与归档哈希见证据。

浏览器原批保留失败：开发服务器启动常量仍为 beta.3；一项设置全流程耗尽 30 秒预算；旧 formatting helper 寻找已删除的审批按钮；一次 route.fetch ECONNRESET。对应修正和原预算复验单独记录：shell 原批 54/59，通过修正测试入口后的 5/5 复验；设置/快捷键/工作区/About 原批 36/38，最终 beta.4 服务 About 17 项和原超时设置场景共 18/18 通过。不删除失败，也不将测试入口变化写成产品修复。最终生产二进制与 Windows 构建须独立核验，开发服务器截图不代替安装包证明。

## 交付与未验收

目标为 `2.0.0-beta.4` Windows x64 小型未签名 NSIS，沿用已批准的 Auto-Plugin/milkup Actions artifacts 和对话交付，保留一天；精确源码、EXE/ZIP 哈希、插件清单及实际下载链接见文末最终 Windows 交付记录。手测指南和副本样本位于 `docs/manual-windows-beta4/`、`tests/fixtures/manual-beta4/`。

不执行安装器，不上传到其他目的地。Windows GUI、IME、系统 DPI、实际升级/健康确认/回滚仍须真实验收；Linux Chromium/WebKit 结果不冒充 Windows。当前签名渠道未配置，Windows 独立 DOM/PDF 仍关闭；新版 Worker 不等于完整 Mermaid 支持。

## Windows 首次 CI 失败与 checkout 修复

首次 [Windows 运行 39731812510](https://github.com/Auto-Plugin/milkup/actions/runs/39731812510) 使用源码 `d115364eed98f6cb4e1949043e98f5ede3e43fb1`，约 95 秒在独立插件构建前置检查中失败，产物数为 0。严格 parser 字节哈希检查报 `Vendored parser hash differs: src/vendor/flow-parser.mjs`，交付门禁随即停止；未进入产品运行或安装验证，不能归为产品运行时失败。[原始 CI 日志](./evidence/v2-beta4-feedback/windows-first-failure.log)完整保留。

根因是 Windows checkout 的换行转换改变了已审计的 Mermaid Worker parser 字节。修复提交 `8df2969b36278ff090a74dcb7616b6f475bcc13b` 仅补 checkout 属性与回归：两个 parser 使用 `-text` 保留原始字节，打包的 provenance/notice 固定 LF；workflow 仅补说明注释。未改 parser 内容、预期哈希、构建校验逻辑或运行时权限，也未通过换行归一化放松验证。真实 Git autocrlf checkout 回归从 [9 通过、6 失败](./evidence/v2-beta4-feedback/worker-checkout-red.log) 到 [15/15 通过](./evidence/v2-beta4-feedback/worker-checkout-green.log)，另有 [36/36 相关检查通过](./evidence/v2-beta4-feedback/worker-checkout-related.log)；CRLF、内容篡改及 provenance 摘要变化仍被严格拒绝。

后续 [Windows 运行 39732673935](https://github.com/Auto-Plugin/milkup/actions/runs/39732673935) 已启动。本节只记录首次失败及 checkout 修复，不据本地回归声明后续 CI、安装包或交付成功；终态与产物仍需另行核验。

## 参数边界补丁与原生生产验证

独立审查发现 Worker 将额外围栏参数按首词忽略。`7eee3944a8658a955f5f43fff3455f734aa6ce0d` 增加严格 info 校验；4 种参数空白组合先失败，修后全部 56 项图表测试与仓库外 SDK 构建通过。合法 `mermaid` 周边空白仍允许；额外参数显示明确诊断并保留完整原围栏。新版归档 SHA-256 `b1c2b8490da465f1c38f4f3886e7fa926978d2e6e2c5081bca4d716659c4acc1`。原运行 39732673935 因候选被替代主动取消，未打包/上传，0 artifacts，不能写成成功或新的产品失败。最终候选运行 39733156227。

Linux release 二进制 SHA-256 `a31e3b2d222f7dbb69146cfb82b82f393d8504d4b75374793915633730c19301`，编译提交 d115364；其 520 项 Linux 构建输入与 7eee3944 候选逐字节相同。Windows Worker 平台归档单独重建验证。原生初轮 4 项通过后，测试错误地寻找 blob img，实际截图已经显示 typed SVG；保留失败并修正为精确向量节点/连线/标签/尺寸/可见性断言。新临时目录完整复验 38/38 通过，含 32 组 light/dark × source/live × 1280/760 宽 × 原生 100/125/150/200% 缩放，真实卡片动作、指针分隔条、About 和恢复备份不等于保存。

最终 Worker 归档首次补验脚本报告 7/7，但随后像素复核推翻了诊断可见性的弱断言：提示虽有 DOM 高度，已被父编辑器滚动裁掉。完整四行源码、无错误图形替换、磁盘字节不变及合法向量断言仍有效；这次不能称为实际诊断可见性通过。只读六帧探针确认 notice top=8、editor top=37、scrollTop=29，提示中心命中标题栏。该轮转向以原顶部不滚走新提示的最小修复补验，最终结果见下文；其他滚动位置仍保留原有阅读锚定。截图和只读 DOM 观察在 native-first/native-matrix/native-final，原失败没有覆盖。使用既有私有用户/挂载命名空间；初次嵌套沙箱因只读 uid_map 失败，获准在执行器启动同一隔离映射后成功，未关闭 WebKit 沙箱。所有这些是 Linux WebKit/X11 结果，不是 Windows GUI、OS DPI 或中文 IME 验收。

原生严格断言对第一版提示修复 `993b2a30` 再次报红：220 项局部测试虽通过，但只覆盖 provider reject 路径。真实错误 fragment 在 `paint()` 内调用 fallback，随后外层无条件恢复锚点，同样把提示滚走。此候选当时未单独推送或运行 Windows CI，随后作为最终提交的祖先一并推送；原生失败与像素保留于 native-notice-first-fix。必须覆盖真实 error fragment / incomplete 响应路径后重新构建验收，不能沿用局部测试绿灯声明已修复。

最终 `0e74d9fad211c304ef68449fa6becb7450dfffef` 补齐 paint 外层：只有初始顶部且实际产生 notice 时跳过该次阅读锚点恢复，成功预览和已滚动位置不变。error fragment/incomplete 两个回归先红后绿，225 项相关测试与类型检查通过。新 Linux release SHA-256 `c2ec837c2c24b14e426b52719f90cad48525402499f14855b1a5f86ac66ab754`，520 项输入与该提交无漂移。严格原生 38/38 通过；诊断真实像素显示、notice y=37..66.1875、editor y=37、scrollTop=0，命中自身且不受祖先裁切，源码和磁盘字节完整。已目视系统截图，不再依赖 DOM 存在作为可见性证明。最终 Windows run 39735106683 受测同一源码；此前 39733156227 因发现此缺陷主动取消，0 artifacts。

最终同一二进制另通过 760×520 的 16 组 light/dark × source/live × 100/125/150/200% 窄窗矩阵。200% 下需要正常纵向滚动，不代表全部内容同屏。真实键盘补验确认 Tab 从开关进入卡片面板动作、Return 打开、Escape 还原可见焦点；原生滚轮使 About 完整未配置说明可读且中心命中自身。该补验首跑因测试脚本未等待缩放重置而失败，补齐与主矩阵相同的等待后通过，未更改产品；两次记录保留。新增测试参数与辅助脚本属于报告提交，不改变受测产品源代码。

## 最终 Windows 交付

[run 39735106683](https://github.com/Auto-Plugin/milkup/actions/runs/39735106683) 全成功，精确产品源码 `0e74d9fad211c304ef68449fa6becb7450dfffef`。15 个源码检查阶段全部通过：2703 项工作区 Vitest、4 项 DOM bootstrap JS、10 个独立插件合计 348 项测试、全仓/插件类型、前端构建、Windows all-targets、2 项更新启动测试、215 项 Rust library 测试和 release 编译链接。Rust 另有 3 个显式 ignored（两个被父测试调用的私有子进程 fixture，以及未运行的搜索基线），不冒称全都直接执行。全仓格式检查及后续修改文件格式检查在 Linux 完成。

[下载 beta.4 测试 ZIP](https://github.com/Auto-Plugin/milkup/actions/runs/39735106683/artifacts/12407892111)，artifact `12407892111`，4,687,673 字节，到期 `2026-10-23 07:00:12 UTC`。唯一安装器 `milkup-2.0.0-beta.4-windows-x64-0e74d9fad211-setup.exe`，4,402,677 字节，SHA-256 `2becc80d9b5ad7e9e2b8a0f76130157d4a8af32102b65b33c221d334ff4838c4`；ZIP SHA-256 `2a70a9c6ebe8a90d75c3e0d02595c90270016ee4716a1f644d5937bf73b48e6f`。已实际下载回读，外层 digest、18 文件 CRC、17 内层 SHA、10 插件归档/manifest、源码与版本全部匹配。初次 gh 下载重定向 Forbidden，空文件被哈希门禁拒绝；随后从同一 Actions artifact 经授权 GitHub 连接器读取成功，没有另行上传。父线程也已独立下载核验并交付用户。

预装 Diagrams 1.2.0、Footnotes 1.0.1、Formatting 1.0.0、Images 1.0.0、Management 1.0.0、Math 1.0.0、Outline 1.3.3、Preferences 1.0.0、Shortcuts 1.0.0、Workspace 1.0.1。没有 Updates 插件归档；最终 Windows Diagrams SHA 与实际 Linux 原生/Chromium 验证的独立归档完全一致。清单和全部校验和在 windows-delivery 下，不把 Windows 安装器或插件构建产物复制到源代码仓库。

NSIS 载荷已从包中提取，验证为编译应用按既有 Tauri 2.11.4 唯一 UNK→NSS 的 3 字节预期转换结果；不是声称载荷与打包前 EXE 逐字节相同。安装器、打包前应用和提取载荷版本均为 beta.4，未签名状态准确保留。没有运行安装器，没有真实安装、GUI/IME、更新/回滚验收；About 签名更新渠道未配置，Windows DOM/PDF 安全门禁仍关闭。手测只使用随包样本副本，遇安全警告记录停止，不绕过防护。

本轮源码阶段约 18 分 24 秒，其中 Rust release 编译链接约 8 分 31 秒、all-targets 约 3 分 22 秒、更新测试约 1 分 36 秒、全 Rust 测试约 1 分 3 秒；依赖恢复约 6 秒，10 插件构建测试约 57 秒。早期原始 parser 换行失败在昂贵编译前停止；两个被修复替代的候选主动取消。没有累计耗时停工，没有额外构建或上传。证据报告提交与受测产品源码区别记录；当前等待用户 Windows 复测，不继续扩展本轮。
