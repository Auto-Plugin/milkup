# 视觉修复与独立插件系统的本地兼容性检查（2026-10-14）

本轮仅组合两个指定、已批准提交：视觉 `92f0dfd8befe0efc78fbb3e5e9f1823647a0d9a5` 与插件 `5d82cbe84274677c166efdb324ce8692fc625365`。开始前远端 SHA 与要求一致，工作区干净，共同基线为 `566babb93fde847251a9f3f458d77c6603bf8ba4`。新建本地 `dot/milkup-v2-integration-check`，保留原分支；不推送、不更新质量分支/main/v2、不触发 Windows 包或产物上传。本轮不包含插件线程后续的性能整改。

## 合并与差异

从视觉提交执行 `git merge --no-ff --no-commit 5d82cbe...`，Git 自动合并成功，没有文本冲突，也没有采用整文件覆盖或丢弃任一分支。审查两处交集：

- `apps/desktop/src/style.css`：插件的67行树形 UI 样式限定于插件面板；表格换行、焦点、代码滚动和编辑器尺寸规则保留。
- `packages/view-dom/src/editor-view.ts`：插件仅给受控渲染器增加 `aria-expanded`、`aria-level`、`role` 三个允许属性；视觉的任务事务、嵌套行内渲染、光标与滚动代码保留。

Setext 块解析与嵌套行内解析位于不同实现文件，但进行了实际组合验证。新增4项 LF/CRLF × 普通/窗口化测试，覆盖 Setext 标题中的 `**粗体中的 *斜体*** tail 😀`、任务切换和撤销重做。原生组合检查使用同一类标题、大纲精确导航、表格、任务与长代码，并比较完整保存和恢复字节。新增内容限于测试与本报告；没有追加产品功能或兼容性修正。

[合并审计](evidence/v2-integration-check/merge-audit.json)记录精确父提交、交集与自动合并树，用于区分功能组合和额外验证代码。

纯功能整合已单独提交为本地 `500998f6b8809524d4821c20346c4f2b174b7153`，两个父提交依次为视觉与插件指定SHA，树为 `2864db0ab8c106c69c22745b177d7d06a3130ffd`。后续验证提交仅增加测试与证据，不改变这一产品实现。

## 已完成检查

| 检查                                        | 结果                                              |
| ------------------------------------------- | ------------------------------------------------- |
| 全 workspace 单元测试                       | 998通过                                           |
| 独立大纲测试                                | 19通过                                            |
| 原生启动测试工具                            | 7通过                                             |
| Chromium 浏览器回归                         | 79通过；工程名沿用 msedge，不是 Windows/Edge 实测 |
| Rust                                        | 75通过，1个既有性能基准忽略                       |
| 类型、全 workspace 构建、Prettier、Rust fmt | 通过                                              |
| 生产 Linux deb                              | 构建成功，解包运行；不是系统安装                  |

完整输出保存在[证据目录](evidence/v2-integration-check/)。大纲按其 README 从公开 SDK tgz 安装依赖后独立构建，归档 SHA-256 为 `b8dd88ae1bad5e28b380b63da0679d8205177bb6186b6badb6829ec3153fc740`，与插件线程验收包一致。首次独立测试因未安装 SDK 无法收集测试；安装后19项通过。Rust fmt 首次缺少工具组件，安装到本地工具链后通过。首次生产命令把含前导空格的环境 JSON 误传成 `--config` 文件名；改用既有 `TAURI_CONFIG` 环境入口后正常构建，未改产品配置。

生产包与二进制[SHA-256](evidence/v2-integration-check/production-sha256.txt)：

- deb：`7fdc8b560b105507bb5e28e902f6222d6b4f15241f0fcace173a04b87168d46d`。
- 二进制：`9448f005ff50a9427c8fcb59e3eca8f5c4c95f61f9da0697a428af5f6037fef8`。

## 原生验证记录

原生检查使用独立 X11 显示 `:100`、独立用户目录与 `tauri://localhost` 生产资源。开发服务器关闭，真实键鼠动作和 X11 像素截图；保存、恢复使用实际文件系统。完整原始日志、截图、fixture、生产包留在 `/workspace/milkup-integration-evidence`，不上传构建产物。

视觉七项生产回归：普通/窗口化 × light/dark × 100/125/150/200% × 1100×760/760×520，共32组配置，每组都检查 source/live，**386条断言零失败**。任务点击、Space、撤销重做、保存及代码选区替换均比较完整CRLF/Unicode字节；窗口化夹具120016行。保留192张系统像素截图，仓库记录[完整断言](evidence/v2-integration-check/visual-results.json)、[几何测量](evidence/v2-integration-check/visual-metrics.json)与代表图。

代表截图：[普通亮色](evidence/v2-integration-check/ordinary-light-100-1100-live-table.png)、[窗口化亮色](evidence/v2-integration-check/windowed-light-100-1100-live-table.png)、[200%窄窗代码End](evidence/v2-integration-check/ordinary-light-200-760-code-end.png)、[200%窄窗source End](evidence/v2-integration-check/ordinary-light-200-760-source-end.png)、[窗口化暗色200%表格](evidence/v2-integration-check/windowed-dark-200-760-live-table.png)。截图右侧/底部黑色是独立X11桌面；选择与此前视觉报告相同的检查方法，不把截屏合成时序当作跨平台通过。

