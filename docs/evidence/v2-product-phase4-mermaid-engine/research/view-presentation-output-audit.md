# Mermaid 成熟引擎：presentation 输出边界只读审计

审计基线：`d3851430fac0dc85c758187b33b769c5daba7f4a`。未改仓库源码，未安装依赖，未启动 UI、测试、编译或 native。下述新类型和进程方案均为设计建议，不是已实现能力。

## 结论

建议将“官方引擎执行”和“静态图像输出”分开决策。现有 flat vector 无法无损承载官方复杂 SVG；继续逐图重写布局会复制 Mermaid 的工作。优先考虑 **通用、版本化的 SVG 安全 AST / image profile → 宿主验证与规范序列化 → 自有 blob img**。输出绝不直接插入编辑 DOM，也不接受插件指定 blob/file/network URL。插件负责 Mermaid 解析与官方布局，宿主只处理通用图形数据，不按插件 ID、围栏语言或 Mermaid 图种分支。

该建议不自动解决官方 DOM 执行环境：现有独立 supervisor 只保证终止子 Worker。若将官方渲染移到普通 iframe/UI 线程，Worker 的两秒 watchdog 不能终止那个执行上下文，必须另有可证明的独立可终止 DOM renderer，或先证明官方依赖能在受监督 Worker 的完整兼容实现中运行。不能把 Promise.race、移除 iframe、securityLevel=sandbox 当作 CPU 死循环硬终止证明。

“完整承载”需限定为指定版本官方引擎在公开静态、安全配置下生成的全部视觉内容。任意 HTML/CSS、交互点击、远端字体/图片与现有无网络、无事件输出合同冲突。任何不能无损处理的视觉构造，必须整片保留原文并说明原因；不能 sanitize 掉标签后仍声称 ready。

## 具体入口与已存在冲突

| 入口                                                                                         | 已存在行为与影响                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/core/src/document-presentation.ts:79–143                                            | vector 只有平面 rect/ellipse/line/polyline/polygon/text。没有 path、嵌套 g、transform、defs、clipPath、marker、tspan、gradient、CSS、foreignObject、任意颜色，也没有 viewBox minX/minY。                            |
| 同文件:163–173、444–592                                                                      | 现配额 input 64Ki UTF-16 /256行，output 256KiB，4096节点，depth64，fragment128，图宽高1..8192、坐标±8192，point1024，文本4096，字号8..72；未知字段直接 invalid-output。复杂图可能合法但超过配额，不能默删超出部分。 |
| 同文件:671–752                                                                               | 纯 serializer 先验证；vector 的 tone/fill/stroke 除 none 外均输出 currentColor，丢失屏幕的 background/accent/border 区别。这是现有出口局限，不能拿它当成熟SVG保真导出证明。                                         |
| packages/plugin-sdk/src/index.d.ts:675–836                                                   | 独立发布类型复制同构合同。新输出需同步 core/SDK/workerwire/public-contract、SDK版本和外部包构建；不能只给宿主加私有返回字段。                                                                                       |
| packages/plugin/src/runtime.ts:443–480；document-render-rpc.ts；worker-supervisor.ts:175–243 | runtime 按真实 renderer declaration 再验证；supervisor 自己计时并 terminate 子 Worker，取消不撤销 deadline。需保留这条链，不能把实际重活外包主线程却沿用“2秒隔离”称谓。                                             |
| apps/desktop/src/document-presentation-service.ts:37–151                                     | 通用可信窗口、版本/identity/撤销 guard、fence保护、聚合重叠排除。无需 Mermaid 业务分支。                                                                                                                            |
| packages/view-dom/src/document-presentation.ts:70–171                                        | 只 createElementNS+allowlist；明确不解析插件 SVG/CSS/HTML。新 image 类型是显式合同变更，不是把 innerHTML 藏进现 vector。                                                                                            |
| 同文件:650–806、810–902、1055–1309                                                           | selection/epoch/version/window guard、source fallback、换窗锚点、内部滚动保存、preview pointer lease。新输出必须置于同一个 fragment wrapper，复用上述路径。                                                         |
| packages/view-dom/src/source-document-view.ts:838–910；editor-view.ts:584                    | 两 view 共用 presentation/updateContent；windowed 测量需要资源初始尺寸及 decode 后布局通知，不能另外插未受测量的大图。                                                                                              |
| packages/view-dom/src/image-presentation.ts:134–234                                          | 现资源图片有 blob-only resolver、dispose、abort/late-result 处理，可借鉴生命周期；它是本地文档资源管线，不应借此绕过插件 presentation 验证。                                                                        |
| plugins/diagrams/src/renderer.ts；layout.ts:15                                               | 当前是独立子集 parser/layout，Worker 采用保守字宽估计，无 DOM 字体测量。不能仅更换输出格式就宣称官方引擎兼容。                                                                                                      |

