# 第十二阶段：独立输入安全闭环与分批长文矩阵（2026-10-13）

## 结论与边界

从干净的 `4aa90ad3472ff7abc1d64de6f33adfb71b4fb0c7` 接续，分支仍为 `dot/milkup-v2-quality`。第十一阶段已核验的恢复基点为 `cefe9e4157ef7bcd909ee273004595f3b832e075`；未回到配置旧基点，未改旧环境、合并 v2、强推或发布。

**修复了已有文件保存期间真实键盘输入丢字，并完成独立 CLI + XTest 的保存／历史／磁盘闭环。** 175 KiB、1/10/100 MiB × 短/长行 × source/live 的串行样本均已执行，但长行跳转超标，且 100 MiB 短行末尾滚动不可达。真实中文 IME 仍未验收。这些问题阻止将整体认定为 Typora 级质量。

## 丢字证据与修复

修复前在正常 CLI 打开的原生窗口化文件上，以 XTest 无人为按键间隔发送 `a × 20 → Ctrl+S → b × 20`。起点 UTF-16 head 为 14，全部 20 个 `b` 的可信 keydown 均已到达，最终 head 只有 53，正文只有 19 个 `b`；第一个 `b` 到达时 `saving=true`、输入代理只读。

- [最终完整事件证据](./evidence/v2-phase12/red-direct/burst-final.json)、[复现脚本](./evidence/v2-phase12/red-burst.py)。早期 `burst-result.json` 在事件尚未全部送达时取样，只是诊断记录，最终结论使用 `burst-final.json`。
- 原因：普通保存复用全局输入锁；尚在保存时抵达的按键被输入代理／动作守卫丢弃。
- 修复：已有文件的普通保存允许接收后续输入和撤销／重做。窗口化视图把保存放入已有编辑队列，先提交之前的输入，再写对应版本，之后的输入／历史操作按顺序执行。普通视图按写入前版本记录 savedVersion，后续编辑继续保持 dirty。
- 队列内保存不再次等待自身队列，避免循环等待；文档身份校验、磁盘冲突校验和 watcher 对账继续执行。新文件选择路径、另存为和文档切换确认仍使用原保护流程。

## 独立原生输入验收

`tests/native/x11-save-history.py` 直接用文件参数启动正常 Tauri CLI，使用 XTest 系统按键。`tests/helpers/native-observer-server.mjs` 是显式启动的 Vite 测试服务，只读会话／选区并记录可信事件，没有输入、执行代码或文件修改接口。没有 WebDriver 输入、DOM 合成事件或文件选择器替身。

每种文件在 source/live 各检查：

1. 20 个 `a`、保存、20 个 `b` 连发；保存边界只写入之前的 `a`，之后的 `b` 全部存在且 dirty。
2. 保存后立即撤销结构性 Enter，核对磁盘保留已保存版本、编辑状态恢复且 dirty。
3. 重做、继续输入、保存，检查完整磁盘字节和光标。
4. 三字符反向选区的保存、替换、撤销／重做、继续替换，核对 anchor/head 方向及 UTF-16 cursor。
5. 结束该 runner 的进程组，再由正常 CLI 重新打开，检查文件字节、clean/version 状态和首行末尾光标。

| 文档路径        | 实际初始字节 | source/live | 结果与截图                                                                                                                                             |
| --------------- | -----------: | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 普通 EditorView |        1,048 | 各 5 项     | [状态和结果](./evidence/v2-phase12/x11-small-complete/results.json)、[反向选区](./evidence/v2-phase12/x11-small-complete/source-reverse-selection.png) |
| 内存窗口化      |      179,238 | 各 5 项     | [状态和结果](./evidence/v2-phase12/x11-memory-window/results.json)、[保存后](./evidence/v2-phase12/x11-memory-window/live-saved.png)                   |
| 原生窗口化      |    1,100,058 | 各 5 项     | [状态和结果](./evidence/v2-phase12/x11-native-final/results.json)、[反向选区](./evidence/v2-phase12/x11-native-final/live-reverse-selection.png)       |

每次保存比较全文件 UTF-8 字节（含原有 CRLF）；最终文件长度和 SHA-256 保存在各目录的 `disk-metadata.json`。测试等待 F8 真实事件屏障及预期提交状态，避免把 XFlush 当作 WebKit 完成。Enter 用来提供明确历史边界；相邻普通输入可能合法合并，不要求保存自动切断输入历史。普通视图内部 LF 坐标与窗口化原始 CRLF 坐标分别核对。

夹具修正记录：初版 F24 在 Xvfb 无键位；随后发现事件已送达不代表批量编辑已提交；小文件还暴露了错误的历史合并和 CRLF 坐标假设。失败日志及 JSON 保留，不作为产品失败或通过。最终三组各 10 项完整运行均通过。

