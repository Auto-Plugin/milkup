# P4 Markdown 扩展：公式、图表与脚注

本轮基线 `2184526ddfaeef6ae1e80008f0ee90e41be9fdec`，独立分支 `dot/milkup-v2-product-phase4-markdown-extensions`。当前为实现与验收中的报告；未列出实际结果的检查均不代表通过。

## 审计与设计

既有 Markdown 扩展只有正则匹配和整行 renderer，不能可靠表达跨行范围、隔离同步死循环、证明窗口前缀上下文或避免异步旧结果覆盖新编辑。窗口化视图没有对应受控渲染入口。现有所谓 incremental parse 实际重新解析全文，不能宣称本轮实现了完整增量语法算法。

新增三个独立 Worker 插件，仅依赖公开 SDK 0.3.3（兼容 0.3.2）与列明的第三方库：

- `math`：行内 `$…$`、独占行 `$$` 块、`math` 围栏。固定 KaTeX 0.19.0 的公开 `renderToString` 输出 MathML，经有界转换映射到封闭语义树。拒绝信任命令、外部 URL/HTML、危险扩展；每公式独立宏环境。不使用 KaTeX 私有解析入口。
- `diagrams`：明确子集的 Mermaid flowchart/graph、sequenceDiagram、pie。纯 Worker 解析与布局，输出受控矢量几何；不依赖 Mermaid 的 DOM 渲染器，不声称完整 Mermaid 兼容或像素一致。未知指令整图回退源码，不能漏画一部分后显示为成功。
- `footnotes`：引用、定义及四空格/tab 续行的有界后台索引；首引用编号、首定义生效、重复定义和缺失目标有诊断。只替换定义标记，正文保留基础编辑器呈现与映射，续行仍可直接编辑。跳转绑定文档与版本，扫描未完成不能误报“定义不存在”。

宿主只提供通用窗口读取、文档上下文、受控语义树、渲染生命周期与位置导航，不包含上述插件 ID 的业务分支。普通及窗口化视图共用呈现层，source 始终是原文；live 预览不参与光标、选区、复制和搜索文本映射，编辑时同步恢复原文。

## 预算与故障处理

输入最多 64 Ki UTF-16/256 行；输出最多 256 KiB JSON、4096 节点、深度 64、128 片段。单插件最多一个执行、两个排队，2 秒 watchdog 终止超时 Worker/进程并撤销能力，需手动重新启用。取消调用不会提前撤去尚未结束执行的 watchdog。宿主和视图均复核文档版本、身份和渲染代次。

窗口上下文有界续扫，未知嵌套及不能证明的前缀保留源码。脚注索引分批读取完整逻辑行，CRLF 偏移由宿主元数据给出，不截断后误定位。所有超限都保留原文。插件自身的更小语法/布局预算见各插件 README。

旧 Worker 能力防护不等于针对恶意第三方代码的完整安全沙箱；现有动态模块/全局对象威胁模型仍为 P6 专项。本轮保证文档内容不能借由这三个审计过的渲染器注入 HTML、URL、事件或脚本，不借机宣称整个插件沙箱已经重做。

## Markdown 覆盖与后续范围

下表对照本轮基线 `2184526` 的覆盖审计，描述当前实现范围，不代替后文的候选包验收结果。公式、图表、脚注新增了下列有界能力，属于阶段交付；尤其 Mermaid 子集不等于达到 Typora 图表目标，也不能据此将 P4 标为完整完成。不表示完整 LaTeX、Mermaid 或 CommonMark 兼容。SDK 0.3.3 保留旧公开合同；三个新插件依赖新增文档呈现能力，不表示旧 0.3.2 宿主可直接运行它们。

| 能力           | 当前实际支持                                                                                                                                                                                         | 相对基线与仍未支持的边界                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 标题与常用格式 | 保留独立 formatting 的 ATX 1–6、粗体/斜体/删除线、直接链接、列表/任务、引用、行内代码与围栏 toggle；基础解析另支持 Setext，live 任务项保留交互                                                       | **上轮能力保留**。未知嵌套上下文仍保守拒绝结构操作；引用式链接解析、任意复杂嵌套及完整 CommonMark 兼容未在本轮补齐。                                                                                                                                                                                                 |
| 表格           | 保留真实行列增删、对齐、单元格设置/清空、选中及退出操作，继续走受版本约束的公开编辑事务                                                                                                              | **上轮能力保留**。仍受完整表格上下文、16 列及编辑快照预算等限制，不保证任意尺寸表格都可操作。                                                                                                                                                                                                                        |
| 本地图片       | 保留 PNG/JPEG/WebP 选择、可信粘贴、相对资源目录、另存迁移/恢复保护及 live 预览；source 保留 Markdown                                                                                                 | **上轮能力保留**。拖入、网络图片导入、未命名草稿持久暂存、引用式图片安全迁移没有新增实现，资源预算见下文。                                                                                                                                                                                                           |
| 公式           | 新增行内 `$…$`、独占行 `$$` 多行块与完整 `math` 围栏；分数、根式、上下标、求和积分、矩阵、aligned/cases、常见重音及数学 Unicode 转为受控 MathML                                                      | **基线缺口在子集内已解决**。不是完整 LaTeX；跨公式宏、自动编号/引用、HTML/URL/图片/颜色扩展及不在安全树内的输出拒绝。单式 8 Ki UTF-16；跨出可信请求窗口、未知上下文或不完整公式保留源码。详见 [math 范围](../plugins/math/README.md)。                                                                               |
| 图表           | 新增完整 `mermaid` 围栏的 flowchart/graph TD/TB/LR（矩形、圆角、菱形、有向标签边、回边/自环/孤立节点）、sequenceDiagram（participant/actor、实线/虚线箭头及 self 消息）、pie（标题、非负十进制数据） | **阶段子集已实现，Typora 图表目标仍未完成**。不支持子图、配置、样式、点击动作及其它未列语句；整图回退，不漏画。纯 Worker 输出主题 token 矢量树；32 Ki 源码、100 节点/200 边、标签 256 UTF-16，复杂图可更早达到几何/输出预算。详见 [diagrams 范围](../plugins/diagrams/README.md)。                                   |
| 脚注           | 新增 `[^id]` 引用、独立定义、四空格/tab 续行；首引用编号、首定义生效、重复/缺失诊断；引用跳转与每定义至多八个返回按钮均绑定文档/版本。只呈现定义标记，正文/续行保留基础编辑映射                      | **基线缺口在有界索引内已解决**。label 为 trim/NFC 后大小写敏感；分批索引覆盖窗口外定义，但最多读取 8 Mi UTF-16、200,000 行、4096 个定义/引用。未知容器、取消、超限或未完成索引保留 partial 状态，不能当作目标不存在；超过八个引用只提示总数，不提供无限回链。详见 [footnotes 范围](../plugins/footnotes/README.md)。 |

