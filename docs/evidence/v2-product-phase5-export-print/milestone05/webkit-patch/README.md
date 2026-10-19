# WebKitGTK 2.52.6 原文 / 字形簇补丁审查材料

日期：2026-10-19。当前决策：保持 MilkUp 已有依赖，研究 WebKit 引擎补丁；先前 Chromium 结果仅保留为实验对照。

**结论：尚无完整、可部署的 Unicode PDF 修复。** 本目录给出一个可审查的 RTL 字符偏移配对前置 diff、原文元数据接线设计及明确阻塞。前置 diff 不会让当前 PDF 获得 ActualText，也不代表已经修好复制或搜索。没有编译、运行或安装修改后的 WebKit；没有修改 MilkUp 产品、现有系统库或运行时。

- 本文后半部分：源码链、候选合同、fallback / RTL / 非单调 cluster、DisplayList / IPC / ABI 覆盖缺口与验收门槛。
- [0001-review-only-align-glyph-source-offset.patch](0001-review-only-align-glyph-source-offset.patch)：仅一处 `ComplexTextController` 字形与字符偏移配对修改，供上游审查；未经引擎回归。
- [reference-cases.py](reference-cases.py)、[reference-results.json](reference-results.json)：9 个源码推导模型，说明直接拼接 cluster 的错误条件；**不是 WebKit、PDF 或浏览器实测**。
- [source-manifest.json](source-manifest.json)：有限源码文本的上游标签 URL、字节数及 SHA-256；外部研究目录的 `sources/` 保留原始文件与许可头；本精简证据目录不包含源码树，运行 fetch 脚本可按清单获取并逐项验 SHA。标签为 `webkitgtk-2.52.6`，不声称等于 Debian 应用全部下游补丁后的完整构建树。
- [build-feasibility.md](build-feasibility.md)：独立 native 审查，记录本机库身份、缺失构建条件和部署边界。

范围止于可审查研究材料。没有隐藏整行文本、没有从 glyph ID 猜回原文、没有切换 HarfBuzz 全局 shaping 策略、没有把 RTL / fallback 排除后宣称通用正确。最小完整补丁仍需解决设计文档列出的语义与传输问题，然后在匹配引擎构建中验证。当前环境缺匹配完整构建树、工具链与空间；不可通过单文件链接或修改 stripped 系统库替代。

---


## 判断与交付边界

上游已有 Skia `ActualText` 生成机制，但 WebKit 的 Skia 字形绘制入口没有给它原文及 cluster。仅把 `allocRunPosH` 换成 `allocRunTextPosH` 不够：该处只剩字形、位置和字体，无法可靠恢复原文。完整修复需要跨 shaping、字体拆分、GraphicsContext、DisplayList 与 Skia 传递语义元数据。目前**未形成完整可靠的端到端 patch**；提供的 diff 是独立前置候选，不能声称修复 PDF。

本研究只读取指定标签的有限源码文本，无引擎构建。下文事实来自这些文件；拟议数据结构和覆盖策略是设计建议，不是现有能力。源码快照 / URL / SHA 见 manifest。发行版还可能有下游补丁，必须在实际构建前逐项核对。

## 已核对的丢失链

| 位置 | 已有信息与丢失点 |
| --- | --- |
| `FontCascade::drawText`、`displayListForTextRun` | 原始 `TextRun` 和请求 `from/to` 在场；生成、flatten 字形缓冲后，调用 `drawGlyphBuffer` 时不传原文。 |
| `WidthIterator` | 简单路径把 UTF-16 字符偏移写进 GlyphBuffer；非 BMP 字符可先产生后半代理项的占位 glyph，不能直接把每个 offset 当有效 UTF-8 边界。 |
| `ComplexTextController` / HarfBuzz | 保有 shaping run、字体、原文位置、方向、cluster start/end；HarfBuzz 使用 `HB_BUFFER_CLUSTER_LEVEL_CHARACTERS`，不能假定全部簇单调或同簇 glyph 相邻。 |
| `GlyphBuffer` | 有随 glyph 移动的单个 UTF-16 offset；没有完整 run 来源、明确 cluster end、源文本所有权。synthetic/noOffset/不可见 glyph 需要独立处理。 |
| `FontCascade::drawGlyphBuffer` | 按连续相同字体拆分，只给 context 传 glyphs、advances、位置、平滑模式；fallback 拆分之后无法仅靠该 span 推断原文范围。 |
| `FontCascadeSkia` → `Font::buildTextBlob` | 当前只用 `allocRunPos` / `allocRunPosH`，完全不填 `utf8text` / `clusters`。 |
| `SkPDFDevice` | 收到带文本的 glyph run 时可按 cluster 使用 ToUnicode 或在**现有 glyph 绘制**外包 ActualText；原文缺失后只能依靠字形/字体映射，不能区别共享字形的原字符。 |

GTK `WebPrintOperationGtk` 在本地 unaccelerated `GraphicsContextSkia` 上 spool page，是直接输出入口。它不是远端 GPU 接线已经完整或缓存显示列表不会参与的证据。

