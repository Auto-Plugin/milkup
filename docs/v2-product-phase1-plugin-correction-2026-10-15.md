# P1 独立插件架构修正与受限离线交付

本轮修正此前未验收的 P1：更新业务必须是可独立构建、安装、禁用和卸载的插件；插件卡片仅显示标题、logo 和描述。工作分支为 `dot/milkup-v2-product-completion-phase1`，修正基线为 `c2f7445ee4f84b46c9044f7df52c876c5449fa0d`。旧报告和截图保留为历史，不能作为本轮架构验收证据。

## 实现与边界

`plugins/updates` 是独立的 `milkup.updates` 1.0.0 Worker 插件，仅依赖公开 SDK 0.2.0。版本检查、说明、进度、取消、重试和安装请求的状态与 UI 均位于插件中；已删除宿主的旧更新业务模块和“关于”更新面板。外部目录使用 SDK tarball 构建，正常 GTK 文件选择器安装该外部档案，不能用仓库内部导入冒充插件独立性。

SDK 新增受 `app:updates` 审批保护的 `host.releases.check/stage/status/cancel/requestInstall`。受信宿主负责固定渠道/公钥、HTTPS、版本与签名验证、暂存和强制安装确认。插件只接收本次能力发放的不透明 release ID，不能提供 URL、路径、公钥或安装字节。禁用、撤权、卸载会撤销旧句柄、清理任务并取消等待中的安装确认；取消按原生候选 token 限定，不影响其他候选版本。下载完成不会自动安装，干净文档也必须确认；脏文档只能保存后继续，不能丢弃草稿。保存失败、外部冲突或取消均不安装。

分发配置预装大纲 1.3.1 和更新 1.0.0 两个独立档案。更新含敏感权限，默认只安装，不自动审批或启用。用户禁用或卸载后重启不会恢复。大纲仅同步 SDK 兼容范围与包版本，没有改变大纲实现。恢复既有插件时仍验证当前宿主/SDK 兼容要求，不静默放宽旧插件范围。

插件列表仅含标题、logo、描述；版本、状态、兼容、权限、启停卸载和贡献入口位于详情。可选 logo 只接受包内声明的受限 PNG，拒绝外部地址/不受控路径，限制文件大小与尺寸，损坏资源显示默认字母图标。正常安装的独立 PNG 夹具已通过真实原生像素检查。详情及通用插件弹窗支持键盘进入、关闭和焦点返回。

共享变动包括 core 公共权限联合类型新增 `app:updates`、SDK 0.2.0、通用插件弹窗焦点控制及局部通用 CSS；未扩展图片、复杂嵌套等 Markdown 支持范围。P2–P9 的独立插件与必要宿主 API 分工见[完整阶段计划](v2-product-completion-plan.md)，不据此宣称后续阶段完成。

## 失败回归与修复

- 宿主能力/安装门：24 项中先复现 10 项失败，再全部通过，覆盖迟到进度、取消并发、撤销期间检查、过期安装闭包、同步异常及重复确认。
- 弹窗首次挂载：先复现 2 项失败，修复异步渲染前未接管焦点和异步完成抢走宿主确认焦点。
- Linux WebKit 原生键盘：实际记录 Shift+Tab 的 `key=Unidentified, code=Tab`，旧逻辑漏判后焦点进入底层审计日志。另复现检查期间按钮消失，结果返回后焦点停在容器。针对这两项补充测试，先有 3 项失败，再有 27 项通用 UI 测试通过；恢复挂起焦点仅在用户仍停留于容器时发生，不抢关闭按钮或外部确认框。
- 浏览器早期回归保留失败日志：除真实焦点缺陷外，区分开发期热重载中断和测试未关闭详情/菜单造成的错误，不将其改写为通过。

## 验证记录

本轮初始完整单元测试 1082 项通过；最终源码在 Windows CI 完整执行 1090 项通过（含后增 8 项 UI 回归），完整类型检查与前端构建通过；随后通用 UI 的新增/修复测试单独完整验证。外部 SDK tarball 构建大纲与更新插件，分别 24 和 17 项测试通过。CI 上传/构建树门禁 39 项通过。Rust 直接运行 84 项通过、1 项原有性能测试忽略；环境包装 runner 下出现的 3 项目录清理 `Bad address` 失败原样保留，未当作产品通过。

