# P4 编辑与资源验收证据

对应精确基线 `516577020a275fb1fca2ead9b0882e18b2582c09`，隔离分支 `dot/milkup-v2-product-phase4-editing-resources`。完整解释见[阶段报告](../../v2-product-phase4-editing-resources-2026-10-15.md)。

- `production-source-manifest.json`：候选 03 源码输入哈希；文档及外部测试脚本不进入该集合。
- `linux-deb-binary-provenance.json`：deb、实际解包二进制及 Tauri 打包标记差异。
- `full-*-candidate03.log`：本次冻结代码的全仓门禁；`candidate-02-*` 与 candidate02 日志为此前候选记录。
- `browser-candidate03.log`：161 项一次整批通过，退出 0。此前 `browser-final.log` 为 158/159，`browser-exit-final.log` 保留相同数据和双撤销断言、补充异步结构等待后的三次通过。
- `focus-breakpoint/` 与 `native-focus-before/`：新增断点焦点问题的浏览器先失败后通过和原生单键修复前证据。
- `candidate03-source-delta.json` 与 `sdk/candidate03-bundle-audit.json`：候选 03 仅改变通用断点焦点处理；七个插件档案逐字节未变。
- `sdk/`：7 个插件仅公开 SDK 的仓库外构建、旧合同兼容审计和预装包执行内容对照。
- `editing/`、`formatting/`、`resources/`、`view/`：有针对性的修复前失败与修复后回归。
- `native-before/`：候选 01 的真实 X11 工具栏重叠、空 DataTransfer 图片粘贴失败及诊断；不作为最终验收通过证明。
- `native-format-and-paste/`、`native-untitled-import/`、`native-resource-tail/`、`native-cancel/`：候选 02 的 24 组真实格式编辑、图片选择/粘贴、首次保存及取消、跨目录另存和图片恢复分段闭环。
- `native-all-seven-disabled-candidate03/`：最终候选 03 全新用户目录、七插件禁用后的基本编辑/保存/正常重开/崩溃恢复，30 次禁用后审计；此前 candidate02 同项证据仍保留。

- `native-matrix-candidate03/`：最终候选 03 单 Home 键断点焦点及完整 64 组原生矩阵，64 原始 X11、64 份逐次边界采样和退出/来源记录。
- `native-environment/`：GTK/proot/SVG/旧测试入口失败的诊断索引与原始小型日志，记录环境 workaround 及未证实原因。
- `root-final-evidence-audit.json`：独立复核全部组合、实际状态、几何和代表性原始截图。

Rust 并行曾出现 104 通过、8 失败、1 忽略（4 项 EFAULT、4 项文档注册缺失），保留 `resources/native-full-final.log`。同组串行 112 通过；补充恢复测试后串行 118 通过、1 忽略。proot runner 和共享测试注册容量均属候选原因，未证实根因。随后对当前同一测试二进制取消 runner、直接默认并行运行：118 通过、1 忽略、退出 0；`resources/native-parallel-direct/` 保留命令、环境白名单、哈希和日志，不能据此追溯证明早期原因。

截图为实际原始输出，不作重绘。浏览器 CSS 平台模拟不等同 Windows 实机；本阶段无 Windows 打包、上传、Release 或部署。

全仓 `pnpm lint` 通过。源码、测试和报告的 `git diff --check` 通过；原始测试日志的行尾空白及 CRLF 文档逐字节证据保持原样，详见 `whitespace-audit.json`。