仓库搜索仅发现纯 serializer 与测试消费；没有已完成的完整 export 产品管线。因此必须区分“提供可安全序列化合同”与“已验收 HTML/PDF/SVG 导出”。

## 三种路径比较

| 路径                            | 保真与开发代价                                                                                                      | 关键安全/运行边界                                                                                                                              | 建议                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 丰富 typed vector，直接 SVG DOM | 可精确表达 path/g/transform/clip/marker/text。若也支持 HTML/CSS，schema 很快接近整个浏览器；主题/自定义颜色需扩展。 | 解析后的数字和引用安全可控，但 DOM SVG 的资源、ID、CSS、可聚焦子节点都要限制；新增节点还会改变现有 preview 点击目标逻辑。                      | 对纯 SVG profile 可行，不能称任意 Mermaid 输出完整支持。                         |
| 严格验证的自包含 SVG image      | 保留原始几何与 CSS 排版最接近官方输出；img 无图内交互，与现 preview 单一编辑入口吻合。                              | 不能信任“字符串已sanitize”。先有界 XML/CSS AST 验证，再规范重建，禁止原始markup直插；用宿主创建的blob。image上下文限制是额外防线而非替代校验。 | 推荐静态呈现主路径；typed安全AST比可伪造的“sanitized:true”更容易统一core和导出。 |
| 隔离 DOM 渲染后 PNG/WebP        | 可保留 HTML label/复杂 CSS 的最终像素，不要求编辑器实现这些构造。                                                   | 必须独立进程/可终止渲染单元、无网络和文件访问、解码配额；同线程iframe不满足硬终止。输出栅格失去矢量缩放和语义文本。                            | 真正需要 HTML/复杂CSS且安全SVG profile无法表达时的显式能力；不能静默从矢量降级。 |

## 推荐通用合同草案

新增版本化节点（例如 `type:'svg-image', profile:'static-svg-v1', tree:SvgImageTree`）。tree 保留完整 viewBox 四元组、CSS逻辑width/height、静态节点与显式资源引用。也可选择原字符串作为传输，但必须在可终止隔离阶段转换成同一规范 AST，并在宿主独立重新验证；仅插件内 sanitize 不构成边界。

- **path**：解析为 typed command arrays（M/L/H/V/C/S/Q/T/A/Z，含相对标记）或完整语法解析后 canonical d；禁止仅用字符白名单。有限数字、命令/坐标总量、arc flags与半径约束、计算量配额，不把曲线离散成近似折线。几何 bbox 不能仅检查端点，曲线控制点/transform可能产生大尺寸。
- **transform**：typed有序操作或6值矩阵，有限值与累计变换幅度；保持乘法次序、旋转中心，不仅支持 translate。
- **clip/mask/gradient/marker/use**：只允许同一图内显式ID引用，验证存在、类型、引用深度/展开预算及循环。生成局部命名空间，正确重写每个引用（含 marker-start/mid/end、clipPathUnits、markerUnits、refX/Y、orient、gradientTransform）。缺任一必要构造应整图报不支持，不能删除箭头或裁切。
- **CSS**：不得透传任意 style。采用已解析的selector/declaration allowlist或在隔离官方布局环境计算并内联所需最终属性。允许有限颜色、stroke dasharray/linecap/linejoin、opacity、font、text-anchor/dominant-baseline等明确值域；CSS变量应解析为最终颜色。所有 url 仅允许已验证本地图形引用。拒绝 import、外部字体、动画、任意资源URL和未实现属性；不能只 regex 去 url 后保留剩余样式。若固定官方stylesheet含无效/未用安全字段，需能证明剔除不改变visual，且记录规范化规则，不做通用静默丢弃。
- **foreignObject**：不能直接挂进主文档。纯SVG profile优先由官方配置产生 SVG text/tspan 标签，但必须对指定版本每种图实证，不假设 htmlLabels=false 能消除所有foreignObject。若需要真正 HTML label，image profile 可另定义极小 XHTML/MathML 文本布局schema（具体标签、样式、namespace全验证）并实际验证 WebKit 图像解码；超出schema转为明确unsupported或经独立DOM进程完整栅格化。删除foreignObject会丢全部标签，绝不可作为成功。
- **字体**：固定随包可用的许可字体族，测量和呈现用同一font fingerprint；等待字体ready后布局。不能测量A字体、img回退B字体。SVG image内无法依赖编辑器CSS注入字体；如需嵌入，接受受控内置字体ID由宿主装配，不接受插件任意data URI字体。CJK/emoji/组合符缺字必须测实际像素。
- **颜色/导出**：将 theme 作为已存在request输入并返回resolved颜色；screen/export共用规范序列化，不依赖编辑器CSS变量，也不把所有颜色改currentColor。纯 serializer 需要为新节点显式产出规范 SVG 或内嵌图像；导出不得复用临时blob URL。
- **资源**：initial版不接受远端image、file、任意dataURI、脚本、事件属性、SMIL、外部href、SVG a。遇到实际请求这些能力的图应明确拒绝，不能显示无图像的残缺图。未来资源需独立opaque grant，不借源码URL自动授权。
- **无障碍与选择**：fragment.accessibleText保留官方title/desc与节点/边语义摘要；img配alt，wrapper保留现有键盘Enter显示原文。图内文字不参与源码caret/copy/search，源文本仍唯一编辑对象。静态图禁止 Mermaid bindFunctions；公开reference仍只有版本绑定源目标，不变成任意链接/脚本入口。
- **缩放与滚动**：尺寸取真实viewBox，保持非零原点与preserveAspectRatio；不能直接viewBox 0 0误裁边。大图继续使用现wrapper的bounded viewport与横/纵scroll，不强缩到标签不可读。等待图像decode再交换可见内容，失败保留源码；预先设置intrinsic尺寸防高度抖动。相同语义/文档的refresh继续保inner scroll，配置/版本变更不能带旧offset。栅格路线需要显式像素密度与总像素预算，200%缩放不能假称无限矢量清晰。

