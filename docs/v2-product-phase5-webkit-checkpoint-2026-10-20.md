# P5 WebKit PDF：链接与原文搜索失败检查点（2026-10-20）

本轮从精确基线 `cf7d407dbb9416232d4f2163e8cebf9d49798c57` 建立独立分支 `dot/milkup-v2-p5-webkit-checkpoint`。结论是 **阻塞，未修复**：当前 WebKit 输出缺失链接注释，并继续改变部分原始 Unicode 文本。没有修改产品代码、插件、大纲、SDK、依赖或系统配置；P7 候选仍保持隔离。

## 本轮实际执行

沿用 cf7 的已验证生产 ELF，SHA256 为 `f320d5dd7baf43996ef25c39fa239d041ce4d3704e874463bf04a7dca2f0aab7`，23,255,880 字节。保存了原构建证明，并核对 helper 使用的 guard 完整字节确实存在于这个 ELF 中。没有误用当前构建目录里的 P7 候选。

通过生产程序的原生输出 helper、原有 guardian、启用的 WebKit sandbox 与既有只读 namespace wrapper，实际输出两份 A4 PDF：

- `minimal.pdf`：手写最小 HTML，2 页；包含跨页 ID 跳转、旧式 name 跳转、返回链接和外部 HTTPS 链接。
- `serialized.pdf`：当前 `renderStaticMarkdownDocument` 生成，1 页；包含公开 presentation 合同构造的脚注双向引用与正常 Markdown HTTPS 链接。警告为空，所有片段目标均存在。此处使用受控 presentation 数据，未声称执行了独立脚注插件。

这是 **生产原生后端的定点诊断**，没有重跑完整应用 GUI 的打开文档、插件执行、保存选择器流程。两份输出均实际进入 WebKit 打印路径，PDF producer 为 `Skia/PDF m145`；两次 guardian 和本轮拥有的 Xvfb 均正常退出。导出流程成功不代表内容质量通过。

## 画面、文字、搜索、链接分别验收

| 检查                  | 本轮结果                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实际页面画面          | 3 页均已栅格化并逐页查看；标题、正文、脚注和带下划线的链接标签可见，无本例可见裁切。截图不能证明原始码点保真。                                                  |
| 普通 ASCII 提取和搜索 | 两份 PDF 的 `EXTERNAL-HTTPS` 均被 Poppler、MuPDF 原样提取，MuPDF 搜索各命中 1 次。                                                                              |
| 中文原文              | 输入 `中文搜索`，两种提取器均得到 `中⽂搜索`，其中 U+6587 被替换为 U+2F42；原文搜索命中 0 次。                                                                  |
| 组合字符              | 输入 `cafe` + U+0301，提取为预组合 `café`；原始序列搜索命中 0 次。输入本身的预组合对照保留。                                                                    |
| ASCII 连字            | 输入 `office`，提取为 `oﬃce`（U+FB03）；原文搜索命中 0 次。输入本身的 `ﬁle` 对照另行保留。                                                                      |
| 链接结构和功能前提    | 两份 PDF 的全部 3 页均为 **0 个 `/Annots`、0 个 MuPDF 链接、0 个命名目标**。最小 HTML 的 4 个链接和序列化 HTML 的 3 个链接全部缺失实际 PDF 动作，不能点击跳转。 |
| 分页                  | 最小例显式分页得到 2 页；**不代表**旧长表格／代码／列表标题孤行问题修复，本轮未重跑该组。                                                                       |

搜索使用 MuPDF `search_for`，提取使用 Poppler 25.03.0 和 PyMuPDF 1.26.6；pypdf 6.10.0 独立检查注释和命名目标。没有做 NFKC/NFC 归一化来隐藏差异，没有将自动识别 URL 当成真正的 PDF 链接。未执行某个桌面 PDF 阅读器的鼠标点击、剪贴板复制或搜索框操作。

`quality-gate.py` **实际退出 1**，记录 8 项失败（两份文档各 1 项链接和 3 项原文要求）；ASCII 正向对照通过。这是可复现的失败门槛，不是修复后的通过记录，也不是完整 PDF 验收套件。

