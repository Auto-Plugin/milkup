# beta6 完整官方 Mermaid：安全架构与有限可行性调查

> 后续决策补充：[固定官方渲染服务与PNG输出的具体方案](v2-beta6-mermaid-render-service-decision-2026-10-23.md)给出仅数据输入、独立无Tauri helper、WebView2请求/导航限制、PNG新合同、普通用户权限与精确剩余风险，供选择后再实施。本报告的固定源码与失败证据继续保留；该补充不是已完成实现，也不改变通用DOM/PDF门禁。

本次读取基线 `7189a26a0cb055e96a72bd2655b673e067ba3012`，分支 `dot/milkup-v2-beta6-context`；beta5 交付源码为 `a85db767`。只读审查既有源码、固定依赖与官方文档，新增本报告及 `/tmp` 静态证据。没有修改产品安全代码、门禁、插件库存或依赖，没有启动 DOM/浏览器/不可信插件进程，没有安装 Runtime、修改系统安全、运行 CI、提交或推送。

## 结论与目前可推进的路线

**当前约束下，没有已经验证、可以直接开启 Windows 完整官方 Mermaid 的后端。** 官方 Mermaid 12.2.0 完整实现已在仓库中冻结，但其正式渲染和现有安全转换均需要真实浏览器 DOM、字体与 SVG/CSS 布局。将它装进 Worker、把 `htmlLabels` 设为 false、使用 OffscreenCanvas，均不能提供这些 API。重新编写其布局或用近似测量模拟 DOM，会再次成为用户不接受的自制实现。

保留既有合同的目标架构仍是：**独立插件中的完整官方引擎 → 可独立硬终止且资源受 OS 限制的 DOM helper → 现有闭合类型数据 → 宿主独立验证 → 静态图片**。Windows 的该执行边界尚未成立；[W0](v2-windows-w0-isolation-2026-10-20.md)与[重复 UDP 诊断](v2-windows-w0-udp-diagnosis-2026-10-20.md)已实际否定当前 AppContainer / 零 capability 足以拒绝全部网络的假设。不能删除门禁或把没有观察到某一种请求当作修复。

可立即完成的是固定全量目标、审计完整依赖、补齐逐图型验收规格与准确平台状态。继续扩大 Windows 自制 flow/sequence 收集器不能完成本次需求；把全部图型送进主 WebView 也不是原合同内的修复。需要执行的新路线必须先有具体架构授权，不能用“官方依赖可信”默认获得权限。本文末尾列出两个可审核的后续研究目标及各自限制；当前并未选择或执行它们。

## 实际交付与完整引擎必须分清

| 项目           | beta5 Windows 路径                                                   | 仓库现有完整官方路径                                                              |
| -------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 源码           | `plugins/diagrams-worker`                                            | `plugins/diagrams`                                                                |
| 插件 ID / 版本 | `milkup.diagrams` / 1.2.0                                            | `milkup.diagrams` / 1.1.1                                                         |
| 执行环境       | `host: worker`                                                       | `host: dom`，当前只实现 Linux                                                     |
| 引擎           | 从官方 12.2.0 提取的 flow/sequence 两个 parser；自制收集器和静态布局 | `import mermaid from 'mermaid'`，固定完整 `mermaid@12.2.0`，官方 `mermaid.render` |
| 输出           | 现有有限 `vector` 原语                                               | `bounded-svg-v1`，宿主复验并重建静态 SVG 图片                                     |
| 当前实际范围   | 基础无环流程图、简单时序图；多种普通语法明确拒绝                     | 完整引擎输入，受安全转换、预算、平台后端及尚未完成的保真验收约束                  |

Windows 库存选择见 [release/bundled-plugins.json](../release/bundled-plugins.json)；手测包脚本还断言 diagrams 为 1.2.0 / worker，见 [prepare-manual-trial-payload.mjs](../scripts/ci/prepare-manual-trial-payload.mjs)。Worker 包的 README 和 `compileDiagram` 都明确写出受限范围，不能将其两个官方 parser 的来源等同于完整官方 renderer。