图片与资源边界继续按[上轮报告](v2-product-phase4-editing-resources-2026-10-15.md)保留：迁移扫描最多 4 Mi UTF-16 和 4096 个引用；超文本预算仅继续流式检查 `![` 候选，没有候选才可证明不需迁移，有候选则明确拒绝安全迁移。引用式图片、需实体解码或无法证明的本地目标语法不能静默跳过。未命名文档导入前仍需首次保存；显式恢复导出仍只有 Markdown，不是含图片归档。本轮没有消除这些 P4 资源后续边界。

P5 尚无独立完整导出/打印产品链路。当前需要明确保留的输出缺口如下：

- 既有 `packages/export` HTML 转换仍缺删除线分支及任务 checkbox 语义，URL 只做属性转义、没有完整 scheme 策略；原有公式路径仍是 `math` class/data-math 占位文本，尚未接通本轮 MathML 呈现结果。
- 新安全 serializer 只提供经校验的语义序列化基础。矢量的 foreground/background/accent 等 token 目前统一输出为 `currentColor`，没有完成图表导出配色映射；不能据安全序列化已存在而宣称背景、文字与线条可读性已完成。
- 脚注 reference 目前序列化为带源范围数据的 span，尚无输出文档中的定义 anchor、编号链接和多返回链接合同。编辑器内受版本约束的跳转不等于 HTML/PDF 导航已经实现。
- 离线图片/字体资源、受控输出目标、取消与原子提交、大文件输出、实际 PDF/打印分页仍归 P5。复用 screen/export 同源语义不等于已验收最终输出。

数学字形使用浏览器 MathML 与系统数学字体，不承诺与 KaTeX HTML 像素一致。Windows 字体/构建、系统 IME、读屏及打印均需独立实际验证；Linux 或纯函数结果不能替代这些验收，本表不声明它们通过。

## 图表阶段差距与成熟引擎后续方案

当前 `diagrams` 没有使用官方 Mermaid 成熟渲染器，而是自行解析有限语法并布局。这样可以在现有无 DOM 的 Worker 合同内输出封闭矢量树，约束输入、几何、输出及执行时间，并在不支持时保留完整源码。这是本阶段的架构取舍，不是完整 Mermaid 兼容的替代品，也不意味着成熟引擎不能接入。即使本阶段全部验收通过，以下产品缺口仍须保留。

| 范围              | 当前阶段能力与后续缺口                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 节点与方向        | 仅矩形、圆角、菱形及 TD/TB/LR；圆形、体育场形、数据库、子程序、六边形、平行四边形等常见形状和其它方向尚未覆盖。                                                                              |
| 连线与布局        | 已有有向线、纯文本标签、回边、自环；无箭头线、点线、粗线、双向或其它端点、曲线及复杂分支布局仍有缺口。                                                                                       |
| 标签              | 支持有界纯文本及中文/emoji 换行；不能视为完整多行、转义/实体、Markdown 富文本和字体度量兼容。                                                                                                |
| 嵌套              | 未支持 subgraph、嵌套分组、组内方向与跨组连线，不能省略分组后当作成功。                                                                                                                      |
| 样式与配置        | 只有宿主主题 token；节点/连线样式、class、字体、主题变量及安全的逐图配置尚未接入。                                                                                                           |
| 时序图            | 已有 participant/actor、实线/虚线消息和 self 消息；Note、激活条、自动编号、loop/alt/opt/par、创建/销毁参与者及其它消息箭头尚未支持。                                                         |
| 其它图型          | pie 仅基础标题/数据；类图、状态图、ER、甘特图、Git 图、需求图、思维导图和时间线等均未实现。应先固定目标 Typora/Mermaid 版本和验收图型，不能将最新 Mermaid 的全部图型自动算作已承诺或已支持。 |
| Typora 的其它围栏 | Typora 文档还列有独立 `sequence` 与 `flow` 围栏，分别使用 js-sequence 与 flowchart.js；它们不等同于 `mermaid` 围栏，本轮没有实现。                                                           |

