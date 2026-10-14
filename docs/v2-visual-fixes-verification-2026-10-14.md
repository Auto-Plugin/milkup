# v2 七项视觉与任务列表修复（2026-10-14）

本轮隔离分支 `dot/milkup-v2-visual-fixes` 精确基于远端质量分支的 `566babb93fde847251a9f3f458d77c6603bf8ba4`。未整合质量分支、main、v2，未改插件系统／大纲实现或 core 公共 API，未发布 Release 或上传 Windows 构建。共享样式修改仅在 `apps/desktop/src/style.css` 的编辑器规则；另有既存验证 JSON 的纯格式修正，以通过全仓 Prettier。

## 先复现，再修复

独立基线工作树编译生产 release；通过 `tauri://localhost` 本地资源、真实 X11 鼠标和系统按键，在普通文档及 3.1 MiB／120016 行的窗口化文档中，七项均复现。见[失败断言](./evidence/v2-visual-fixes/before-native.json)、[布局测量](./evidence/v2-visual-fixes/before-metrics.json)、[普通视图截图](./evidence/v2-visual-fixes/before-ordinary-live.png)、[窗口化截图](./evidence/v2-visual-fixes/before-windowed-live.png)、[End 离屏截图](./evidence/v2-visual-fixes/before-code-end.png)。截图的右侧／底部黑区是 X11 桌面，不是应用内容。

| 项目           | 基线失败与修复方式                                                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表格对齐       | 六个表头／正文单元格均为 `start`；现在将表格 CST 的 `alignments` 应用于两种视图中的每列，不改变源码。                                                                                                                                               |
| 无空格长单元格 | 760px 窗口中首格右界 262.66px，文字延伸至 537.91px，被邻格背景遮挡。现在零最小宽度网格和单元格内 `overflow-wrap:anywhere` 让长词换行。                                                                                                              |
| 粗体内斜体     | `***` 被错误分配，随后文字变斜体，嵌套节点也未递归渲染。现在将共享闭合符先分配给内层斜体；仅含真正嵌套语法的子节点递归渲染／映射，保留普通行内 DOM、UTF-16 坐标和未完成语法行为。                                                                   |
| 长代码 End     | 普通 live 光标约 x1609，窗口760，代码行 scrollLeft0。两种 live 视图现在滚动实际代码行并同步／裁剪选区、搜索与光标层。source 补验也失败：x1601、窗口1100、外层 scrollLeft0；现在 source 滚动外层，并保留末尾内边距，防止原生分数缩放下裁切半个光标。 |
| 绿色焦点框     | 输入代理聚焦时给整个编辑区添加2px绿色内框。移除该内框，键盘输入焦点以持续可见光标表示；直接聚焦可滚动编辑区保留低干扰中性色轮廓，按钮、菜单、搜索、任务框等仍有可见键盘焦点。                                                                       |
| 双任务标记     | 每项同时显示圆点和装饰方框。仅任务项隐藏原始圆点，普通列表圆点保留，源码仍完整。                                                                                                                                                                    |
| 任务框不能切换 | 装饰 span 无编辑动作。现在为有名称及 `aria-checked` 的键盘可达 checkbox button，点击／Space／Enter 通过现有事务或窗口化编辑队列只替换 `[ ]` 的检查字符，保留方向选区并隔离历史分组。                                                                |

任务框在只读、composition 或自身提交期间不可编辑。窗口化路径在之前的编辑仍待完成时忽略点击，防止旧 DOM 坐标编辑错误位置；可在编辑完成后重试。双击／重复按键、异步切换文档、排队后变只读均有回归。没有新增保存、恢复或原生全文快照通道。

## 验证

- 全仓 JS/TS 单元与回归 **875 项通过**，另补充大纲及原生启动工具 **9 项通过**；Rust **75 项通过、1 项性能基准按原规则忽略**。类型检查、全 workspace 构建及 Rust 格式检查通过。全仓 Prettier 曾发现基线已有 JSON 格式问题，已仅格式化修正。
- Chromium 全套 **79 项通过**，包括新增14项视觉／交互回归。当前新增行内33项测试中，基线14项失败，修复后全部通过；新增视图29项覆盖两条路径及选区、嵌套映射、编辑排队、只读、切换文档与重复激活安全。
- **生产deb解包二进制**完成普通／窗口化 × light／dark × 100／125／150／200% × 1100×760／760×520，共 **32组配置**；每组分别检查 source/live，合计 **386条断言、零失败**。开发服务器关闭，加载 `tauri://localhost` 生产资源，CSS zoom 为1，原生 viewport／DPR与实际倍率对应。
- 每组实际点击checkbox、Space切换、撤销／重做、保存，检查完整CRLF、中文、emoji、组合字符字节与SHA-256；代码End、Shift选区替换与撤销、source输入与撤销也逐组落盘对比。窗口化夹具是120016行，并非小文档冒充大文件路径。
- [修复后全部断言](./evidence/v2-visual-fixes/after-native.json)、[32组布局测量](./evidence/v2-visual-fixes/after-metrics.json)、[生产资源来源](./evidence/v2-visual-fixes/production-origin.json)、[deb与二进制SHA-256](./evidence/v2-visual-fixes/production-sha256.txt)。测试中旧脚本曾被浮动工具栏挡住点击，现把目标滚至中央且严格断言源光标位置；另一次窗口化渲染未完成就读取节点，现等待实际渲染完成。上述失败保留在执行器证据目录，未算作产品通过。

