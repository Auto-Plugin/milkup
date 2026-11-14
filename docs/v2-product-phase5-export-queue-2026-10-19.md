# P5：导出呈现队列期限修复（2026-10-19）

状态：**已修复确定性的导出队列期限混用；P5 整体验收仍未完成。** 基线为 `53f043e86bf162a18db67acef941811a867d1d20`。本轮有证据支持的修复是导出等待队列时错误消耗渲染执行期限；不是 Mermaid 原生执行超时根因修复，也不关闭历史 Print04。

本报告引用的 `milestone06/` 收录原始失败、修复后断言、真实 HTML/PDF/页面截图及逐请求时序。可执行文件和独立插件包仅保留本地哈希，不随证据上传；外部候选闭包清单因此不代表归档目录包含所有构建产物。

**已证明的问题与最终行为。** 旧 `collectOutputPresentations` 在调用 renderer 前启动另一个 2 秒计时器。这段时间包含真实 RPC 队列等待，而隔离 owner 的执行计时从实际 dispatch 才开始。例如编辑器占用 1500 ms、导出执行另需 1500 ms，两次执行都低于 2 秒，但旧外层在总计 2000 ms 时取消导出，此时它只执行了 500 ms。

修复使 `document-presentation-service` 将同一次 `provide` 的绝对 preparation deadline 传给每个 renderer：调用方提供的 deadline 保持原值，否则沿用已有 10 秒 preparation 窗口。导出外层只使用其剩余时间；不逐个围栏重新计时，也不是对整篇多窗口文档新设一个总 10 秒期限。期限已到则不再发起请求，返回结果后再检查单调时钟，避免前端阻塞造成计时器回调迟到时接受超期结果。期限到期先确定 timeout 原因，再 abort 下游，避免真实 RPC 的 aborted 抢先将它误报为 unavailable。

**原生每任务 2 秒执行限制未改变。** owner 仍从 dispatch 开始计时，真正执行超限仍终止隔离实例并撤销能力。准备阶段的等待预算与执行期限分开，不能让一个 renderer 获得 10 秒执行时间。取消、文档身份/版本变化、renderer 撤回、晚结果拒绝以及有界输入/输出保护继续保留；无公共 SDK API 变更或插件 ID 特例。

| 验证项                        | 当前记录                                                                                                     | 证据                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 确定性 RED                    | 旧实现 1 失败、3 通过；export `render_2` 在 t=1500 ms dispatch，t=2000 ms 被错误取消；owner 未超限、未停用   | [RED 日志](evidence/v2-product-phase5-export-print/milestone06/queue-regression/red.log)、[时序与指纹](evidence/v2-product-phase5-export-print/milestone06/queue-regression/red-proof.json)                            |
| 队列 GREEN                    | 扩展后 7 通过、0 失败                                                                                        | [GREEN 日志](evidence/v2-product-phase5-export-print/milestone06/queue-regression/green-authority-expanded.log)、[证明与源指纹](evidence/v2-product-phase5-export-print/milestone06/queue-regression/green-proof.json) |
| preparation / service 测试    | 本轮定向运行 35 通过；包括同一 provide 的绝对 deadline 共享，以及结果已超过 deadline、timer 尚未回调时仍拒绝 | [定向测试日志](evidence/v2-product-phase5-export-print/milestone06/queue-regression/preparation-green.log)                                                                                                             |
| 桌面类型检查                  | 扩展队列测试后 exit 0                                                                                        | [类型检查日志](evidence/v2-product-phase5-export-print/milestone06/queue-regression/desktop-typecheck-expanded.log)                                                                                                    |
| 最终全仓检查                  | 2,210 项 Vitest、4 项 Node 通过；全仓类型、版本核对、构建及格式通过；Rust 格式检查通过                       | [最终检查](evidence/v2-product-phase5-export-print/milestone06/checks/final-checks.json)                                                                                                                               |
| 最终正式构建与 Linux 原生验收 | release 构建通过；独立插件的 HTML、A4、Letter、打印、大文件、取消重试及全停用均有实测，内容缺口见下表        | [构建指纹](evidence/v2-product-phase5-export-print/milestone06/production-queue/provenance.json)                                                                                                                       |

