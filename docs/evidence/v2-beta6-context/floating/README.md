# Beta6 浮层证据

此目录保留原始日志、截图和布局数据；仅复制证据，没有重跑测试或修改产品／测试。原始日志、JSON 和 Markdown 诊断仅追加 `.txt` 后缀，内容字节未改。`source-map.json.txt` 列出每份复制文件的原始路径、字节数和 SHA256；`SHA256SUMS` 校验本目录所有文件（不含自身）。重复的自动失败截图、trace ZIP、依赖和插件包未复制。

## 环境与证明范围

- Chromium 154.0.8037.57，Debian Linux，Node v24.19.0；真实浏览器运行应用代码，但采用内存文件适配器，不证明原生窗口、磁盘保存或 Windows 行为。
- 100%／125%／150%／200% 通过 CSS viewport 按比例缩小模拟可用布局空间，不是原生缩放或系统 DPI。ordinary／windowed 指编辑器普通／窗口化渲染模式。
- Formatting 1.0.1 外部包 SHA256：`4bce37c68e9cce6a93f8f3b416e7fb77bf0459bd45dca95111a6b554003d6b8f`。测试时插件源文件已与工作区逐项核对，未改插件包。
- `configs/` 保留当时临时配置的原始字节，路径是测试环境路径，不是可直接移植的配置。

## 基线与修复后证据

`baseline/` 是基线 `7189a26a0cb055e96a72bd2655b673e067ba3012` 的两例稳定复现：ordinary 1100×760 light 100%，windowed 760×520 dark 200%。两例标题栏都从 37 增到 80 CSS px（+43），编辑区域高度减少 43 px。各自保存 `layout-before-and-after.json.txt`、`failure.png` 和错误上下文。

基线通过临时 Vite load 插件仅替换基线的 `main.ts`、`style.css`、`desktop-plugin-ui.ts`，其余模块来自当时工作区；这不是完整独立 checkout 的重放。`baseline-source-hashes.json.txt` 记录这三份替换文件与对应 Git 对象逐字节一致的校验结果。

正式修复后使用真实工作区 `main.ts`，没有临时几何适配器。37 个不同用例的通过覆盖来自多轮执行：

