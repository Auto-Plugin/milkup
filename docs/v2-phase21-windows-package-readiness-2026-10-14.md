# Windows v2 测试安装包：只读核查与下一交付里程碑

> 后续已从第 21 阶段最终 SHA 准备独立、未启用的 Windows 工作流与安装验收脚本。具体补丁、静态检查和待确认执行范围见[测试包方案](./windows-v2-test-package-plan-2026-10-14.md)；以下保留为最初只读核查记录。

> 用户随后批准公开日志／测试包与未签名状态。已运行的 Windows 原生构建／安装结果、失败证据和交付边界见[Windows 实测报告](./windows-v2-test-package-verification-2026-10-14.md)。

用户要求在下一交付里程碑拿到可安装的 Windows v2 测试包；不等待所有 Typora 体验差距关闭。本阶段性能／恢复安全修复完成后接续制作，不把 Linux 二进制当成 Windows 包。此报告仅记录只读核查，未触发 CI、推送标签、创建 Release、上传安装包或新增凭据。

## 当前路径

- 专用分支基线 `bba85ef6dd78a4a826e2300c1f56968371807f6f` 无 `.github/workflows`。
- `apps/desktop/src-tauri/tauri.conf.json` 已配置 Tauri 2 NSIS、`currentUser` 安装、Markdown 文件关联与 ICO；`nsis-hooks.nsh` 写入／移除文件关联图标注册表项。安装测试必须记录这些副作用，使用隔离 Windows 用户／VM。
- 当前配置没有 Authenticode 证书、thumbprint 或签名命令；未读取秘密或猜测账户是否另有证书。若按当前配置构建，只能交付明确标注未签名的测试包，并实际检查签名状态。不能为消除提示而修改系统安全设置。
- 只读 GitHub API 确认仓库为 public、默认分支 main。main 的 [release.yml](https://github.com/Auto-Plugin/milkup/blob/main/.github/workflows/release.yml) 使用 `windows-latest`，但构建的是 Electron，pnpm 10.13.1，与 v2 不匹配。它由 `v*`／`Beta*` 标签触发，后续 `create-release` 会创建公开 GitHub Release。不能复用它制作本次私下测试包。
- main 另有贡献者欢迎工作流，无现成 v2 Windows 测试包流程。通用 fetch 接口拒绝 workflows 集合端点；上述结论来自成功读取 main 的 `.github/workflows` 目录和 release.yml 内容，不冒充已经成功触发／跑通 Windows CI。

## 最小可行方案及执行前需核实的范围

独立 Windows x64 原生构建任务，固定第 21 阶段最终 commit SHA，使用仓库锁文件、pnpm 11.7.0、Tauri CLI 与 MSVC Rust。先执行适用 Rust／前端检查，再生成 NSIS `.exe`。在隔离 Windows 用户／VM 安装、启动安装后的程序，验证基本打开／编辑／保存／关闭及重开；记录 OS、WebView2、执行日志与实际文件字节。CI 构建成功本身不能算安装启动通过，更不能算中文 IME 通过。

该任务应只有仓库读取权限，不创建标签／Release，不运行 Electron release 脚本，不上传第三方服务，不新增长期 token、签名证书或持久授权。使用标准 GitHub Windows runner 的账户策略、可用额度与计费尚未核验，不能预先宣称零费用。

公开仓库的 Actions 日志／产物不能自动视为私密交付。父线程需在执行前核实可用的独立 Windows 执行路径及私下下载渠道；可选已授权的私有构建环境，或明确确认可接受的 CI 产物可见性与后续私下交付方案。本阶段不在主分支安装新的 workflow，也不绕过默认分支的 dispatch 要求。未发现可直接、安全触发的现成 v2 流程，这是当前具体缺口，而非 Linux 交叉编译的承诺。

## 交付验收记录

交付时必须附最终 commit SHA、安装包文件名／大小／SHA-256、Windows 与 x64 架构、实际签名检查结果、安装后程序路径与二进制哈希、实际安装／启动／基本文件闭环结果，以及未验／失败项目。真实 IME、Word 2016、DPI／多屏、辅助技术、跨平台锁与完整磁盘故障继续单列；任何未运行项目必须写未验，不能继承旧版本的 Windows 勾选。
