# 第十一阶段：干净环境恢复与第十阶段原生闭环

## 恢复与结论

本环境从已发布配置新建，旧环境保留。初始 `/workspace/milkup` 的 `work` 和 `v2` 均在配置基点 `f713d91d311ff22e7b19a01b3b94938b714ba375`，工作树干净。专门 fetch `refs/heads/dot/milkup-v2-quality` 后确认远端精确 HEAD 为 **`cefe9e4157ef7bcd909ee273004595f3b832e075`**，从此 SHA 创建本地同名分支；没有从旧配置继续开发，没有覆盖用户文件、reset、强推、合并远端 v2 或发布应用。

初始远端 fetch refspec 没有包括该专用分支，`switch --track` 被 Git 拒绝；随后直接从已核验完整 SHA 建立分支，未修改 Git 安全配置。仓库及挂载 `.agents` 中没有 AGENTS.md / SKILL.md。读取 coding-plan、架构、v1 回归策略，以及质量基线、云环境和 phase9/10 报告。没有切换模型或委派；工具不提供独立模型／推理档位核验接口。

环境工具现已可用、命令真实返回，不是等待设置。Node 24.19.0、pnpm 11.7.0、Rust 1.99.0、GTK 3.24.49、WebKitGTK 2.52.6；重新冻结安装、构建工作区和当前 Rust debug 二进制。沿用用户级 sysroot/proot/Xvfb/D-Bus，不关闭 WebKit 沙箱。初始没有旧应用／驱动进程。详见 [环境记录](./evidence/v2-phase11/environment.log)。

**第十阶段新增原生功能已完成 WebDriver 验收，并发现、修复了保存后光标消失。** 本次不能据此宣称 Typora 级完成：系统中文 IME 仍阻塞，完整性能矩阵、跨平台和若干编辑／视觉能力仍待验收。

## 正常启动与 WebDriver 时序

- 首次正常 CLI 打开 1.1 MB 真实文件：约 412 ms 出现 10×10 隐藏窗口，1847 ms 映射 1100×760 窗口。但[首帧截图](./evidence/v2-phase11/direct/initial.png)仍空白，不能当作可编辑就绪。这次临时探针在映射后立即运行 XTest，首个保存断言失败；后续截图已显示正文。保留[原始日志](./evidence/v2-phase11/direct.log)，不将其计为产品语义通过或永久启动死锁。
- 随后的 WebDriver 首次会话从 14:20:33.800 开始，14:20:35.309 窗口检查完成，14:20:35.323 已进入编辑器 ready 检查。约 **1.52 秒**达到可操作阶段，随后实际编辑落盘。原 60 秒启动／20 秒交互期限保持不变；本次原生套件没有旧环境的会话超时。见 [首次原生运行](./evidence/v2-phase11/windowed.log)。
- 为纠正临时正常启动探针的“映射即就绪”错误，另做一次独立正常 CLI 观察，先取真实帧再发送输入：[约 2.09 秒仍空白](./evidence/v2-phase11/direct-ready/frame-2013.png)，[约 2.73 秒完整正文、状态和光标已显示](./evidence/v2-phase11/direct-ready/frame-2594.png)。这些是离散截图时间上界，不是精确首帧事件或 P95。见[逐帧记录](./evidence/v2-phase11/direct-ready/startup.json)。
- 同一正常 CLI 进程中，独立 XTest 脚本完成列表续行、缩进、两层空项退出及前两步撤销的精确磁盘核对；第三步撤销／保存没有得到期望字节。脚本只等待磁盘字节，不等待保存状态解除，不能证明完整 UI 队列完成；应用 `runDesktopAction` 在保存中明确忽略编辑命令。保留此[失败日志](./evidence/v2-phase11/direct-ready-editing.log)及[截图](./evidence/v2-phase11/direct-ready/failure.png)，不计为六组通过，也不修改等待时限来掩盖它。
- 对同一进程分别发送后续真实 X11 撤销／保存，恢复全文后再输入 `x`、保存，实际插入位置 **UTF-16 12**，与期望一致；旧阶段曾错误落在 14。该[聚焦原生闭环](./evidence/v2-phase11/direct-ready/focused-caret.json)与[截图](./evidence/v2-phase11/direct-ready/focused-caret.png)证明行定位修复在普通启动路径有效，但不替代上面的完整脚本失败。后续应让纯 XTest runner 观察界面解锁，并单列保存期间快速连续快捷键的体验策略。

