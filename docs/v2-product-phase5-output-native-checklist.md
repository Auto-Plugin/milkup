# P5 Linux 原生输出验收

当前文件是验收计划，不是已通过报告。只针对 Root 确认并冻结的 Linux 集成构建运行；不启动 Windows、Runtime 打包、上传或发行。

复用现有 `tests/helpers/native-production.mjs`、`native-updates-fixture.mjs` 与 P4 production08 的已验证 X11/驱动/沙箱启动包装。新增驱动不注入 editor state、不直接调用输出 IPC、不自动批准插件权限；通过产品按钮、GTK 选择器、XTest 输入执行。DOM 只用于读取状态和将焦点放到可见控件。

## 样例与证据

源样例 `tests/fixtures/p5-output/rich-document.md` 包含中文/组合字符/emoji、表格、代码、引用、列表、本地/缺失/远程图片、公式、Mermaid 和脚注。准备阶段在独立证据目录生成真实 PNG、分页长文、选区样例和源文件哈希。远程地址使用 `.invalid`，无需网络。公式/图表若宿主当前输出仅支持可读源码，须将此项判为能力缺口，不能用源码存在冒充排版完成。

每次独立 run 留存 `plan.json`、`provenance.json`、逐项 `results.json`、真实输出文件、PDF 的 `pdfinfo`/`pdftotext`/`pdftoppm` 结果、操作前后源文件 SHA256 和 UI 截图。截图仅证明界面状态；PDF 必须是实际 `%PDF-` 文件，并检查页数、字体、正文及逐页图像。

## 执行顺序

1. 安装仓库外构建的 `milkup.export-print` 1.0.0，确认初始未批准，手动通过产品的“批准”按钮批准 `document:output`，启用并从普通侧栏入口打开。
2. 整篇 HTML 包含图片：正常 GTK 保存到新文件。断网/离线读取，检查中文、表格、代码、脚注、本地图片；缺失和远程图片的提示可见。HTML 不含执行脚本或外部网络资源引用。
3. 省略图片 HTML：确认没有内嵌图片，保留可读替代文本/提示；原文哈希不变。
4. PDF：A4 纵向、Letter 横向各输出一次。真实 PDF 多页、中文/表格/代码可提取，页面尺寸方向正确；逐页目检分页、图像、公式、图表、脚注。至少保留首尾页截图和完整 PDF。
5. 打印：GTK `Print document` 选择 `Print to File`，保存真实 PDF；另跑打印窗口取消。不得将截图或 HTML 改扩展名作打印结果。
6. 取消保存选择器、拒绝现有文件覆盖：源文档与原目标逐字节不变，界面可重新开始。
7. 将输出目标设为当前 Markdown 文件及另一个已打开文档：必须明确拒绝，内容不变。用普通现有输出文件确认覆盖时检查目标更换内容、原文仍不变。
8. 原生键盘选择第一行后导出 selection：只有第一行，不包含 `P5-END-MARKER`。导出后编辑并另存，先前输出保持捕获版本，下一次导出包含新内容。
9. 在输出准备期间切换/编辑文档，确认旧输出不混入新编辑。GTK 保存窗口为模态时此竞态无法仅靠前台键盘触发，须保留控制器/host 测试证据并明确标为原生 UI 尚未覆盖，不能绕过真实授权注入私有状态。
10. 禁用插件后，普通键盘编辑、撤销和保存仍正常；取消/失败后重复此检查。大文档输出需独立记录大小/用时/响应，不以普通文档代替。

## 准备与运行

先运行 `node tests/native/tauri-p5-output.mjs --preflight`，配置 `MILKUP_NATIVE_EVIDENCE_DIR`、`MILKUP_P5_ARCHIVE`、`MILKUP_P5_ARCHIVE_SHA256`。这一步不启动应用。

正式运行复用现有 production08 driver 环境，但把冻结 binary、独立 profile、日志与 evidence 指向本阶段目录；不得使用旧 P4 binary SHA。设置 `MILKUP_P5_BINARY_CONFIRMED=1`、`TAURI_APP_PATH`、`MILKUP_NATIVE_EXPECTED_BINARY_SHA256`、`TAURI_DRIVER_URL`、`DISPLAY`、`MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1` 后运行同一脚本。Root 负责先完成集成构建和驱动启动。支持 `MILKUP_P5_STAGE=html|pdf|cancel|selection|disable|print-cancel` 单段运行；完整打印文件及覆盖交互在 native helper 最终 GTK 行为确认后执行。

已准备的串行运行入口 `tests/native/p5-output-run-case.py` 直接改编 production08/run-case.py：检查冻结二进制哈希与已就绪驱动，记录执行命令/日志/退出码，运行一个阶段；不会自行启动驱动或更改共享环境。阶段还包括 `overwrite`、`print-file`、`large`。打印文件阶段依赖 GTK 原生 `Name`/`Print` 助记键，必须在首次真实对话框中核对；若 GTK 键盘布局不吻合会以缺少真实 PDF 失败，不能记录通过。

最终独立包使用 SDK 0.3.5 最终 tarball 构建：

```sh
MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-export-print-evidence/milestone01/native-ui/preflight-final \
MILKUP_P5_ARCHIVE=/workspace/milkup-export-print-evidence/milestone01/plugin/final-external/dist/milkup.export-print-1.0.0.milkup-plugin \
MILKUP_P5_ARCHIVE_SHA256=04976caad7d2e93bdd316239de6e76054f7bc8eaa42769891dc578f743a9f294 \
node tests/native/tauri-p5-output.mjs --preflight
```

Root 集成 ready 且同一专用 profile 的 driver 已启动后，继承前述 production08 环境、更新本次冻结 binary/hash/profile/log，并设置最终 archive/hash 和新的 evidence run 目录：

```sh
# 其余 TAURI/XDG/DISPLAY 环境由当前冻结构建的 driver 包装提供。
MILKUP_P5_BINARY_CONFIRMED=1 \
MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-export-print-evidence/milestone01/native-ui/html-01 \
python3 tests/native/p5-output-run-case.py html
```

每个阶段使用独立 profile 与独立 evidence 目录，因为驱动会验证首次安装未批准状态。`completion.json` 只列实际执行的阶段；其中 `visualReview: pending` 在真实 PDF/HTML 目检前不能提升为排版质量通过。正式通过报告还应列出实际耗时、大文档资源峰值、取消后的 guardian 进程清理及所有剩余缺口。
