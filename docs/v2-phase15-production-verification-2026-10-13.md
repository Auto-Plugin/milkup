# 第十五阶段：生产 Worker 链路与有界窗口化表格

从本地与远端一致的 `5ab5a20eee12a3765b07a38b1f3db57eafbb5734` 接续，分支 `dot/milkup-v2-quality`。此前新环境恢复的精确 `cefe9e4` 及第十阶段补验记录仍见[第十一阶段报告](./v2-phase11-clean-environment-verification-2026-10-13.md)。本阶段只构建本地生产二进制，不发布、合并远端 v2 或强推。

## 生产路径证据

正常命令 `pnpm --filter @milkup/desktop tauri build --no-bundle` 生成 release 二进制，未使用 Vite profile 注入。WebView 文档、JS/CSS 和搜索 module Worker 均来自 `tauri://localhost` 本地资源；测试明确要求 1420 端口关闭。运行时观察 Worker 构造 URL、真实消息、错误和 CSP violation；不替换 Worker 实现或注入私有编辑器状态。

首轮“文档就绪失败”实际是新脚本查询了生产 DOM 不存在的路径字段；失败截图中的文件已经打开。其后另修正了自定义协议 `new URL(...).origin` 与 `location.origin` 的比较、Unicode 夹具匹配数，以及 XTest 发送后过早用脚本切换焦点的驱动时序。最后一项由完整磁盘哈希捕获：预期 `TAIL`，实际只收到 `T`，现先等待替换框接收完整输入再激活按钮。后续新增超限表格夹具的 `over80` 意外包含查询 `r80`，以及搜索计数完成早于选区定位的脚本等待问题，也分别修正并保留失败记录，不作为产品通过证据。

原生窗口就绪观测约 1.3 秒，独立 Worker 确实加载并返回 Unicode 匹配。现有应用没有配置 CSP，本轮没有降低或修改安全设置；“没有 CSP violation”不等于 CSP 加固。一次网络命名空间尝试因只读 `/proc/self/uid_map` 失败后即停止，未绕过限制。按用户随后明确的范围，以本地生产资源不依赖 dev server 为验收边界；关闭代理端口的故障注入也不能冒充系统完全断网。

生产搜索验证使用两种夹具：约 2 MiB 的 `İ`、希腊字母、中文、emoji 混合文档，以及第十三／十四阶段同一份 **104,857,639 字节、1,638,402 行** CRLF 原文件，SHA-256 `d9b2dd396a2624d9563c3bfc43e69a3c1e7c1dd4b1f0239f28bc5a8bafcbf6e1`。覆盖 source/live 的完整搜索、Unicode Worker 回退、旧查询取消、字面 `$1😀` 替换、单项与 1,638,400 处全部替换、提交前取消、整笔撤销重做、完整磁盘字节及关闭重开。最终追加 83,558,400 处密集匹配期间的真实按键编辑与版本失效回归。没有缩小原夹具或增加性能验收时限。

## 表格修复与支持边界

[设计与支持合同](./v2-phase15-windowed-table-design-2026-10-13.md)先于最终验收形成。现在窗口化 live 视图从完整有界表格恢复跨窗口的表头／分隔线语义，共用普通编辑器的 Tab、Enter、方向键、Home/End、行列命令；操作及方向选区映射回全局 UTF-16 坐标。单元格输入保护管道符，Shift-Enter 和多行粘贴使用 `<br>`。原生读取在创建窗口正文／IPC 载荷前检查 UTF-16 索引长度。

支持顶层 pipe 表格，最多 128 个逻辑行（含分隔线）、16 列和 262,144 个 UTF-16 单元的完整上下文。四个完整上下文缓存均受该文本预算约束；`window.text`、行字符串与解析对象存在额外表示开销，不能把这些数字说成进程内存上限。超限表格保留字面 Markdown，不显示结构工具，不对窗口片段执行整表命令。围栏上下文按版本检查；前置扫描页超出预算时保守保留源码。深处首次围栏发现仍可能扫描先前页面，没有宣称 200 ms 达标。

真实生产验收发现并修复了三类问题：

- 乐观输入修改单元格 `textContent` 会压平已渲染的 `<br>`；现在从有界乐观上下文重建当前行，原生多行行高实测 51 px，光标位于第二视觉行。
- 新增后台表格上下文检查曾提前提交输入批次；后台渲染现在不主动 flush 输入。异步单行渲染还检查源对象、版本和编辑序号，防止旧结果覆盖新字符。
- 加入超限表格后，渲染调度仍可让连续输入横跨多个原生提交批次。现在连续插入的历史分组独立于 24 ms IPC 批次：仅合并 750 ms 内、相邻、选区连续且最多 65,536 UTF-16 单元的显式 typing 批次。结构操作、粘贴／composition、保存、原生快照历史和撤销重做保留边界；合并历史仍恢复最早的方向选区。不是延长 IPC 提交延迟或测试超时。

虚拟布局记录最多 2,048 行的实测高度，支持多行单元格与隐藏分隔线的坐标换算。未访问或被淘汰的行仍用估计高度，这不是全文精确排版。稳定渲染挂载视口行，结构编辑的短暂乐观重绘可覆盖有界上下文。

## 验收结果与原始记录