代表性像素对照：[普通修复后](./evidence/v2-visual-fixes/after-ordinary-live.png)、[窗口化修复后](./evidence/v2-visual-fixes/after-windowed-live.png)、[200%窄窗live代码End](./evidence/v2-visual-fixes/after-code-end-200.png)、[200%窄窗source End](./evidence/v2-visual-fixes/after-source-end-200.png)、[暗色200%任务框](./evidence/v2-visual-fixes/after-task-dark-200.png)、[暗色200%表格](./evidence/v2-visual-fixes/after-table-dark-200.png)。使用X11根窗口真实像素；单独窗口截图曾遗漏部分合成画面，部分窗口化滚动帧也出现标题区合成滞后，因此代表性任务截图选用标题与内容完整的普通路径帧。未将截图工具边界当作跨平台视觉通过。

同一deb二进制还通过六套既有原生回归 **49项**，六个脚本退出码均为0：[完整汇总](./evidence/v2-visual-fixes/existing-native-summary.json)。覆盖真实保存失败、外部冲突、副本保留、窗口关闭、Unicode与CRLF历史、普通／窗口化列表代码、表格、搜索和大纲导航。上述测试不修改大纲实现。

仓库文本日志仅清理行尾空白并将CR转义为`\r`，原始日志仍保留在执行器。完整命令输出保存在本目录相应 `*-final.txt`、`rust.txt`、`supplemental.txt`；构建的JS/CSS哈希与最终全仓构建一致。全量192张矩阵截图和各次尝试日志另保留在执行器 `/workspace/milkup-visual-evidence`，仓库保留代表截图及完整断言／几何记录。

## 复现入口

```bash
# 按 docs/cloud-environment-v2.md 准备现有原生工具；不关闭 WebKit sandbox。
bash scripts/cloud/pnpm.sh test
bash scripts/cloud/pnpm.sh typecheck
bash scripts/cloud/pnpm.sh lint
bash scripts/cloud/pnpm.sh build
MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium bash scripts/cloud/pnpm.sh test:e2e --workers=2
# 关闭1420开发服务器，启动独立X11显示和tauri-driver；使用正常生产deb解出的可执行文件。
TAURI_APP_PATH=/path/to/extracted/usr/bin/milkup-desktop \
MILKUP_NATIVE_EVIDENCE_DIR=/path/to/evidence \
MILKUP_NATIVE_DEDICATED_DISPLAY=1 node tests/native/tauri-visual-fixes.mjs
```

基线模式 `MILKUP_VISUAL_BASELINE=1` 保留失败而不提前终止，使用独立基线二进制。浏览器另有独立最小示例；不能用修改后的源代码重跑来代替失败基线。

## 边界

这是 Linux WebKitGTK／X11 生产和 Chromium 验证，不能冒充 Windows WebView2、Windows 原生缩放或中文 IME 验证。用户 Windows 反馈的三项已在 Linux 独立复现并修复；Windows 实机验收仍待进行。未扩展图片、复杂嵌套列表、表格预算等支持范围；既有超限回退仍保留。行内解析仍是项目既有的有限 Markdown 实现，本轮不声称达到完整 CommonMark 兼容性。局部修复和通过的测试不等于整款产品已达到 Typora 级品质。

## 提交环境说明

容器仍带有旧Electron main生成的 `.git/hooks/pre-commit`（`npx lint-staged`）与 `commit-msg`（`scripts/verify-commit.js`）；v2没有对应依赖／配置／脚本。首次提交因此在旧npm缓存路径失败。在完成v2全仓检查后，仅该次提交使用这些hook自带的 `SKIP_SIMPLE_GIT_HOOKS=1` 开关；未更改全局hook、sandbox、产品安全或任何发布配置。
