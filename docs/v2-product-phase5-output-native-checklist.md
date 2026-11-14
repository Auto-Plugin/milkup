# P5 Linux 原生输出验收

> 后续路线与验收更新：[保持现有依赖的 WebKit 修复准备](./v2-product-phase5-webkit-repair-2026-10-19.md)。下文保留原检查点历史；Chromium 研究候选已撤回，不能作为当前产品修复。

当前文件是验收计划，不是已通过报告。只针对 Root 确认并冻结的 Linux 集成构建运行；不启动 Windows、Runtime 打包、上传或发行。

复用现有 `tests/helpers/native-production.mjs`、`native-updates-fixture.mjs` 与 P4 production08 的已验证 X11/驱动/沙箱启动包装。新增驱动不注入 editor state、不直接调用输出 IPC、不注入权限状态。已授权的验收通过真实产品按钮批准权限，通过 GTK 选择器和 XTest 输入执行。DOM 只用于读取状态和将焦点放到可见控件。

## 样例与证据

源样例 `tests/fixtures/p5-output/rich-document.md` 包含中文/组合字符/emoji、表格、代码、引用、列表、本地/缺失/远程图片、公式、Mermaid 和脚注。准备阶段在独立证据目录生成真实 PNG、分页长文、选区样例和源文件哈希。远程地址使用 `.invalid`，无需网络。公式/图表若宿主当前输出仅支持可读源码，须将此项判为能力缺口，不能用源码存在冒充排版完成。

每次独立 run 留存 `plan.json`、`provenance.json`、逐项 `results.json`、真实输出文件、PDF 的 `pdfinfo`/`pdftotext`/`pdftoppm` 结果、操作前后源文件 SHA256 和 UI 截图。截图仅证明界面状态；PDF 必须是实际 `%PDF-` 文件，并检查页数、字体、正文及逐页图像。

## 执行顺序

1. 安装仓库外构建的 `milkup.export-print` 1.0.0，确认初始未批准，通过真实产品的“批准”按钮批准 `document:output`，启用并从普通侧栏入口打开。
2. 整篇 HTML 包含图片：正常 GTK 保存到新文件。断网/离线读取，检查中文、表格、代码、脚注、本地图片；缺失和远程图片的提示可见。HTML 不含执行脚本或外部网络资源引用。
3. 省略图片 HTML：确认没有内嵌图片，保留可读替代文本/提示；原文哈希不变。
4. PDF：A4 纵向、Letter 横向各输出一次。真实 PDF 多页、中文/表格/代码可提取，页面尺寸方向正确；逐页目检分页、图像、公式、图表、脚注。至少保留首尾页截图和完整 PDF。
5. 打印：GTK `Print document` 选择 `Print to File`，保存真实 PDF；另跑打印窗口取消。不得将截图或 HTML 改扩展名作打印结果。
6. 取消保存选择器、拒绝现有文件覆盖：源文档与原目标逐字节不变，界面可重新开始。
7. 将输出目标设为当前 Markdown 文件：必须明确拒绝，内容不变。用普通现有输出文件确认覆盖时检查目标更换内容、原文仍不变。`File → Open` 会替换当前文档，因此不能用曾经打开的文件冒充仍同时打开；多文档保护的原生 UI 验收单列未覆盖，使用 native 边界测试作为代码证据。
8. 原生键盘选择第一行后导出 selection：只有第一行，不包含 `P5-END-MARKER`。导出后编辑并另存，先前输出保持捕获版本，下一次导出包含新内容。
9. 在输出准备期间切换/编辑文档，确认旧输出不混入新编辑。本实现选择器在独立进程，真实 X11 焦点可回到主窗口；selection 阶段记录捕获版本、选择器期间编辑状态及新旧文件哈希，不能绕过真实授权注入私有状态。
10. 禁用插件后，普通键盘编辑、撤销和保存仍正常；取消/失败后重复此检查。大文档输出需独立记录大小/用时/响应，不以普通文档代替。

## 准备与运行

先运行 `node tests/native/tauri-p5-output.mjs --preflight`，配置 `MILKUP_NATIVE_EVIDENCE_DIR`、`MILKUP_P5_ARCHIVE`、`MILKUP_P5_ARCHIVE_SHA256`。这一步不启动应用。

正式运行复用现有 production08 driver 环境，但把冻结 binary、独立 profile、日志与 evidence 指向本阶段目录；不得使用旧 P4 binary SHA。设置 `MILKUP_P5_BINARY_CONFIRMED=1`、`TAURI_APP_PATH`、`MILKUP_NATIVE_EXPECTED_BINARY_SHA256`、`TAURI_DRIVER_URL`、`DISPLAY`、`MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1` 后运行同一脚本。Root 负责先完成集成构建和驱动启动。支持 `MILKUP_P5_STAGE=html|pdf|cancel|selection|disable|print-cancel` 单段运行；完整打印文件及覆盖交互在 native helper 最终 GTK 行为确认后执行。

已准备的串行运行入口 `tests/native/p5-output-run-case.py` 直接改编 production08/run-case.py：检查冻结二进制哈希与已就绪驱动，记录执行命令/日志/退出码，运行一个阶段；不会自行启动驱动或更改共享环境。阶段还包括 `overwrite`、`print-file`、`large`。打印文件阶段使用经真实截图确认的 GTK `Print to File` 行、`File` 按钮、原生保存选择器和 `Print` 按钮；缺少指定路径中的真实 PDF 时失败，不能以截图记录通过。

