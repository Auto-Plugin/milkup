# 流程图与时序图（受限语法）

这是 Windows 的独立 Worker 归档，插件 ID 为 `milkup.diagrams`，版本为 `1.2.0`。
Linux 继续使用 `plugins/diagrams` 的完整官方 Mermaid DOM 插件；本包不改变 DOM 平台门禁，不提供 DOM fallback，不声称支持完整 Mermaid。

在 `mermaid` 代码围栏内，支持：

- `flowchart TD` / `TB` / `LR` 或 `graph`：矩形 `A[文字]`、圆角矩形 `A(文字)`、菱形 `A{文字}`；`A --> B`、`A -->|文字| B`；中文和 emoji 纯文本标签。图必须无环，边连接相邻布局层。支持基础分支及合并，不支持跳层连线。
- `sequenceDiagram`：隐式参与者或 `participant A as 别名`，普通消息 `A->>B: 文字` 和虚线返回 `B-->>A: 文字`。

其他图类型、循环/子图、HTML/Markdown 标签、链接、配置、样式、特殊形状、开放箭头、注释框、激活、自调用、动态参与者、编号与标题均保留完整 Markdown 源码并说明无法呈现。标签不执行 HTML；不会静默删除不支持的语法来画部分图。

## 有界资源与隔离

每个图最多 8192 UTF-16 字符、128 行；流程图最多 20 节点、32 边，时序图最多 6 参与者、16 消息。标签最多 24 Unicode 码点，按最多 12 码点一行显示（菱形最多 12 码点，LR 横向边标签最多 4 码点，以避免覆盖形状）；布局最大 4096 × 4096。输出仅使用现有 SDK 的有限 `vector` 原语，没有 raw SVG、HTML、URL、样式字符串或事件处理器。主应用仍验证完整请求和返回结果。

运行在现有可终止的 CSP Worker 中。使用现有 2 秒渲染截止时间、取消与 Worker 终止机制；不使用 `eval`、动态 Function、DOM、网络或新原生 Runtime。权限只有 `document:read`。浏览器证明不代替 Windows WebView2 原生与发行安装包验证。

## 来源与独立构建

`src/vendor` 是 Mermaid **12.2.0** 官方发布包的两个生成语法分析器片段，保留原始语法代码。它们不包含 Mermaid DB、DOMPurify、布局引擎或 DOM renderer。本包在其上实现明确受限的收集器和静态布局。不是对完整 Mermaid 引擎换 manifest。

`dependency-provenance.json` 记录原 npm 包 integrity、原文件 SHA-256、提取边界和产物 SHA-256。完整 MIT 许可见 `THIRD-PARTY-NOTICES.txt`。`scripts/extract-parsers.mjs /path/to/unpacked/mermaid-12.2.0` 离线核验精确提取结果；不下载、不执行上游渲染器。普通 build 只读取 vendored 字节并核验 hash，不需要上游安装目录。

```sh
pnpm install
pnpm check
pnpm test
pnpm build
node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.8.tgz /tmp/diagrams-worker-external
```

独立构建仅依赖本目录和公开 SDK，最终 ESM 包没有运行时 imports 或新增依赖。`dist/milkup.diagrams-1.2.0.milkup-plugin` 包含 manifest、单文件入口、许可与来源记录。平台库存明确选择本归档，不能把旧 DOM manifest 改写为 Worker，也不能以插件 ID 绕过平台门禁。