完整引擎以独立插件构建，不需要把语法代码纳入 Markdown 内核。其 manifest 权限只有 `document:read`；原生 DOM profile 不接受网络 origin、额外 broker 或任意贡献点。底层 host 按通用 profile 工作，不按 Mermaid 或插件 ID 特判。[完整插件说明](../plugins/diagrams/README.md)、[Worker 插件说明](../plugins/diagrams-worker/README.md)、[DOM manifest 校验](../packages/plugin/src/manifest.ts)、[原生后端门禁](../apps/desktop/src-tauri/src/plugin_dom.rs)。

## 固定版本的全量语法入口

本轮按 `plugins/diagrams/build-dependencies.json` 的 SHA-256 白名单核验实际安装的完整包及既有离线研究包。两份 Mermaid 的 68 个已审批构建输入分别全部匹配；当前安装依赖的 2111 个已审批输入也全部匹配。没有重新解锁或下载依赖。

- 包版本：`mermaid@12.2.0`，入口 `dist/mermaid.core.mjs`。
- 入口 SHA-256：`4d085c790146a42c65d51ea21170427b24bc706de970df570331321996cbdbaf`。
- 独立锁文件 SHA-256：`eece5b86a0955df5204de2dc0cd69b1907a31a83de7d6fad39fa442c11ca7f01`。
- 包内共有 **37 个 lazy registration ID**。将 flowchart-elk 作为 flowchart 布局变体、四种 railroad 文法作为一族后为 **33 族（含 info）**；这是计数口径，不是 33 族已经通过产品验收。
- 内部还注册 `error` 与 `---` 错误处理项，不算用户图型。图型入口识别只负责分派；任意匹配前缀不等于其后正文是合法文法。

