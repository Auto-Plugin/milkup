# 第八阶段：表格编辑与富文本复制验收

日期：2026-10-13。基线 `6af818fc2be40a2c57f366ee0b4b92a016087e35`，专用分支 `dot/milkup-v2-quality`，开始时工作树干净。沿用 pnpm 11.7、Rust 1.99、GTK 3.24.49、WebKitGTK 2.52.6 的原生云环境；原生 debug 二进制的 Rust 部分未改，Tauri 窗口加载本阶段 Vite 代码。未重建环境、重置用户修改、强推、合并远端 v2 或发布应用。

收到环境断开通知后，在 UTC 10:35:05 实际执行命令确认了同一 HEAD、目录、16 个当时修改／新增文件以及仍在更新的测试日志；Vite、Xvfb 和 4446 端口 driver 存活。没有依赖任务状态推断恢复，也没有重复启动仍在运行的测试。中途快照保存在 `/workspace/milkup/.tmp/phase8-checkpoint-20261013T103505Z/`，含补丁、工作文件和当时证据；最终交接以本阶段提交为准。

## 现状审核与交互约定

此前表格只有 live 渲染和点击定位：Tab 没有单元格导航，Enter 会拆开 Markdown 行，行列操作没有显式入口，复制只写 `text/plain`。新增命令沿用常规文档 `EditorView`、现有解析范围与全局事务历史，没有创建另一份表格文档状态。

| 场景                 | 本阶段语义                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| 进入单元格           | 直接点击定位；工具栏“选中单元格”可整格替换；模式切换保留源文本选区                                              |
| Tab／Shift+Tab       | live 中选择下一／上一格内容，跳过分隔行；最后一格 Tab 新增一行；第一格 Shift+Tab 回到表格之前，必要时创建空段落 |
| Enter                | live 中到下一行同列；最后一行创建数据行，不拆开当前单元格的 Markdown 行                                         |
| Shift+Enter          | 在单元格插入 `<br>`；只识别无属性的 br 标签，其他原始 HTML 不启用执行                                           |
| 多行粘贴／输入管道符 | 单元格内 CRLF／LF 转为 `<br>`，未转义的管道符写为 `\|`；已有转义不重复添加                                      |
| Backspace／Delete    | 单元格起止边界不删除列分隔符；紧邻 `<br>` 时整段删除，可独立撤销；其他文字沿用现有字形删除                      |
| 增删行列             | 工具栏“下方加行／删除行／右侧加列／删除列”；保留表头，沿用当前解析器至少两列的限制；不追加一套隐藏的行列快捷键  |
| 列结构变更           | 只规范化当前表格的管道间距；保留各格源内容、列对齐、换行风格及表格外文本。行插入／删除只改相应位置              |
| 退出                 | Esc 或“退出表格”到后续独立段落；必要的新空行属于一个可撤销结构操作                                              |
| 选区                 | 延续线性的源文本选区；提供整格／整表选择。跨格选区 Tab／Enter 不改分隔符，不声称实现矩形网格选区                |
| 撤销／重做           | 每次结构操作、单元格换行或粘贴独立成组；导航不产生文档历史；输入与结构修改可逐步撤销                            |
| source 模式          | 继续直接编辑 Markdown；Enter 为字面换行，复制为原始文本，不将 source 键盘静默改成网格模式                       |

工具栏只在常规 live 表格上下文出现，显示当前行／列，禁用不适用的操作；只读、保存中和组合输入边界仍受现有保护。单元格内容仍由同一 Markdown 源文本派生。当前不支持一列表格、合并单元格、矩形多格选区或电子表格式批量填充。跨格方向键仍沿用源文本导航，本阶段专门设计和验收的是 Tab／Enter 导航；方向键跨隐藏分隔符的体验仍须后续复核。

## 复现、修复与真实界面发现