独立插件完整流程中的正常安装、启用、层级折叠展开、精确导航、编辑/撤销/重做/保存、空文档、Setext/重复标题、正常关闭索引清理、重启、禁用/重新启用、卸载后编辑保存、改 manifest 身份安装和移除均通过。26 MB/40001行夹具完成8775个标题索引，取消/重试、头尾十次导航、中部精确定位和全树折叠展开通过。完整建树本轮单样本79548 ms、全折叠34369 ms；没有在本容器重建单分支性能对照，不能据此归因于合并或宣称性能达标。[原始结果](evidence/v2-integration-check/plugin-first-attempt-results.json)保留这些已通过阶段及随后组合脚本的失败。

新增组合场景首次在普通文档保存和真实崩溃恢复通过后，窗口化 Setext 导航超时。失败时cursor为431，截图显示侧栏已收起；宿主在每次进程启动时默认收起侧栏，测试却点击了仍在DOM中的隐藏条目。仅修正测试，在导航和恢复截图前真实展开侧栏，并断言目标中心位于视口且命中目标元素。没有修改产品导航逻辑。原始[失败截图](evidence/v2-integration-check/plugin-failure-desktop.png)与[阶段摘要](evidence/v2-integration-check/plugin-first-attempt-summary.json)保留，未将该失败计为通过。

第二次组合执行已通过普通恢复、窗口化任务历史/保存/代码End/source标题修改与索引更新，但在准备窗口化恢复点时超时。现场任务未勾选、dirty=false、version=savedVersion=12，点击落在下方空行，磁盘恢复记录正确为saved；没有丢失已接受修改的证据。测试补上模式/光标完成等待、目标矩形连续稳定与命中检查，并先断言dirty及checkbox状态，再等待恢复点。窗口化独立补验已成功生成恢复点、实际终止进程并恢复，完整字节与勾选后内容相同，原文件未被覆盖，大纲与任务状态一致。[第二次原始记录](evidence/v2-integration-check/plugin-combination-attempt2-results.json)、[失败像素](evidence/v2-integration-check/attempt2-failure-x11.png)、[独立恢复补验](evidence/v2-integration-check/plugin-windowed-recovery-results.json)均保留。上述修正仅涉及测试。

修正后的完整组合执行已通过，退出码0：[全部阶段记录](evidence/v2-integration-check/plugin-complete-results.json)、[运行日志](evidence/v2-integration-check/plugin-complete-run.txt)、[实际驱动副本](evidence/v2-integration-check/combination-driver.mjs)。重新正常安装大纲后，在普通与180015行/3.1 MiB窗口化文档上连续执行任务点击、Space、撤销重做、保存、长代码End、source标题修改/索引更新/撤销，再实际终止进程并恢复任务修改。两条路径恢复字节与预期完全一致、原文件未覆盖；最后卸载后贡献点为空。连续任务编辑期间允许索引重建并取消过期工作，仅在检查标题内容时等待完整索引，不用等待索引掩盖编辑并发。代表图：[普通组合](evidence/v2-integration-check/final-combined-ordinary-live-x11.png)、[窗口化组合](evidence/v2-integration-check/final-combined-windowed-live-x11.png)、[窗口化恢复](evidence/v2-integration-check/final-combined-windowed-restored-x11.png)。

同一生产二进制的既有[四类崩溃恢复](evidence/v2-integration-check/recovery-results.json)全部通过：未命名、已有文件、大文件、UTF-16/BOM/CRLF；恢复副本逐字节比较，原文件及外部新内容保护成立。[保存安全12项](evidence/v2-integration-check/quality-results.json)全部通过，覆盖取消/保存/放弃、真实写入失败、外部冲突与副本、只读恢复、大文件保存和原生关闭。该既有quality脚本的文件选择使用测试路径接缝，Rust磁盘I/O真实；本轮插件安装及组合测试文件打开使用真实GTK选择器。

## 边界

这是指定两提交的有界兼容检查，不是最终发布验收，也不覆盖插件线程后续提交。Linux WebKitGTK 与 Chromium 结果不能代替 Windows WebView2、macOS 或真实系统 IME。没有扩大 Markdown 支持范围，也没有声称全文大纲性能已达 Typora 水平。

## 复现与提交环境

使用独立、干净的原生用户目录与显示，关闭1420开发服务器，令 `TAURI_APP_PATH` 指向上述deb解出的二进制。视觉入口为 `tests/native/tauri-visual-fixes.mjs`。插件完整入口为：

```bash
MILKUP_PLUGIN_ARCHIVE=/absolute/milkup.outline-1.1.0.milkup-plugin \
MILKUP_PLUGIN_VISUAL_INTEGRATION=1 \
MILKUP_RECOVERY_PROFILE=/absolute/profile/data/app.milkup.desktop/recovery-v1 \
MILKUP_NATIVE_EVIDENCE_DIR=/absolute/evidence \
node tests/native/tauri-plugin-system.mjs
```

没有设置组合变量时保留插件线程原有测试范围。文本编辑和控件激活使用原生键鼠，安装/打开文件走GTK；DOM聚焦和滚动仅用于测试定位，读取DOM和恢复记录用于断言，未注入编辑器文档或伪造保存结果。

容器仍带旧Electron分支的simple-git-hooks，v2没有对应lint-staged配置和提交脚本。本轮在独立检查通过后沿用hook已有的单次 `SKIP_SIMPLE_GIT_HOOKS=1`；未修改hook、安全设置或历史。提交身份仍为 `LarryZhu-dev <larryzhu@foxmail.com>`。