| 证据                                                                         | 覆盖与结果                                                                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current/matrix-attempt/`、`logs/milkup-beta6-floating-green.log.txt`        | 32 组 Source 布局矩阵加普通／窗口化两例交互，共 34 例；首轮 33 通过，1 例被 HMR 中断。保留全部 32 组布局／滚动 JSON 和截图，以及失败截图。                |
| `current/matrix-targeted/`、`logs/milkup-beta6-floating-targeted.log.txt`    | 仅补跑 ordinary 760×520 dark 100% 的中断例，1 通过。该例最终证据以此目录为准。                                                                            |
| `current/live/`、`logs/milkup-beta6-floating-live.log.txt`                   | Live 模式普通／窗口化，600×400 dark，两例布局与鼠标命令编辑／历史路径通过，保留两组截图和几何。                                                           |
| `menu-return/green/`、`logs/milkup-beta6-floating-menu-return-green.log.txt` | 只打开／关闭主菜单，不补输入、滚动或 resize，原浮层自动恢复，1 通过；状态 JSON 保留同一 cursor 116、8 个 ready 按钮和菜单按钮焦点。此例没有另拍成功截图。 |

矩阵：普通／窗口化 × 1100×760／760×520 × light／dark × 100／125／150／200。断言涵盖标题栏、编辑器和宿主几何不变，浮层与锚点相邻、边缘避让、滚动跟随、离屏隐藏和回归，Tab 只滚动浮层。交互用例涵盖鼠标／Enter 命令、编辑器焦点、直接 Unicode 输入、撤销、禁用／重新启用和切换新文档。完整断言以仓库 `tests/e2e/desktop-floating-toolbar.spec.ts` 为准。

## 各轮失败与补跑说明

日志全都保留，没有把预备尝试计入正式通过数。

| 日志（均在 `logs/`）                                    | 当轮结果与解释                                                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beta6-toolbar-unit-red.log.txt`                        | 3 个真实行为断言先红，77 跳过：空白／空输出、指针保持期间清空，以及选区变化后迟到输出。                                                                                                                       |
| `beta6-toolbar-ui-green.log.txt`                        | 早期 UI 单文件 80 通过。                                                                                                                                                                                      |
| `beta6-toolbar-geometry-red.log.txt`                    | 几何模块尚未创建时的 import 失败，没有执行测试；这是实现前启动失败，不计为行为先红。                                                                                                                          |
| `beta6-toolbar-unit-green.log.txt`                      | 此任务完成时 UI／浮层／几何三个文件共 94 通过；不是项目后来所有测试的总数。                                                                                                                                   |
| `milkup-beta6-floating-red.log.txt`                     | 并行编辑未完成时页面出现 `hasToolbarContent is not defined`，未进入有效基线布局验收。                                                                                                                         |
| `milkup-beta6-floating-baseline-red.log.txt`            | ordinary 单例，预期布局断言红。                                                                                                                                                                               |
| `milkup-beta6-floating-windowed-baseline-red.log.txt`   | windowed 单例，预期布局断言红。                                                                                                                                                                               |
| `milkup-beta6-floating-baseline-red-final.log.txt`      | ordinary 再次布局红；windowed 未找到按钮，伴随并行编辑期间缺失 `editor-context-menu.ts` 的 Vite 错误，不把第二例当作布局复现。                                                                                |
| `milkup-beta6-floating-baseline-red-stable.log.txt`     | 稳定重跑两例均在预期布局断言红；这是正式两例基线证据。                                                                                                                                                        |
| `milkup-beta6-floating-provisional.log.txt`             | 主接线完成前临时几何适配器下两例通过，仅预检，不计入正式真实 main 覆盖。                                                                                                                                      |
| `milkup-beta6-floating-provisional-interaction.log.txt` | 预检交互运行：首例 fixture 等待插件入口超时，第二例中断。发生于并行编辑／HMR 阶段，未形成正式交互验收。                                                                                                       |
| `milkup-beta6-floating-green.log.txt`                   | 33 通过；ordinary 760×520 dark 100% 页面重载为未命名空文档，后续矩形为空。按当时调查归因为 HMR 中断，失败截图和上下文仍保留。                                                                                 |
| `milkup-beta6-floating-targeted.log.txt`                | 上述中断例独立补跑通过。                                                                                                                                                                                      |
| `milkup-beta6-floating-menu-return-red.log.txt`         | 真实顺序缺陷：主菜单关闭后 editor 已非 inert、同一 cursor 116 且 8 个按钮 ready，浮层仍隐藏 5 秒；浏览器事件仅一次导航，没有 HMR。                                                                            |
| `milkup-beta6-floating-menu-return-green.log.txt`       | main 把背景 inert 更新移到几何 reconcile 之前后，同一用例通过，未额外触发编辑器事件。                                                                                                                         |
| `milkup-beta6-formatting-regression.log.txt`            | 既有 Formatting 22 例首轮 17 通过、5 失败：首个中断例受 HMR 影响；菜单例随后确认旧 button 定位与新 menuitem 契约不符；最后三例受共享服务生命周期影响，先出现插件状态未就绪，随后两例明确 connection refused。 |
| `milkup-beta6-formatting-targeted.log.txt`              | HMR 中断例补跑通过；菜单例仍等待旧 button 定位超时，交由菜单代理更新契约和验收，其最终证据在根归档中。                                                                                                        |
| `milkup-beta6-formatting-geometry-targeted.log.txt`     | 上述最后三例在隔离服务上补跑，3 通过。                                                                                                                                                                        |

`evidence-original.json.txt` 是浏览器代理当时的原始汇总，含历史 `/tmp` 路径及菜单例交接状态；其 `remaining` 不是当前项目未完成事项。该原始汇总把末三例概括为 connection refusal，逐例实际表现以保留日志及上表为准。后来菜单生命周期修复和 Linux 原生验收由根任务另行归档，不扩展本目录的证明范围。