主要原始来源：[FontCascade](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/FontCascade.cpp)、[FontSkia](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/skia/FontSkia.cpp)、[SkPDFDevice](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/ThirdParty/skia/src/pdf/SkPDFDevice.cpp)。

## 可单独审查的前置 diff：RTL offset 配对

`ComplexTextController::advance` 按 `glyphIndexIntoCurrentRun` 选择当前实际 glyph（RTL 时为 `glyphCount - 1 - m_glyphInCurrentRun`），但当前写入 GlyphBuffer 的字符串 offset 使用 `indexAt(m_glyphInCurrentRun)`。候选改为 `indexAt(glyphIndexIntoCurrentRun)`，让源 offset 与实际 glyph 使用同一个 run 索引。

反例：visual glyph 顺序 C/B/A，cluster 为 2/1/0。RTL 处理后再由 FontCascade 反转，原公式可得到 C→0、B→1、A→2；候选得到 C→2、B→1、A→0。LTR 两种索引相同。模型记录在 `reference-results.json`。

该 diff 不修改 glyph ID、advance、origin 或字体；不添加 ActualText 或任何传输字段。但 offset 可被文字装饰/选区等其他逻辑使用，因此仍需 WebKit 复杂文本、selection、decoration、垂直文本和非单调簇回归，不能仅凭模型断言对所有平台安全。它还在共享 `ComplexTextController.cpp` 中，不能假定影响仅限 Skia。

来源：[ComplexTextController](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/ComplexTextController.cpp)。

## 最小完整修复需要的元数据合同（尚未实施）

建议语义层保存一个引用计数、不可变的源记录，加逐 glyph 的来源引用；临时 `TextRun` span 不得逃逸到缓存或 IPC。记录至少包括：未经规范化的原始 UTF-16、原文有效范围、shaping run ID、方向、字体分段来源、每个 glyph 的原文 cluster 起止及 synthetic 标识。glyph 的反转/删除/插入/合并必须同步维护记录。选择性绘制 `from/to` 和 ligature 跨边界必须规定“真实绘制的完整 cluster”语义，不能把一个 ligature 随意改注为其中一个码元。

到 Skia 边界才转换成**该语义片段的** UTF-8 和 glyph-count 个 UTF-8 byte offsets。须验证 UTF-16 代理项完整、偏移是 scalar 边界、UTF-8 byte offset 在片段内、count/长度在 Skia int 范围内，并保留兼容字符、变体选择符、组合字符与原始规范形式。不允许由 glyph cmap 反推、NFC/NFKC 或用整个 TextRun 填每个 font span。

简单、单字体、单调、完整 cluster 的 span 可按上述数据直接使用 `allocRunTextPos` / `allocRunTextPosH`，复制原文字节和 cluster 数组，其余 glyph / position / smoothing 不变。这个子集能解释 CJK 同 glyph 不同原文的修复机制，但不构成完整交付。

尚未解决的核心不是字段数量，而是这些分组语义：

1. **fallback 边界。** 假设 A/B 分别使用两种字体，每个 font span 都带全文 `AB`，A 的最后 cluster 会吞掉 B，最后得到 `ABB`。必须在按字体拆分之前保存准确源区间；不可用该 font span 的最大 offset 到整行结尾。跨字体同一逻辑 cluster 与回退多 glyph 还需要统一归属，不能重复原文。
2. **非单调 / 非相邻同簇。** Skia 接口文档要求单调 cluster。实现会扫描全部 cluster 找 next-greater end，所以非单调 distinct offsets 并非都无法切片；但它仅合并相邻同簇 glyph。`[0,1,0]` 对 `ab` 会产生 `a,b,a`，重复原文。不能把现有 HarfBuzz offset 原样投入 sink。也不能全局改 shaping cluster level 后宣称无布局副作用。
3. **RTL / bidi。** Skia 只把单调递减且末项为 0 的序列识别为 ReversedChars。简单 RTL 修正不等于混排或跨字体 bidi 的逻辑抽取次序正确。需要保留 run 方向和逻辑顺序，并在实际 reader 中验证复制/查找。
4. **复杂分组的可实现路径待选择。** 可以研究保持绝对位置的语义 cluster 分组绘制，或者给 PDF 后端增加跨实际 glyph draw 的 cluster 级 marked-content。前者可能改变叠印/组合字形的绘制顺序，后者需修改 Skia PDF API 及状态管理；两者均未证明。不能用整行隐藏文字覆盖绕过，也不能把无法映射的 cluster 静默丢弃后宣称完整成功。
5. **无 glyph 文本。** 默认忽略字符、控制符、软连字符、emoji ZWJ/VS、被裁剪/省略内容、生成的标点、强调标记等必须有明确源归属。不能把所有 glyph 缺失的源字节随意加到邻近 span。当前没有证明全部行为。

来源：[HarfBuzz cluster 设置](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/harfbuzz/ComplexTextControllerHarfBuzz.cpp)、[SkTextBlob 合同](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/ThirdParty/skia/include/core/SkTextBlob.h)、[SkClusterator 实际行为](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/ThirdParty/skia/src/pdf/SkClusterator.cpp)。

