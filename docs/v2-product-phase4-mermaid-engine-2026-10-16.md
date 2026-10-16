# P4 成熟 Mermaid 引擎接入

本阶段基线为 `d3851430fac0dc85c758187b33b769c5daba7f4a`，独立分支 `dot/milkup-v2-product-phase4-mermaid-engine`。已核验远端/本地 SHA、干净工作区及候选 11 的 4,044 份证据存储哈希；候选 11 的 Linux 有界能力验收继续有效。[基线核验](evidence/v2-product-phase4-mermaid-engine/baseline-verification.json)。

**当前状态：已完成本轮官方样例原生扫描与初步像素研究，通用渲染及安全输出的产品实现正在进行，尚未完成产品验收。** 本阶段以官方成熟 Mermaid 替代自研小子集，不以三个简单图型代替产品覆盖。后续继续 P4 剩余 Markdown/图片覆盖，再进入 P5 导出/打印；P4 总体仍为部分完成。

## 固定版本与覆盖目标

候选标准引擎为官方 Mermaid **12.2.0**，使用完整主包，离线锁定依赖和许可证，不使用 CDN 或 tiny 精简包。官方文档要求 Node ≥22.12，并说明 12.x 发布包目标为 ES2024/Safari 17.4+；本环境 Node 24.19.0。目标 Linux WebKit 及后续平台仍须实际验证，不能由版本号推断通过。[官方使用与运行时要求](https://mermaid.js.org/config/usage.html)。

以下为必须有独立标准样例和实际编辑导航证据的目标，不是已通过清单：

- 流程图：常用形状，TD/TB/LR/RL/BT，子图/嵌套与跨组连线，边标签、中文/长标签、多行与 Markdown 标签，class/style/linkStyle 与主题配色。
- 时序图：participant/actor、箭头与返回、自消息、Note、激活、自动编号、loop/alt/opt/par 等分组。
- 类图、状态图、ER、甘特、journey、gitGraph、pie；另审计 requirement、mindmap、timeline、quadrant、XY、block 等官方图型的实际输出及离线依赖。
- 官方完整版本还包含其它图型；未纳入或无法完整安全呈现的图型逐项列为未完成，不用“Mermaid 已支持”概括整个库。
- 网络图片、外部字体/图标抓取、任意脚本回调和点击跳转不授予文档。禁用的主动能力与尚未实现的普通图形语法分开记录。

样例以固定版本的官方仓库/文档为来源，记录原始内容与出处；增加中文、长标签、多图长文档和真实 source/live 编辑用例。未知或不可完整呈现的输出须整图回退源码并说明原因，不能删掉节点或样式后宣称成功。

## 已确认的合同冲突

1. 现 `diagrams` 是纯 Worker 插件。官方 `render` 使用 `document`、SVG `getBBox` 和文字长度测量；不能直接放入无 DOM Worker。模拟 DOM 和近似字体测量不等于官方真实浏览器布局。
2. 当前 `DocumentVectorNode` 仅平面基本图元与主题 tone，没有路径、分组变换、裁剪、标记和完整文本布局，无法保真承载官方 SVG。既有导出 serializer 也未完成颜色映射，本阶段不能顺带宣称 P5 已完成。
3. 当前监督 Worker 的 2 秒终止不能终止被移到主 UI/普通 iframe 的同步 DOM 工作。普通 iframe 不是可独立终止的执行单元。
4. Mermaid `securityLevel: strict` 是输入防护之一，不是网络隔离或输出校验的替代品；官方 renderer 可能生成 `foreignObject`、样式及图像资源。必须检查实际输出和资源请求，不能假设 `htmlLabels:false` 足够。

以上分别对应执行环境和输出形式两个问题；不通过放宽超时、关闭 sandbox 或宿主按 diagrams ID 特判绕开。[既有成熟引擎差距方案](v2-product-phase4-markdown-extensions-2026-10-15.md#图表阶段差距与成熟引擎后续方案)。

## 官方输出研究与尚未通过的验证

[第二检查点证据索引](evidence/v2-product-phase4-mermaid-engine/checkpoint02/README.md)保存官方样例、完整输出、锁与许可证、原始失败日志和设计草案。原始文本逐字节保存并附 SHA256，不包含生成二进制、node_modules 或浏览器 profile。

完整离线 ESM 已在仓库外构建：5,254,581 字节，SHA256 `043c33385b8b41bb628872f4e419c7f20886403152b045736382db36072d8c0c`，打包后的外部 import 数为零。锁定图含 ELK EPL-2.0 和其它依赖许可证，不能将整个 bundle 标为仅 MIT；它是从公开主入口与锁定依赖重新打包的产物，不等于上游预编译文件的逐字节副本。

首轮 Chromium 输出研究使用 30 个未经修改的官方样例及 7 个本地边界探针。37 次调用中 34 次返回 SVG，16 类图型均有至少一个官方样例返回；两项外部图片请求被拦截后渲染失败，另一项 CSS URL 探针在语法解析时失败。**该轮沿用 Playwright 默认关闭 Chromium sandbox 的启动行为，只能用于输出研究，不能作为安全隔离或产品验收证据。** 未做像素验收。

同一组 30 个未经改写的官方样例已通过当前 diagrams 构建入口建立修前基线：30 次 error，全部返回逐字节一致的完整 Markdown 围栏源码，没有异常或漏 fragment；另加 flowchart、sequence、pie 三个已支持控制样例，均 ready。该结果证明这些选定样例的覆盖缺口，不推断每一类的所有语法均失败，也不将直接 API 的源码一致性当作编辑/保存闭环验收。

实际输出确认 journey 在全局 `htmlLabels:false` 时仍有 7 个 `foreignObject`，sankey 使用渐变及边重叠混色，默认 neo 外观使用阴影，时序图有 symbol 定义。上述普通呈现能力须由受控输出完整表达，或通过实测选用明确的官方外观配置；不能删除后标成功。严格模式仍会输出外链，宿主必须独立拒绝。有效动画与仅存在但未使用的 keyframes 也须区分：首版静态输出将对有效动画明确报未支持并保留完整源码，不把定格帧计为完整呈现。数学标签探针返回原样美元符号文本，不能宣称已支持图中数学排版。

第二轮准备比较官方 `look:'classic'` 与 `journey.textPlacement:'tspan'`，同时补齐有效样式及像素采集。开启 Chromium sandbox 后，浏览器因当前 SUID helper 配置失败，在样例执行前退出：**0/18 样例、0 截图**。未关闭 sandbox 重跑。

原生 DOM 原型已经编译。最初宽根挂载命令被自动审批拒绝；随后改为空根、精确只读运行资源、无工作区/主目录挂载、隔离网络及独立临时 profile 的命令，获得自动审批允许。第一次实际启动触发 WebKit 的 sandbox 初始化时序 fatal；随后只读检查发现该 Wry 临时 context 的 sandbox 实际未开启，因此改用 WebKitGTK 公开 API，在创建 WebView 前启用 sandbox，没有关闭安全边界或 fork Wry。空根运行依赖、bootstrap 和 AT-SPI stdout 污染等首次失败均保留；结果通道改为独立管道，未忽略非法协议帧。

**固定 Linux 机制在 narrow-11 首次通过，尚非 Mermaid 或产品验收。** [冻结的原始结果和摘要](evidence/v2-product-phase4-mermaid-engine/checkpoint02/prototype/frozen-mechanism-11/mechanism-summary.json.txt)记录：准备 0.955 秒；sandbox/ephemeral 为 true，无 Tauri 命令桥；CSP `connect-src` 拒绝固定网络与文件请求；两次真实 Unicode SVG `getBBox` 均为 227×29。同步死循环的 WebProcess 持续消耗 CPU，独立监督器在任务开始后 2.000667 秒观察截止、2.000984 秒发出 SIGKILL，2.135871 秒核验已无所属后代。保留 PID birth、CPU ticks、清理与构建哈希；这不是零调度延迟承诺，也不等于编辑器集成时保持响应已验。原生 `send-request` 拒绝、官方引擎兼容、安全 SVG 转换和像素仍须分别验证。bootstrap MIME header 与 readiness 轮询在成功前同时改变，不能单独归因其中之一。

随后首轮官方引擎原生探针 `mermaid-narrow-01` 完成五次调用：[冻结摘要](evidence/v2-product-phase4-mermaid-engine/checkpoint02/prototype/mermaid-summary.json.txt)。flow 为 1.083 秒/51,109 字节；journey 默认配置为 0.319 秒/49,745 字节、classic+tspan 为 0.079 秒/42,247 字节；sankey 为 0.519 秒/220,228 字节；sequence 为 0.118 秒/48,384 字节。均在单次两秒与 256 KiB 帧限制内，时间包括 native dispatch、渲染、观测、序列化及传输；这些字节是诊断结果，不是已通过安全校验的产品 AST。另有明确 `GUARD_DENY entry.mjs?guard-check`，且 native protocol handler 未收到该 URI，独立证明了原生 WebProcess 资源拦截。后代清理为空。该阶段 Journey 的 tspan 配置不再产生 foreignObject，但当时尚未进行像素比较；后续完整扫描和像素结果见下文。安全转换、编辑保存和生产集成仍未验收。

### 完整 Linux 原生扫描与配置决定

[第三检查点](evidence/v2-product-phase4-mermaid-engine/checkpoint03/README.md)归档本轮最小原始证据。30 个未经修改的官方样例与 7 个本地探针分别使用 baseline、classic-tspan，共 **74 次独立原生调用：68 次返回结果、6 次明确拒绝，0 次超时，无输入重试，全部后代清理核验通过**。两种配置下，`flowchart-069-image` 和 `flow-url-image` 均报 Loading error，`flow-style-url` 均报解析错误；不是 74 次全部通过。

每次使用新 namespace/helper/profile，准备阶段保持 10 秒上限，实际任务保持独立 2 秒及 256 KiB 帧上限；执行时间包含 dispatch、解析/布局、观测、序列化及传输。最大成功用时 0.990612 秒，最大诊断结果 220,067 字节；诊断结果仍包含原始 SVG，不能冒称产品安全 AST。固定 bundle 与运行时哈希、原件来源/长度/哈希见[索引](evidence/v2-product-phase4-mermaid-engine/checkpoint03/index.json)。432 份原始扫描文件通过外部完整清单引用，未重复塞入仓库。

Journey 两配置另取真实 WebKit 1100×800 原图，均为 light、zoom 1、相同配置字体，未缩放或拼接：[baseline](evidence/v2-product-phase4-mermaid-engine/checkpoint03/journey-light-baseline.png)、[classic-tspan](evidence/v2-product-phase4-mermaid-engine/checkpoint03/journey-light-classic-tspan.png)。两者 viewBox 均为 `0 -25 1300 540`；baseline 有 7 个 foreignObject，实际 HTML 标签深色可读。classic-tspan 虽将 foreignObject 降为 0，却使浅色任务框上的标签变白、分区标签也呈浅色，实际像素明显降低可读性。Make tea 的实际标签从 Arial 16px、rgb(51,51,51) 变为 Open Sans/sans-serif 14px、白色 SVG fill，不能仅归结为测量误差。

**本轮 classic-tspan 配置不可用作标准产品配置，不因去掉 foreignObject 就接受其视觉差异。** 这不证明所有 tspan 配置都不可行；也不意味着允许把 baseline 的 foreignObject 注入编辑器。完整安全转换仍须保留实际布局与样式，否则整图回退源码。两次 Journey 渲染分别为 0.185/0.136 秒，均先在原执行预算内完成，再以独立截图阶段采集像素；截图不延长或补救渲染截止。

本轮研究只覆盖 light，尚不构成 dark、产品 SVG 映射、编辑保存/历史、停用恢复或生产矩阵验收。产品实现正在进行，Linux 原型结果也不外推 Windows/macOS；既有首次失败和平台限制继续保留。

## 通用 DOM 宿主基础实现检查点

已实现严格 `host: "dom"` manifest/profile、UTF-8 包入口、宿主切换审批与启用隔离、opaque native lease 路由和无 broker 的桌面加载路径。随包预装通过普通安装器接受已验证的只读 DOM 包；已有安装不覆盖，卸载后不自动重装，缺少后端时记录单插件失败。没有按 Mermaid 或插件 ID 特判。

[基础实现的原始红绿记录](evidence/v2-product-phase4-mermaid-engine/dom-foundation/README.md)保留最初 plugin 28 失败/10 通过、desktop 9 失败，以及预装 guard 修复前的 3 失败/47 通过。实现后的 plugin 新旧 focused 114 项通过，但类型检查随后发现参数化权限夹具误把数组展开为参数，故这些相关断言不能采用最初的绿结果；修正为对象行后，manifest 32 项重新通过。桌面管理、生命周期与预装 50 项通过，plugin/desktop 类型检查及改动文件格式检查通过。

前端传输层另有 DOM 15 项及既有 sidecar 9 项通过，覆盖精确 lease/instance、启动失败、旧代次消息、native 控制事件和清理。**这些是 mock transport 检查，不证明真实原生隔离或编辑器集成已通过。** 产品原生命令、官方引擎插件替换、安全 SVG 输出及生产矩阵仍在实现和验证；本检查点不更改已有 diagrams Worker 包，也不将其标为成熟 Mermaid 已支持。

## 原型设计与通过门槛

机制和输出研究已取得上述结果，产品正在按以下边界实现，尚未通过完整验收：

- 插件拥有固定版本 Mermaid、配置、语法与离线 bundle；宿主只拥有任务生命周期、边界和输出校验。
- 独立可信 helper 使用新 WebContext，不加载编辑器、不注入 Tauri 命令桥，不提供文档/文件/网络接口；只接收有界输入并输出有界结果。Linux 原型采用 WebKitGTK 公开 API 与独立结果管道；固定资源映射、严格 CSP、导航/新窗口/下载/权限拒绝分别验证。仅拦导航不能代表子资源被拦。
- 准备阶段与执行阶段分离，准备有原 10 秒上限；从宿主发送实际解析/布局任务开始，原生监督器按单调时钟执行 2 秒硬截止。不会把解析/布局藏进准备阶段。
- 同步死循环必须能终止，编辑器保持响应；必须核对 WebKit/Network 后代，不能将仅 `Child.kill()` 直接子进程退出当作整个任务已终止。
- 每次任务绑定插件生命周期、文档身份/版本与请求代次；取消、停用、卸载、文档切换、超时和异常均丢弃失效输出并回退完整源码，不改变正文、历史或保存状态。
- 候选输出为封闭静态 SVG AST：有限节点/属性、数值/路径语法、局部引用和受控样式，经宿主重新校验和规范序列化后放入图片上下文；不向编辑器 DOM 注入原始 SVG/HTML/CSS。样式必须完整保留或整图拒绝，不能静默清洗后漏画。
- `foreignObject`、不支持的样式/图元及字体布局必须用真实样例决定完整实现方式。隔离栅格化可作为待比较方案，但须明示缩放、文本选择、无障碍和导出损失，不能当作矢量保真已完成。
- Linux process group、Windows Job Object、macOS WebKit 后代生命周期各有平台边界；只宣称实际验证的平台。Linux 已通过上述固定机制原型；新通用产品后端尚未通过任何平台验收。

机制原型至少包含真实 SVG 量字、同步死循环、外部资源与文件/IPC尝试、错误/超限、取消/清理，然后运行官方引擎的完整图型样例。原型结果及第一次失败必须保留；证明机制可行后才扩展公共 SDK/核心合同并添加修前回归。

## 交付与验收顺序

1. 固定标准包、许可证、完整离线依赖与官方样例；记录现合同冲突及机制原型，先保存正常提交推送的阶段检查点。
2. 实现通用渲染执行与静态输出合同，再替换独立 diagrams 插件；宿主不含插件 ID 特判。
3. 验证 source/live、普通/窗口化、宽窄窗口、明暗主题、100/125/150/200% 原生 UI 缩放、选区/光标、源码揭示和编辑导航；完整字节的保存、撤销/重做、停用/卸载回退及恢复继续作为门禁。
4. 用官方标准样例与实际长文档做 Linux 生产原生闭环及实际像素对照，明确每个图型和能力的通过、失败、未验与不支持状态。
5. 更新唯一八阶段计划，继续 P4 剩余 Markdown/图片，再 P5 输出/打印；不把本阶段 Mermaid 完成等同于整个产品完成。

允许本地 Linux 构建和正常提交推送该隔离分支。禁止 Windows/Runtime 打包、artifact 上传、Release、部署、真实凭据创建及 main/v2/quality 整合；此前 Runtime 条款/上传预算批准仍未使用。