干净环境下启动及交互显著快于旧环境记录，支持“累积运行状态影响结果”的判断；**没有确定唯一底层根因**。正常 CLI、WebDriver、首次／后续启动并非严格同缓存实验，不能把所有差异归因于僵尸进程，也不能宣称所有平台启动 SLA 通过。

## 发现与修复

原生窗口化 source 三组首先通过；live 列表完成四步撤销、磁盘正文恢复正确后，光标查询返回 null。截图与日志显示输入代理仍在，但 `.milkup-cursor` 不存在。

`SourceDocumentView.renderCursor()` 在保存禁用编辑时移除光标；若这期间窗口重绘，`setEditable(true)` 原来只改只读属性，没有恢复光标。修复在可编辑状态改变时重绘现有光标，不改文本、选区、历史或保存权限。source/live 两个回归先[失败](./evidence/v2-phase11/red-save-caret.log)，修复后[通过](./evidence/v2-phase11/green-save-caret.log)，保留反向选区不变量。

原生脚本补充：

- source/live 中含中文、emoji、组合字符及 CRLF 的 UTF-16 撤销／重做光标；撤销后真实输入并核对整份磁盘字节。
- 40 行跨渲染窗口的反向选区缩进／撤销／重做／反缩进后，继续 Shift+Home 并输入 `x`，验证范围两端和方向，不只检查光标 head。
- 旧 Unicode 套件曾在正文恢复后、异步行定位尚未完成时捕获位置 1，稍后位置为正确的 8，导致滚动保持断言失败。增加原期限内等待**明确的预期位置** 8／1，再执行下一动作；没有放宽断言或延长时限。保留[初次失败](./evidence/v2-phase11/windowed-unicode.log)。

## 原生验收

全部通过记录均运行真实 Tauri/WebKitGTK、原生文件服务和磁盘字节断言。WebDriver 键盘与 X11 Shift+Tab 是实际原生输入；文件选择路径仍使用既有 test seam，不能算 OS 文件选择器或系统 IME。

| 套件                                                                 | 本轮结果                        | 证据                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 第十阶段窗口化列表、窗口外开围栏、CRLF、方向选区、历史及新增 UTF-16  | 8 组完整通过                    | [结果](./evidence/v2-phase11/windowed-fixed/results.json)、[日志](./evidence/v2-phase11/windowed-fixed.log)                 |
| 普通 live 表格、系统剪贴板、行列、退出及两组方向键／Unicode 原子跨度 | 9 组完整通过                    | [结果](./evidence/v2-phase11/table-editing/results.json)、[日志](./evidence/v2-phase11/table-editing.log)                   |
| 搜索／替换／真实大纲插件、窄窗与十万行定位                           | 6 组完整通过                    | [结果](./evidence/v2-phase11/navigation/results.json)、[日志](./evidence/v2-phase11/navigation.log)                         |
| 原生文档安全、失败、冲突、窗口保护                                   | 12 组完整通过                   | [结果](./evidence/v2-phase11/quality/results.json)、[日志](./evidence/v2-phase11/quality.log)                               |
| 窗口化 Unicode、滚动光标、CRLF                                       | 调整异步就绪断言后 6 组完整通过 | [结果](./evidence/v2-phase11/windowed-unicode-final/results.json)、[日志](./evidence/v2-phase11/windowed-unicode-final.log) |
| 普通列表、代码与历史                                                 | 8 组完整通过                    | [结果](./evidence/v2-phase11/block-keyboard-final/results.json)、[日志](./evidence/v2-phase11/block-keyboard-final.log)     |

49 组是上述不同套件的合计，不是一次无失败的全阶段运行；修复前失败及独立 XTest 失败均保留。

## 十万行与性能边界

