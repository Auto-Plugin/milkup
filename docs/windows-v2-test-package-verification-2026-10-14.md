# Windows v2 测试包原生验证（2026-10-14）

> 后续用户明确要求自行安装试用，不再把自动化安装／启动闭环作为交付前提；已批准本次全部上传 ≤50 MiB、保留 ≤7 天、额外存储费用 ≤US$0.01。交付构建 [38525193345](https://github.com/Auto-Plugin/milkup/actions/runs/38525193345) 对应 `8909f2fa9c1615e7e9e9b525d3f135be1446b892`，只构建并上传一次安装器及小型校验说明，不执行安装诊断。已成功上传并下载校验，链接及实际到期时间见下。

## 已交付下载

[下载 Windows x64 试用包（需 GitHub 登录）](https://github.com/Auto-Plugin/milkup/actions/runs/38525193345/artifacts/11876145389)。实际到期时间：**2026-10-21 07:04:13 UTC**。

- 构建源码：`8909f2fa9c1615e7e9e9b525d3f135be1446b892`，应用配置版本 0.1.0，v2 质量工作分支。
- 未签名 NSIS 安装器：2,263,872 字节，SHA-256 `5edaa1e9b7e74421876653f9381f22d345c8322b0e9816501ae0c42d60a375ec`。
- ZIP：2,267,642 字节，SHA-256 `bb96ac16b925f197bfb9f7eef39c38b083ed8bbafd0455307a303b36f7fc753d`。共四文件：安装器、README、manifest、SHA256SUMS。
- 本次总上传为一个 artifact，低于 50 MiB，保留 7 天，无 cache 上传、无 Release／标签／主分支合并。共享余额／实际账单仍无读取权限，不宣称零存储费用；按授权体积和期限执行。上传请求随后设为 disabled/consumed，不自动再上传。
- 最终 Windows 前端 831、类型检查、Rust 69／忽略 1、字节校验 5、构建树检查 4 通过；成功构建不等于安装／启动／编辑验收。依用户要求，本次未执行自动安装。
- 已通过授权 GitHub connector 实际下载，核对 ZIP digest、完整安装器 SHA-256、SHA256SUMS、四文件集合和源码 SHA。CLI 直连 Azure blob 曾返回 403，connector 下载成功；没有变更凭据／安全设置。

最终构建树记录中，`git diff --name-only HEAD` 与 untracked 列表均为空，但 `git status --porcelain` 仍显示 Cargo.toml、desktop-schema.json、windows-schema.json 为 modified；两份原始结果均保留在 manifest 与日志中，不将此记录改写成完全干净的 status，也不推断第一次失败具体修改了什么。交付以固定 checkout SHA、锁文件构建和最终安装器字节哈希为标识。

交付核验见 `docs/evidence/windows-v2-package-prep/download-verification.json`、`artifact-metadata.json`、`windows-delivery-02.json` 及原始日志。本地另保留下载的完整 ZIP 和四文件副本于 `/workspace/.milkup-v2-windows-delivery/11876145389/`。

以下保留前六次验证及失败历史，不将其未通过项改记为通过。

Windows x64 未签名 NSIS 安装包已在标准 GitHub-hosted runner 构建，静默安装及安装后完整字节校验通过；启动／编辑保存闭环仍失败，尚未交付下载。用户已接受公开日志／测试包与未签名状态；当时额外费用未获授权，组织共享存储余额查询返回 403，因此前六次 workflow 无 artifact 上传、无 Actions cache，仅记录日志。前六次运行均未上传包。后续单次上传已获明确预算授权，见页首。

## 实际运行与修正

| 运行                                                                          | 精确源码                                   | 结果                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [38515743781](https://github.com/Auto-Plugin/milkup/actions/runs/38515743781) | `41e7acca235489d746aea5da57f796fd0448a032` | Windows 前端 831 通过，类型检查通过；Rust 66 通过、2 失败、1 忽略；未进入打包。                                                                        |
| [38516379696](https://github.com/Auto-Plugin/milkup/actions/runs/38516379696) | `0146389aa29743ff5c5baa5982feb900089c90e4` | Windows 前端 831 通过、类型检查通过；Rust 69 通过、1 忽略；NSIS 构建成功、安装器退出 0；直接比较 EXE 哈希的旧验收失败，尚未启动应用闭环。              |
| [38517660167](https://github.com/Auto-Plugin/milkup/actions/runs/38517660167) | `ae2cfa46e18059bdbed9ca9b52afa8f43a86a1eb` | 安装器退出 0；安装后 EXE 全部字节、x64 与未签名状态通过；首个 WebDriver 会话请求 45 秒超时，尚未进入编辑／保存。                                       |
| [38518996976](https://github.com/Auto-Plugin/milkup/actions/runs/38518996976) | `f487172895cb993930b0a060356036abde2da6c8` | 全部源码检查及安装字节校验通过；原生驱动报 `DevToolsActivePort file doesn't exist`，未进入编辑／保存。                                                 |
| [38520387826](https://github.com/Auto-Plugin/milkup/actions/runs/38520387826) | `bc502a8b1f55603d1d89b41c3d55151d7bbdd483` | 前端 831、类型检查、Rust 69／忽略 1、二进制校验回归 5 通过；安装退出 0 且安装后字节一致；直接启动后 60 秒未出现 WebView2 调试端口，0／4 编辑闭环完成。 |

首跑发现两个具体问题，未跳过失败测试：

- 原生搜索私有临时目录仅依赖进程 ID 和墙上时钟，Windows 重复时钟 tick 会撞名。现在加原子序号并在目录已存在时最多尝试 16 次，不覆盖／删除碰撞目录。新增固定相同时钟值且预置已有证据目录的回归；Linux 原生搜索 12 项通过。
- 插件路径测试错误地把 Windows `RUNNER~1` 短路径与规范长路径按字符串比较。断言改为真正的 `canonicalize` 结果，生产路径逻辑未改；Linux 针对性测试与下一轮 Windows 全部 Rust 测试均通过。

第二次发现验收合同与 Tauri bundler 不一致。锁定的 tauri-cli 2.11.4 使用 tauri-bundler 2.9.4，它在打包前把主 EXE 的 `__TAURI_BUNDLE_TYPE_VAR_UNK` 标记改为 `NSS`，打包后恢复构建目录中的原始 EXE。因此不能要求安装后文件直接等于恢复后的原始文件。修正只接受这次明确替换后的**全部字节完全一致**，拒绝重复／缺失标记、其他字节变更、截断及错误包类型；记录原始／预期／实际三个 SHA-256，输入 EXE 限 64 MiB，不修改任何 EXE。5 项校验回归通过。CLI 版本变动会停止，要求重新审阅合同。[固定版本源码](https://github.com/tauri-apps/tauri/blob/8909f221d1515955fc843808032bdc5d62209c96/crates/tauri-bundler/src/bundle.rs)

已下载的官方 CLI／bundler crate 均按 crates.io 校验和验证；来源、版本及 SHA-256 见 `docs/evidence/windows-v2-package-prep/bundler-contract.json`。第三次已实际通过全文件比较：预期及实际安装后 SHA-256 都为 `ff844db84af0945cef3779c8a0a17b1991b40f7f1e44852b9588eb818055c203`。这不是对第二次包的追认，各次包独立留存哈希。

第三次使用已验证 Microsoft 签名的 EdgeDriver，与 WebView2 runtime 精确匹配为 `153.0.4234.48`；文件关联前后值已记录。但 tauri-driver 转发的首个会话请求在 45 秒超时，尚无 DOM 或编辑证据。读取 tauri-driver 2.0.5 的实际源码确认 Windows 转发的 capabilities，并确认它丢弃原生驱动 stdout。第四次使用相同 capabilities 直接运行 EdgeDriver，增加 verbose 日志及失败时应用进程／窗口／崩溃事件记录，只有创建会话的等待上限改为 90 秒，以取得原生驱动错误；不改变应用、安全配置或字节验收标准。

第四次原生日志显示 EdgeDriver 将 Markdown 路径变成 `--d:\...` 开关，并在等待 DevToolsActivePort 约 60 秒后终止应用。第五次采用 Microsoft 文档的 WebView2 attach 模式：直接传入字面文件参数启动安装后 EXE，每次使用独立 profile、固定到 loopback 的调试端口，再通过 `debuggerAddress` 连接；同时保留应用 stdout／stderr、PID、退出码、启动参数及 DevTools 元数据。没有关闭浏览器或系统安全策略。[Microsoft WebView2 WebDriver 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver)

第五次实际失败发生在 `installed WebView2 startup on loopback`，还没有发出 WebDriver `POST /session`。应用 PID 8008 从 `06:16:42.272Z` 持续到测试在 `06:17:42.370Z` 清理时发出 SIGTERM；没有提前退出记录，应用 stdout／stderr 为空。没有 DevTools 元数据、DOM、可信输入或保存闭环证据。PowerShell 在 Node 清理之后记录的进程列表及 Application 错误事件为空，不能据此宣称应用未启动、无窗口、无崩溃或根因已定位。该结果排除了“仅因 EdgeDriver 改写文件参数”的单一解释，但无法区分应用原生启动与 hosted runner 的 GUI／WebView2 自动化环境问题。停止扩展矩阵，没有继续增加超时或修改系统策略。下一次诊断应先在清理前保留目标进程窗口／子进程状态，再判断修复路径。

## 第五次历史包的证据（未交付）

- 精确源码：`bc502a8b1f55603d1d89b41c3d55151d7bbdd483`，以阶段 21 的 `a73131e4b46f88fa85f2f59f1c4ae3f75d16d778` 为祖先。
- 文件：`milkup_0.1.0_x64-setup.exe`，2,261,669 字节（约 2.16 MiB）。
- 安装包 SHA-256：`cda8d87a76cd0445dd4a4cff6c8733382e42b464425ec87d7bb36f9d58d1580c`。
- 安装包、原始 EXE 及安装后 EXE 签名状态均 `NotSigned`。
- 原始 EXE：10,181,120 字节，SHA-256 `8296bff69a667b192a7edf1b4115cf39236c9c502aee1a02444f03a96a1734b7`。
- 安装后 EXE：PE machine `0x8664`，预期／实际 SHA-256 均为 `f468199e5e6cd2776e302dbffe872f4d3a88cccbb361d83e2e8ad216b0d41205`；除 Tauri 已审阅的包类型标记转换外全部字节一致。
- 环境：Windows Server 2025 build 26100，`win25-vs2026 / 20260925.250.1`；Node 24.19.0、pnpm 11.7.0、Rust 1.99.0；WebView2／EdgeDriver 153.0.4234.48，驱动 Microsoft 签名有效。
- 该次临时 VM 未上传包；以上为日志内真实构建记录，不是可下载安装包，也不能替代下一次候选包自己的哈希。

## 费用与交付路径

`Actions permissions` 与组织 billing usage／summary 的只读查询返回 403，但精确分支 push 已实际成功触发五次标准 Windows 工作流，说明管理查询权限与运行权限不同。未扩大凭据或绕过管理限制。Git／gh 曾短暂返回 401，后续正常远端读取及 push 恢复，未新增凭据。各已推送 commit 的 GitHub author／committer 都核验关联 `LarryZhu-dev`，本仓库身份保持 `LarryZhu-dev <larryzhu@foxmail.com>`。

标准公开 runner 的运行免费；日志不计入 artifact 存储，但不能推导 artifact 免费。用户随后已一次性批准 GitHub 共享存储费用，采用**一次上传总量不超过 50 MiB、最多 7 天自动到期、额外费用上限 $0.01（税费另计）**的方案：官方单价 $0.25/GiB/月，以 28 天月份保守计算该体积／保留时间约 $0.00306。实际 NSIS 目前约 2.16 MiB；上传总量仍需计入 ZIP 与清单，超过硬限则停止。用户于 2026-10-14 06:37:47 UTC 同意父线程确认的该预算，取代先前 256 MiB／1 天提案。只允许一次小型上传，不开启缓存、不使用付费 runner 或订阅；上传前原始四文件合计不得超过 49 MiB，为 ZIP 开销保留 1 MiB。该授权不是更改 GitHub 账户级支出配置。[GitHub 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、[保留时间设置](https://docs.github.com/en/actions/tutorials/store-and-share-data)

用户选择亲自试用后，启动闭环不再是交付前提。交付包只要求成功构建、明确未签名状态并保留 SHA／大小／哈希和未验说明；包含安装器、manifest、SHA256SUMS 及 README 四文件，下载后再次核验。不会把二进制编码进日志、提交到源码仓库或使用未授权外部存储来绕开这项费用确认。

## 范围与证据

当前只在全新 GitHub-hosted VM 的已有 runner 用户中执行 `currentUser` 安装，使用唯一临时目录，记录相关 HKCU Markdown 文件关联变化。不修改安全设置，不自动确认安全警告。供应商 Windows runner 默认管理员／UAC 设置与普通桌面不同，静默安装不算 SmartScreen／UAC 人工验收。

安装后原定验证普通／1 MiB、source／live 四例（本轮实际完成 0／4），含中文文件名、中文与 emoji 内容、CRLF，真实 WebDriver 输入、保存、撤销／重做、关闭会话、重开及完整字节比较。当前脚本关闭方式是保存字节确认后 detach WebDriver 并终止自己启动的进程，不代表正常关闭 UI 或未保存关闭对话框验收。真实 IME、Word 2016、辅助技术、DPI／多屏、原生文件选择器、未保存关闭对话框和普通 Windows 用户交互安装仍待外部验收。

原始日志及结构化结果保存在 `docs/evidence/windows-v2-package-prep/windows-validation-01.*`、`windows-validation-02.*`、`windows-validation-03.*`、`windows-validation-04.*`、`windows-validation-05.*`、`windows-validation-06.*`；没有删除失败证据或旧恢复数据。没有改 main、合并 v2、创建标签或 Release。

本地容器曾短暂 transport disconnected，随即重连；仓库、格式／语法检查和 5 项字节校验回归恢复正常，工作区磁盘仍约 19 GiB 可用。该中断没有终止远端 CI，也不是本次 Windows 启动阻塞的归因。

## 第六次清理前诊断（后续不再扩展）

[run 38522362027](https://github.com/Auto-Plugin/milkup/actions/runs/38522362027)，源码 `bc9f0d7f8af5beac8c70ee9ef5292e38dfda6d1d`。前端 831、类型检查、Rust 69／忽略 1、字节校验回归 5 通过。产品进程 PID 7584 在清理前 responding=true，存在可见的 `milkup` Tauri Window（1044×769）及可见 WRY／Chrome 子窗口，WebView2 浏览器、GPU、renderer 等子进程存在，独立 profile 已创建；没有监听端口及匹配 Application 错误事件。实际浏览器命令行没有请求的 remote-debugging 参数。证据支持“产品已创建原生窗口及 WebView2，自动化入口不可用”，仍不等于编辑保存通过；4 例仍为 0／4。

最小 Tauri 对照于启动约 48 ms 后以 3221225785 退出，未进入可观测 stdout／stderr、没有窗口／profile，因此该对照自身未成功，不能用它证明环境或产品正常。所有退出状态、窗口枚举、子进程与事件原始结果已归档。用户随后选择直接下载、自行安装试用，本轮不再为诊断新增运行。

## 用户试用交付的构建检查修正

首次交付构建 [38523846474](https://github.com/Auto-Plugin/milkup/actions/runs/38523846474) 已通过前端 831、类型检查、Rust 69／忽略 1、5 项字节校验回归，并成功生成 2,263,872 字节未签名 NSIS；未执行自动安装。上传前的笼统 `git status` 检查失败，旧错误没有记录变动路径，上传步骤跳过，API 核验 artifact=0。不能将这个失败归为编译或启动失败。

新检查只准入 Tauri 已知四个 `gen/schemas` JSON 输出，逐个核对普通文件／大小／合法 JSON 并记录 SHA-256；其他 tracked 修改或 untracked 文件一律失败，并保留 git status。不恢复或删除生成文件，不隐藏源码差异。新增 4 项回归覆盖干净树、已知输出、源码修改、未知文件和非法 JSON，与原有 5 项字节校验共 9 项本地通过。新的构建沿用同一上传请求及总预算；此前未上传，不是每次重试获得一份预算。
