# 官方引擎研究与修前基线

这些文件是仓库外研究目录的逐字节快照。原始扩展名后附 `.txt`，避免执行 SVG/脚本及格式化工具改写证据。完整路径、长度与 SHA256 见 [archive-index.json](archive-index.json)。大型 npm tarball、node_modules、生成 bundle、原生二进制和临时浏览器 profile 未纳入 Git；版本、锁、构建脚本及许可证已保留。

- [官方包、离线构建及许可证审计](research/audit.md.txt)：完整 Mermaid 12.2.0，含 ELK；首轮浏览器启动的 sandbox 限制有明确记录。
- [30 个官方样例的修前汇总](research/current-diagrams-baseline/summary.json.txt)：30 error，30 完整源码回退；三个已支持控制样例均 ready。这是直接插件 API 基线，不是编辑、保存或像素验收。
- [37 个输入](research/samples.json.txt)、[首轮 SVG 输出汇总](research/browser-audit/summary.json.txt)及完整结果：34 个返回 SVG，16 类图型有输出；默认关闭 Chromium sandbox、没有像素验收，不能计为产品安全通过。
- [第二轮配置对照失败](research/browser-comparison-first-run.log.txt)：显式开启 Chromium sandbox 后在启动阶段失败，0/18 样例、0 截图。
- [DOM 宿主合同](research/dom-host-contract-audit.md.txt)、[隔离机制审计](research/dom-render-isolation-audit.md.txt)：候选方案与待证门槛，尚非已实现能力。
- [真实 SVG 能力清单](research/official-svg-profile-revision.md.txt)、[封闭 AST 草案](research/bounded-svg-schema-proposal.ts.txt)、[体积估算](research/official-svg-ast-sizing.json.txt)：静态研究，完整样式与保真仍待验证。
- [冻结的 Linux 机制摘要](prototype/frozen-mechanism-11/mechanism-summary.json.txt)和[原始事件](prototype/frozen-mechanism-11/run/result.json.txt)：sandbox 开启、固定 CSP 拒绝、Unicode 量字和两秒死循环终止通过；不包含 Mermaid，也不是产品后端验收。源码、锁、运行脚本和首次失败一并保留，二进制仅记录身份哈希。
- [首轮官方引擎原生摘要](prototype/mermaid-summary.json.txt)：五次调用在单次两秒/256 KiB 内，独立验证原生资源拒绝；原始文件在 `prototype/frozen-mermaid-native-01/`，尚无像素或产品验收。
- [新 DOM host 首次红测](research/dom-host-red-run/execution.json.txt)：新宿主尚未实现时失败。Manager 用例尚被 manifest 门禁拦截，不假称更深生命周期断言已执行。

原生机制每次构建/运行的首次失败和后续结果分别保存，不能用研究阶段的 Chromium SVG 替代 Linux WebKit 原生验收。
