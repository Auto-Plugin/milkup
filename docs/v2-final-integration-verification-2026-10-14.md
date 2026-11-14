# 最终插件提交与视觉修复的集成复验（2026-10-14）

本轮接续干净的本地集成 `d1cc1a2a586b3ab5686715a4586699507302837f`，合入指定最终插件提交 `91fbef6bc1f79e5d3ed17aa794c26a695f670cf7`，保留视觉修复 `92f0dfd8befe0efc78fbb3e5e9f1823647a0d9a5`。开始前确认未执行此合并，重复指令没有触发重复工作。分支仍为 `dot/milkup-v2-integration-check`，不推送、不更新main/v2/quality、不触发Windows上传或发布。

## 组合结果

本地功能整合提交为 `4d1773b154c04077fd25949351c51a6c9de8c90f`，父提交依次为上述旧集成与最终插件SHA，树为 `8447f995265e9865cddb3eac6ba7a3bb6562c38a`。Git自动合并成功，无文本冲突。唯一交集为 `tests/native/tauri-plugin-system.mjs`：插件线程的“完整索引后点击”和“中部范围连续稳定”检查，与上一轮视觉组合入口、任务保存恢复检查同时保留。没有额外修改产品代码，也没有改变core公共API、恢复频率或配额。

最终插件为独立大纲1.2.0，公开SDK仍为0.1.1。变更范围是分页索引/折叠算法及滚动回声处理，依据[插件最终报告](v2-outline-performance-validation-2026-10-14.md)。旧集成报告与全部失败/补验记录保留在[上轮报告](v2-integration-check-2026-10-14.md)，本轮证据使用独立目录，不覆盖旧文件。

## 聚合检查与构建

| 检查                                      | 本轮结果                                       |
| ----------------------------------------- | ---------------------------------------------- |
| 全workspace单元测试                       | 998通过                                        |
| 独立大纲测试                              | 24通过，含8775/18000标题模型、排名及折叠边界   |
| 原生启动测试工具                          | 7通过                                          |
| Chromium浏览器                            | 79通过；既有工程名msedge不代表Windows/Edge实测 |
| Rust                                      | 75通过，1个既有性能基准忽略                    |
| 类型、全workspace构建、Prettier、Rust fmt | 通过                                           |
| 生产Linux deb、独立大纲包                 | 本轮重建成功                                   |

[完整检查输出](evidence/v2-final-integration/)与[产物SHA-256](evidence/v2-final-integration/production-sha256.txt)保留。最终大纲归档 `milkup.outline-1.2.0.milkup-plugin` 的SHA-256为 `9f3f9ce8239870cc73ae5f2cdd54ade36d540f5f0eaf3a57df80226e7bc5525c`，与插件线程最终验收一致。宿主解包二进制SHA-256为 `9448f005ff50a9427c8fcb59e3eca8f5c4c95f61f9da0697a428af5f6037fef8`，与上轮相同：本次算法变更确实通过外部独立插件交付，没有混入宿主实现。deb为 `f63cf15559b93297b4c091d4afd8356cdd57fed374be7189027c921e9f1b323e`。

## 生产复验

使用新X11显示`:101`、新用户目录、上述deb解包二进制和正常GTK插件安装。后续插件补验另用`:102`与`profile-final`，不清空失败profile。开发服务器关闭；本地`tauri://localhost`资源、真实键鼠、X11像素截图和磁盘字节断言。旧profile、索引和恢复副本保留。完整原始材料位于 `/workspace/milkup-final-integration-evidence`；仅本地保存，不上传构建产物。

七项视觉回归完成普通/窗口化 × light/dark × 100/125/150/200% × 1100×760/760×520的32组配置，每组覆盖source/live，**386条断言全部通过**，保留192张实际像素截图。覆盖表格三列对齐、长无空格单元格换行、嵌套粗斜体、长代码End与选区、低干扰焦点、单一任务标记、任务点击/Space/撤销重做/保存，以及完整CRLF/Unicode字节比较。窗口化夹具120016行；不是小文件模拟大文件路径。[完整断言](evidence/v2-final-integration/visual-results.json)、[32组几何记录](evidence/v2-final-integration/visual-metrics.json)、[生产来源](evidence/v2-final-integration/production-origin.json)。

代表图：[普通](evidence/v2-final-integration/ordinary-light-100-1100-live-table.png)、[窗口化](evidence/v2-final-integration/windowed-light-100-1100-live-table.png)、[200%窄窗代码End](evidence/v2-final-integration/ordinary-light-200-760-code-end.png)、[source End](evidence/v2-final-integration/ordinary-light-200-760-source-end.png)、[暗色窗口化200%表格](evidence/v2-final-integration/windowed-dark-200-760-live-table.png)。右侧及底部黑区是X11桌面，不是应用内容。

