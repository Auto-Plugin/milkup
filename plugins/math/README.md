# 数学公式插件

`milkup.math` 是独立 Worker 插件，唯一宿主依赖为公开 `@milkup/plugin-sdk` 0.3.3。固定使用 KaTeX 0.19.0 的公开 `renderToString`，没有宿主私有导入、DOM、网络、任意文件或动态代码依赖。只声明 `document:read`；宿主提供有界文档片段，不读取全文、不改正文或历史。

## 使用与语法

安装并批准启用后，live 模式显示公式；source 模式保留原始 Markdown。编辑中的公式由宿主显示源码，离开后再呈现。禁用/卸载和错误时保留源码。

- 单行 `$x^2$`：开闭符内侧不得为空白，闭符后不得紧接数字；转义美元、代码和链接目标不匹配。`$5 and $10` 保持货币文本。
- 独占行的 `$$` 开闭多行公式，可跨可信文本块和空白；没有完整结束边界时保留源码。
- 完整 fenced `math` 代码块；其他代码块不参与。
- 支持分数、平方根/高次根、上下标、求和积分、矩阵、`aligned`/`cases`、常见重音和数学 Unicode。
- 宿主声明未知语法上下文、被保护范围和不完整 fence 时不推测公式。渲染请求之外的跨窗公式保留源码。

这不是完整 LaTeX。跨公式宏、自动编号/引用、HTML 扩展、链接、图片、颜色、`menclose`/`mpadded` 等尚不支持的输出均不被接受。严格模式下部分 Unicode（如 emoji）不支持，保留源码；中文 `\text{中文}` 和常见数学 Unicode 有回归覆盖。

## 输出与限制

KaTeX 仅生成 MathML；插件用有界 tokenizer 解析其精确 wrapper、单个 MathML 树及与输入完全相同的 TeX annotation。只去掉已验证的外层包装和非视觉 annotation 元数据，不删除未知数学内容；任何未知标签、属性、尺寸、命名空间或不合法结构会使整个公式回退源码。

不接受 DTD、声明、自定义实体、事件、HTML、CSS、URL 或可执行字符串。XML 五个内建实体和有效 Unicode 数字字符引用被解码为纯文本。宿主再次验证安全树并创建 MathML DOM。

单式最多 8 Ki UTF-16 字符、64 层解析嵌套，KaTeX `maxExpand:1000`、`maxSize:20`、`strict:'error'`，每式独立宏对象。受信任扩展始终拒绝，并检测拒绝结果，不把错误色文本当成功。输出限制 256 KiB、4096 XML 节点；整个请求额外限制 128 fragments、4000 语义节点和约 250 KiB，留出封装预算。取消不返回迟到片段；硬 CPU 截止由宿主 Worker watchdog 执行，插件不声称同步解析可自行抢占。

错误显示完整原始片段及简短纯文本原因；可访问描述超过 SDK 的 8192 字符限额时明确截短，正文和错误源码不截断。渲染不产生文档写入或 undo 项。

## 字体和导出边界

使用原生 MathML，不加载 KaTeX HTML CSS 或字体，不依赖 CDN。实际字形、矩阵间距和打印结果取决于系统数学字体与 WebView；不承诺与 KaTeX HTML 像素一致。目标 Linux/WebKit 的真实视觉验收由宿主完成。本插件不注册包字体或外部资源。

`target: screen/export` 复用相同受控语义。Markdown 源文不变；HTML/PDF 导出的安全序列化和离线字体策略由后续宿主导出工作承担，本包不声称已实现完整 P5 导出。

## 独立构建与验证

```sh
node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.3.tgz /absolute/outside-checkout/math
```

脚本仅复制本目录，在仓库外安装公开 SDK tarball 与固定 KaTeX，再运行类型检查、构建和测试。输出 `dist/milkup.math-1.0.0.milkup-plugin`，附包哈希、实际字节数和 esbuild 输入清单。所有运行时代码打入一个 ESM；构建审计仅允许本包 `src/`、公开 SDK 入口和 KaTeX `dist/katex.mjs` 精确路径。KaTeX 的 CLI 依赖 commander 不进入 Worker 包。

KaTeX 使用 MIT 许可证，随安装包保留 `LICENSE-KATEX.txt`。没有分发字体。依赖升级必须重新审核输出、预算、资源和构建输入清单。