| 生产路径              | 最终结果                                                                        | 证据                                                                  |
| --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Unicode Worker 两模式 | 8 个流程通过                                                                    | [结果](./evidence/v2-phase15/production-unicode-final/results.json)   |
| 原始 100 MiB 两模式   | 14 个流程通过，包括运行中的非 ASCII Worker 取消与编辑期间完整密集搜索           | [结果](./evidence/v2-phase15/production-100mib-final/results.json)    |
| 窗口化表格            | 7 个流程通过，包括真实 GTK/X11 中文多行粘贴、行列增删、历史、重开、超限源码回退 | [结果](./evidence/v2-phase15/production-tables-complete/results.json) |

每 250 ms 采样的应用＋WebKit 进程 RSS 求和峰值：100 MiB 搜索 677,096 KiB，Unicode 流程 631,064 KiB，表格流程 862,924 KiB；共享页可能重复计算，不能当成 JS 堆上限或跨机器稳态保证。100 MiB 密集搜索期间，从聚焦、Ctrl+Home、系统按键到版本确认的整段时间 source/live 为 341／292 ms，包含测试传输和轮询，不是单次键延迟或 200 ms 跳转达标证明。

最终生产二进制、JS/CSS/Worker 资源 SHA-256 见[构建清单](./evidence/v2-phase15/production-build-manifest.json)；[实际命令与退出码](./evidence/v2-phase15/native-complete-checks.json)、[全仓检查](./evidence/v2-phase15/checks-final-history.json)、[早期失败记录](./evidence/v2-phase15/initial-checks.json)均保留。

全仓 JS/TS 815 项、补充 outline／启动工具 6 项、Rust 58 项（另 1 项性能基准默认忽略）、Chromium 60 项通过；全仓类型、构建、Rust 格式和本地 release 构建退出 0。方向选区历史另作 12 项聚焦复验，表格 128 行／16 列边界及超限保护另作 8 项聚焦复验，均退出 0。命令与退出码保存在证据目录，Rust 已解除环境 runner，直接捕获实际退出码。

截图审查见[多行单元格](./evidence/v2-phase15/production-tables-complete/multiline-cell.png)、[真实系统粘贴](./evidence/v2-phase15/production-tables-complete/native-clipboard-cell.png)及[超限字面源码](./evidence/v2-phase15/production-tables-complete/over-budget-literal.png)。它们支持本次行为与局部排版核验，不替代完整视觉／辅助功能验收。

既有六套原生回归（保存／冲突与窗口关闭、Unicode、列表／代码、普通表格、搜索／大纲、窗口化块）共 **49 项**也通过同一 release 二进制；[命令与实际退出码](./evidence/v2-phase15/existing-production-checks.json)保留，未启动 Vite。

WebDriver 的部分窗口截图遗漏了浮动表格工具栏。针对该差异额外观察 15 个时点的 DOM 几何与命中测试，并取得同一窗口的 [X11 系统截图](./evidence/v2-phase15/production-toolbar-x11/x11-root.png)：工具栏实际可见，命中为真实工具栏控件。未将截图差异当成产品样式故障，也未猜测具体合成器根因。截图工具边界与此前快速输入的 allocator 故障分别保留。

完整文件哈希来自独立测试进程，不代表产品前端载入全文。文件打开／重开沿用既有路径 test seam，不算原生文件选择器验收。系统 XTest 按键与 GTK/X11 剪贴板是本轮真实交互；Unicode WebDriver key actions 及合成 composition 不是系统中文 IME。

## 剩余必办

1. 在稳定系统输入法会话中实测中文预编辑、候选提交／取消、标点、选区替换、失焦、历史和保存。此前 IBus 包已装入独立目录，但候选会话未通；本阶段不重置该未验收状态。
2. 当前分支 Windows/macOS 原生编辑、文件对话框、文件占用／watcher、剪贴板，以及 Word 2016 表格／标题互操作仍未实测。Linux 生产二进制通过不替代安装包或跨平台验收。
3. 第十四阶段 WebKitWebDriver 快速输入时的 `malloc_consolidate(): unaligned fastbin chunk detected` 仍未归因。本阶段 XTest 通过不关闭该问题；下一步是固定最小场景、分别捕获 driver/WebKit 子进程退出和回溯，再以最小 Worker 页面作对照，不无限重试完整编辑器。
4. 第十三阶段 100 MiB live 暖跳转 200 ms 缺口仍保留；生产搜索闭环不等于 200/500 ms 跳转性能目标通过。继续做混合 Markdown、全 Unicode、长行、密集匹配和长时间稳定性测试。
5. 表格超限／嵌套语义、矩形选区、跨应用富文本复制、宽列与换行策略、估计高度滚动校准，以及窄窗、键盘可访问性和视觉节奏仍需完整体验验收。此次有界表格支持不能外推为任意规模表格编辑完成。
6. 原生搜索快照的崩溃恢复、长时间保留与跨平台清理仍需专项验证；本轮取消和正常关闭不替代崩溃恢复。

证据文件与 SHA-256 见[完整清单](./evidence/v2-phase15/manifest.json)。本地遗留提交 hook 仍引用缺失的 `scripts/verify-commit.js`；沿用既有单次 `SKIP_SIMPLE_GIT_HOOKS=1` 开关，未修改 hook 或安全配置，检查已独立执行。

不以测试数、成功构建或局部截图宣称达到 Typora 级质量。