## 两秒、生命周期与不静默丢内容

1. 保留现2秒执行上限、队列2、撤销/版本/selection/epoch校验。序列化、SVG解析、复杂样式归一化也必须有界，不能将昂贵不可信处理搬到编辑线程逃过预算。
2. 若官方渲染需要真实DOM，先证明运行单元能独立终止同步死循环且不冻结编辑器，再批准接口。新独立进程至少要做：本地包加载白名单、无网络/文件桥、固定viewport/font、请求ID和nonce、单个pending结果、主动cancel回收、超时进程终止、输出字节/像素验证。不是给每个插件任意浏览器权限。
3. 10秒宿主窗口上下文准备不是引擎额外预算。不能让Worker在2秒内返回“稍后结果ID”后另一路无限渲染。
4. 超过当前256KiB/4096node/8192尺寸不能截断再ready。先取官方复杂图样本统计；若要提升配额，作为独立公共合同审查，仍有aggregate硬限。64Ki/256行跨窗不完整继续原文，不为了图表暗中全文件读取。
5. disable/uninstall/config替换必须abort任务、撤销图像URL、清理decode回调与缓存，立即回原文；后台结果不可复活。source模式一直literal，live被选区触及即原文，不写文档/version/history。
6. 接受失败不等于“完整引擎交付”：如果主要官方图种在安全profile内仍无法表达，需要扩profile或隔离栅格，而不是把这种缺口包装成“完整支持但fallback”。

## 应先做的证明与后续 native 矩阵

先采指定版本官方输出fixture：nested subgraph、曲线/箭头、class/state/ER/gantt、sequence激活区/多行note、pie图例、复杂中文/emoji/数学label、非零viewBox、用户style及HTMLlabel。为每个输出列出element/attribute/CSS/resource inventory，确定schema后再实现。官方结果与规范化结果用同字体/尺寸做实际图像对照，边界/label/marker缺失即失败，不能仅count nodes。

保留普通/窗口化×source/live×light/dark×100/125/150/200×wide/narrow 64场景；对大型图额外真实wheel到top/bottom/left/right及图例，截图证明边缘/文本可达。覆盖异步换窗、同位置scroll去重、刷新保持inneroffset、选择揭源码、点击/Tab返回、编辑undo/redo、disable/uninstall后恢复原文与全文bytes。两秒真实死循环终止在UI堵塞下仍有效，网络请求计数零、恶意XML/CSS/ID引用/foreignObject整片failclosed，export与screen视觉等价应独立验收。Linux证明不能替代Windows。

## 官方资料（2026-10-16读取）

- [Mermaid使用/API与安全配置](https://mermaid.js.org/config/usage.html)：官方 render 返回SVG与可选bindFunctions；strict关闭点击；文档提醒字体未加载会导致标签越界。此处不直接采用官方示例innerHTML。
- [Mermaid配置schema](https://mermaid.js.org/config/schema-docs/config.html)：htmlLabels选择HTML标签；fontFamily可配置。这些是可用配置，不是全图种无foreignObject的证明。
- [MDN：SVG作为图像](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image)：image上下文可限制脚本与外部资源，与iframe/object文档上下文不同。仍需对本产品WebKit实际验证，不能将浏览器限制替代验证器。
- [MDN：foreignObject](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/foreignObject)：可承载其他XML namespace，通常XHTML，因此不属于当前纯SVG primitive合同。