- 初始 10 项键盘用例中 9 项失败、1 项通过：[失败记录](./evidence/v2-phase8-table-before.txt)。复现 Enter 拆行、Tab 无导航、换行／管道符破坏单元格、结构退出等问题后实现限定行为。
- 4 项解析边界先全部失败后修复：[解析记录](./evidence/v2-phase8-parser-before.txt)。表头-only 表格的范围原先漏掉分隔行；偶数反斜杠后的管道仍应是列边界；表头和分隔列数不匹配不进入结构编辑；无属性的 br 可作为换行。
- 新增空列后的原生截图发现空单元格光标画到相邻列。真实几何为目标列 x=376–725，光标 x=735；修复后 x=386。空单元格没有文本节点，原测量逻辑误选后续格文本；现在先用空单元格自身的矩形和内边距。保留[原生失败](./evidence/v2-phase8-native-empty-before.txt)、[单元失败](./evidence/v2-phase8-cursor-before.txt)及修复前后截图，不往文档或 DOM 文本中塞占位字符。
- 补测表格末尾已有换行时，EOF 空行被误认作表格，Enter／Tab 被截获。先[失败复现](./evidence/v2-phase8-table-trailing-before.txt)，再修正范围；该空段落现在保持普通文本行为。
- 输入已有反斜杠后的管道曾被重复转义，定向失败后按前缀反斜杠奇偶性处理。空行输入的原生验收曾假定 `| new |` 的规范化间距，实际为保留原空白的 `|  new|`，内容与结构均正确；修正的是测试预期，没有为匹配脚本重排用户空白。

## #252：HTML 与纯文本复制