## 长文性能：执行完成，验收未全面通过

[环境](./evidence/v2-phase12/environment.json)：Linux、WebKitGTK、Xvfb、软件 GL，debug Tauri + Vite；容器 CPU 配额 4 核、内存上限 16 GiB。全部按小批串行执行，未与全仓测试／构建并跑；运行时检查 cgroup 内存，超过 8 GiB 停止该批。主矩阵最大观测约 3.08 GiB，另行末尾检查约 3.3 GiB；不能把系统耗尽作为这次延迟的解释。

每个大小分别用 64 字节和 4,096 字节正文行生成确定性 CRLF 文件，保留 Unicode 首行；实际字节和行数见原始 profile。每格新应用进程，source/live 分别重新打开文件；每种模式包含首次目标窗口、三轮热往返，以及四次真实按键输入、删除恢复、实际保存和全文件字节核对。跳转到可滚动高度约 65% 后返回开头。175 KiB 长行只有 46 行，source 往返仍在同一渲染窗口，不能称远距离行窗口跳转。

“冷”仅指新应用／重新打开后首次目标窗口，**没有清空 OS 文件缓存**。打开和保存耗时包含驱动往返及状态轮询；输入记录 keydown 到 DOM／两帧，窗口记录滚动、IPC、渲染、两帧和最大 timer gap。原始样本、cgroup CPU／内存及资源时点见 [汇总](./evidence/v2-phase12/performance/summary.json) 和各 `profile.json`。P50/P95 用 nearest-rank，每模式窗口 n=8、输入/保存 n=4，小样本不代表长期尾延迟保证。

| 大小/行长  | 模式   | 窗口 P50/P95 ms | 输入 P95 ms | 保存 P50/P95 ms | 跳转超标数 |
| ---------- | ------ | --------------: | ----------: | --------------: | ---------: |
| 175k-short | source |           62/92 |          67 |         120/131 |          0 |
| 175k-short | live   |           68/88 |          65 |         117/154 |          0 |
| 175k-long  | source |         122/132 |          92 |         106/126 |          0 |
| 175k-long  | live   |         122/145 |         124 |         106/175 |          0 |
| 1m-short   | source |          82/120 |          75 |         133/191 |          0 |
| 1m-short   | live   |          64/126 |          81 |         142/215 |          0 |
| 1m-long    | source |         227/506 |          76 |         153/187 |          5 |
| 1m-long    | live   |         120/434 |          86 |         171/223 |          0 |
| 10m-short  | source |          83/111 |          55 |         479/500 |          0 |
| 10m-short  | live   |          72/108 |          80 |         460/510 |          0 |
| 10m-long   | source |         253/422 |          94 |         469/519 |          4 |
| 10m-long   | live   |         152/592 |          72 |         460/555 |          2 |
| 100m-short | source |           65/75 |          53 |       3824/4069 |          0 |
| 100m-short | live   |          59/134 |          74 |       3677/3797 |          0 |
| 100m-long  | source |         214/437 |          72 |       3677/3751 |          4 |
| 100m-long  | live   |         122/508 |          67 |       3670/3854 |          1 |

具体未通过项：

- 1 MiB 长行 source 首次 506 ms、热跳最高 319 ms；10 MiB 长行 live 首次 592 ms；100 MiB 长行 live 首次 508 ms。多项超过首次 500 ms／热跳 200 ms。层次记录显示长行的 IPC 与布局／帧呈现均有成本，不能仅由总耗时断言唯一根因。
- **100 MiB 短行的末尾滚动不可达**：[补验](./evidence/v2-phase12/performance/100m-short-tail/profile.json)。文件 1,638,402 行，source/live 的 scrollHeight 均封顶为 33,554,432 px，滚动到底时 DOM 仅生成至 1,597,855 行，实际截图的正文区域为空白，最后约 40,547 行无法通过滚动到达。[source 截图](./evidence/v2-phase12/performance/100m-short-tail/profile-source.png)。当前固定行高直接对应滚动像素的映射需要有界虚拟坐标／分段映射及跳转回归；此项未在本阶段扩大为滚动架构改造。
- 100 MiB 保存约 3.6–4.1 秒；这次验证了字节完整性，未证明保存时持续写作的延迟达标。
- 全量十万行搜索、密集匹配、长围栏、超长单行、持续运行和跨平台矩阵仍未关闭。此次八格执行完成不能替代这些项目。

首轮 1/10 MiB 长行 profile 因诊断 RPC 使用旧夹具固定行号 4738 而中断。修正为按实际行数取窗口后，以同样大小／行长完整重跑，前后 profile 均保留。未提高编辑或性能超时、放宽 200/500 ms 目标或缩小夹具来宣布通过。

## 中文系统 IME：有界诊断后仍未验收