## 缺失发生在哪一层

HTML 审计确认所有内部 href 的 ID/name 均存在，外部 HTTPS 地址完整。没有需要修正的本例序列化缺失。对照 WebKit 官方 `webkitgtk-2.52.6` 固定标签源码：

1. [`GraphicsContext.h`](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/GraphicsContext.h) 的 `setURLForRect`、`setDestinationForRect` 和 `addDestinationAtPoint` 默认为空操作，`supportsInternalLinks` 默认为 false。
2. [`GraphicsContextSkia.h`](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/skia/GraphicsContextSkia.h) 及对应 `.cpp` 没有覆盖这些接口。
3. [`PrintContext.cpp`](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/page/PrintContext.cpp) 的 `outputLinkedDestinations` 会在不支持内部链接时直接返回。
4. [`WebPrintOperationGtk.cpp`](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebKit/WebProcess/WebPage/gtk/WebPrintOperationGtk.cpp) 的 Skia 分支用 `GraphicsContextSkia` 绘制，再将录制的页面交给 SkPDF。

这是与实际“文字画出、所有链接动作缺失”一致的源码归因。已保存原文件、许可证、URL 和 SHA256；没有将固定标签源码声称为完整复原的 Debian 构建树。当前运行库 SHA256 仍为 `e5145df62121ee186c4a9bdaebe2ebebb706d8ce400675b131449ecf8bd94889`，与此前精确发行包证明一致。

Unicode 原文簇与长块分页的既有引擎限制，仍适用[上轮 WebKit 评估](./v2-product-phase5-webkit-repair-2026-10-19.md)。本轮没有继续尝试字体替换、HTML 拆块或推测性 CSS 改动。

## 为什么本轮停在明确阻塞

当前只有发行版运行库，没有匹配配置的 WebKit 源码／生成头文件／可链接构建树。本轮重新检查，加载既有环境脚本后仍没有 cmake、ninja、clang++、ld.lld、bison、flex、gperf、ruby 和 unifdef；运行库也没有导出上述内部图形接口。已有的 Rust 应用构建工具不能把一个 WebCore C++ 修改编译成独立可装插件。

本轮时间点可用空间为 workspace 2,492,116,992 字节、`/tmp` 3,555,631,104 字节；后者仍是共享内存的 tmpfs。没有据此虚构完整引擎编译的精确资源需求。没有下载引擎或构建依赖、替换系统库、注入内部接口、关闭沙箱、加入 PDF 后处理器或新增浏览器。

**最小下一步**是获得已有依赖版本的匹配 WebKit 构建环境，在引擎内部补齐 Skia 的 URL／内部目标／目标坐标接口及能力声明，验证注释经过页面录制和 PDF 重放后仍正确。需要真实构建的未修改／修改引擎对照，检查跨页目标坐标、分页变换、外部 URI、普通文字和原有隔离边界，再做同一应用 GUI 的 PDF 与打印闭环。这个链接问题的补丁范围比原文簇链路更小，但目前没有编译或运行过的补丁，不能承诺交付日期或声称已解决 Unicode／分页。

在现有依赖和分发约束下，终端修复仍需进入既有 WebKit 的正常上游／发行版维护路径。当前没有经过验证的应用侧小补丁可以替代它。本轮不继续开放式引擎实验。

## 证据与边界

[证据目录](./evidence/v2-p5-webkit-checkpoint-20261020/README.md)提供原始 PDF、逐页像素、HTML/Markdown、原始提取文本、搜索与注释审计、失败检查、生产构建证明、源码快照和 SHA256 清单。原始生产 ELF、guard、浏览器、字体、插件包和用户 profile 不进入证据归档。

只新增本报告和诊断证据，因此没有用重复全仓编译或单测伪装引擎验证。执行了证据完整性核验、实际 PDF 内容诊断、失败检查和新增 Markdown 格式检查。产品树保持 cf7，未合并、发布或上传安装包。

Windows GUI、真实 IME、Windows PDF、macOS 输出与正式升级／回滚均不在本轮验证范围内；Linux 后端诊断不能替代它们。
