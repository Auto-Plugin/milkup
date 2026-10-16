# static-svg-v1 受控输出 profile 与恶意输出测试草案

此为审查草案，未增加公共类型或产品功能。先用锁定官方 Mermaid 版本的真实 SVG inventory 校准。默认预算沿用现 presentation 的256KiB/4096节点/depth64/128fragments；新path指令、引用展开、CSS规则计算有独立总量计数，具体数值必须按样本与负载证明确定，不能隐式无限。

## 信任边界

插件/独立DOM helper输出不可信；“已sanitize”字符串、helper返回类型声明、随机ID都不能免宿主校验。helper可负责解析官方SVG、计算样式与转换typed AST；宿主只接收plain data AST，再独立验证与canonical序列化。编辑文档只挂宿主创建blob的img，不innerHTML，不把SVG嵌iframe/object，不调用bindFunctions。辅助进程必须独立硬终止；其协议与输出profile是两条分别需要证明的边界。

建议泛型节点字段：

- svg-image：profile版本、width/height（CSS逻辑长度）、viewBox=[minX,minY,width,height]、preserveAspectRatio枚举、tree。
- tree：g/rect/circle/ellipse/line/path/polyline/polygon/text/tspan/defs/clipPath/marker；gradient/mask/use等仅在实际inventory证明必要并有完整验证后加入。
- g与shape：typed transform数组或affine matrix，typed paint和opacity；无任意attribute字典。
- path：命令discriminated union（M/L/H/V/C/S/Q/T/A/Z）及定长数值参数；arc flag只有0/1。需完整消费输入，不允许尾随垃圾或省略参数被忽略。
- text/tspan：文字或有序子片段，x/y/dx/dy有限数值列表、anchor/baseline枚举、fontId/fontSize/fontWeight/fontStyle/decoration枚举。不允许HTML字符串；若当前profile不能表达textPath或嵌套混合内容，整图拒绝。
- paint：none、有限RGBA、已验证本地gradientRef（未实现时不允许）；strokeDasharray、linecap/join/miterLimit明确类型；currentColor在helper计算为最终颜色。
- clipPath/marker：局部typed ID、units枚举、refX/refY/orient/markerWidth/Height和子树；属性不能错误套用普通shape默认值。
- a11y：host fragment accessibleText + plain title/description；图像alt不接HTML、不作为脚本或URL。

不要使用 type:string / attrs:Record<string,string> / rawCSS / rawSVG / html 作为逃生口。

## 样式与ID规范化

helper在隔离真实DOM中等待受控字体ready，锁定theme/viewport；对官方样式完成cascade、继承与已匹配规则解析，输出最终paint/font/layout属性。宿主不能通过“CSS字符串没有url”就接受。原始输出里存在未处理的可能影响视觉的rule/attr时整图失败；不能不认识就忽略。CSS规范化需要记录转换前后所覆盖的属性集，使用实际截图对照证明保真。

ID由宿主分配输出局部前缀，映射所有defs和所有引用；引用只能typed ID，不能url文本。拒绝重复ID、悬空ID、错误引用类型、循环以及超过展开预算。即使img独立document天然隔离，仍规范化，保证未来导出合并不会互相引用。不得修剪#之外的前缀把外部URL“洗成”本地引用。

viewBox允许非零与负原点；每个数字finite，变换链与viewBox比值有界。不能只限制原始坐标而不限制matrix导致的最终巨大几何；不能clamp超界值改变图形。stroke、marker、filter等绘制外延纳入检查。若不支持某个滤镜，显示明确错误而非删掉阴影/符号。

foreignObject：初版若锁定官方 htmlLabels:false 后仍生成，必须整图失败并记录类型；不能删掉后ready。若成熟图种确实依赖它，决定增加单独经过验证的XHTML文本profile或独立隔离栅格结果，不能将任意HTML许可塞入现profile。外部image/icon/font同理，不因官方输出而自动授权。

## 必须成立的恶意输出测试（通过公开validator/serializer/view入口）

| 测试输入                                                                            | 必须结果                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| script、onload、onclick、href javascript、SVG a、animate/set、未知节点/属性         | 整图invalid-output；源码与可见错误；无部分ready          |
| path NaN/Infinity/1e999、错误参数数、非法arc flags、垃圾尾随                        | 完整拒绝，不截断或修复                                   |
| transform矩阵爆炸、极深嵌套、超大viewBox、负width/height、巨大stroke                | 有界拒绝，不触发巨大canvas分配                           |
| clip/marker外部url、file、data、blob、https、带空白/转义url                         | typed输入拒绝；没有请求，没有静默改为本地                |
| 缺失/重复ID、marker指向text、循环use/clip、指数引用展开                             | 有界拒绝；canonical输出无冲突                            |
| CSS import、url、escaped url、var回退URL、font-face src、filter资源、未支持property | 原始转换阶段拒绝；宿主typed入口无法承载这些字符串        |
| foreignObject带script、HTML事件/img/iframe/link/style/MathML链接                    | 初版整图拒绝；不能剥离子树后成功                         |
| 文本含</text><script>、&、引号、零宽字符、RTL、组合Unicode                          | 按文字编码，无元素注入；Unicode保留                      |
| object原型污染键、getter、Proxy非plain data、过深tree/过多path segments             | 与现plain-object规则一致拒绝；执行与输出都有预算         |
| 单图各自合法但聚合超256KiB/4096node                                                 | aggregate拒绝/明确不完整，不越预算                       |
| helper标记validated:true但恶意tree                                                  | 宿主独立验证失败，不能信任标记                           |
| image decode失败、迟到decode、source/version/config更改、停用卸载                   | 不挂载旧图；blob释放；原文可编辑且history不变            |
| equivalent refresh/window replacement                                               | 保持当前innerTop/Left、焦点lease与阅读锚点；不重置到顶部 |
| 单次id重复的两个fragment/两个document                                               | canonical IDs隔离，不串图                                |
| 200% narrow + 非零viewBox + longlabel/marker超边缘                                  | 原图所有语义内容可通过真实滚动达到，不裁掉箭头/标签      |
| screen与export（light/dark）                                                        | 同树同颜色/字体/几何；export无blob URL、外部资源或事件   |
| helper真实while(true)、abort后仍计算                                                | 独立两秒终止，编辑线程继续响应；不能靠协作AbortSignal    |
| PNG栅格可选路线超大dimensions/压缩炸弹/错误mime                                     | decode前后配额；保留明确分辨率，不假称vector             |

“完整保留”测试需以官方引擎实际输出为oracle：同字体与相同逻辑尺寸下对照标签文本、边/箭头、group位置、clip和图例，并看原图。不能用自家AST输出自身当唯一oracle。任一不能转换的原始构造必须可报告具体kind/reason，绝不以减少节点数作为成功优化。

## 公共合同与视图兼容验收

新增node discriminator和profile version需同步 core、独立SDK发布、runtime/RPC、aggregate validator、纯export serializer、view DOM builder。旧vector/math/reference继续兼容；不按plugin ID开白名单。source模式不创建preview；普通与windowed live沿原fragment来源范围/selection reveal路径。渲染内容不可改变Markdown、document version、history、save format。辅助图像decode尺寸变化只通知既有layout测量机制，防窗口spacer反馈；默认尺寸提前分配，掉线/错误回原文不遗留空洞。