下表从上述固定包的 detector 与生成文法整理，而不是根据当前网站菜单猜测。全部细节文法仍以冻结官方包为准；不能在入口之后另设手写 flow/sequence 子集来冒称全量支持。官方固定 tag 的[注册源码](https://github.com/mermaid-js/mermaid/blob/mermaid@12.2.0/packages/mermaid/src/diagram-api/diagram-orchestration.ts)可用于复核。

| 图族                | 固定包 ID                                                 | 文本入口 / 版本标记                                                                                                               |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| C4                  | `c4`                                                      | `C4Context`、`C4Container`、`C4Component`、`C4Dynamic`、`C4Deployment`；[官方仍标为实验性](https://mermaid.js.org/syntax/c4.html) |
| Flowchart           | `flowchart-v2`、`flowchart-elk`                           | `graph`、`flowchart`；`flowchart-elk` 为兼容布局入口                                                                              |
| Agent flow          | `agentflow`                                               | `agentflow-beta`                                                                                                                  |
| Swimlane            | `swimlane`                                                | `swimlane-beta`                                                                                                                   |
| Entity relationship | `er`                                                      | `erDiagram`                                                                                                                       |
| Git graph           | `gitGraph`                                                | `gitGraph`                                                                                                                        |
| Gantt               | `gantt`                                                   | `gantt`                                                                                                                           |
| Information         | `info`                                                    | `info`                                                                                                                            |
| Pie                 | `pie`                                                     | `pie`                                                                                                                             |
| Quadrant            | `quadrantChart`                                           | `quadrantChart`                                                                                                                   |
| XY chart            | `xychart`                                                 | `xychart`、`xychart-beta`                                                                                                         |
| Requirement         | `requirement`                                             | `requirement`、`requirementDiagram`                                                                                               |
| Sequence            | `sequence`                                                | `sequenceDiagram`                                                                                                                 |
| Class               | `classDiagram`                                            | `classDiagram`；兼容 `classDiagram-v2`                                                                                            |
| State               | `stateDiagram`                                            | `stateDiagram`；兼容 `stateDiagram-v2`                                                                                            |
| User journey        | `journey`                                                 | `journey`                                                                                                                         |
| Timeline            | `timeline`                                                | `timeline`                                                                                                                        |
| Mindmap             | `mindmap`                                                 | `mindmap`                                                                                                                         |
| Kanban              | `kanban`                                                  | `kanban`                                                                                                                          |
| Sankey              | `sankey`                                                  | `sankey`、`sankey-beta`                                                                                                           |
| Packet              | `packet`                                                  | `packet`、`packet-beta`                                                                                                           |
| Radar               | `radar`                                                   | `radar-beta`                                                                                                                      |
| Block               | `block`                                                   | `block`、`block-beta`                                                                                                             |
| Tree view           | `treeView`                                                | `treeView-beta`，注意大小写                                                                                                       |
| Architecture        | `architecture`                                            | `architecture-beta`；detector 的 `architecture` 前缀本身不能证明无后缀文法成立                                                    |
| Event modeling      | `eventmodeling`                                           | `eventmodeling`                                                                                                                   |
| Ishikawa            | `ishikawa`                                                | `ishikawa`、`ishikawa-beta`                                                                                                       |
| Venn                | `venn`                                                    | `venn-beta`                                                                                                                       |
| Treemap             | `treemap`                                                 | `treemap`、`treemap-beta`                                                                                                         |
| Use case            | `usecase`                                                 | `usecase-beta`                                                                                                                    |
| Wardley             | `wardley`                                                 | `wardley-beta`                                                                                                                    |
| Cynefin             | `cynefin`                                                 | `cynefin-beta`                                                                                                                    |
| Railroad            | `railroad`、`railroadEbnf`、`railroadAbnf`、`railroadPeg` | `railroad-beta`、`railroad-ebnf-beta`、`railroad-abnf-beta`、`railroad-peg-beta`                                                  |

**ZenUML 不在这份冻结主包的 detector、依赖白名单或锁文件中。** 官方网站列有 ZenUML，并不意味着当前 `mermaid` 主包内置其扩展。外部 diagram/layout/icon pack 不能被计入已冻结支持集合；如后续明确要求这类扩展，需要单独固定版本、许可证、包体及安全审查。本轮没有新增扩展依赖。官方[ZenUML 集成说明](https://mermaid.js.org/syntax/zenuml.html)与当前包内注册表的适用范围不同。

## 为什么纯 Worker 不能承载这个官方 renderer

这是明确的 API 不相容，不是根据尚未运行的性能猜测：

| 环节                            | 固定实现使用的能力                                                                         | Worker 中缺口                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 官方 render 编排                | `document.body`、临时 div/SVG、`document.createElement('style')`、浏览器内 `renderer.draw` | 无浏览上下文、Document 或活 SVG 树                                         |
| 官方 SVG 标签                   | `getComputedTextLength`、`getBBox`，根据实际字体调整布局                                   | Canvas 文本宽度不是 SVG/CSS/行布局的同一合同                               |
| 官方 HTML / Math / 复杂图元路径 | `foreignObject`、`getBoundingClientRect` 等                                                | `htmlLabels:false` 并未消除全部真实 DOM 需求                               |
| 现有插件准备                    | `document.fonts.ready`                                                                     | 当前插件本身就是 DOM host 入口                                             |
| 现有安全转换                    | attached `SVGSVGElement`、`getComputedStyle`、CTM、文字 ink bbox、viewport/paint bounds    | 输出转换也不是 XML 字符串解析器，不能只移走 Mermaid 后仍在 Worker 原样工作 |

具体证据见固定包 `dist/mermaid.core.mjs` 的 render 实现（1315 起读 `document.body`，1361 创建样式，1370 调用 draw），以及 [renderer.ts](../plugins/diagrams/src/renderer.ts)、[svg-converter.ts](../plugins/diagrams/src/svg-converter.ts)、[paint-envelope.ts](../plugins/diagrams/src/paint-envelope.ts)。官方 tag 的 [mermaidAPI.ts](https://github.com/mermaid-js/mermaid/blob/mermaid@12.2.0/packages/mermaid/src/mermaidAPI.ts)与 [HTML Worker 标准](https://html.spec.whatwg.org/multipage/workers.html#the-workerglobalscope-common-interface)支持同一边界。

其中某些 parser 或布局算法可以在 Worker 运行；这并不等于完整公开 `mermaid.render` 可运行。把测量通过 RPC 交回 DOM 线程，会形成新的混合 renderer：官方同步 DOM 调用没有现成的全面异步桥，仍需宿主 DOM 工作，并须重新处理截止、取消、字体与所有图型。`OffscreenCanvas`、DOM shim 或返回固定 bbox 的 stub 均不能被记为原版真实布局通过。

官方 `securityLevel: strict` 只规定标签与点击等行为；`sandbox` 选项是 iframe 输出机制，不能提供本项目要求的独立进程硬终止或已验证 OS 网络拒绝。[官方安全配置](https://mermaid.js.org/config/schema-docs/config.html#securitylevel)。原 [P4 合同冲突](v2-product-phase4-mermaid-engine-2026-10-16.md#迁移前已确认的合同冲突)早已明确这些条件，本次没有重新解释成可选项。

## 全部官方语法与当前安全输出并非同一个完成条件

现有完整插件确实把围栏正文交给官方引擎；它尚不能证明所有官方图型的全部正常视觉效果都能通过 `bounded-svg-v1` 转换。已有原生样例主要覆盖早期的常用图族；当前 37 个入口不能从历史 16 类样例或 64 项 UI 结果推导为全覆盖。

现有固定边界包括：输入窗口 64 Ki UTF-16 / 256 行；单图 50,000 UTF-16；官方 `maxEdges: 500`；结果 256 KiB、4096 计费节点、64 层深度，以及独立宿主的引用展开、几何与栅格工作量校验；准备 10 秒，原生渲染 2 秒。转换器要求每个图元和生效样式都有完整表示，不能静默删掉不支持的内容来返回成功。[插件实现](../plugins/diagrams/src/renderer.ts)、[原生期限](../apps/desktop/src-tauri/src/plugin_dom_process.rs)、[宿主 SVG 合同](../packages/core/src/document-svg-image.ts)。

需要分别记录三种情况：

1. **固定版本的普通静态语法与视觉效果**：所有图族均应由官方解析与布局；形状、子图、循环、分组、样式、长标签等不能再以自制子集替代。若当前 converter 不支持，属于未完成项目，源码回退只是保全内容，不能充当验收成功。
2. **明确禁止的主动或外部能力**：任意 URL / 网络图片、外部字体/图标加载、JS callback、点击跳转、活动动画等仍不授予文档；不能把“完整 Mermaid”理解为移除这类边界。当前转换还限制 `foreignObject` 为特定普通文本框结构，未知 HTML/MathML/样式/滤镜不能直接透传。
3. **有界系统的资源限制**：过大或超时的图应明确保留源码，不能将失败伪装成非法 Mermaid 语法，也不应取消现有全局预算以声称支持“任意图”。

完整支持的验收需要每个注册族的官方固定样例，加上重要语法分支、主题、中文/长标签、嵌套、布局变体；逐项检验官方 SVG → 类型数据 → 宿主 canonical image 的视觉一致性、源码编辑/取消/停用/卸载和 export/screen 一致性。Windows 尚须在实际打包引擎中完成；Linux 历史结果不替代它。产品 UI 的安全回退提示与语法错误应能区分，这也是后续实现要求，本文未修改提示代码。

## 可信宿主渲染与不可信插件隔离的具体区别

“官方代码是受审查依赖”可以用于定义新的信任边界，但不能自动消除图文本的敌意输入、依赖漏洞或浏览器漏洞。Mermaid 在返回 SVG 之前已经创建 DOM、应用样式和布局；当前 converter 在 `await mermaid.render(...)` 之后运行。后置 SVG 检查无法撤销此前已经发生的资源请求或主线程卡住。禁止任意插件代码进入主界面，与“渲染器被攻破后仍被 OS 拒绝联网”是两个不同保证。[Microsoft WebView2 安全指南](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)也要求将 Web 内容视为不可信、限制 bridge 并验证消息。

| 候选放置位置                                                                                             | 可以保留的性质                                                               | 不能直接保留的性质 / 风险                                                                                                                                            | 本轮判断                                                             |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 当前独立 Worker，原样导入完整包                                                                          | 插件独立、可终止 Worker                                                      | 没有真实 DOM/测量，公开 render 不可用                                                                                                                                | 技术上不成立                                                         |
| 主编辑器 WebView 加载固定官方包                                                                          | 完整浏览器 DOM；可仍让外围插件通过 RPC 请求                                  | 不可信图文本进入有应用上下文的进程；官方依赖变成主宿主 TCB；同步布局不能由 Worker terminate 中止；现有主窗口 CSP 仅显式配置 script-src，不能当成独立 no-network 合同 | 违反原有隔离/硬截止承诺，不能直接落地                                |
| 主界面的普通隐藏 iframe                                                                                  | 可隔离部分 DOM/CSS，sandbox 属性可限制部分页面能力                           | iframe 不保证独立 OS 进程；不是可独立强制终止单元；CSP/iframe sandbox 不是已验证全路径 OS 网络边界                                                                   | 不能修复已知门槛                                                     |
| 独立可信固定 renderer helper + Worker 插件                                                               | 插件仍独立；不加载插件提供的 JS/模块；若真实独立受监督可保留 UI 响应与硬终止 | renderer 变成宿主服务/TCB；任意插件可通过数据输入攻击其 parser/布局/DOM；没有新 OS 网络拒绝，渲染器执行漏洞后的网络风险仍在；新 SDK/消息预算/版本兼容/生命周期需设计 | 这是改变威胁模型的新架构，未获授权/未验证，不能悄悄命名为原 DOM 插件 |
| 原有通用 DOM helper + 有效 OS 网络拒绝                                                                   | 最接近原合同；插件完整官方实现仍随独立包；真实测量与独立截止                 | 当前 Windows 网络边界失败；新 WFP 等机制的权限、覆盖和 fail-closed 尚未验证                                                                                          | 保留合同的研究候选，不能先开启                                       |
| [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli/blob/master/src/index.js) / 新 headless Chromium | 官方 renderer 通常可通过完整浏览器执行                                       | CLI 本身不是无浏览器 DOM 方案；引入浏览器/Node/部署与进程隔离责任；不满足本轮不得新增 Runtime 的约束                                                                 | 本轮排除                                                             |
| 远程渲染服务                                                                                             | 服务端有 DOM                                                                 | 文档外传、联网、额外信任和离线失效                                                                                                                                   | 本轮排除                                                             |

主窗口当前配置见 [tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json)。现有可安全放进编辑器的只是宿主从封闭类型重新序列化的 SVG 图片：`createOwnedDocumentSvgImage` 以 canonical XML 创建 image Blob URL；它并不意味着可以把官方原始 SVG、样式或 JS 插入主 DOM。[图片宿主](../packages/view-dom/src/document-svg-image.ts)。

如果未来明确选择“可信固定服务”，最低设计要求包括：服务只能加载固定受审查字节，不能接收插件 HTML/JS/模块 URL；窄消息协议与实例绑定；原有输入/结果预算；独立进程和宿主计时终止；空白专用 profile；无 Tauri/文件/网络 broker；在渲染开始之前实施资源准入；继续复验闭合输出。即使这些全部实现，依然不能声称获得原来要求的 OS 全路径网络拒绝；需要明确接受的是哪一种残余风险，而不是只授权一个函数位置变更。

## 包体、权限与平台取舍

完整引擎已是受控离线 JS 依赖，没有要求捆绑第二套浏览器。仓库依赖来源记录中的完整插件构建入口为 **5,313,918 字节，约 5.07 MiB**，2118 个构建输入，运行时外部 imports 为 0，低于现有 8 MiB entry 上限；这是既有冻结构建记录，不是本轮新构建。官方发布包的完整单文件 `dist/mermaid.min.js` 本轮静态测得 5,494,801 字节。约 30 KiB 的 `mermaid.esm.min.mjs` 是拆分入口，不能用它来表示完整引擎总包体。[依赖记录](../plugins/diagrams/dependency-provenance.json)、[构建合同](../plugins/diagrams/scripts/build-support.mjs)。

把同一份引擎移进主 bundle 不会使这些字节或运行时成本消失；保留插件副本并再捆绑宿主副本还可能重复。反过来，改成宿主固定渲染服务会把引擎版本升级耦合到应用，不能再声称插件单独升级即可更新全部 renderer。未在本轮测量打包压缩增量、启动时间、内存、每图耗时或 Windows 像素，所以不给虚构的 installer/性能数字。官方 12.x 目标为 ES2024，实际 WebView2 兼容仍需验证。[官方运行时要求](https://mermaid.js.org/config/usage.html#supported-browsers-and-runtimes)。

WFP 不增加浏览器 Runtime 体积，但默认普通用户没有新增有效过滤器所需权限。现有评估已经否定把“管理员 CI 可以加规则”当成轻量 current-user 安装的默认能力；也没有证明过滤能覆盖本项目所有 broker/DNS 路径。[WFP 部署评估](v2-windows-wfp-deployment-assessment-2026-10-20.md)、[Microsoft 访问控制](https://learn.microsoft.com/en-us/windows/win32/fwp/access-control)、[过滤条件](https://learn.microsoft.com/en-us/windows/win32/fwp/filtering-condition-identifiers-)。按 `msedgewebview2.exe` 全局阻断会波及主编辑器和其他应用，不是可接受替代。

## 本轮验证与准确阻塞

已完成的有限验证：

- 14 份产品/合同文件的字节哈希与 11 项静态断言：固定版本、DOM manifest、只读权限、官方 render、真实字体/几何、strict 配置、非 Linux 门禁与原生两秒期限均成立。
- 两份本地 Mermaid 包各 68 个已审批输入，与冻结 SHA 全匹配；安装依赖共 2111 项输入全匹配；37 个 detector 入口按固定字节提取。
- 官方 tag 的编排/API 源码、官方安全/运行时说明、HTML Worker 标准、Microsoft WebView2/WFP 文档交叉核对；文档说明与真实 Windows UDP 失败证据分开使用。
- 没有运行 Mermaid JS、浏览器或插件，也没有重建、重测旧 Linux 产品矩阵。所有结论标明静态推导，未把哈希一致性当成无漏洞证明。

本地审查证据位于 `/tmp/milkup-beta6-mermaid-feasibility/`：`contract-audit.json`、`source-audit.json`、`extracted-inventory.json`。它们记录完整路径、字节哈希和注册入口；是本轮临时证据，不是随发行持久保存的 GUI 验收材料。

阻塞是两项独立问题：**Windows 可接受的隔离 DOM 后端尚不存在；完整官方包全部被动输出的转换/像素覆盖尚未完成。** 仅修复其中一项不得宣布全量支持。已知 UDP 反例继续保留，所有 Windows DOM/PDF 门禁继续关闭；文档未把本轮研究称为 beta6 功能实现完成。

若要继续执行而不是停在文档层面，需明确授权的最小目标分别是：

1. **保留既有威胁模型的有限 OS 隔离原型**：仅临时测试环境、本次独立身份与精确过滤对象；先评审所需权限、规则生效验证、控制端崩溃时持续拒绝与清理顺序。任何不成立都不启动不可信 helper。随后用既有原生重复 UDP、WebRTC TURN、TCP、IPv4/IPv6、loopback、DNS/broker、取消和异常退出的正反对照验收。此授权只允许研究，不等于允许产品部署、提权安装或开启门禁；目前用户禁止改系统安全，因此本轮没有实施。
2. **明确更改威胁模型的固定宿主服务设计**：仅在产品方明确接受固定 renderer 作为宿主 TCB、文档输入漏洞的网络残余风险及独立性变化后，评审专用 helper 协议与生命周期；不能先将 Mermaid 放入主 WebView 再补解释。这一路线与当前“不降级隔离”的约束冲突，本轮不将其列为可自动执行的后续步骤。

如果两类变化均不接受，准确交付状态就是继续保留安全门禁并报告 Windows 完整 Mermaid 未实现。不能重新包装自制子集、伪造全量语法支持，或把等待新安全边界包装成已完成。