7 项队列测试经公开 `createRpcPluginIsolationHost` 运行真实 RPC client 的单任务队列、取消和撤销逻辑；只有可信 owner 和时钟由测试模拟。覆盖：两次各 1500 ms 的正常执行；真实 2 秒超限仍停用并拒绝晚包；排队取消不 dispatch、不取消编辑器 owner；运行中取消后等待旧 owner settle 才推进队列；owner 1500 ms 内接受但前端 3000 ms 才交付仍可在 preparation 期限内成功；旧版本结果晚交付期间发生编辑时拒绝旧 capture、新版本正常返回；preparation 到期移除排队任务，之后编辑器结果交付也不再发出该任务。这些是控制逻辑证明，不是原生性能或 UI 实测。[完整队列说明](evidence/v2-product-phase5-export-print/milestone06/queue-regression/README.md)

**Diagrams 1.1.2 候选已撤回，产品保持 1.1.1。** 曾尝试在 activation 内通过公开 `registerExternalDiagrams([], { lazyLoad:false })` 提前加载已打包图型。候选独立构建和 129 项插件测试通过，SDK 仍为 0.3.4，入口及插件包各增加 53 字节。但小样本未证明收益：旧首次 screen 为约 447/806 ms，新为 589 ms；旧 export 为约 152/154 ms，新为 476 ms；直接冷 multi export 约 577→517 ms。两版均未复现超时，activation/RSS 成本未完整测量，独立布局 loader 仍可能懒加载。因此不将它当作修复采纳；候选的 5 个源码文件已恢复到基线，仅保留补丁、冻结输入、独立包及全部实验/失败日志作为研究证据。[候选构建说明](evidence/v2-product-phase5-export-print/milestone06/diagrams-candidate/README.md)、[候选体积比较](evidence/v2-product-phase5-export-print/milestone06/diagrams-candidate/comparison.json)、[原生小样本比较](evidence/v2-product-phase5-export-print/milestone06/native-diagnosis/old-new-print-comparison.md)

成功缓存的完整请求 key 和文档版本绑定未放宽，也未新增渲染预热。现有插件仅缓存满足条件的 Sankey 成功结果，历史失败样例为 flowchart，故不能用该缓存解释此前 PDF05/HTML10 成功或本次 Print04 失败。同 document/version/完整输入的安全复用边界保持原样。[插件诊断](evidence/v2-product-phase5-export-print/milestone06/plugin-diagnosis/README.md)

## 正式 Linux 生产闭环

生产 ELF SHA-256 为 `6e6c004030fe06146b58d9e40cbd22c7c7d3315c306ceb741f3f58e119ed9d2a`，22,325,536 字节。所有正式 run 均通过真实 UI 安装独立 export-print 1.0.0（`08cd8532…1b9`）与 diagrams 1.1.1（`23516924…8a19`），从冻结夹具开始；不使用开发服务器或私有 IPC 驱动产品行为。原生追踪仅在环境变量明确启用时记录固定元数据，不记录正文；有界非阻塞队列保留原执行 watchdog。

| 正式 run                        | 真实结果                                                                                                           | 仍需区分的边界                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `product-multi-html`            | 首次/重复各 3 幅真实 SVG，节点/箭头/引用/唯一 ID、正文标记及离线像素通过                                           | 首次有 incomplete 警告；重复无。两份分别与此前相应基线文件字节相同，不能声称 native 性能改善            |
| `product-a4` / `product-letter` | A4 1 页、Letter 横向 2 页，三图可见，实际页面留存                                                                  | 首次均有 incomplete 警告；Letter 警告单占第 2 页；复制搜索仍失败                                        |
| `product-print-02`              | GTK Print-to-File 首次与重复各 7 页；图表页均有三节点、两箭头；100 正文标记完整                                    | 首次脚注回退 `[^p5]`，共 5 条警告；重复脚注正常，仅保留夹具故意缺失/远程图片的 2 条警告。未测物理打印机 |
| `product-large-diagrams`        | 327,594 字节、2,088 行，实际原生大文件 notice 与窗口视图成立；首中尾三图、1,032 正文标记完整                       | 不是此前 180,060 行基准的新复跑；有跨窗口富内容保留源码的通用提示；本夹具三图没有源码回退               |
| `product-cancel-02`             | 取消点击落在原生请求处理区间；无目标发布。真实剪贴板替换 r2、保存 SHA 精确匹配，版本 0→1，再输出含新图与新标签     | 晚结果不会发布旧输出；处理区间包含点击不等于测得瞬时 CPU 活动。r2 重试仍有 incomplete 警告              |
| `product-disable-all`           | 全部已启用插件（含大纲、图表及输出）通过 UI 停用；source/live 各输入→撤销保存→重做保存→恢复原文保存，精确 SHA 通过 | 未改变大纲或插件实现；原本未批准的插件保持停用；本轮未重跑此前 32 格主题/缩放矩阵                       |

