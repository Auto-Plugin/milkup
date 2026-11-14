# 官方 Mermaid：Linux 独立原型渲染证据

固定官方 Mermaid **12.2.0** 在独立 Linux Chromium 154.0.8037.57 测试原型中实际生成了 **50 张 PNG**：37 个内置 registration ID 的最小样例，加 13 个选定特性/C4 变体。50 张图片均通过解码、尺寸、哈希、registration ID 和非空像素检查；此前独立人工像素检查覆盖其中 16 张，见 `visual-review.json`。

这证明的是这些固定样例的独立原型出图，**不是 Milkup 正文集成、WebKit、Windows 或产品发布验收，也不是所有语法组合、外部适配器及未来语法的保证**。未覆盖可选 ZenUML、tidy-tree、外部图标包及远程资源；没有验证点击链接、脚本或其他图形交互。

- `fixtures/`：50 个自建最小 Mermaid 样例；没有私人文档或真实用户数据。
- `fixtures-manifest.json`：原始样例清单，保留每份源文本的哈希及官方语法出处。其 `validationPolicy` 和 `baseInitialize` 属于先前解析阶段；不能替代实际渲染结果或当作渲染器配置原件。实际渲染阶段的固定配置摘要和代码哈希见 `provenance.json`。
- `rendered/<id>.png` 和 `rendered/<id>.json`：原始图片及对应实际渲染结果。
- `summary.json`、`pixel-validation.json`、`visual-review.json`、`RESULT.json`：原始运行摘要、机械像素校验、16 张图的既有人工检查及范围声明；这些文件均逐字节复制。报告中的图片文件名在本集合的 `rendered/` 下。
- `provenance.json`：每份复制文件的原始来源、原始哈希、目标哈希，以及本说明的派生规则。

宽图 `rendered/flow-wide.png` 内容完整，但原始 3496 像素宽的 SVG 缩到 1232 CSS 像素显示区，标签约 6 CSS 像素；这是明确的阅读体验限制，不能算产品级视觉通过。50 张机械校验通过也不等于逐张人工排版验收。

本集合只保留自建样例和结果。不含账户/机器配置、环境日志、进程采样、缓存、运行脚本、浏览器或 Mermaid 引擎，因此**不是可直接运行的完整复现环境**；不提供跨环境逐像素确定性保证。图片和样例可以按记录的哈希核对。原型配置中的 `strict` 仅是内容策略；本结果集合不替代完整隔离安全验收。原始运行目录未修改，集合的最终校验清单由父级统一生成。
