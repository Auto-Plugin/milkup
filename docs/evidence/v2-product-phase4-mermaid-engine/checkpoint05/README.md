# 第五检查点：转换覆盖、归一化反例与 rasterBounds 合同

**进行中的静态归档，不是最终产品验收或全部通过声明。** 本目录继承[第四检查点](../checkpoint04/README.md)的证据规则；[index.json](index.json)逐份记录原件绝对路径、存储路径、字节数与 SHA256。文本追加 `.txt` 后逐字节保存，PNG 未缩放、未拼接。归档操作仅复制、计算哈希和整理既有结果，没有运行新的转换、测试或原生验收。

本次快照以 `index.json` 中的归档时间和 HEAD 为准。后续生产修复、当前源码变化及新结果不能倒填到这里的历史批次。二进制、生成 bundle、node_modules、target/build、profile 均不归档；已有来源清单中的相关路径/哈希保留作为外部引用。`selectionHashMismatches` 应为空。许可证最终清单仍在核对，不以历史 121 条记录宣称 121 份许可证均有效；其中维护脚本误入的历史记录不能作为最终许可清单。

## 37 项首次转换与独立宿主验证

[首次选集](research/svg-converter-prototype/native-runner/baseline37-first-selection.json.txt)、[完整摘要](research/svg-converter-prototype/native-runner/baseline37-first-summary.json.txt)与[分类](research/svg-converter-prototype/native-runner/baseline37-review/classification.json.txt)保存 37 项首次调用：转换成功 **19**，拒绝 **18**；首次独立宿主接受 **17**，另 **2** 项拒绝。拒绝中包含普通呈现能力缺口，不能笼统计为安全负例通过。例如 Timeline 的 brightness 是普通呈现能力；当前整图回退必须计为未支持，不能归入网络、脚本或点击等受限主动能力，也不能由单例 brightness→none 像素相同推断已实现。后面的 product-converter02 是选定 11 个普通样例，不是重新跑完这 37 项，更不是 Timeline 已通过。

[宿主首轮](research/svg-converter-prototype/native-runner/host-validation-baseline37-first/results.json.txt)与[虚线校验修正后](research/svg-converter-prototype/native-runner/host-validation-baseline37-dash-final/results.json.txt)均保留；后者接受全部 19 份已转换 AST。该结果仍属于旧合同的转换/规范序列化验证，不是像素、完整图型或新 required `rasterBounds` 合同通过证明。37 份原始 run、日志及冻结源码均在 `research/svg-converter-prototype/native-runner/`。

## 真实像素归一化：通过与反例分别保留

以下仅为特定 Linux 原生 WebKit 样例的原始 DOM 研究，不是通用删属性授权。每组原始/修改后 PNG、状态、日志和比较 JSON 保存在对应 `runs/normalization-*` 目录。已有执行者及根代理的实际看图记录原样保留，本次归档没有新增看图或渲染声明。

| 操作                                              | 实际结果与边界                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 缺失本地 filter 改为 `none`                       | **失败：388 像素变化**，新增了原本未绘制的 loop 标签多边形背景/边框。[首次反例](research/svg-converter-prototype/native-runner/normalization-missing-filter-first-review.json.txt)不可被后续结果覆盖。                                                      |
| 缺失 filter 改为另一个已确认不存在的本地 fragment | 当前单一样例 **0 像素差、PNG 字节一致**，保留原缺失引用的绘制效果。[记录](research/svg-converter-prototype/native-runner/normalization-missing-local-fragment01-review.json.txt)不证明其它引擎或任意引用均等价。                                            |
| 实际 SVG rect 的 box-shadow                       | 单个 SVG rect 去除该属性后 PNG 字节一致；不允许据此删除 foreignObject/XHTML 的有效阴影。[四组首轮研究](research/svg-converter-prototype/native-runner/normalization-first-review.json.txt)。                                                                |
| Gantt 根裁剪之外的直线                            | 删除该样例完全不可见的直线后 PNG 字节一致，但祖先 bbox 改变；通用裁剪必须排除依赖 bbox 的祖先效果，不能只看叶节点在视口外。                                                                                                                                 |
| circle 的 width/height                            | 只删除两个 circle 上不适用的尺寸属性，保持 cx/cy/r 后 PNG 字节一致；不是通用属性忽略规则。                                                                                                                                                                  |
| Timeline brightness 转显式 componentTransfer      | **失败：36,204 像素变化**，事件框变浅且文字边缘变化。[首败](research/svg-converter-prototype/native-runner/normalization-timeline-region01-review.json.txt)保留。                                                                                           |
| Timeline 原 CSS brightness 改为 none 的独立对照   | 本例 **0 像素差、PNG 字节一致**；说明本轮 WebKit 原 inline 样例未观察到该属性的绘制效果，不证明其它引擎、SVG 图片上下文或任意 brightness 可删除。[后续对照](research/svg-converter-prototype/native-runner/normalization-timeline-none01-review.json.txt)。 |

## 产品 core/SDK 与 view 合同验证

[core/SDK 实现摘要](research/product-integration-red/port/summary-final.json.txt)保留实现期间的真实结果：core SVG 53 项、旧 renderer/RPC 31 项，以及历史 19 份实际 AST 的产品公开入口验证。最初两次 pnpm 调用在编译器运行前发生环境错误；之后直接 TypeScript 调用的 nullable 错误和修正也保留，[环境说明](research/product-integration-red/port/environment-note.json.txt)不将启动错误伪装成产品失败。固定元素预算修前的 3 项失败见原始日志。

