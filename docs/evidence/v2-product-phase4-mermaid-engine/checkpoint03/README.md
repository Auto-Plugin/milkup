# Mermaid 检查点 03：完整原生扫描与 Journey 像素研究

本检查点仅归档 Linux 隔离 WebKit 原型研究，**不代表产品验收**。[索引](index.json)记录每份原件的绝对来源、长度与 SHA256。文本原件加 `.txt` 后缀逐字节保存；两张 PNG 未缩放、未拼接、未修改。

- [74 次扫描摘要](native-scan-light-01/compact-summary.json.txt)及[输入来源和预算](native-scan-light-01/provenance.json.txt)：30 个原始官方样例加 7 个本地探针，分别使用 baseline/classic-tspan，共 74 次，未重试输入。68 次返回结果、6 次明确拒绝；0 超时，全部后代清理核验通过。每次准备上限 10 秒、执行上限 2 秒、结果帧上限 256 KiB。最大成功用时 0.991 秒，最大诊断结果 220,067 字节。
- 六次拒绝分别为两个 profile 下的 `flowchart-069-image`、`flow-url-image`（Loading error）及 `flow-style-url`（解析错误）。不能写成 74 次全部通过，也不能把返回的原始 SVG 当作已经通过产品安全转换。
- [运行时完整性](runtime-integrity.json.txt)保存实际二进制与资源哈希。432 份原始扫描产物留在仓库外，索引引用其完整清单及清单哈希，不在本检查点重复复制。
- [Journey 像素审阅](journey-native-pixel-review.json.txt)、[baseline 原图](journey-light-baseline.png)、[classic-tspan 原图](journey-light-classic-tspan.png)：同为 light、1100×800、zoom 1、相同配置字体。截图取自真实 WebKit，渲染与序列化先在 2 秒内完成，截图阶段独立计时。

baseline 的实际 HTML 标签深色且可读；classic-tspan 虽将 foreignObject 从 7 个降为 0，却出现浅色框上的白色任务文字及浅色分区文字。实际 Make tea 标签从 Arial 16px、rgb(51,51,51)，变为 Open Sans/sans-serif 14px、白色 fill。该配置当前不可用作标准产品配置，不能因为消除了 foreignObject 就宣称视觉等价。原始审阅文件保留当时的建议措辞，本检查点记录后续决定，不改写原件。

本轮仅 light 研究。dark、安全静态 SVG 映射、产品 helper 集成、真实编辑/保存/历史、停用/恢复、生产矩阵及其它平台仍未由这些结果验收。产品实现正在进行；旧失败与限制继续保留。