导航保留原 100,000 条 body 行、CRLF、约 1.1 MB 文件。查找六万行后的 `target`，直到选区精确定位，再实际替换输入为 `changed` 并核对整份文件；大纲跳到第 60002 行。不是小夹具替代，也不是 `1/1` 一出现即宣布完成。日志中从查询后首次计数检查 14:24:36.135 到精确光标确认约 14:24:40.604，约 **4.47 秒**，包括扫描、定位、轮询／驱动开销；不是专用纯扫描耗时。全扫描响应与多次取消重查仍需性能优化。

同一既有 1,100,019 字节／100,002 行窗口性能夹具：

| 测量                 | source   | live     |
| -------------------- | -------- | -------- |
| 首次远跳，DOM 到两帧 | 115 ms   | 146 ms   |
| 其余远跳／返回样本   | 62–91 ms | 57–90 ms |
| 真实 `x` 输入到 DOM  | 8 ms     | 5 ms     |
| 输入到两帧           | 65 ms    | 56 ms    |

[完整分层样本](./evidence/v2-phase11/performance-clean/profile.json)在本次样本里没有 500 ms 首次远跳／200 ms 热跳目标违规；OS 文件缓存未强制清空。16 个跳转及各一次输入不足以宣布 P50/P95、长期稳定性或 10/100 MiB 矩阵全部合格。

首次性能脚本在改码后的 Vite 会话中未挂上实际 render 原型，明确断言失败，[结果](./evidence/v2-phase11/window-performance-final/profile.json)没有有效跳转样本。仅重启本任务 Vite 清除模块图后，同一脚本、夹具、门槛和 instrumentation 断言通过。模块图差异是符合现象的解释，不把失败运行的空违规数组当作通过。

## 系统中文 IME 可行性

默认镜像没有 ibus/fcitx：见[初始检查](./evidence/v2-phase11/ime-environment.log)。本轮进一步使用现有 Debian 签名软件源的包索引，将 IBus 1.5.32、ibus-libpinyin 1.15.8、GTK3 输入模块和依赖下载、解包到新的 `/workspace/.cache/milkup-ime-phase11`，没有系统安装、改原 setup 或关闭安全设置。独立 XDG 配置、schema、候选 panel 与拼音引擎只用于此次可行性检查。

组件能被列出，panel／引擎进程曾创建，但启用全局拼音时出现 `SetGlobalEngine ... Operation was cancelled`，随后有 D-Bus 连接关闭及进程退出。最初检查还遇到 daemon 尚未 ready，补有限就绪等待；之后一次前台 daemon／显式引擎诊断保留失败后停止。见[安装记录](./evidence/v2-phase11/ime/download.log)、[引擎启用失败](./evidence/v2-phase11/ime/session-engine-failed.log)、[引擎日志](./evidence/v2-phase11/ime/engine.log)及[可复核启动探针](./evidence/v2-phase11/ime/start.py)。

**未取得候选窗、组合提交／取消或中文标点证据，Linux 中文系统 IME 仍未验收。** 安装成功、进程存在、Unicode WebDriver 输入和合成 composition 都不算通过。最小下一步是在具备稳定 IBus 会话的标准 Linux 桌面／原生镜像执行同一 Tauri HEAD 的候选、取消、选区替换、失焦及历史矩阵；不要求降安全设置。现有证据不足以归因产品 IME 实现，也不足以断言仅是缺少安装包。

## 端到端与视觉审查

逐张查看原生截图，并以真实输入、保存、重新切换与布局断言支持结论：