根边界问题推动新增 required `rasterBounds: [x,y,width,height]`，单位为根 CSS 像素；须包含根视口，整数外缘使用 floor/ceil，仍保留原精确内层视口、布局足迹和独立效果预算。[rasterBounds 摘要](research/product-integration-red/raster-bounds/summary.json.txt)记录 **修前 6 失败 / 1 通过 → 修后 60 通过**，以及 core/SDK 类型和公开合同检查。SDK contract 首次 `@ts-expect-error` 位置错误及修正单列，未放宽校验器。

[旧 view 实现](research/product-view-integration/execution.json.txt)为 104 项；[rasterBounds 后 view](research/product-view-raster-integration/execution.json.txt)为 **108 项（38 image + 70 既有 presentation）**，类型与格式通过。两者仅验证 JSDOM 中的所有权、生命周期、源码回退和布局声明，图片 decode/Blob 边界使用 mock；不是实际图片解码、像素等价、wheel 可达或生产编辑器通过证据。

## Marker 后续单测补充与冻结边界

[marker reference 摘要](research/product-integration-red/marker-reference/summary.json.txt)记录 core **修前 5 失败 / 1 通过 → 14 通过**，插件私有 paint bounds **修前 2 失败 / 23 通过 → 25 通过**。修正引用点与内容使用相同 viewBox 矩阵、引用单位及 marker 继承上下文。开发环境旧 SDK tarball 缺 required `rasterBounds` 的类型失败保留；随后只映射到当前公开 SDK 类型的严格检查通过，不将它写成新的外部安装/构建证明。

[marker paint 摘要](research/product-integration-red/marker-paint/summary.json.txt)记录预算继承回归 **修前 2 失败 / 2 通过 → 8 文件 70 项通过**，含 marker reference 及既有 raster、安全、成本与未解析引用回归；core 严格类型与格式通过。它修正 marker 使用根/定义上下文而非引用形状的 paint 继承，保留 symbol/use 原规则。各轮测试有重叠，不能累加成新的独立测试总数。

这些是单元/类型验证，**没有新增原生像素复验或生产验收**。早先 rasterBounds 的 implemented-files 是 marker 修正前的历史快照，不是最终 core 冻结。checkpoint05 在此补充后冻结；后续完整 raster 原生、构建与生产矩阵使用 checkpoint06，不能覆盖本批原件或将新结果回填为旧批通过。

## 根边界真实裁剪修前证据

[六组执行记录](research/product-ui-preparation/edge-execution.json.txt)来自旧边界合同的实际 Linux WebKit 对照，light、zoom 1。使用当时产品 core 验证/序列化固定 AST，不是生产插件转换运行。

- root-visible 的原始左侧描边在规范结果中丢失 **336 像素**；[原图](research/edge-product-root-visible-z100/runs/edge-root-visible-z100-native/controlled-original.png)、[规范图片](research/edge-product-root-visible-z100/runs/edge-root-visible-z100-native/canonical-img.png)。
- marker 的右箭头在根视口处被裁掉 **102 像素**；[原图](research/edge-product-marker-z100/runs/edge-marker-z100-forced/controlled-original.png)、[规范图片](research/edge-product-marker-z100/runs/edge-marker-z100-forced/canonical-img.png)。
- hidden、fractional 与 Sankey 的对应图像无像素差。CSS shadow 样例原图本来没有实际阴影，不能将无差异计为有效阴影正例。

[root 实际查看四张原图的记录](research/product-ui-preparation/edge-before-root-visual-review.json.txt)确认左描边缺失和箭头尖端裁剪。required `rasterBounds` 的单元测试通过不能替代这些真实边界的新合同原生复验，更不能提前宣称完整生产修复。

## product-converter02：37/38 符合预期，CSS origin 保持 RED

[冻结批次说明](research/svg-converter-prototype/native-runner/product-converter02-review.json.txt)、[38 项摘要](research/svg-converter-prototype/native-runner/product-converter-second-summary.json.txt)记录 **11/11 普通样例 ready + 26/27 固定合同预期结果符合**，合计 37/38；固定合同预期包括明确拒绝，不表示 37 张图渲染成功。

唯一不符合预期的是 `css-origin-once`：转换器错误拒绝 `transform-origin-x=`，见 [原始失败 run](research/svg-converter-prototype/native-runner/runs/product-converter-second-25/result.json.txt)。该批采用 required `rasterBounds` 加入前的冻结 TypeScript 源码，仅证明当时转换行为，**没有新宿主接受或像素验证**。不能给旧 AST 补字段后伪称原执行通过。

更早的 product-converter01 有 **8 次外部 harness 相对资源路径错误**，见 [bootstrap 失败说明](research/svg-converter-prototype/native-runner/product-converter01-bootstrap-failure.json.txt)及全部首轮日志。它们不是 Mermaid 渲染结果；纠正入口后的第二批独立保留，没有覆盖首次失败。第二批使用原 2 秒执行预算和 256 KiB 帧预算，无重试，记录的清理均为空。

## 待补证据

当前 CSS origin、marker/边界及其它正在修复的实现，须以各自新冻结源码、完整修前/修后结果和真实像素补证。新的离线闭包与许可证、仓库外公开 SDK 构建、全仓门禁、真实生产包安装与 source/live/普通/窗口化编辑保存历史矩阵尚不能从本索引推断通过。Windows/macOS、系统 IME、读屏与 P5 输出仍未由本检查点验收。
