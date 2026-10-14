# v2 云环境适配（2026-10-13）

> 2026-10-14 第二十一阶段在新容器 fetch 并精确核验 `bba85ef6dd78a4a826e2300c1f56968371807f6f` 后接续，使用有界分片快照与工作文件租约，将完整恢复正文写出移出文档锁。同容器生产对照、并发／中断证据及仍未达标项目见[第二十一阶段报告](./v2-phase21-snapshot-streaming-verification-2026-10-14.md)；下一里程碑 Windows 测试安装包的现有 CI 副作用和交付缺口见[安装包准备](./v2-phase21-windows-package-readiness-2026-10-14.md)。

> 2026-10-14 第十八阶段新增恢复目录准入配额、可见写入失败及外部副本导出，并完成暗色、原生整 UI 125/150/200% 缩放与窄窗改进。真实支持范围、故障证据及剩余门槛见[第十八阶段报告](./v2-phase18-storage-appearance-verification-2026-10-14.md)。

> 2026-10-13 第十七阶段新增异常退出恢复点、校验后副本恢复与保留式归档，并完成生产中断／重启证据；准确支持边界见[第十七阶段报告](./v2-phase17-recovery-verification-2026-10-13.md)。

> 2026-10-13 第十六阶段继续使用本地生产二进制和 X11 系统截图核对键盘与视觉状态；不变更安全设置、不重复安装 IME。见[第十六阶段报告](./v2-phase16-visual-keyboard-verification-2026-10-13.md)。

> 生产构建补验：[第十五阶段报告](./v2-phase15-production-verification-2026-10-13.md)记录关闭开发服务器后的 release 二进制、`tauri://localhost` Worker、真实 IPC 与磁盘闭环。网络安全配置未改变；系统截图与 WebDriver 截图差异单独留证。

> 干净环境对照：本轮新建环境仍默认检出旧 `f713d91`，已安全恢复专用分支 `cefe9e4157ef7bcd909ee273004595f3b832e075`。真实原生启动／回归可用，系统 IBus 会话仍阻塞；精确时序、验证边界及最小下一步见 [第十一阶段报告](./v2-phase11-clean-environment-verification-2026-10-13.md)。以下旧阶段安装与配置记录保留，不当作最新测试结果。

> 后续原生云环境补验：当前已能加载用户级 GTK/WebKitGTK 并实际运行恢复后的专用分支；下面的缺库结论是旧容器历史记录。准确环境、恢复 SHA、Rust runner 退出码问题及 GTK 选择器限制见 [第四阶段报告](./v2-phase4-native-safety-verification-2026-10-13.md)。

## 结论与发布状态

当前执行容器可以直接开发、安装依赖和测试，不依赖产品发布。云环境 setup 的保存／发布是平台的另一项操作；本次可用工具没有该配置的查询、保存或发布接口，因此**无法核验平台配置发布状态，也未发布环境或产品**。

本次交付的是仓库内可追踪的 setup／启动草稿及当前容器的安装结果。脚本进入未来容器需要在环境配置界面引用这些文件；本地提交不会自动更新平台配置。旧 `/workspace/.cloud/milkup/setup.sh` 保留未改，它是 main 的 Electron 专用脚本，依赖 `vite.config.mts`、`src/renderer`、Electron build 脚本，不能用于 v2。

## 实际架构与环境

| 项目         | 检查结果                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| 仓库／分支   | `Auto-Plugin/milkup`，远端既存 v2 的 `f713d91`；本地 v2 跟踪 origin/v2                                         |
| 应用         | Tauri 2 + Rust；Vite + TypeScript 自研 Markdown 内核，15 个 pnpm workspace 项目                                |
| Node         | 已有 24.19.0；setup 以 Node 22+ 为支持范围                                                                     |
| pnpm         | v2 packageManager 声明 11.7.0；系统默认命令是 11.25.0；新脚本通过 Corepack 固定使用项目声明版本                |
| Rust         | 初始没有 cargo/rustc；已从官方 Rustup 安装 1.99.0 minimal 到 `/workspace/.cache/milkup-v2`，不改 shell profile |
| 浏览器       | `/usr/bin/chromium` 可运行；Playwright 支持显式选择该路径，默认 Edge 配置保留                                  |
| 系统库       | 缺 GTK3 / WebKitGTK 4.1 / JavaScriptCoreGTK / libsoup 开发包                                                   |
| 安装权限     | 当前 uid 1000，无 sudo；apt 实际失败于 dpkg lock 的 Permission denied                                          |
| 原生测试脚本 | 现有 `tests/native/tauri-webdriver-smoke.mjs` 硬编码 Windows GNU exe 和驱动，不能直接当作 Linux 原生测试       |