## 接线与 ABI / IPC 覆盖清单

以下均为**完整补丁需要覆盖但本候选未实现**的路径。

| 层 | 精确接线位置 / 风险 |
| --- | --- |
| 输入 / shaping | `FontCascade.cpp` 的 `drawText`、`displayListForTextRun`、`layoutSimpleText`、`layoutComplexText`；`WidthIterator`、`ComplexTextController` 与 `GlyphBuffer` 变换。源数据可能经 small caps / transforms，必须保留原文而不是变换后的文本。 |
| 直接 GraphicsContext | `GraphicsContext.h/.cpp` 的 virtual `drawGlyphs` / `drawGlyphsImmediate`，`FontCascade.h` 的静态 drawGlyphs 及 `FontCascadeSkia.cpp`，最后 `Font.h` / `FontSkia.cpp`。所有派生 override / 其他平台调用方均需核对。 |
| 本地 DisplayList：Normal | `DisplayListRecorderImpl.h/.cpp` → `DisplayListItems.h` 的 `DrawGlyphs` 持有元数据 → `DisplayListItems.cpp::DrawGlyphs::apply` 回放。只改直接 context 会在记录时丢失数据。 |
| 本地 DisplayList：TextBlob | `FontCascade::displayListForTextRun` 在 Skia 平台 context 存在时可选择 `TextBlob`；`DrawTextBlob` 构造时立即调用 `Font::buildTextBlob`。需在构造时保留 / 填入文本，不能等回放再找原 TextRun。 |
| 远端 context / IPC | `RemoteGraphicsContextProxy.h/.cpp::drawGlyphs{Immediate}` 当前只发送 font ID、glyphs/advances、anchor、smoothing；`RemoteGraphicsContext.messages.in` 的 `DrawGlyphs` schema 和 GPU 侧 `RemoteGraphicsContext.h/.cpp::drawGlyphs` 需一起更新，增加长度/边界验证。`RemoteDisplayListRecorderProxy` 继承这条路径。 |
| 其他 draw / replay | 强调标记、SVG 文字、text-path、vertical/color fonts、decomposed glyphs、canvas、image buffer、缓存重用及过滤器路径需进行完整调用图 / 实际打印核对。有限源码审查未枚举全部入口；不能声称这些已经覆盖。 |
| ABI / 进程匹配 | 修改虚函数参数或新增虚函数可能改变内部 C++ ABI / vtable；增加 DrawGlyphs 消息字段改变 IPC 协议。必须使用同一构建匹配库、WebProcess、GPUProcess、生成 IPC 代码及相关运行组件。不会通过可公开替换的小插件接口完成。 |

现有 diff 只修共享函数内部的一次 offset 取值，本身未增 ABI / IPC 字段。它的低文本行数不能作为完整修复规模或安全性的依据。当前 GTK 直接打印入口不证明所有内容都绕开缓存 / 远端路径；可以对以后 patch 声明经过验证的 GTK 专用范围，但不能对未审计路径静默丢 metadata。

来源：[本地 RecorderImpl](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/displaylists/DisplayListRecorderImpl.cpp)、[远端 Proxy](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebKit/WebProcess/GPU/graphics/RemoteGraphicsContextProxy.cpp)、[远端消息定义](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebKit/GPUProcess/graphics/RemoteGraphicsContext.messages.in)、[GPU 接收方](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebKit/GPUProcess/graphics/RemoteGraphicsContext.cpp)。

## 完成修复前的最低验收

- 在匹配 WebKitGTK / Debian 构建上编译、运行，核对实际 loaded library、BuildID / SHA；不能把当前未修改的库运行结果记作 patch 验收。
- 对原有真实 HTML 的汉字 / CJK 兼容字符、emoji、代码引号、SVG 图表汉字和组合文本逐码点复制/搜索比较，不仅比较视觉截图。
- 加入 RTL + 数字 + LTR 混排、阿拉伯连写、复杂脚本重排、跨字体回退、非相邻同簇、ZWJ/VS、非 BMP、ligature 部分范围、vertical 与 glyph 缺失 / synthetic 情况；验证原文不重复、不遗漏、不规范化。
- 比较补丁前后的 glyph / advance / page geometry / 可见输出，证明没有为文本抽取改变布局、字体选择或分页。
- 本地 Normal 与 TextBlob 记录/回放、缓存复用和进程边界各有覆盖；IPC 畸形长度/offset 拒绝及元数据释放后生命周期测试。
- 验证 PDF ActualText 内容及 Poppler / MuPDF / 真实 viewer 的复制和查找。reader 对 ActualText 的支持有差别；pypdf 单一结果不能作为通用 reader 结论。
- 继续单独追踪长块标题分页：本 Unicode 前置 diff 不涉及分页 CSS 或排版，不能声称同步解决。

当前仅 9 个源码推导反例模型通过，patch 正反向应用检查见 `patch-validation.json`。没有引擎编译或修改后 PDF 验收。构建及部署阻塞详见 native 的 `build-feasibility.md`；不再扩大下载或启动未知重建。