最终插件完整生产脚本通过，退出码0，保留36条阶段记录：[原始状态](evidence/v2-final-integration/plugin-results.json)、[运行日志](evidence/v2-final-integration/plugin-run.txt)。覆盖正常安装/启用/禁用/重新启用/卸载/重启、改manifest身份安装、ATX/Setext/重复标题、空文档、26 MB/40001行/8775标题完整索引、取消重试、头尾导航、中部精确定位、全树折叠展开、正常关闭释放当前索引，以及卸载后继续编辑保存。中部经4批真实滚轮定位第34728行，精确源偏移和活动项可见均通过。完整索引本轮单样本19476 ms，全折叠382 ms，仅记录本次功能观测，不替代性能线程基准。

同一次脚本还完成普通与180015行/3.1 MiB窗口化组合：Setext内嵌粗斜体、三列表格、任务点击/Space/撤销重做/保存、长代码End、source标题修改/索引更新/撤销，以及任务修改后实际终止进程与恢复。恢复副本逐字节等于预期，原文件未覆盖，恢复后的大纲与任务状态一致。最后卸载完成，未知崩溃owner按既有规则保留，不删除旧索引伪造清理。[普通组合像素](evidence/v2-final-integration/combined-ordinary-live-x11.png)、[窗口化组合像素](evidence/v2-final-integration/combined-windowed-live-x11.png)、[窗口化恢复像素](evidence/v2-final-integration/combined-windowed-restored-x11.png)、[中部导航像素](evidence/v2-final-integration/06b-large-middle-x11.png)。

密集18000标题生产补验通过，脚本退出码0：[全部记录](evidence/v2-final-integration/dense-results.json)、[日志](evidence/v2-final-integration/dense-run.txt)、[实际像素](evidence/v2-final-integration/dense-nested-complete-x11.png)。覆盖三次全局折叠/展开、六次头尾导航、第二个同名根标题精确定位第1801行、该根899个后代的局部折叠（可见17101）/展开、嵌套项两个后代折叠（可见17998）/展开恢复18000，源文件完整字节不变。使用既有脚本的DETAILS_ONLY路径，不重跑前后性能对照。

同一生产二进制的既有四类恢复和12项保存安全检查全部通过，脚本均退出0。[恢复记录](evidence/v2-final-integration/recovery-results.json)覆盖未命名、已有文件、大文件、UTF-16/BOM/CRLF，比较恢复副本完整字节并保护原文件/外部新内容。[保存安全记录](evidence/v2-final-integration/quality-results.json)覆盖取消/保存/放弃、真实写入失败、外部冲突与副本、只读恢复、大文件保存及原生关闭。既有quality脚本的文件选择采用测试路径接缝，Rust磁盘I/O真实；插件安装和组合文件打开使用正常GTK选择器。

初次插件生产测试在中部滚轮定位超时。实际可见标题约第38268行，范围稳定，`virtualFollowActive=false`，没有Worker错误；固定零间隔1000次XTest滚轮并未进入测试要求的10000–35000行区间。[原始状态](evidence/v2-final-integration/plugin-initial-results.json)、[日志](evidence/v2-final-integration/plugin-initial-run.txt)、[实际截图](evidence/v2-final-integration/plugin-initial-failure.png)保留。仅调整测试为分批真实滚轮，每批后观察范围连续稳定，再决定继续；保留中部行号、可见目标和精确源偏移断言，不直接写scrollTop，也不改插件导航实现。

## 限制与提交

本轮验证指定最终提交的组合正确性，不重做插件线程的前后性能基准；耗时仅记录本环境观测，不推导稳定p95或跨平台结果。全文索引仍有等待，不能声称整个产品已达到Typora品质。Windows/WebView2、macOS和真实系统IME仍需目标环境验收。

提交身份为 `LarryZhu-dev <larryzhu@foxmail.com>`。容器仍带旧Electron分支的simple-git-hooks，v2缺少其lint-staged配置与提交脚本；沿用已说明的单次 `SKIP_SIMPLE_GIT_HOOKS=1`，以本轮实际聚合检查为准，不修改hook、安全配置或历史。

复现入口沿用 `tests/native/tauri-visual-fixes.mjs`、`tests/native/tauri-plugin-system.mjs`（`MILKUP_PLUGIN_VISUAL_INTEGRATION=1`，并设置正确的 `MILKUP_RECOVERY_PROFILE`）、`tests/native/tauri-outline-performance.mjs`（本轮 `MILKUP_OUTLINE_DETAILS_ONLY=1 MILKUP_OUTLINE_DETAILS=1`）、`tauri-crash-recovery.mjs` 与 `tauri-quality.mjs`。`TAURI_APP_PATH`指向解包二进制，`MILKUP_PLUGIN_ARCHIVE`指向1.2.0归档；使用独立profile、显示与证据目录。输入使用原生键鼠，DOM聚焦/滚动只作定位，未注入文档或伪造保存结果。

最终额外差异仅为中部滚轮测试稳定性调整与本报告/证据；旧视觉及集成证据经git比较保持不变。远端检查未发现集成分支，未执行推送。报告记录已完成验证，不将首次测试定位失败计作通过，也不将Linux结果代替Windows验收。