最终独立包使用 SDK 0.3.5 最终 tarball 构建：

```sh
MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-export-print-evidence/milestone01/native-ui/preflight-final \
MILKUP_P5_ARCHIVE=/workspace/milkup-export-print-evidence/milestone01/plugin/action-id-fix-external/dist/milkup.export-print-1.0.0.milkup-plugin \
MILKUP_P5_ARCHIVE_SHA256=08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9 \
node tests/native/tauri-p5-output.mjs --preflight
```

Root 集成 ready 且同一专用 profile 的 driver 已启动后，继承前述 production08 环境、更新本次冻结 binary/hash/profile/log，并设置最终 archive/hash 和新的 evidence run 目录：

```sh
# 其余 TAURI/XDG/DISPLAY 环境由当前冻结构建的 driver 包装提供。
MILKUP_P5_BINARY_CONFIRMED=1 \
MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-export-print-evidence/milestone01/native-ui/html-01 \
python3 tests/native/p5-output-run-case.py html
```

每个阶段使用独立 profile 与独立 evidence 目录，因为驱动会验证首次安装未批准状态。`completion.json` 只列实际执行的阶段；其中 `visualReview: pending` 在真实 PDF/HTML 目检前不能提升为排版质量通过。正式通过报告还应列出实际耗时、大文档大小与耗时（未采样 RSS 时明确未采样）、取消后的 guardian 进程清理及所有剩余缺口。

## 已执行证据的判定边界

运行目录在 `/workspace/milkup-export-print-evidence/milestone01/native-ui/runs/`。每个 run 保留原始失败记录，不覆盖重跑；最终选用的 run 由同级汇总记录明确列出。`completion.passed` 只代表该脚本的交互及文件结构断言；`layoutStatus`、实际逐页视觉审计、PDF 复制/搜索保真必须分别报告。

PDF 文本提取保存原始字节及 NFKC 对照。当前真实 PDF 存在图表部分汉字、emoji 和代码引号的复制/搜索丢失，NFKC 不能修复；像素完整不得掩盖该失败。实际 Letter 分页亦需检查标题孤行，不能因正文标记齐全就称排版全部通过。

布局矩阵经产品偏好设置选择浅色/深色主题，经原生快捷键设置 100/125/150/200% 缩放，760×520 与 1280×900 两窗尺寸，source/live 两模式；普通文档及窗口化大文档分别执行。控件获得焦点后需完整处于视口内且四个内缩角落无遮挡，逐项保留 bounds 和截图。`layout-failure.json` 不会提升为完整矩阵通过。

定向诊断可设置 `MILKUP_P5_LAYOUT_DIAG=1`，只执行一个浅色、760×520、200%、源码模式的 UI 探针，不执行 HTML/PDF 导出。`MILKUP_P5_GUTTER_DIAG=1` 仅用于已授权的临时样式对照：先记录原始精确箭头点击，再注入窄窗侧栏滚动容器 `padding-inline-end: 16px`，记录对照后在 `finally` 移除。候选名称保存在 `plan.testOptions.diagnosticCandidate`，完整 CSS 保存在诊断 JSON；历史 diag03 的 `scrollbar-gutter: stable` 无效，diag04 的留白候选成功。该运行明确标记 `diagnosticOnly`，不得算作生产样式验收。正常矩阵不设置这些变量，不注入样式。

截至最终 HTML09 的富内容 HTML 产物抽查中，15 份中 14 份含图表 SVG；`p5-layout-diag-02` 的一份返回“增强渲染未完成”警告与源码降级。这是捕获边界的单次观测，不能解释为概率估计或完整富内容通过。另 `p5-html-03` 的独立图表插件启用失败尚未定位，后续重跑成功不抹除该记录。

最终取消、拒绝覆盖和禁用阶段另用只读 `p5-output-process.mjs` 留存 `process-lifecycle.json`：仅跟踪本次应用 PID/birth 及其已观察到的输出 helper/guardian 后代，记录原生窗口列表，等待操作后同 birth 进程不再执行且窗口消失，再真实编辑、单次撤销、保存并比对源文件 SHA256。应用退出后另检查自己的应用与这些已观察后代；不从 driver 退出推断辅助进程清理。

`MILKUP_P5_PAPER_LAYOUT=1` 是独立的生产样式短覆盖，不导出文件、不注入 CSS：PDF 与打印各检查深色、760×520、200%、source/live 两格，全部五个下拉字段和操作按钮均记录完整矩形/焦点，并用真实箭头点击、键盘改值与恢复验证。结果写入 `paper-pdf-layout-*` 和 `paper-print-layout-*`，`paperLayoutOnly: true`，不能冒充各格式的完整 32 格矩阵。AA9 构建的普通 HTML09 与大文档 Large03 各 32 格全部通过，Paper-layout01 的四格补充覆盖也通过。

最终产品提交 `cb928c9e9726aea3d70fbea71ea3f7a3fd672662` 的二进制位于 `production-heading-blocks/milkup-desktop`，SHA256 `f29911982fc0d6e26d15ef572156c0c29d2fc2140ace6d2d7914b456e9635d98`。计划的 PDF05、Print-file04、HTML10、Large04 原生复验**未执行**：自动审批服务连续三次返回 `Selected model is at capacity`，明确为审批未能完成，命令均未执行，非产品断言失败或安全性判定。Root 要求停止重试；`native-ui/approval-service-blocked-pdf05.json` 留存阻塞证据。不得将 AA9 的已通过原生结果改标为此最终构建通过。
