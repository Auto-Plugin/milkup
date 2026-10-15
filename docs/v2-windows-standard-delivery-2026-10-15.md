# Windows 标准版交付与通用插件预装（2026-10-15）

从已验收本地集成 `3162d56f8adbf66fbd4c5631a8e71e8ad8723a51` 创建独立分支 `dot/milkup-v2-windows-delivery`。保留七项视觉修复与独立大纲 1.2.0；不合并 main/v2/quality，不创建 Release，不签名，不使用付费 runner。

## 本次范围与 WebView2 调查

用户最新指令限定本次交付小体积标准 Windows x64 NSIS 和独立大纲包。`tauri.conf.json` 未配置 `webviewInstallMode`；构建脚本也没有传覆盖配置，故使用 Tauri 默认 `downloadBootstrapper`。缺 Runtime 时需要目标电脑联网下载并安装，包内不含完整 Runtime。旧 Windows runner 已有 Runtime，旧验证不能证明缺 Runtime 的电脑上安装成功。没有用户电脑的安装日志，不能把具体报错归因于网络、权限或 Runtime 注册损坏。

本次不修改这个模式，不下载或捆绑 Runtime，不构建 offlineInstaller/fixedRuntime。未来正式整合 main 时，可另提供包含 Evergreen 安装程序的离线选项，同时保留标准小包；这只是后续方案，不是此次 main 合并授权。官方大小参考：内嵌联网引导程序约 2 MB，离线 Evergreen 约 127 MB，实物以当次 Microsoft 版本及生成文件为准。[Tauri 安装方式](https://v2.tauri.app/distribute/windows-installer/)、[Microsoft 分发说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。

## 通用预装行为

构建阶段将独立 `.milkup-plugin` 档案作为数据纳入发行版。宿主仅枚举通用档案目录；没有按大纲 ID、命令、DOM 或标题逻辑分支，也没有把插件实现作为宿主模块导入。安装仍走原有包解析、用户目录安装、注册、隔离 Worker 和受控 UI。公开 SDK 保持 0.1.1，core 公共 API、共享 CSS、文档保存/恢复实现未改变。

默认安装仅发生一次：先持久化已处理 ID，再尝试安装。已有同 ID 记录保持原版本和启用状态，不自动升级或降级。用户禁用后重启保持禁用；用户卸载后重启或升级应用不自动装回。只读文档 Worker 才允许默认启用；敏感权限和 sidecar 不自动批准。损坏的处理记录不会被清除后重新安装；存储写入失败会阻止默认安装并在当前插件失败列表显示，避免阻塞编辑器启动。安装中断或失败后可从普通安装入口手动重试。

独立档案与预装数据使用相同字节：`milkup.outline-1.2.0.milkup-plugin`，40614 字节，SHA-256 `e2f0cf02232251bdb32f3775cee820fc592fddae34078e40d8706e195e5dfaa3`。本轮使用锁定的仓库构建工具和 SDK 公共导出构建；与上一轮已验收独立构建的可执行内容一致，仅 esbuild 的 SDK 来源路径注释不同。未改变大纲实现。Library：`libfile_d99352c43fec819185ab107651be96de`。

## 工作流与费用边界

新增专用分支工作流，保留旧质量分支的已消费请求不变。新请求绑定上述精确基线、单次 request ID、提交消息、首次 run attempt、公开仓库及标准 windows-2025 runner。只允许五个文件：安装器、同字节独立插件、manifest、SHA256SUMS、README。原始文件合计不超过 49 MiB，为上传 ZIP 留 1 MiB；一次 artifact 总量上限 50 MiB，保留 1 天，无 cache、Release 或额外存储服务。

用户明确批准新的总量 ≤50 MiB、保留 1 天、额外存储费用含税 ≤US$0.01 额度（父线程 2026-10-15 转达原文），沿用现有 GitHub 计费方式。旧预算不复用，不新增订阅或付费 runner。按 GitHub 官方 $0.25/GB/月、28 天月份保守估算，本轮约 2.4 MB / 1 天约 $0.00002（税前），50 MiB 上限约 $0.00044（税前）；实际账户余额及账单不可读取。两次无上传验证 artifact 均为 0。仅切换一次请求上传，下载核验后立即关闭请求，禁止重跑上传。[GitHub 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

## 验证记录

新增预装回归先记录 7 项失败；实现后扩展为 10 项并全部通过（含首次预装与主动安装的顺序）。全仓单元测试最终在 Windows 共 1008 项通过；Linux 全仓先通过 1007 项，增加安装顺序回归后，受影响桌面 144 项通过。大纲 24 项、Windows 构建树/二进制工具 9 项通过；Rust 75 通过，1 个既有性能基准忽略。类型检查、全仓构建、格式检查和 Chromium 浏览器 79 项通过。生产 Linux deb 重建并解包运行。首轮完整插件组合通过（39 阶段，含 26 MB 全文大纲及中部导航）。最后仅增加用户安装等待初始化后，重建并用全新 profile 再验首次预装/禁用/卸载/重启、正常 GTK 手动安装、改名插件和普通/180015 行窗口化任务编辑/保存/实际 SIGKILL 恢复（29 阶段，全部通过；此轮不重复 26 MB 大纲部分）。完整字节比较、文档原件保护与独立插件卸载后的编辑均通过。记录见 [证据摘要](evidence/v2-windows-standard-delivery/summary.json)、[最终原生结果](evidence/v2-windows-standard-delivery/native-final-results.json)、[首次预装截图](evidence/v2-windows-standard-delivery/bundled-first-start.png)。

完整当前证据位于 `/workspace/milkup-windows-delivery-evidence`。Linux 原生结果不代替 Windows/WebView2、真实系统 IME 或用户桌面安装验收。本轮 Windows 实物与来源记录见下节。

提交身份已通过 GitHub authenticated profile 再次核验为 LarryZhu-dev（40397402），邮箱 larryzhu@foxmail.com。沿用已有单次 `SKIP_SIMPLE_GIT_HOOKS=1`：旧 Electron hooks 调用 v2 不存在的 lint-staged 配置/提交脚本，未修改 hooks 或安全设置，以本轮实际检查为准。

源码提交 `9e03ca2e30944df05b7a87391a5e07b710a4db24` 已推送专用分支，GitHub author/committer 均为 LarryZhu-dev。无上传 Windows 验证 [38664582584](https://github.com/Auto-Plugin/milkup/actions/runs/38664582584) 失败于独立插件测试的 SDK 解析：干净 runner 未安装插件自己的 node_modules。此前 Windows 全仓 1008 项、类型检查、Rust 69 通过/1 忽略及二进制/构建树 9 项通过，未进入打包且 artifact 数为 0。已为该测试入口显式解析 SDK 公共导出；本地暂存并移走插件 node_modules 后，24 项测试及同字节独立档案构建通过。未跳过测试或修改插件实现。

第二次无上传 Windows 验证 [38665094452](https://github.com/Auto-Plugin/milkup/actions/runs/38665094452) 在源码 `82273ad6dd547e9eda83306489009c23ede573e6` 全部通过；打包得到 2276284 字节标准安装器，五文件合计 2321131 字节，未上传任何 artifact。独立插件 SHA 与已交付 Library 一致。该次安装器未保留，交付件将使用授权构建的实测 SHA。

首次授权交付构建 [38665728736](https://github.com/Auto-Plugin/milkup/actions/runs/38665728736) 在大纲测试阶段失败，artifact 数为 0，尚未打包或消费上传额度。已定位测试等待条件：扫描状态完成与异步可见切片刷新并不同步，旧 helper 仅等待任意非空切片，偶尔读取前一轮六行。仅将原有完整七级断言置于有界 `vi.waitFor`，保留全部预期与后续导航/不重复扫描断言；未修改大纲实现、SDK 或产物字节。修正后本地 24 项大纲测试通过，目标测试连续 10 次通过。

## 最终下载件

授权交付构建 [38666325304](https://github.com/Auto-Plugin/milkup/actions/runs/38666325304) 在 `a55a9ce85cb967153db983f7f4318b39a98f1977` 成功，Windows 全仓 1008 项、大纲 24 项、Rust 69 通过/1 忽略、构建辅助 9 项，以及类型/构建检查通过。安装器为 unsigned Windows x64 NSIS 标准版，2280435 字节，SHA-256 `6a8ac86b48b5c4801105ef4ce9fbad23d8c329c04ea31d528d87ab29f4d74b5c`。没有执行 Windows 实机安装/启动/编辑、真实 IME 或 DPI 验收，manifest 明确标为未验。

唯一 artifact `11942341220` 共 2326048 字节，2026-10-16 01:43:32 UTC 到期（保留 1 天）。实测约 2.22 MiB，按 $0.25/GB/月和 28 天月估算约 US$0.00002 税前，远低于已批准 US$0.01 含税上限；实际账单未读取。此前三次运行均无 artifact。已关闭并标记本次请求已消费，不允许重跑上传。ZIP 取回后的 SHA-256 `b73efa5438910549958acac5cc3a7f8cf8fb794c4ced1bafb50eb64228743769` 与 GitHub digest 完全一致；五文件清单、来源 SHA、体积、安装器/插件哈希均通过本地校验。

持久 Library 下载：

- [Windows 标准安装器](https://chatgpt.com/api/library/files/libfile_0d1a8f2f0ef881918054795c11ee92ff/download)：`libfile_0d1a8f2f0ef881918054795c11ee92ff`，版本 0。
- [独立大纲插件 1.2.0](https://chatgpt.com/api/library/files/libfile_d99352c43fec819185ab107651be96de/download)：`libfile_d99352c43fec819185ab107651be96de`，版本 0；与 Windows 内含预装档案完全同字节，40614 字节。

本地下载核验见 [verification](evidence/v2-windows-standard-delivery/windows-download-verification.json)，Windows 构建信息见 [manifest](evidence/v2-windows-standard-delivery/windows-delivery-manifest.json)，Library 写入回执摘要见 [delivery](evidence/v2-windows-standard-delivery/library-delivery.json)。完整 ZIP 在上述 GitHub artifact 中，另保留于本地证据目录；不额外创建重复 Library 档案。未修改大纲实现、core 公共 API 或共享 CSS，未合并 main/v2/quality，未创建 Release。