- 普通[表格](./evidence/v2-phase11/table-editing/live-table-arrows.png)表头、边框与选中单元格清楚，方向键跳过隐藏分隔符；行列工具可达，原生 HTML／Markdown 剪贴板已跑通。工具条距离正文较远，键盘发现性及更复杂表格仍有体验改进空间。
- [760×520 搜索／大纲](./evidence/v2-phase11/navigation/native-narrow-search-live.png)没有覆盖正文，正文可用高度 207 px，控件都在容器内；[源码切换](./evidence/v2-phase11/navigation/native-narrow-source.png)去掉 live code 样式。窄窗大纲与搜索仍占较多高度，需要可折叠性、缩放及可访问性专项设计。
- 大文件[跨窗口选区](./evidence/v2-phase11/windowed-fixed/live-windowed-reverse-selection.png)、[代码空行](./evidence/v2-phase11/windowed-fixed/live-windowed-code-blank-line.png)的文本／历史语义已验收。窗口外长围栏仍可能显示局部 Markdown 投影；长无断点行出现横向溢出／局部换行，不能宣称与普通文档体验一致。
- 保存失败／外部冲突仍有可见反馈，原文件保护经磁盘检查。普通 CLI 快速交替保存／撤销的独立 runner 失败提醒：磁盘完成不等于 UI 解锁，保存时快捷键策略仍需单列体验与测试闭环。
- 本阶段未新增品牌素材、全面主题改版或发布；截图来自实际应用，不是设计稿。字体缩放、高 DPI、多屏、屏幕阅读器和更复杂文档尚未完整审查。

## 全仓验证

| 检查                               | 结果                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全 workspace JS，单 worker 串行    | 776 项一次完整通过；[日志](./evidence/v2-phase11/unit-final.log)                                                                                   |
| 大纲／原生启动 helper 独立覆盖     | 2 + 4 通过；[大纲](./evidence/v2-phase11/outline-final.log)、[helper](./evidence/v2-phase11/harness-final.log)                                     |
| Chromium 实际浏览器                | 57 项一次完整通过，48 秒；[日志](./evidence/v2-phase11/browser-final.log)                                                                          |
| Rust                               | 46 通过，取消会掩盖退出码的 runner；[日志](./evidence/v2-phase11/rust-final.log)                                                                   |
| 全仓类型／JS 构建／原生 debug 编译 | 通过；[类型](./evidence/v2-phase11/types-final.log)、[构建](./evidence/v2-phase11/build-final.log)、[原生](./evidence/v2-phase11/native-build.log) |
| Rust 格式                          | 通过；[日志](./evidence/v2-phase11/rust-fmt.log)                                                                                                   |

命令使用既有 `env.sh`，测试串行，原生和浏览器／性能测量分开运行，没有提高测试时限、降低安全设置或缩小性能 fixture。收尾全仓 Prettier 与 `git diff --check` 结果见同目录日志。

## 距离 Typora 级质量的剩余必办

1. 真实系统中文 IME 候选、提交／取消、标点、选区替换、失焦和撤销；Linux 当前阻塞，Windows/macOS 本阶段均未实测，不外推历史记录。
2. 完整 175 KiB／1／10／100 MiB、长围栏／长行／密集匹配的打开、搜索、输入、跳转、内存、P50/P95 与长时间运行矩阵。十万行搜索仍约数秒；本次少量跳转达标只关闭本样本缺口。
3. 窗口化表格、大文件替换的原子事务／撤销、复杂嵌套块、窗口外代码投影；对普通／窗口化模式的能力降级提供一致且清楚的用户体验。
4. 普通 CLI 快速连续保存／撤销的 UI 解锁契约与独立 XTest runner；在保留保存安全的前提下评估快捷键排队／反馈，不能用固定延时宣称已解决。
5. Windows 文件占用与剪贴板、macOS Cmd／watcher、OS Open/Save As 选择器、Word 2016 表格与标题语义；全部保留未验收。
6. 高 DPI／缩放、窄窗大纲与搜索占位、长行换行／横向滚动、工具发现性和可访问性；不以功能测试数量替代真实写作体验。

本阶段只提交、正常推送专用质量分支。完整原始材料仍在 `/tmp/milkup-v2-phase11`；关键日志、截图和复现信息已随本报告入库。

入库日志仅裁去行末空白和末尾空行；完整原始字节保留在临时运行目录及本地归档。仓库全局忽略 `*.log`，本轮仅显式加入本阶段选定的验收日志。遗留 main hooks 引用 v2 不存在的脚本，完成上述检查后使用其既有 `SKIP_SIMPLE_GIT_HOOKS=1` 单次开关，不改 hooks 或 Git 安全设置。