[Issue #252](https://github.com/Auto-Plugin/milkup/issues/252)报告的目标环境为 Milkup v1.0.18、Windows 11、Word 2016；诉求是渲染表格复制到富文本目标时成为可编辑表格，纯文本目标仍收到 Markdown。本环境未运行该 Windows／Word 组合。

本阶段在当前 v2 中实际确认了相同机制缺口：Tauri Ctrl+C 的系统剪贴板有正确的 `UTF8_STRING` Markdown，没有 `text/html`，见[修复前剪贴板](./evidence/v2-phase8-clipboard-before.json)。修复复用现有导出器，在 live 选区包含有效完整表格时写入两种表示：

- `text/plain` 保持所选 Markdown 的 Unicode、空白和换行，不用制表符或渲染文本替换源码。
- `text/html` 使用真实 `table/thead/tbody/tr/th/td`，保留对齐、加粗、行内代码和 br，增加表格边框；所有文本／属性经转义，拒绝可执行 URL scheme，不把原始 HTML 直接塞进剪贴板。
- source 复制、单个单元格和不能独立构成完整表格的局部片段保持纯文本。剪切复用同一 payload，删除仍走全局历史；撤销恢复完整源内容。混合选区只导出选中片段，不额外读取未选中单元格。

原生验收通过实际 Ctrl+C／Ctrl+X，另一个 GTK 进程读取 X11 系统剪贴板，核对 Unicode Markdown、HTML 结构和转义；再在原生 WebKit 中的独立可编辑测试目标执行 Ctrl+V，确认为两行、两列表格。该目标是测试夹具，**不是 Word**。GTK 的 legacy `text/plain` target 会转换换行／非 ASCII 表示；`UTF8_STRING` 是本次精确字节断言的原生文本 target，原始各 target 数据都保留。浏览器测试另外核验 `navigator.clipboard` 的标准 `text/plain`／`text/html`。

没有手写 Windows CF_HTML 偏移头；平台映射由 WebView 剪贴板实现负责。Windows 11／Word 2016 的格式选择、边框、单元格可编辑性和字体效果仍是**未验收**，不能以 Linux／Chromium 结果宣布该平台 issue 已关闭。

## 历史验收来源与后续归属

以下是历史反馈和后续验收来源，**不是本阶段已经复现的 v2 缺陷**；issue 关闭状态也不等于当前 v2 自动通过。

- [#258（已关闭）](https://github.com/Auto-Plugin/milkup/issues/258)：outgoing 复制应同时提供原始 Markdown `text/plain` 与语义 HTML／内联关键样式，明确不覆盖 incoming paste。本阶段验证的是含有效表格选区的双格式输出及表格边框／对齐；不把它外推为无表格的标题、列表等全部富文本选区及字号／层级／缩进样式验收。单元格多行粘贴属于本阶段编辑安全约定，不算 #258 的验收结果。
- [#241](https://github.com/Auto-Plugin/milkup/issues/241)：历史 Word 导出中 H4／H5 落入 Heading 3。后续必须检查真实 H1–H6 的 Word 样式级别／大纲级别，不只看字号或外观；本阶段未运行 Word 导出。
- [#243](https://github.com/Auto-Plugin/milkup/issues/243)：视觉／source 阶段反复切换模式，检查行内代码残留样式及实际 computed style，不能仅断言源文本未变。
- [#232](https://github.com/Auto-Plugin/milkup/issues/232)：窄窗口最小宽度、布局和空白；后续同时核对原生窗口约束、工具栏及正文可用区域。
- [#240](https://github.com/Auto-Plugin/milkup/issues/240)：高分辨率下整界面的可读性；后续覆盖正文、菜单、工具栏、状态栏和对话框，不只调整编辑器文字。

## 验收矩阵

| 项目                                    | 结果                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| 定向表格编辑／空单元格光标              | 23 + 1 项通过                                                                            |
| 解析边界／剪贴板 payload                | 4 + 4 项通过                                                                             |
| 原生表格／系统剪贴板                    | 7 组通过，实际 X11／WebKit 按键与 GTK 剪贴板读取                                         |
| 既有原生安全／Unicode／列表代码         | 12 + 6 + 8 组通过                                                                        |
| 全仓 JS 单元／集成                      | 749 项通过，13 个有测试的 workspace，退出 0                                              |
| Chromium 浏览器                         | 49 项通过，退出 0                                                                        |
| Rust                                    | 46 项通过；未用会掩盖退出码的 runner                                                     |
| 类型／构建／格式                        | typecheck、前端 build、Prettier、Rust fmt、diff check 通过                               |
| Windows／Word 2016、macOS、系统中文 IME | 未验收                                                                                   |
| 第六／七阶段 200／500 ms 目标           | 仍未全面达到；本阶段未进行独立性能验收或改变门槛；Unicode 回归附带计时不构成新的性能结论 |

截图：[空列修复前](./evidence/v2-phase8-empty-cell-before.png)、[空列修复后](./evidence/v2-phase8-live-table-columns.png)、[多行内容](./evidence/v2-phase8-live-table-multiline.png)、[整表复制](./evidence/v2-phase8-live-table-copy.png)、[退出段落](./evidence/v2-phase8-live-table-exit.png)。[原生分组](./evidence/v2-phase8-native-tables.json)与[实际剪贴板](./evidence/v2-phase8-clipboard-after.json)另行保存。

原始日志位于 `/tmp/milkup-v2-phase8/`。最终[校验清单](./evidence/v2-phase8-verification.json)记录结果与哈希。截图和原生 JSON 随提交保存，截图只支持界面／光标观察，不替代磁盘字节与历史断言。例行类型检查中修正了 NodeList 的迭代写法；依赖仅增加桌面到已有 `@milkup/export` 的 workspace 链接，锁文件保留既有其他平台条目与版本。

## 复跑与后续必办

```bash
source /workspace/.cloud/milkup-v2/env.sh
# 先启动 Vite :1420、Xvfb :99、tauri-driver :4446。
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:tables
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:quality
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:unicode
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:blocks
# 停止人工 Vite 后再让 Playwright 自行启动服务。
MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:e2e --workers=2
pnpm -r --workspace-concurrency=1 test --maxWorkers=1 --no-file-parallelism
pnpm typecheck
pnpm build
pnpm lint
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
```

原生文件路径仍通过既有测试入口提供，不计为 GTK 文件选择器验收；Shift+Tab 使用 X11 原生键路径，系统中文 IME 没有以合成 composition 事件替代。提交前完成全套适用验证，沿用已记录的 main 遗留 hooks 单次跳过开关，不修改 hooks 或 Git 安全配置。

下一阶段按风险推进：

1. **搜索／大纲**：先复核搜索取消和旧结果竞态、Unicode／CRLF 位置映射、跨视口命中定位、标题导航与模式切换的滚动锚点；基于真实失败逐项修复，再以原生窗口验证位置和焦点。
2. **视觉一致性**：用包含段落、嵌套列表、代码、表格、图片的固定文档核对间距、字体／行高、焦点可见性、窄窗口工具栏和深滚动光标，避免仅凭单张截图调整。
3. **窗口化 Markdown 上下文是必办项**：第七阶段留下的列表／代码键盘语义差距仍未解决；本阶段也未把表格结构命令或富文本复制扩展到 `SourceDocumentView`。需要先建立跨窗口上下文，再复用这些交互，不能把局部解析误当完整结构。
4. Windows／Word 2016、macOS、真实中文 IME 和 10／100 MiB、极长单行性能继续单列；不将等待平台资源的项目计为通过。

这是限定场景的表格质量阶段，不代表已经整体达到 Typora，也不是产品发布批准。