最终 Chromium 全仓 98 项通过；随后桌面 181 项单元测试、全仓类型和格式通过，冻结锁文件安装未改变锁文件。最新 deb 的生产原生矩阵已覆盖 light/dark × 100/125/150/200% 原生缩放 × 1100×760/760×520 共 16 组合；正常档案安装、显式审批、禁用/卸载、重启不复活、source/live 编辑撤销重做与完整字节保存、真实 SIGKILL 后恢复副本且保留原文件均通过。真实 0.1.0 档案迁移通过：旧大纲兼容拒绝、外部 1.3.1 安装启用、重启状态保持，更新仍未审批。18,000 行窗口化文档在 source/live 切换后保留选区与光标，两种模式输入、撤销重做及保存均比对完整 Unicode/CRLF 字节；末尾光标等于完整 UTF-16 长度。窗口化首轮即时读取少一个按键属于测试观察竞态，失败捕获已收到最后按键，改为等待同一快照的目标选区后通过；未修改产品。首次结果像素专项在不含连续 rAF 观察器、静置 5 秒时即正确显示，无需移动鼠标或 resize；保留短等待的旧截图，不据此宣称已建立绘制延迟性能结论。真实更新渠道仍未配置，原生 UI 如实显示未配置；浏览器网络/安装替身与 Rust 真实签名测试向量分别注明，不冒充在线生产更新。

像素与原始日志见[证据目录](evidence/v2-plugin-architecture)：[简洁卡片及 PNG](evidence/v2-plugin-architecture/plugin-cards-with-png.png)、[外部包审批前](evidence/v2-plugin-architecture/external-package-awaiting-approval.png)、[深色 200% 窄窗](evidence/v2-plugin-architecture/native-dark-760-200.png)、[卸载更新插件后的恢复](evidence/v2-plugin-architecture/recovery-without-updates.png)。另有[迁移重启](evidence/v2-plugin-architecture/migration-after-restart.png)、[窗口化选区](evidence/v2-plugin-architecture/windowed-live-selection.png)和[无需 resize 的首次结果](evidence/v2-plugin-architecture/first-result-without-resize.png)。[原生索引](evidence/v2-plugin-architecture/native-summary.json)区分完整流程、补验和保留失败。原生截图为真实 X11 像素，不以浏览器视口模拟原生缩放。

## 源码与身份

最终实现提交 `097d6735086927d6075c1d32b32a588284542303` 已推送隔离分支并核对远端 SHA。GitHub 返回 author/committer 均为 `LarryZhu-dev`（ID 40397402），提交身份为 `LarryZhu-dev <larryzhu@foxmail.com>`。源码提交保持请求禁用；其后仅修改请求文件的 `db9be7d8456e0e5e3588d578b7226380ab13e90e` 启用本轮构建，精确引用已验证源码。仓库旧 hooks 引用缺失的工具，本轮按既有授权仅在提交命令设置 `SKIP_SIMPLE_GIT_HOOKS=1`，没有修改 hooks；实际检查记录见前文。

## Windows 交付授权与剩余边界

用户本次明确接受离线 Evergreen Runtime 条款，并新增一轮 artifact 上传额度：总量不超过 256 MiB、保留不超过 1 天、额外费用不超过 US$0.01（税费另计）。旧标准包额度保持已消费。本轮独立请求 `windows-plugin-offline-2026-10-15-01` 默认关闭；最终代码提交验证后，启用提交只能改该请求，且需要精确 reviewed source SHA 和两个触发标记。

首轮 Windows run [38678616137](https://github.com/Auto-Plugin/milkup/actions/runs/38678616137) 已通过 1090 项工作区测试、类型检查和 44 项构建辅助测试；Rust 测试 exe 编译成功后在进入 harness 前以 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND` 退出，故整个任务失败。上传未运行，API 确认 artifact 为零，预算未消费；此失败不能计入 Rust 或 Windows 安装验收。

诊断 run [38679750892](https://github.com/Auto-Plugin/milkup/actions/runs/38679750892) 保留失败且 artifact 为零。实证显示库测试 exe 直接导入 `comctl32.dll!TaskDialogIndirect`，默认系统 DLL 不导出它，原 exe 无 manifest resource。临时副本仅补 Common Controls v6 manifest 后，77 项 Rust 测试通过、1 项既有忽略；该副本只用于对照，不替代原始测试门禁。依赖资源工具只把默认 manifest 链接到 binary targets，漏掉 lib harness，故需正式修正 Windows MSVC 的 manifest 链接配置。

上传前门禁检查六个文件：一个未签名 Windows x64 NSIS、两个独立插件包、manifest、SHA256SUMS 和 README。裸文件总量不超过 255 MiB，为 ZIP 留余量；单 artifact、一天保留、不覆盖、不创建 Release 或 cache。实际 run、artifact 字节和到期时间待执行后记录。费用依据于 2026-10-15 核对 [GitHub 官方计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)：公共仓库标准 runner 免费，超额 artifact 存储为每 GiB/月 US$0.25、按小时累计。即使不使用免费额度，256 MiB 保留一天按最短 28 天月估算约 US$0.00224（税前；尚非实际账单），低于本次 US$0.01 上限；本流程不生成 cache。

Linux 和 Chromium 不能替代 Windows 实机验收。真实 Windows 更新安装/重启、缺 Runtime 机器安装、IME、读屏、DPI/多屏及完整升级矩阵仍需实机验证；本轮不生成真实发布密钥，不部署更新渠道，不合并 main/v2/质量分支。