复用上一阶段从官方发行源下载到 `/workspace/.cache/milkup-ime-phase11` 的独立包，不改系统安全、系统安装目录或持久权限。沿用合并 schema 和 GTK 模块清单，组件 XML 的 exec 仅指向该用户目录包装器；数据映射仅用于独立引擎进程。

- 第一次把 daemon 移到 proot 外，以独立配置／缓存目录启动：普通自动地址路径下 `ibus engine` 返回 `IBUS_IS_BUS` 失败。
- 第二次指定独立 IBus socket、单独启动 daemon：能列出 libpinyin/libbopomofo；为隔离总线而关闭了配置模块，切换引擎 12 秒未完成，提示配置未就绪。**该提示不能当作系统缺配置组件的证据。**
- 第三次按上一步唯一明确缺项手动启动已有 `ibus-memconf`：引擎进入初始化，但切换仍失败，日志有 `../lua/base.lua`、用户 `user.lua` 和 `user.conf` 路径初始化问题。另有 `org.freedesktop.portal.IBus` 可执行文件缺失提示，尚未证明它是此次失败的决定原因。
- 三次都只作用于独立测试会话，并以 20–25 秒外层／12 秒切换上限退出；没有关闭 sandbox、认证或扩大权限。

[诊断日志与复现配置](./evidence/v2-phase12/ime/diagnostic-third.log)、[引擎初始化日志](./evidence/v2-phase12/ime/daemon-third.log)。本轮没有候选窗、可信 composition 提交、取消、中文标点或选区替换的证据。最小下一步是提供稳定用户 IBus 总线、就绪配置服务及完整可定位的引擎 Lua／字典数据和可写首启缓存，再运行真实键盘候选／提交／取消／失焦／历史矩阵；优先使用具备这些条件的标准 Linux 桌面镜像。安装包存在和 Unicode 按键测试均不等于 IME 验收。

## 回归与证据校正

- Workspace JS：776 项串行通过；大纲 2 项、原生启动 helper 4 项通过。
- Chromium：60 项完整通过，包含新增已有文件异步保存成功／取消／错误时的继续编辑与历史。测试项目名沿用 `desktop-msedge`，实际执行器为 `/usr/bin/chromium`，不是 Windows Edge 验收。
- Rust：46 项通过，已取消会掩盖失败退出码的原生 runner；全仓类型／构建通过。
- 格式证据校正：第十一阶段报告曾写 Rust 格式通过，但该阶段归档日志实际为缺少 `cargo-fmt`。本阶段发现并修正那一行，通过 rustup 在现有独立工具链补装 rustfmt 后，`cargo fmt --check` 实际退出 0。本阶段保留首次失败和最终日志。

既有六套 WebDriver 原生回归共 49 项完整通过：窗口化块编辑 8、表格 9、导航 6、持久化保护 12、窗口化 Unicode 6、常规块键盘 8。对应 `native-*.log` 和截图一并入库；这与独立 XTest 的 30 项是两种输入路径。全仓 Prettier、Rust 格式及 `git diff --check` 通过。所有日志以归档证据为准。截图来自实际应用，状态/方向选区断言不代替缩放、对比度、屏幕阅读器等视觉／可访问性验收。

## 距离 Typora 级仍必办

1. 修复百万行滚动范围上限，验证末行、选择、搜索跳转和恢复定位；优化长行 200/500 ms 尾延迟及大文件保存时的持续写作体验。
2. 完成真实中文 IME 候选、提交／取消、替换、失焦和撤销矩阵。
3. 补齐密集搜索、长围栏和长期写作性能；窗口化表格编辑及大文件替换仍是独立能力缺口。
4. Windows／macOS、Word 2016 富文本复制、原生文件对话框、安装包流程均保留未验收。
5. 继续缩放／高 DPI、长行布局、工具发现性及可访问性体验验收。不能以本报告测试数量宣称达标。

复现普通 XTest：先用 `MILKUP_NATIVE_EVIDENCE_DIR=<只读观测目录> node tests/helpers/native-observer-server.mjs` 启动专用 Vite 服务，再在独占 X11 显示下运行 `MILKUP_NATIVE_EVIDENCE_DIR=<新的结果目录> MILKUP_FIXTURE_BYTES=1100000 python3 tests/native/x11-save-history.py`。可用 `MILKUP_NATIVE_LAUNCHER` 指定该环境的正常 CLI 包装器。性能脚本参数和采样口径见 `tests/native/tauri-window-performance.mjs`。

证据入库仅规范 JSON 排版以及日志行末空白／末尾空行；原始字节保留在 `/tmp/milkup-v2-phase12`。`manifest.json` 记录入库文件 SHA-256。既有 main hooks 引用 v2 不存在的脚本，提交使用已记录的 `SKIP_SIMPLE_GIT_HOOKS=1` 单次开关，不修改 hooks 或安全配置。
