# 第五阶段：窗口化 Unicode、换行边界与即时撤销

## 起点与范围

从已远端核验的第四阶段 `007539abd56c6b5e08c0b11cbf6e7f334da701a6` 继续，专用分支 `dot/milkup-v2-quality`。环境沿用第四阶段的 Linux Tauri / GTK / WebKitGTK，不修改系统权限、不切换模型或委派子模型。没有合并 v2、强推或发布应用。

本阶段只修复有复现的窗口化键盘操作及相关历史顺序，保留现有内核和窗口化架构；没有扩大到富文本复制、列表／表格重写或视觉改版。

## 失败证据与修复

| 复现                                                                  | 当前修复                                                                                              | 边界                                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `A👩🏽‍💻B` 右移两次落在 UTF-16 位置 2，组合字形被拆开；删除只处理一个码点 | 共用 `Intl.Segmenter`，对当前原始源行按完整 grapheme 移动、选中、向前／向后删除；垂直移动落在字形边界 | 存储位置仍是 UTF-16，不扫描全文；极长单行仍需单独性能验收               |
| CRLF 相邻行不在窗口内时只删一半分隔符或无法取得 deletedText           | 原始行缓存优先，仅补读相邻行；按上一行 `to`／下一行 `from` 处理整个分隔符，保留完整撤销载荷           | 原生 source 没有全局 position→line 索引，不能假定该 API 可用            |
| 窗口首行退格／跨窗口选区删除后，光标留在视口外                        | 从编辑范围读取保留源行编号，结构编辑后将光标所在行渲染回来                                            | 覆盖相邻窗口和行边界；任意多窗口长选区不是本阶段完整验收项              |
| 可见删除出现后立即 Ctrl+Z，正文仍是删除后的内容                       | 箭头、输入和历史共用串行队列；先提交待处理编辑，再撤销／重做；校验当前文档身份                        | 同时覆盖 memory source 和 native large source；普通非窗口视图保持原路径 |

先在 `007539a` 上运行新增回归，保留失败输出；最初等待不完整的诊断运行也保留，稳定等待后的基线仍出现 28 失败／2 通过。修复中又发现长文选区删除的视口丢光标，保留独立 red 记录。浏览器即时撤销的两个失败断言没有用延迟绕过，修复队列后原断言通过。

脚本：[source-unicode.test.ts](../packages/view-dom/src/__tests__/source-unicode.test.ts)、[desktop-shell.spec.ts](../tests/e2e/desktop-shell.spec.ts)、[tauri-windowed-unicode.mjs](../tests/native/tauri-windowed-unicode.mjs)。完整原始日志在 `/tmp/milkup-v2-phase5/`，关键失败证据随本报告入库。

## 验收矩阵

| 项目                                 | 结果／证据                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 😀、组合重音、ZWJ／肤色 emoji、旗帜  | source/live 单元回归；左右、Shift 选区、Backspace、Delete、上下跨行                              |
| 原生风格 source 无全局 position 索引 | 回归使用只支持窗口读取的 source，避免 MemoryDocumentSource 掩盖原生限制                          |
| CRLF 位于窗口外                      | 单行视口、零 overscan 回归；原文、deletedText 和光标位置均断言                                   |
| 编辑／历史／后续按键顺序             | 延迟异步历史及紧接的按键有顺序断言；浏览器即时撤销／重做                                         |
| 远处窗口切换                         | 回归滚至第 5000 行再返回，光标位置不变，读取范围受限                                             |
| Linux Tauri 实际磁盘大文档           | 1,100,019 字节、100,002 行；两种模式下实际 WebDriver 键盘及指针操作、Rust 文件服务、保存字节核验 |
| 原生输入方法                         | WebDriver 英文／导航按键，不是系统中文 IME；中文 IME 仍未验收                                    |
| OS 文件选择器                        | 使用第四阶段已注明的测试路径接口；GTK proot 对话框限制未解决，不计为通过                         |
| Windows / macOS / Word 2016          | 当前环境不可验收                                                                                 |

原生截图：[source](./evidence/v2-phase5-native-source.png)、[live](./evidence/v2-phase5-native-live.png)。

原生矩阵和性能样本见 [native-results.json](./evidence/v2-phase5-native-results.json)。原生截图展示当前窗口，不以截图替代字节／光标断言。

## 性能记录的含义

真实 Tauri 约 1 MiB fixture 在远处窗口只渲染 82 行。第一次 WebDriver 往返包含跨进程通信及并行检查负载，source/live 分别约 9.27／4.49 秒，不能解释成单次按键或纯渲染耗时。最终脚本另在页面内部测量 scroll→目标行窗口→两次 animation frame，每种模式三次离开／返回，原始样本随矩阵保存。样本量不足以报告可信 P95；没有前后性能基准，不宣称性能提升或达到 Typora 流畅度。