上述差距以官方 [flowchart 语法](https://mermaid.js.org/syntax/flowchart.html)、[时序图语法](https://mermaid.js.org/syntax/sequenceDiagram.html)、[主题能力](https://mermaid.js.org/config/theming.html)、[图型目录](https://mermaid.js.org/intro/)及 [Typora 图表文档](https://support.typora.io/Draw-Diagrams-With-Markdown/)为对照。任意脚本回调、外部网络和原始 HTML 不必因兼容目标而开放；必要的安全限制应与尚未实现的语法分别说明。

成熟引擎与现合同的主要衔接问题是 DOM 与输出形式。官方 [`render` 结果](https://mermaid.js.org/config/setup/mermaid/interfaces/RenderResult.html)包含 SVG 字符串及可选 `bindFunctions`；[当前官方实现](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/mermaidAPI.ts)使用 DOM 容器和样式参与渲染。公开 [`parse`](https://mermaid.js.org/config/usage.html#syntax-validation-without-rendering)用于语法验证，并非可直接替换现合同的完整布局 AST。因此，仅在 Worker 安装 Mermaid 依赖并不能完成接入；也不能把返回的 SVG 字符串直接插入宿主 DOM。现有矢量树还缺路径曲线、变换、裁剪、局部标记及丰富文字样式等表达，删除这些内容后仍返回“成功”会造成漏画。

后续实施按以下原型顺序评估，**尚未实现，也不是已通过的安全合同**：

1. 固定目标 Typora 与 Mermaid 版本，建立常用图型、节点、连线、标签、嵌套和样式语料库，分清支持、延期与安全禁止项。优先验证成熟引擎复用，不以持续补写自制解析器来宣称完整兼容；同时核验目标 WebKit/WebView 运行时、依赖和离线字体。
2. 原型验证通用的隔离 DOM 渲染任务能力：插件拥有 Mermaid 及业务配置，宿主只提供受预算、版本和生命周期控制的执行与结果通道。执行单元不得获得编辑器、文件、网络或宿主 IPC 权限，并须能在同步卡死时由外部强制终止。独立进程或可独立终止 WebView 是待比较方案；普通 iframe 不等于进程隔离，也不能据此保证 CPU 超时可终止。
3. 以 `securityLevel: 'strict'`、关闭 HTML 标签布局/自动扫描、限制文本和边数量、保护安全配置及白名单逐图配置作为防护候选；不执行 `bindFunctions`。官方 [安全选项](https://mermaid.js.org/config/usage.html#securitylevel)中的 sandbox 是 iframe 机制，[配置合同](https://mermaid.js.org/config/schema-docs/config.html)提供 `maxTextSize`、`maxEdges` 与受保护的 `secure` 配置键；这些都不能代替宿主输出校验和可强制终止的隔离验证。
4. 比较两种受控输出桥接：一是增量扩展 typed vector，以有限数值路径、变换、样式和局部标记表达成熟引擎输出，再逐项验证；二是隔离端生成经尺寸/字节限制、宿主重新解码的栅格资源句柄。两者均不接受任意 SVG/HTML/CSS、脚本、事件或外部 URL；遇到无法安全表达的内容应整图回退。栅格方案的缩放、文字选择与无障碍损失必须明示，不能凭图片可见就宣称矢量兼容目标完成。
5. 用真实成熟引擎输出验收普通/窗口化、source/live、中文与长标签、分组/循环、明暗主题、缩放、取消/超时、文档切换及插件禁用。P5 另行验证离线资源、配色、HTML/PDF/打印和可访问替代文本；Windows、系统 IME、读屏仍需相应平台实际证据。

## 验收记录

**当前为尚未验收的代码检查点。** 因执行器多次断连，按要求先保存并推送隔离分支；检查点不代表 P4 完成，也不触发打包上传或发布。候选 04 正式原生 run02 已失败，64 组显示矩阵尚未开始。

普通文档的源码完整可见、图表 Tab/Shift+Tab、脚注跳转及 source/live 字节一致的保存和撤销重做已实际运行，但 run02 在普通 live 保存阶段记录 math Worker 被停用：render_57 从发出到终止为 2313 ms，同期主线程出现 2289 ms 停顿；其它两个 Worker 的结果也延迟约 2260 ms 才交付。该失败请求没有 Worker 内部完成时标，不能断言插件已完成或确认误杀。随后窗口化请求在 38/18/37 个块之间反复变化，仍需独立定位布局与缓存反馈。保留 2 秒真实执行预算，不以延长期限或移除断言通过门禁。[失败与时序证据](evidence/v2-product-phase4-markdown-extensions/native/deadline-diagnosis-candidate04.json)、[候选状态](evidence/v2-product-phase4-markdown-extensions/candidate04-gates.json)。

候选 04 run01 在窗口化点击前的稳定几何采样遇到瞬间缺失的预览节点；脚本现将缺失记录在原有 15 秒期限内，仍要求稳定、完整可见及命中后才发送真实 pointer。run02 的失败发生在此前的 live root 呈现等待，不能归为已修复的脚本问题。窗口化语义、远距离脚注、完整缩放/主题矩阵及禁用后恢复尚未验收；Linux 结果不替代 Windows。

工作证据目录：`/workspace/milkup-markdown-extensions-phase4-evidence`。先保存新增接口/功能的失败回归，再运行修复后检查；测试入口或环境错误单独记录，不伪装产品失败。最终候选的全仓门禁、原生矩阵、实际截图和 SHA 将在完成后补入本页。

候选 04 已冻结 669 项源码与生成资源，[源码清单](evidence/v2-product-phase4-markdown-extensions/candidate04-source-manifest.json)。本次补齐预览刷新和视图 DOM 替换的焦点连续性：同文档、版本和选区下保留仍有效的预览，替换时仅同步恢复当前仍在预览内的图表或脚注控件；等待期间转到外部控件的焦点不会被抢回，错误、超时、禁用和源码变化会清除失效结果。相关 **229 项单测、类型及 5 项专项浏览器测试通过**，包括普通/窗口化、真实 Tab 往返与外部焦点保护；全仓 **1,657 项单测（144 文件）、类型、格式及构建通过**；完整浏览器 **166 项通过、无重试**（Linux Chromium，4.6 分钟），[日志](evidence/v2-product-phase4-markdown-extensions/browser-full-candidate04.log)。Linux 生产构建及独立解包通过，原生验收失败并继续诊断，详见本节检查点记录。

检查点之后已独立复现窗口请求反复变化的触发链：脚注后台扫描的每次刷新通知都让视图撤掉有效预览，源码布局变短，随后生成大窗口请求，重绘后再发小窗口请求；没有刷新通知时，真实浏览器夹具稳定。普通和窗口化回归各 6 次通知，修前均出现 6 次预览消失空档、12 次请求。现增加独立的后台刷新入口，只在同配置、文档版本和选区下保留已验证预览；配置撤销、主题变化及失效仍硬清除。修后两种视图均为 0 空档、6 次请求，原有 5 项浏览器交互回归通过。没有采用无限扩大的范围缓存。此项尚待新生产候选的原生验证。

脚注索引另增加呈现修订号：只在引用、定义、续行正文、截断或完整/受限状态实际变化时标记更新。扫描无关正文不再每 250 ms 通知；最终脏状态仍会刷新，并遵守原频率上限和取消语义。真实修前回归见 `footnotes/37-revision-refresh-before.txt`；修后 22 项测试通过，包含通知失败保留脏状态重试与末次等待取消。`41-revision-types.txt` 是首次本地 SDK 路径配置错误，`42-revision-types-final.txt` 使用公开 SDK 声明通过，独立包构建验证另行进行。

独立生产 WebKit 机制实验进一步确认误判可能：预热后的真实 Worker 在请求后约 1 ms 完成并发出结果；主线程同步阻塞 2400 ms 后，原始 RPC 客户端先执行超时回调，在结果交付前终止 Worker。实验未使用端点门闩或重排，真实死循环对照仍在约 2001 ms 终止。[实验结果](evidence/v2-product-phase4-markdown-extensions/native/deadline-mechanism/webkit-result.json)。这证明该引擎中的机制缺陷，不是对原 render_57 内部状态的回溯证明。

2026-10-16 的真实 WebKit 原型验证了独立监督 Worker：主线程阻塞 2400 ms 时，快速子 Worker 的结果在 62 ms 完成仲裁，死循环子 Worker 在 2000 ms 到期、2001 ms 被终止。[原型结果](evidence/v2-product-phase4-markdown-extensions/native/deadline-mechanism/supervisor-webkit-20261016-summary.json)。另以独立观察者和 OS 线程采样核验父 Worker 终止的清理效果：持续消耗 CPU 的子线程在父终止后 15 ms 消失，WebView 与观察者继续响应。[清理证据](evidence/v2-product-phase4-markdown-extensions/native/run-candidate04-busy-child-20261016-01/summary.json)。这些是当前 Linux WebKit 的独立机制实验，不能代替最终生产实现验收或 Windows 验证。

生产实现现将渲染仲裁移至可信监督单元：Worker 由不加载插件代码的父 Worker 持有固定 2000 ms 单调时钟截止时间；侧车由原生 Rust 实例持有同样期限，在向 WebView 交付事件前判定结果是否完成，超时先终止进程。成功响应保留插件实例与状态；取消不撤除或重置期限。控制事件与插件输出分层，结果语法在客户端和监督端一致；缺少成功值、非法错误类型或额外字段均不能解除期限。侧车使用实例 ID 隔离旧事件和停止请求，阻塞 stdin 不持有进程控制锁。Worker 的 1000 ms 退出确认回退仅用于清理父执行单元，不延长渲染期限。第三方自定义端点若未接入可信仲裁仍沿用原有客户端定时器，不据此宣称任意宿主都已迁移。

本次未改变 SDK、core 或共享 CSS；新增能力位于宿主内部。全面 stdout 配额、子孙进程治理和恶意插件沙箱继续属于 P6。最终生产候选尚待下文记录；实现单测或原型通过不等于 P4 已完成。

候选 05 冻结 676 项源码、配置、测试及预装资源。全仓 JavaScript 单测 **1,682 项、146 文件通过**，类型、格式及构建通过；完整 Rust **126 通过、1 忽略**，rustfmt 通过。[门禁记录](evidence/v2-product-phase4-markdown-extensions/candidate05-gates.json)、[单测](evidence/v2-product-phase4-markdown-extensions/full-unit-candidate05.log)、[Rust](evidence/v2-product-phase4-markdown-extensions/rust-tests-candidate05.log)。完整浏览器结果为 **166 通过、2 失败、零重试，10.7 分钟**：脚注导航用例尚未进入导航时，初始引用预览未在 5 秒内出现；Updates 用例尚未进入禁用/编辑时，启用后的状态仍为已禁用。[完整日志](evidence/v2-product-phase4-markdown-extensions/browser-full-candidate05.log)。候选 05 因此未构建生产包，也未开始原生验收。中间一次测试夹具用对象展开丢失原型方法，产生 441/442 失败，修正后本次全仓通过；原单测失败日志保留，类型失败日志曾被覆盖的事实另有[记录](evidence/v2-product-phase4-markdown-extensions/native/deadline-mechanism/verification-log-provenance-20261016.txt)，不将其冒称为保留的原始日志。

两次独立被动诊断未复现自然失败，不能据此宣称原失败原因已经确定。脚注诊断确认夹具在 1734 ms 返回时，三个 Worker 尚未激活；实际激活在 2060、2404、2693 ms 完成，引用在 2879 ms 出现。原夹具预种 `enabled` 后只检查其数量，等待条件本身无效；`updatedAt` 也不能证明激活，因为目录初始化会先改时间。[启动记录](evidence/v2-product-phase4-markdown-extensions/browser-startup-diagnosis/run01-summary.json)。Updates 的独立启用记录成功，且该诊断前有一个同夹具用例预热，不能称为冷启动复现。[记录](evidence/v2-product-phase4-markdown-extensions/browser-updates-diagnosis/run01-summary.json)。

随后只在测试中将首次 Worker 模块加载延迟 5500 ms，两项均取得真实旧失败、新通过证据，且启用成功仍在宿主既有 10 秒启动期限内。Markdown 夹具现等待成功启用审计及当前 enabled 状态；Updates 仅“已启用”的启动断言使用既有 10 秒期限。渲染的 2 秒执行期限、脚注出现的 5 秒断言以及编辑/保存断言不变。[受控红绿汇总](evidence/v2-product-phase4-markdown-extensions/browser-startup-diagnosis/controlled-red-green-summary.json)。人为加载延迟证明准备阶段门禁缺陷，不冒充原自然失败的时序复现。

候选 06 冻结 676 项文件，与候选 05 只差上述两个测试文件，产品源码及生成预装资源完全一致。[继承证明](evidence/v2-product-phase4-markdown-extensions/candidate06-gate-inheritance.json)据此沿用已通过的全仓单测、类型、前端构建及 Rust 结果。完整浏览器复跑 **168 通过、零失败、零重试**，[日志](evidence/v2-product-phase4-markdown-extensions/browser-full-candidate06.log)；全仓格式检查通过。Linux 生产 DEB 构建、独立解包和构建后 676 项冻结文件核验通过。[产物证明](evidence/v2-product-phase4-markdown-extensions/native/candidate06-provenance.json)中的 DEB SHA-256 为 `f205d262486fc7c85174aaa3f8adf27749798f77aa9aac31589ebed15e96ea84`，实际运行二进制 SHA-256 为 `2f39d6df705618ae8dcd8aa9e73913583acb729e9044334ea2e514cb7201c10d`；原生 run01 在窗口化脚注预览等待阶段失败，不能由浏览器结果替代。

候选 06 正式原生 run01 已完成三份外部包的真实安装、普通文档语义与 source/live 保存和撤销重做，以及窗口化公式/图表源码揭示和图表键盘焦点往返；随后 `live footnotes presentation` 在原有 30 秒期限内未出现。失败截图中视口已到 `END-SAMPLES` 后的正文，但选区仍为脚注标记行的 416–432；关闭搜索前标记顶部已为 −224，关闭后为 −341。三个呈现插件均保持 enabled 且无错误；脚注后三个请求成功返回空片段，没有 supervisor 超时事件。现有日志没有请求的完整绝对范围，尚不能确定滚动漂移的具体触发点。[原始失败与摘要](evidence/v2-product-phase4-markdown-extensions/native/candidate06-run01-failure-summary.json)、[实际截图](evidence/v2-product-phase4-markdown-extensions/native/run-candidate06-run01/FAIL-webview.png)。64 组显示矩阵完成 0 组，远距离脚注、全部禁用与恢复仍未验收；下一步在独立诊断运行中记录范围和连续几何，不修改正式断言或放宽预算。

独立轻量诊断 seek02 重现了同一失败，补齐连续几何和绝对请求范围：111359 ms 时脚注标记顶部 184.75、编辑区顶部 154，目标可见；111433 ms 的 DOM 换窗从 11–86 行变为 12–87 行，scrollTop 从 1045 增至 1358，目标同步上移 313 像素。后续请求起点依次为 288、416、434、461、463、501，脚注成功返回的片段数为 3、3、3、1、1、0；最后范围已排除所有脚注，索引也已完成。三插件保持启用、无监督器超时，证实这是窗口位置丢失导致范围改变。[诊断摘要](evidence/v2-product-phase4-markdown-extensions/native/candidate06-seek02-summary.json)。较重的独立 seek01 诊断则在更早阶段出现三个真实监督器超时，未复现原脚注路径；没有充分证据认定其原因，单独保留[记录](evidence/v2-product-phase4-markdown-extensions/native/candidate06-seek01-summary.json)，不将它计为原失败或修后通过。

窗口替换现先记录仍有效预览下的可见源码行身份与位置，在同文档、版本、配置和选区下同步重用既有结果，再对新 DOM 的同一行恢复位置；没有预览焦点也按此处理，用户滚离选区则保持阅读行。新文档、版本变化、source 模式或新窗口没有旧行时不套用旧锚点；外部焦点不被抢回。Source 窗口的四项范围元数据同时移入 DOM 替换回调，避免新行测量使用旧范围。没有扩大缓存范围、改变 CSS/API 或延长预算。两个锚点回归真实修前各偏移 179 像素，真实 Source 换窗回归修前读到 declared 1–6 / actual 48–55；修后相关 238 项单测和类型通过。7 项浏览器通过，随后将新增导航断言加强为全部 20 次连续采样并单独再验通过，原文、版本、选区不变。[完整红绿证据](evidence/v2-product-phase4-markdown-extensions/view/105-window-replacement-summary.json)。候选 07 已冻结，仍须新的生产原生验收。

候选 07 全仓单测 **1,689 项、146 文件通过**，类型、构建、全仓格式检查通过；完整浏览器 **168 项通过、零失败、零重试，7.2 分钟**。[门禁](evidence/v2-product-phase4-markdown-extensions/candidate07-gates.json)、[浏览器日志](evidence/v2-product-phase4-markdown-extensions/browser-full-candidate07.log)。冻结的 676 项源文件与候选 06 仅差两处视图实现及两处测试；Rust、公开 SDK 和外部插件未变，沿用对应已通过证据。[继承证明](evidence/v2-product-phase4-markdown-extensions/candidate07-gate-inheritance.json)。Linux 生产构建及独立解包通过，构建后 676 项冻结源码无变化。[产物证明](evidence/v2-product-phase4-markdown-extensions/native/candidate07-provenance.json)记录 DEB SHA-256 `ebcc49c227960d3b668bc258ca5f129f74621a7c993372f716c6e658755d108b`、实际解包二进制 SHA-256 `fe27bd3cbed38f1ff42704ee90aece1dec223d1b2f9066a7fc559fadaf0b5849`。全新 profile 的正式原生 run01 已通过普通文档语义、source/live 保存历史，以及窗口化近端脚注预览、键盘焦点、定义与返回（即候选 06 的失败边界）；随后在远距离引用准备的原有 90 秒期限内未出现预览而失败。搜索完成时远端标记仍在视口内，之后未出现新的插件渲染请求，三插件均启用且无错误；宿主上下文与窗口更新路径正独立诊断。显示矩阵完成 0 组，远端脚注、窗口化保存历史、全禁用与恢复尚未验收。[失败现场](evidence/v2-product-phase4-markdown-extensions/native/run-candidate07-run01/failure.json)、[近端修后实际截图](evidence/v2-product-phase4-markdown-extensions/native/run-candidate07-run01/windowed-footnote-keyboard-focus-x11.png)。

候选 07 的独立远端诊断随后在约 41.1 秒完成上下文准备，但末尾引用经 Tab 进入输入代理后，Shift+Tab 未返回。轻量键盘诊断确认引用节点始终连接，WebKit 的反向 Tab 事件为 `key=Unidentified, code=Tab, shiftKey=true`；捕获阶段和微任务的 `defaultPrevented=false` 不能证明整个事件未被后续处理。另一轮带额外观察的诊断在更早图表阶段出现监督器超时，未到达远端目标；其 Tauri invoke 包装因属性只读而未安装，零条宿主记录不能当作没有调用。[远端准备与焦点](evidence/v2-product-phase4-markdown-extensions/native/candidate07-remote01-summary.json)、[观察失败边界](evidence/v2-product-phase4-markdown-extensions/native/candidate07-remote02-summary.json)、[轻量键盘记录](evidence/v2-product-phase4-markdown-extensions/native/candidate07-remotekeys01-summary.json)。独立诊断成功准备不覆盖正式 run01 的失败。

受控浏览器回归进一步发现实际数据风险：普通和窗口化视图的末尾引用往返都会误删首行两个空格，版本与撤销记录各增加一次。视图现只识别紧邻的、真实预览 Tab 进入输入代理的导航状态，让浏览器处理反向 Tab；其他编辑、指针、外部焦点和预览更换会取消该状态。未重排 DOM、跳过输入区或强制转移焦点，普通文本 Tab 缩进保持原行为。另一个受控单测证明，宿主准备达到既有 10 秒期限后，即使提供者已经结束，稳定视口也没有自动续扫；读取器检查点、取消和版本切换本身通过。两项均需新的生产候选验收，不能把这组结构性复现当作正式远端失败的唯一因果证明。续扫现只在超时 provider 真正结束后，按原 1 秒退避对仍匹配的文档/版本/选区/窗口继续；同窗口未结束读取不叠加任务，普通错误及正常未知上下文不自动重试。16 项新增续扫回归及 51 项原呈现测试、类型检查通过；准备每次 10 秒及插件执行 2 秒预算保持不变。[续扫红绿证据](evidence/v2-product-phase4-markdown-extensions/native/preparation-retry-summary.json)、[焦点红绿证据](evidence/v2-product-phase4-markdown-extensions/view/112-preview-navigation-summary.json)。

候选 08 最终冻结 677 项文件，产品范围仅为上述焦点和续扫修复；插件、公开 SDK、Rust 与预装包未变。全仓单测 **1,708 项、147 文件通过**。首次全仓类型检查发现新增慢源测试直接对同步值/Promise 联合返回类型调用 `.catch()`；改为 `Promise.resolve` 后，受影响 9 项测试及全仓类型检查通过。原冻结清单和失败日志保留，[最终清单](evidence/v2-product-phase4-markdown-extensions/candidate08-final-source-manifest.json)与[夹具修正记录](evidence/v2-product-phase4-markdown-extensions/candidate08-fixture-correction.json)明确区分；产品源码未因该类型错误改变。构建通过，证据 JSON 统一排版后全仓格式检查通过。完整浏览器 **182 项通过、零失败、零重试，5.3 分钟**，[日志](evidence/v2-product-phase4-markdown-extensions/browser-full-candidate08.log)。Linux 生产 DEB 构建与独立解包通过，构建后 677 项冻结文件无变化。[产物证明](evidence/v2-product-phase4-markdown-extensions/native/candidate08-provenance.json)记录 DEB SHA-256 `47c1569ae04f187615481151b0a02bf9d5c87d584490cd1698b8c1781059fac1`，实际运行解包二进制 SHA-256 `ffc26d6c38551247a7d8b9164d17eb81c14770260ddb6ea3a12aade35354e97e`。原生验收待运行，[门禁状态](evidence/v2-product-phase4-markdown-extensions/candidate08-gates.json)。

脚注更新后重新在仓库外安装冻结公开 SDK、构建和运行 22 项测试通过；十插件当前源码/资源及 SDK 字节核验通过，总计 327 项，未变化插件沿用相应冻结结果。新脚注外部包 SHA-256 为 `531481d11059563cffac0e0372c911a857ac903d92e5acbd597596efa2d5bfed`，旧包和候选 04 证明保留。

候选 04 `.deb` SHA-256 为 `be903a8533d02177e77e4607ab4ff88bb9a539bac2fa2ec90b913fce36ba4928`，实际运行的解包二进制 SHA-256 为 `1b94f76b6ac09d31483e4c5a7355122a83afe9c86577028a18e4baca3fe0aa55`。[产物证明](evidence/v2-product-phase4-markdown-extensions/native/candidate04-provenance.json)记录与 release 二进制的区别；生产构建后冻结清单无变化。

候选 03 历史冻结 669 项源码/配置/测试及生成预装资源，较候选 02 仅修改视图、相关回归和原生验收脚本。全仓单测 **1,653 项、144 文件通过**，类型、格式与构建通过；完整浏览器 **166 项通过、无重试**（Linux Chromium，5.4 分钟），[日志](evidence/v2-product-phase4-markdown-extensions/browser-full-candidate03.log)；原生失败另见下文。详见 [源码清单](evidence/v2-product-phase4-markdown-extensions/candidate03-source-manifest.json)、[单测](evidence/v2-product-phase4-markdown-extensions/full-unit-candidate03.log)、[类型](evidence/v2-product-phase4-markdown-extensions/full-types-candidate03.log)、[格式](evidence/v2-product-phase4-markdown-extensions/full-format-candidate03.log)、[构建](evidence/v2-product-phase4-markdown-extensions/full-build-candidate03.log)。

候选 03 Linux `.deb` 构建及独立解包通过，[产物证明](evidence/v2-product-phase4-markdown-extensions/native/candidate03-provenance.json)与[构建日志](evidence/v2-product-phase4-markdown-extensions/linux-production-candidate03.log)已保存。`.deb` SHA-256 为 `083dbcf6a4de6bad9875b56ba5fbb6374c0327abfd955a31dc2b4c06f0b25f01`，实际原生运行二进制 SHA-256 为 `eef67bed4cd0da17ab1f8c7dc94319c5f9e07c6ac3af4df7c8d55b5160f99dfa`。生产构建后 669 项冻结清单复核无变化；原生使用全新 profile。

候选 03 原生 `run01` 在安装列表未滚回图表卡片时被严格点击检查拒绝；仅对列表卡片增加公开 focus 揭示后再真实 pointer，记录于 [测试脚本修正](evidence/v2-product-phase4-markdown-extensions/candidate03-harness-revision.json)，正文预览断言未变。正式 `run02` 完成三个外部插件安装/启用，普通公式源码行、光标及选区完整可见，并通过图表 pointer 激活；随后图表 Tab/Shift+Tab 往返失败。原生事件诊断确认 Tab 已移至下一个图表，但异步预览 DOM 替换移除了焦点节点，activeElement 变为 BODY。因此候选 03 原生验收失败、显示矩阵未完成，需修复并生成新候选。带额外观察的诊断后来通过脚注和回退场景，不能代替原正式失败。

候选 02 的历史门禁如下；原生交互失败单独记录，不能由这些结果替代。

| 检查                 | 结果与证据                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全仓 JavaScript 单测 | **1,649 通过，144 文件**；[日志](evidence/v2-product-phase4-markdown-extensions/full-unit-candidate02.log)                                                                                                                                                           |
| 全仓类型、格式、构建 | 全部通过；[类型](evidence/v2-product-phase4-markdown-extensions/full-types-candidate02.log)、[格式](evidence/v2-product-phase4-markdown-extensions/full-format-candidate02-2.log)、[构建](evidence/v2-product-phase4-markdown-extensions/full-build-candidate02.log) |
| 完整浏览器回归       | **166 通过**，Linux Chromium、无重试；[日志](evidence/v2-product-phase4-markdown-extensions/browser-full-candidate02.log)                                                                                                                                            |
| 十插件仓库外独立验证 | **319 通过**，类型/构建/公开 SDK 安装字节及源码资源一致性核验通过；[证明](evidence/v2-product-phase4-markdown-extensions/external-compat/verification.json)                                                                                                          |
| Rust                 | **118 通过、1 忽略**，直接运行已编译测试二进制；[日志](evidence/v2-product-phase4-markdown-extensions/rust-tests-direct.log)。proot 的四项文件系统相关失败另外保留，没有修改 Rust 源码                                                                               |
| Linux 生产构建       | `.deb` 构建、独立解包及二进制 SHA 核验通过；[构建](evidence/v2-product-phase4-markdown-extensions/linux-production-candidate02.log)、[产物证明](evidence/v2-product-phase4-markdown-extensions/native/candidate02-provenance.json)                                   |

候选 02 `.deb` SHA-256 为 `c4fc036978d66c45115265671d02703c7f8558af7a997ccedbd5fa7bbdb776db`；实际运行的解包二进制 SHA-256 为 `edada692e64db3e1ec14ab7cb3392a30b8c6910f0c7bf8033a19dd48698c1592`。Tauri 打包会修改 bundle 类型元数据，不能把未解包 release 二进制的 SHA 混作原生验收 SHA。构建含前端包体大于 500 kB 的常规提示，未将其当作性能验收通过证明。

生产候选 01 的原生运行实际发现 CRLF 显示公式范围错误：数学插件返回的闭合行范围多包含一个 `\r`，视图完整范围校验拒绝显示矩阵。修复保留真实下一行 UTF-16 偏移，但让片段终点与行内容终点一致；不放宽宿主范围校验。精确范围回归先录得 1 失败 / 55 通过，修复后 56 项通过；真实原生夹具的上下文→数学插件→核心校验同样从失败变为通过。该修复需要新的生产候选，不能计入候选 01 的通过证据。

同一次运行还出现图表 Worker 执行超时并被停用。原始失败日志、截图与 profile 均保留；独立 Node 调用和另一轮原生 WebKit 诊断返回正常，不足以宣布首次超时已修复。其原因和最终候选结果仍需在本页补齐。

原生坐标诊断另确认搜索后的异步滚动偏移：选区最初可见，图表重新布局后被推至视口之外。呈现层原本总是保持视口首行的位置；现在优先保持重绘前可见的选区端点所在行，选区已离屏时仍保持阅读位置。新增回归先录得 1 失败 / 33 通过；修后相关 221 项视图测试和 5 项浏览器测试通过，包括普通/窗口化、CRLF 矩阵、用户滚离选区和逐字搜索。没有放宽原生可见性断言，也没有改变 CSS 或插件执行预算；原生修后结果需由候选 02 验证。

候选 02 的原生运行通过三个外部插件的实际安装、公式/图表交互和脚注首次跳转，随后发现非空选区按方向键未折叠。普通与窗口化视图中的边界判断把“光标位置未变化”误判为无需处理，即使仍有选区。精确回归先录得 4 项失败，修正后相关 225 项视图测试及 5 项浏览器测试通过；这些改动晚于候选 02，必须由新生产包验收。候选 02 原生矩阵未完成，不能标记通过。

2026-10-15 12:56 UTC 左右执行环境断连，源码和既有证据仍在工作区；恢复后核验分支、HEAD 和候选包 SHA 一致，原诊断进程已退出，`source01` 没有输出几何结果。新建 `source02` 目录继续诊断，没有覆盖或把中断当作产品失败。该诊断进一步确认关闭搜索后页面仍漂移：编辑器上边界为 37，公式预览最终在 18–50.3，中心落在标题栏下。原因是启动新预览任务时先恢复源码缩短布局，但未保持该次中间状态的滚动锚点；该中间恢复过程现与最终重绘共用可见锚点；回归先录得 1 失败 / 37 通过，修后 225 项相关视图测试及 5 项专项浏览器测试通过，包含关闭搜索和切回源码完整可见性。修复后的最终原生结果仍待新候选确认。

当前不执行 Windows/Runtime 打包、artifact 上传、Release、部署、真实签名或整合主分支。已批准 Runtime 条款和新上传预算未消耗。

检查点提交沿用旧 hooks 自带的单次 `SKIP_SIMPLE_GIT_HOOKS=1`：容器遗留 Electron hooks 引用 v2 不存在的 lint-staged 配置和提交脚本；首次调用因旧 npm 缓存路径失败。以本节记录的实际 v2 检查为准，未修改 hooks 或安全设置。

2026-10-16 原执行器恢复后，首先只读核验原工作区、隔离分支及远端仍为 `c160b90201effd56a064c1436c29f0d5bb67721e`；后台刷新、脚注修订号和全部证据仍在，未发现遗留原生进程。按要求优先建立第二代码检查点，状态仍是尚未验收：监督 Worker 原型尚未运行、新候选生产包未构建、64 组原生显示矩阵未完成。未销毁、重置或替换环境，未改变 2 秒执行预算，也未执行 Windows/Runtime 打包、artifact 上传、Release、部署或主分支整合。