Rust 版本依据本次读取的官方 stable manifest（2026-10-01，1.99.0）。系统依赖依据 [Tauri 官方 prerequisites](https://v2.tauri.app/start/prerequisites/)，安装源为 [Rustup](https://rustup.rs/) / `sh.rustup.rs` / `static.rust-lang.org` 和 Debian 签名软件源；未新增凭证、外部仓库或更改安全设置。

## 可复用 setup 和启动

在**已有的 v2 checkout**执行；脚本不创建或切换分支，不修改锁文件，不发布：

```bash
bash scripts/cloud/setup-v2.sh frontend
bash scripts/cloud/start-v2.sh frontend
```

前端入口是 `http://127.0.0.1:1420`。根目录 `pnpm dev` 启动的是 playground，不能当作桌面前端入口。前端使用浏览器内存文件适配器；“保存成功”不等于操作系统文件落盘。

验证命令（同样固定 pnpm 版本）：

```bash
bash scripts/cloud/pnpm.sh test
bash scripts/cloud/pnpm.sh typecheck
bash scripts/cloud/pnpm.sh lint
bash scripts/cloud/pnpm.sh build
MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium bash scripts/cloud/pnpm.sh test:e2e --workers=2
```

管理员维护的 Debian/Ubuntu 镜像需安装以下原生前置依赖；**本容器未完成这一步**：

```bash
apt-get update
apt-get install -y --no-install-recommends \
  build-essential pkg-config curl ca-certificates file \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  xvfb xauth dbus-x11 webkit2gtk-driver fonts-noto-cjk
```

再执行：

```bash
bash scripts/cloud/setup-v2.sh native
bash scripts/cloud/start-v2.sh native
# 无桌面会话的 CI 可使用 Xvfb + D-Bus；不关闭 WebKit sandbox。
# xvfb-run -a dbus-run-session -- bash scripts/cloud/start-v2.sh native
```

`setup-v2.sh native` 安装／复用用户级 Rust 并检查原生库；缺库退出 2。`start-v2.sh native` 同样显式报缺库。原生模式在系统库安装后仍须重新执行真实 Tauri 构建和原生窗口测试，当前不声称已通过。Linux 原生自动化还需适配 WebKitWebDriver / tauri-driver 和 Linux 可执行文件路径；真实系统 IME 必须另行验收。

## 当前验证与持久化边界

- frontend setup 连续执行两次：安装锁文件依赖、构建、类型检查均通过，锁文件未变化。
- native setup / start 缺库检测：均按预期退出 2，日志指明 WebKitGTK 缺失。
- Rust `cargo check --locked` 已实际进入编译，随后在 `gobject-2.0` 等 GTK 开发库缺失处失败（exit 101），不是通过。
- 原始 Tauri dev 启动实测：初始报 `cargo metadata ... No such file or directory`；用户级 Rust 已补齐。
- apt 安装尝试失败：无系统写权限；未通过更改权限、凭证、安全配置绕过。
- Rust 和 Corepack 缓存只在当前 workspace 可见；未来环境是否保留缓存取决于平台挂载，脚本不依赖缓存必然存在。
- 后续应把默认 checkout 设置为**已存在的 v2**，setup 引用本文件的脚本，在管理员镜像层补齐系统库。配置发布由平台界面管理，本次未执行。

## 本项目后续提交身份（2026-10-14）

用户要求后续提交关联真实 GitHub 账号。已通过已连接 GitHub 的 authenticated profile 核验 `LarryZhu-dev`（numeric ID `40397402`，显示名 Larry Zhu）。本仓库配置：

```bash
git config --local user.name LarryZhu-dev
git config --local user.email larryzhu@foxmail.com
```

原仓库未设 local identity，继承全局名称 Larry；最近基线提交在 GitHub 的 author.login/committer.login 均为空。用户随后明确要求使用绑定邮箱 `larryzhu@foxmail.com`，该邮箱已与 authenticated profile 一致核验，取代临时 noreply 建议；没有使用临时 noreply 创建提交。只改本仓库，不改全局，不伪造 Codex 官方身份。提交前检查 `git var GIT_AUTHOR_IDENT` / `git var GIT_COMMITTER_IDENT` 及四个 `GIT_AUTHOR_*`/`GIT_COMMITTER_*` 身份变量；若环境覆盖，仅在本项目该次提交显式设置正确值。正常推送后用 GitHub commit API 核验 author.login 与 committer.login 均为 `LarryZhu-dev`，不能只检查本地 config。已推送历史保持不变，禁止为改署名 amend/重写历史/强推。
