# Windows 标准版交付与通用插件预装（2026-10-15）

从已验收本地集成 `3162d56f8adbf66fbd4c5631a8e71e8ad8723a51` 创建独立分支 `dot/milkup-v2-windows-delivery`。保留七项视觉修复与独立大纲 1.2.0；不合并 main/v2/quality，不创建 Release，不签名，不使用付费 runner。

## 本次范围与 WebView2 调查

用户最新指令限定本次交付小体积标准 Windows x64 NSIS 和独立大纲包。`tauri.conf.json` 未配置 `webviewInstallMode`；构建脚本也没有传覆盖配置，故使用 Tauri 默认 `downloadBootstrapper`。缺 Runtime 时需要目标电脑联网下载并安装，包内不含完整 Runtime。旧 Windows runner 已有 Runtime，旧验证不能证明缺 Runtime 的电脑上安装成功。没有用户电脑的安装日志，不能把具体报错归因于网络、权限或 Runtime 注册损坏。

本次不修改这个模式，不下载或接受新的 Runtime 许可，不构建 offlineInstaller/fixedRuntime。未来正式整合 main 时，可另提供包含 Evergreen 安装程序的离线选项，同时保留标准小包；这只是后续方案，不是此次 main 合并授权。官方大小参考：内嵌联网引导程序约 2 MB，离线 Evergreen 约 127 MB，实物以当次 Microsoft 版本及生成文件为准。[Tauri 安装方式](https://v2.tauri.app/distribute/windows-installer/)、[Microsoft 分发说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。

## 通用预装行为

构建阶段将独立 `.milkup-plugin` 档案作为数据纳入发行版。宿主仅枚举通用档案目录；没有按大纲 ID、命令、DOM 或标题逻辑分支，也没有把插件实现作为宿主模块导入。安装仍走原有包解析、用户目录安装、注册、隔离 Worker 和受控 UI。公开 SDK 保持 0.1.1，core 公共 API、共享 CSS、文档保存/恢复实现未改变。

默认安装仅发生一次：先持久化已处理 ID，再尝试安装。已有同 ID 记录保持原版本和启用状态，不自动升级或降级。用户禁用后重启保持禁用；用户卸载后重启或升级应用不自动装回。只读文档 Worker 才允许默认启用；敏感权限和 sidecar 不自动批准。损坏的处理记录不会被清除后重新安装；存储写入失败会阻止默认安装并在当前插件失败列表显示，避免阻塞编辑器启动。安装中断或失败后可从普通安装入口手动重试。

独立档案与预装数据使用相同字节：`milkup.outline-1.2.0.milkup-plugin`，40614 字节，SHA-256 `e2f0cf02232251bdb32f3775cee820fc592fddae34078e40d8706e195e5dfaa3`。本轮使用锁定的仓库构建工具和 SDK 公共导出构建；与上一轮已验收独立构建的可执行内容一致，仅 esbuild 的 SDK 来源路径注释不同。未改变大纲实现。Library：`libfile_d99352c43fec819185ab107651be96de`。

## 工作流与费用边界

新增专用分支工作流，保留旧质量分支的已消费请求不变。新请求绑定上述精确基线、单次 request ID、提交消息、首次 run attempt、公开仓库及标准 windows-2025 runner。只允许五个文件：安装器、同字节独立插件、manifest、SHA256SUMS、README。原始文件合计不超过 49 MiB，为上传 ZIP 留 1 MiB；一次 artifact 总量上限 50 MiB，保留 1 天，无 cache、Release 或额外存储服务。

父线程正在向用户申请新的总额含税不超过 US$0.01 预算；旧预算已消费，不能复用。按 GitHub 官方 $0.25/GB/月、28 天月份保守估算，50 MiB/1 天约 $0.00044（税前），实际账户余额及账单不可读取。当前仅启用免费标准 runner 的无上传验证，安装器大小与哈希记入日志；产物不留存。待明确授权才切换一次性交付请求并上传。标准公开 runner 分钟免费不代表 artifact 存储无费用。[GitHub 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

## 验证记录

新增预装回归先记录 7 项失败；实现后扩展为 10 项并全部通过（含首次预装与主动安装的顺序）。全仓单元测试 1007 项通过；最后增加安装顺序回归后，受影响桌面 144 项通过。大纲 24 项、Windows 构建树/二进制工具 9 项通过；Rust 75 通过，1 个既有性能基准忽略。类型检查、全仓构建、格式检查和 Chromium 浏览器 79 项通过。生产 Linux deb 重建并解包运行；原生与浏览器最终结果在完成后补记。

完整当前证据位于 `/workspace/milkup-windows-delivery-evidence`。Linux 原生结果不代替 Windows/WebView2、真实系统 IME 或用户桌面安装验收。Windows 下载件的实际大小、SHA、构建 run 和上传结果须待实际生成后记录，不能以旧包替代。

提交身份已通过 GitHub authenticated profile 再次核验为 LarryZhu-dev（40397402），邮箱 larryzhu@foxmail.com。沿用已有单次 `SKIP_SIMPLE_GIT_HOOKS=1`：旧 Electron hooks 调用 v2 不存在的 lint-staged 配置/提交脚本，未修改 hooks 或安全设置，以本轮实际检查为准。