最终页面内部三次采样：source 远跳 4371／5550／5775 ms，返回 969／1014／971 ms；live 远跳 1968／4960／5356 ms，返回 308／182／372 ms。每次远跳 82 行、返回 58 行 DOM。**性能未达标**：即使排除 WebDriver 请求往返，仍存在秒级延迟。首版把六次采样放在单个请求里触发 20 秒自动化超时；拆为逐次请求后得到以上数据，未放宽单次性能断言或隐去超时。最终原生采样期间没有并行全仓测试／构建，但仍是云容器 debug/proot 环境，尚不能归因到唯一产品模块。

下一阶段首先拆分 Rust 行窗口读取、IPC 和渲染耗时，定位秒级远跳慢路径。初步代码线索是 `read_large_line_window` 逐行调用 `byte_to_utf16`，后者读取当前 piece 到目标位置的前缀；这是待独立计时确认的归因假设，不是已验证根因；随后再继续列表和代码块交互。仍须固定硬件、隔离负载，分别测 175 KiB、1／10／100 MiB、极长单行、输入／滚动延迟和内存，并排查显著慢路径。

## 历史用户问题核查

- [#255](https://github.com/Auto-Plugin/milkup/issues/255)：普通文档 Chromium 中，括号内输入英文／数字，等待 2.5 秒再输入，光标未跳出；图片 Markdown 后紧接 `## 3`、单空格标题也通过。本轮没有为这些场景修改产品逻辑。实际 OS IME、图片导入组合流程及所有平台不由这两项断言推导。
- [#252](https://github.com/Auto-Plugin/milkup/issues/252)：原报告为 Milkup→Word 2016 的复制表格，不是 Word→Milkup 粘贴。当前代码检查发现普通及窗口视图复制路径只设置 `text/plain`，这是需继续核验的富文本输出缺口；当前未执行 Windows 11／Word 2016，不能宣称原生回归已复现或修复。本阶段没有增加新复制菜单或新格式功能。

## 整体质量差距与下一步

数据安全已有 Linux 原生证据；普通和窗口视图关键输入边界得到加固，仍不代表整体达到 Typora。

1. 先定位上文实际测得的原生远处窗口秒级延迟；随后复现列表键盘续行、空项退出、嵌套缩进／反缩进，以及代码块内空行和边界退格；按当前失败最小修复。
2. 表格单元格导航、选区和复制格式；先完成 Linux 端 clipboard 格式证据，再单列 Windows Word 集成验收。
3. 搜索／大纲定位、Esc 和原生 Home/End 快捷键、滚动后继续输入的锚点稳定性；任意长选区、鼠标落入 grapheme 内部仍需专门验收。
4. 视觉重点是段落／标题／图片／列表的间距一致性、长行和窄窗口布局、当前焦点可见性；先对实际场景截图比较，不开展无依据的整体换肤。
5. 保留系统 IME、跨平台保存语义、权限／ACL/xattr、保存最终比较到替换之间的外部写入竞态，以及完整性能基准等未验收项，见第四阶段报告。

## 完整验证

| 检查                                                 | 最终结果                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| 全仓单元／集成                                       | 685 通过，13 个 workspace，退出 0                                     |
| 全套 Chromium 浏览器                                 | 41 通过，退出 0；包括既有保存／关闭／图片／搜索回归                   |
| Rust                                                 | 44 通过，0 失败／忽略，退出 0；直接测试，取消 GUI runner 的退出码遮蔽 |
| Linux Tauri 实际窗口                                 | source/live 共 6 组键盘／滚动锚点／磁盘保存检查通过                   |
| typecheck / build / Prettier / Rust fmt / diff check | 全部通过；build 为 JS/TS/Vite，不是发布安装包                         |
| 原生远跳性能                                         | **未达标，保留下一阶段首要问题**                                      |

结果及源码／日志摘要哈希见 [verification.json](./evidence/v2-phase5-verification.json)。本阶段只修改 TypeScript 产品逻辑；原生复验使用第四阶段已编译的 Rust debug binary 加当前 Vite 前端，Rust 源码无变化。末次类型检查发现并修正范围读取返回值的 `exactOptionalPropertyTypes` 类型注解，再完整通过；没有改变对应运行时行为。没有增加测试超时或关闭既有失败断言。

复跑命令（先加载同一云环境）：

```bash
source /workspace/.cloud/milkup-v2/env.sh
pnpm -r --workspace-concurrency=1 test --maxWorkers=1 --no-file-parallelism
MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:e2e --workers=2
pnpm typecheck
pnpm build
pnpm lint
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
# 单独启动 Vite、Xvfb 和 Tauri/WebKit driver 后运行；勿与性能采样并行构建。
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:unicode
```

Playwright 使用自己的两个 Vite server，运行前应停止人工启动的同端口 server。关键 red 证据：[Unicode 基线](./evidence/v2-phase5-unicode-before.txt)、[选区删除丢失可见光标](./evidence/v2-phase5-selection-before.txt)、[即时撤销失败](./evidence/v2-phase5-immediate-undo-before.txt)。首版原生脚本的 selector 引号错误与合并性能请求超时属于测试诊断记录，保存在原始日志，均未计入最终通过结果。