校验：在本目录执行 `sha256sum -c SHA256SUMS`。源文件对应关系见 `source-map.json.txt`。

## 原生发现后的 Source → Live 模式补充

冻结源代码 `b3962099939149abe930d42b8c57f0a79ba009ce` 的 Linux 原生第 21 步观察到窗口化 Live 表格按钮先可见、点击定位时 DOM 变空。完整原生失败保留在根任务的原生归档；本目录补充其宿主模式身份缺口的确定复现与修复证据。

静态链：Formatting 1.0.1 的 toolbar 签名含 viewMode，模式变化触发 load 同步清 snapshot 后重新 capture；宿主此前仅按 documentId/version/selectionRevision 退休并校验输出，导致切 Live 后仍暂露旧 Source 按钮。原生 ctrl+2 到 pointer 调用约 203 ms，pointer 内部 100 ms 稳定检测跨过宿主 240 ms 的刷新时点，与该链吻合。该时间关系是支持性证据；确定断言来自下述真实浏览器同一 mutation 批次的旧模式按钮可见观察。

最小修复仅在宿主 toolbarContext 与迟到请求检查加入 viewMode，并将 session.viewMode 加入 main 的 navigationSignature，确保鼠标模式切换也预约当前模式渲染。没有保留过期按钮或增加测试延时。

| 追加证据                                                            | 结果                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode-transition/logs/milkup-beta6-toolbar-mode-unit-red.log.txt`   | 新增两例先红：同文档切模式未同步退休，以及迟到 Source 输出被错误接纳。                                                                                                                                                                                                                                |
| `mode-transition/logs/milkup-beta6-toolbar-mode-unit-green.log.txt` | 修复后 controller／浮层／几何共 105 例通过。                                                                                                                                                                                                                                                          |
| `mode-transition/red/`、对应 red 日志                               | 真实应用浏览器两例先红；ordinary 通过状态栏鼠标切换，windowed 通过 Ctrl+2。在 mode 变化的同一 MutationObserver 批次，两例均仍有 8 个旧 Source 命令可见，预期为 0；文档版本 0、cursor 116 未变。保留两份失败截图、事件、上下文和逐帧／mutation 时间线。                                                |
| `mode-transition/green/`、对应 green 日志                           | 同两例通过。切换批次旧命令可见数立即为 0；ordinary 约 255.2 ms、windowed 约 264.8 ms 后当前 Live 输出就绪。随后都完成真实点击加行、Unicode 输入和两次撤销回到原表。只观察时间线，未注入状态、mock Worker 或任意等待。成功时间线记录整条编辑流程，因此命令执行后的正常选区／版本失效也会出现隐藏状态。 |
| `mode-transition/logs/milkup-beta6-toolbar-mode-typecheck.log.txt`  | 桌面 tsc 成功退出 0，正常没有 stdout，所以原日志为 0 字节。                                                                                                                                                                                                                                           |

只新增并运行这两条浏览器路径，没有重跑之前 37 例；跨轮累计覆盖 39 个不同浏览器用例，不声称一次连续 39 例运行。新增测试路径仍是 `tests/e2e/desktop-floating-toolbar.spec.ts`。本轮临时 Vite 配置仅声明版本常量、工作区模块别名和独立 1441 端口，应用 main 与浮层源码直接取工作区；继续使用前述浏览器文件适配器，原生最终验收另归档。

首次单测启动因 Vite 配置中的版本检查 spawnSync 被沙箱拒绝（EPERM），原日志单独保留为 `unit-startup-blocked`，不计行为先红；随后通过临时测试配置运行。首次浏览器启动也遇 localhost listen EPERM，自动审批批准本地运行后取得上述行为红绿，不计为产品失败。产品／测试在这些验证通过后冻结；本次追加仅写证据。

浏览器代理追加模式结果后的汇总独立保留为 `mode-transition/evidence-with-mode.json.txt`；此前 37 例的 `evidence-original.json.txt` 和源路径原始字节保留不变。浏览器 listen EPERM 仅见工具调用输出，没有独立原日志；未把正式行为红日志改写为基础设施日志。