[逐请求和失败状态](evidence/v2-product-phase5-export-print/milestone06/native-diagnosis/product-terminal-summary.md)与各 `native/p5-m06-product-*/` 原件共同解释结果。原生请求没有复现执行超时；缺少前端 enqueue 时戳，**实际队列等待未测**。队列因果结论来自真实 RPC 的确定性 RED/GREEN，不从成功 native 样本反推。

两个正式测试驱动失败保持原样：`product-print` 的 GTK Tab 文件名补全误选同前缀截图，尚未产生 PDF；修复驱动后 `print-02` 通过。`product-cancel` 在 WebDriver 非 BMP key actions 输入时重复了三个 emoji 码点，导致 r2 SHA 失败；复跑用已有真实 X11 clipboard helper，原始 fixture 和精确断言均未改。它与仓库已记录的驱动问题一致，但没有输入事件全链追踪，不能据此笼统宣称所有输入路径无缺陷。

原生定向测试 **16 通过、2 忽略**：一个忽略项是由已通过父测试实际调用的私有子进程 fixture；另一个需要真实 display 的 WebKit 资源/无限循环 fixture 未在该 cargo suite 执行。详见[独立复审](evidence/v2-product-phase5-export-print/milestone06/native-diagnosis/final-review.md)。

正式内容审查分别见 [HTML / A4](evidence/v2-product-phase5-export-print/milestone06/artifact-review/product/visual-summary.json)、[Letter / 打印](evidence/v2-product-phase5-export-print/milestone06/artifact-review/product-pdf-print/review.json)、[大文件](evidence/v2-product-phase5-export-print/milestone06/artifact-review/product-large/screen/review.json)和[取消后 r2](evidence/v2-product-phase5-export-print/milestone06/artifact-review/product-cancel/screen/review.json)。

**仍未解决的事项：**

- 历史 Print04 的 `render_1` 是 native dispatch 后约 **2000.313 ms** 超限；旧记录缺少 renderer 内部阶段和完整请求关联。本轮队列问题发生在不同的期限起点，修复它不能把该历史原生失败结案。成功重跑也不能证明历史失败消失。
- PDF Unicode 精确复制/搜索仍 **blocked**。现有 WebKit 原文与 glyph cluster 传输缺口未完成引擎修复；不能用规范化文本或 pypdf 单一结果声称正确。
- 长块标题与首内容保持同页等分页问题仍 **blocked**；本轮没有引擎分页或容器结构修复。
- 最终真实 HTML/PDF/打印产物的图表可见性、源码回退及告警必须逐份检查；候选实验中的 incomplete 警告不得删掉或计为完整成功。物理打印机实测若未进行，继续标记未验证。

产品保持现有系统 WebKit 依赖，没有恢复 Chromium PDF 后端、捆绑或下载浏览器/字体/runtime，没有上传、发布或合并。本报告不包含 Windows/macOS 验证，也不扩大既有 Linux 验收范围。独立研究产物检查中如使用现有系统 Chromium，它仅是查看器，不构成产品引擎替换或相关问题已解决的证明。

本轮结论限定为修复已证明的导出准备与执行期限混用；不表示所有 Mermaid 超时、PDF Unicode 和分页问题已修复。

提交沿用仓库已记录的单次 `SKIP_SIMPLE_GIT_HOOKS=1`：遗留 Electron hooks 调用 v2 未配置的 `lint-staged` 与不存在的提交脚本，首次提交在旧 npm 缓存路径失败；原日志保留。实际 v2 全仓检查已通过，未修改钩子、全局 Git 配置或安全设置。
