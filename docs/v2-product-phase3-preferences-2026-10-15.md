# P3 编辑偏好与快捷键（2026-10-15）

工作分支 `dot/milkup-v2-product-phase3-preferences`，精确基线 `ffe07fe61fd28ea575f2a26dda0275c4f2d7216b`。本阶段沿用父线程批准的产品插件计划，只提交和推送隔离分支代码及证据，进行本地 Linux 验证；没有 Windows/Runtime 构建、artifact 上传、Release、部署、主分支整合或真实密钥生成。历史预算批准不改变这一范围。

## 实现与分工

- `milkup.preferences` 独立插件拥有编辑偏好界面、草稿校验、预览、保存、取消、重置与错误文案，仅依赖公开 SDK，权限为 `settings:write`。字体为等宽/系统/衬线白名单；字号 12–32px，行距 1.2–2.4 倍，实时正文宽度自动或 480–1200px，缩进为两/四空格或 Tab。主题与原生缩放在同一入口。源码继续不折行，正文宽度帮助明确说明只作用实时模式。
- `milkup.shortcuts` 独立插件拥有命令查询、完整帮助、绑定草稿、冲突反馈、保存/取消与恢复默认，权限为 `app:keymap`。公开目录来自实际注册动作；有必需参数的动作显示为不可直接绑定，插件不能通过 keymap API 执行任意命令。
- 宿主只保留受控 schema/作用域、持久化、原生主题/缩放与视图应用、动作路由和生命周期撤销机制。新插件都通过通用 modal 贡献进入菜单，原宿主外观和简略快捷键业务面板已迁出，没有按这两个插件 ID 分支处理。
- 两个插件均通过通用预装目录安装，敏感权限必须明确批准后才能启用；停用/卸载不会因重启或预装扫描自行复活。

## 数据与交互边界

`host.settings` 提供 `describe/get/begin/preview/commit/cancel`，限定 application 或调用插件自身的 plugin scope。宿主固定 application schema，插件不能传目标插件 ID、任意 CSS、路径或网络地址。一个 application 预览事务持有锁；主机缩放快捷键遇到活动预览会明确失败，避免旧草稿覆盖新值。

预览仅改变视图，提交才持久化；重置先形成可取消预览。存储失败保持明确的未保存状态，可重试或取消，重启读取最后提交值。旧 `milkup.desktop.appearance.v1` 仅在新设置不存在时迁移读取，保留旧记录，不静默覆写损坏数据。外部 revision 变化拒绝过期提交，取消恢复新的已提交基线。停用立即撤销句柄并回滚未提交预览；回滚失败仍完成插件撤销、显示错误，并在下一操作前重试恢复。

字体、字号、行距和宽度变化不派发文档事务，不改变文档版本、脏状态、选择或撤销历史。缩进设置只作用未来的 Tab/Shift+Tab，既有 Tab 字符宽度不改。窗口化布局只测量可见实时行，继续使用有界缓存；未见行仍用基础行高估计，不扫描整篇文档。

原生缩放等副作用在回滚时重新应用，避免“缩放成功、后续布局失败”留下错误缩放。异步布局期间切换文档/模式时，应用过程继续更新替换后的视图，才报告成功。

快捷键只支持单组合键，不增加多步 chord 或全局键盘钩子。Tab、Esc、F6、剪贴板、文本导航和 IME/AltGraph 保留上下文行为；搜索框保留文件/视图/搜索等全局命令，文本全选与历史仍归原生输入框。保存成功的宿主绑定不依赖快捷键插件保持启用；绑定到已停用插件的命令不会执行。

受控字段只能声明 text/number/select 及白名单参数，值事件为结构化 `{field,value}`。宿主保留输入节点、光标和选区，不把字段 input/change 事件当作选择文件所需的可信点击授权。

## SDK 兼容与迁移

SDK 从 0.3.0 增量到 0.3.1，保留旧合同，不修改既有官方插件的版本范围。兼容回归覆盖 P2 的 outline、updates、workspace 已安装记录，启用/停用状态与审批不变。新插件要求 `^0.3.1`；旧宿主在安装阶段明确拒绝，不能执行一半才失败。

本地公共插件验证脚本读取当前 SDK 版本与通用发行清单，支持资源文件，不再硬编码历史 0.2.0 或两插件数量。旧 Windows/offline 预算与批准门禁未修改。

## 验证记录

已完成的全仓门禁：1,366 项单元测试、138 项 Chromium 浏览器测试、全仓类型检查、构建及格式检查通过；Rust 101 项通过、1 项既有忽略。五个官方插件均用公开 SDK 0.3.1 在仓库外独立构建，101 项业务测试通过，声明资源与源文件字节一致；公共构建输入合同另有 [4 项 Node 测试](evidence/v2-preferences/public-build-contract-tests.txt)。见 [外部构建](evidence/v2-preferences/public-build-proof.json) 与 [资源兼容审计](evidence/v2-preferences/public-build-resources.json)。浏览器保存测试使用内存文件适配器，不能代替原生磁盘验证。

一次 Rust 构建、浏览器与全仓单测重叠运行时，既有 100 MiB 搜索测试超过原 5 秒门限；未改产品或放宽门限，减少验证并发后全仓 1,362 项通过。首次构建曾在另一代理格式化 RPC 文件时读到半写入内容，停止并行写入后重新构建通过。这些验证调度失败保留日志，不混称产品缺陷。

本地生产 deb SHA-256：`cafbbfc0c66463d01faf9669d04774d06d394b231c50b4cbd90f15496f74a10d`；独立解包 binary SHA-256：`e749904c26dc6f83d1dd5cb9f4709f170abc93e58c9ef5fdbf1a960c08451654`。最终生产测试使用这一确认二进制的独立副本，不使用开发服务器。

最终包五插件同时禁用原生闭环首次尝试通过：25 步记录、48 张截图，真实 GTK 打开、source 编辑/撤销/重做/完整字节保存、正常关闭重启、SIGKILL 后恢复副本均通过；原文件未改变，所有插件 UI/命令/打开入口均消失，页面错误与 CSP 违规为空。见 [摘要](evidence/v2-preferences/all-disabled-summary.json)、[完整观察](evidence/v2-preferences/all-disabled-results.json)。

最终偏好/快捷键原生验收 `run-final4` 完整通过，共 111 条观察记录。64 个编辑器场景覆盖普通/窗口化 × source/live × 明/暗 × 100/125/150/200% 原生缩放 × 1100×760/760×520；16 个面板场景覆盖主题、缩放与宽窄窗口，逐一检查 Tab 焦点控件和完整焦点环。四条编辑路径验证实际键盘输入、撤销/重做、四空格缩进、预览不改变选择/版本/脏状态及完整 CRLF/Unicode 字节保存，窗口化路径另验 Tab 字符缩进；渲染窗口保持少于 100 行。

同一轮还通过独立档案安装、明确授权、预览/非法值/取消/默认预览取消、设置重启保持、停用和卸载后继续编辑保存、重启不复活插件。快捷键覆盖冲突反馈、草稿取消、Ctrl+K 实际磁盘保存、旧 Ctrl+S 已解绑、重启保持以及恢复默认。所有观察中的页面错误与 CSP 违规为空。见 [原生摘要](evidence/v2-preferences/native-summary.json)、[完整结果](evidence/v2-preferences/native-results.json)、[执行日志](evidence/v2-preferences/native-log.txt) 与 [二进制及插件档案来源](evidence/v2-preferences/native-provenance.json)。测试使用的应用、驱动和显示进程已按所属实例清理，见 [清理记录](evidence/v2-preferences/native-cleanup.json)。

前一候选二进制 `d4e9527…` 的一次全禁用验收启动时，正文已安装而 loading 停在 opening，超过原有 20 秒门限；未调整超时、断言或产品，新配置复测完整通过。推断首绘等待尚未完成，但原因未确定，不宣称已消除间歇风险；见 [失败状态](evidence/v2-preferences/startup-timeout.json) 与 [定位记录](evidence/v2-preferences/startup-timeout-diagnosis.txt)。

可追踪证据位于 [本轮证据目录](evidence/v2-preferences/)。其中取消外部 revision 冲突、受控字段失焦、首次 keymap 保存 stale 的失败日志与修复后断言分开保留。原生发现正文宽度居中后点击两侧空白失焦；独立浏览器还发现窗口化路径右侧点击在 emoji 行末偏移一个 UTF-16 单元。修复把普通视图点击交给编辑器容器、使用最近实测行与精确行端点，同时排除输入控件和原生滚动条；普通/窗口化的左右点击、输入、拖选回归从 2 项失败转为 2 项通过。另修复插件默认键被覆盖后重新绑定可能丢失原上下文的问题：目录独立保留原始条件与实际可用默认键，真实双 Worker 回归验证重启后仅允许的源码编辑上下文执行一次。原生观察器首轮括号错误属于测试脚本问题，未开始设置动作，不记为产品失败。窗口化 Ctrl+Home 是异步操作，原生脚本已先等待归零再记录预览不变量，保留此前未等待造成的失败。

实际像素检查还发现 200% 原生缩放、760×520 窗口下，偏好面板的 Tab 焦点只部分可见；独立等待 500ms 后，控件底边 213.5px 仍超过面板可视底边 205px。新增确定性失败回归后，通用 modal 在焦点切换及恢复滚动后仅调整自身滚动位置，确保当前控件和 4px 焦点环完整可见，不重新聚焦或滚动文档；卸载取消待执行回调。新生产包使用完整裁剪边界断言复验，不再仅检查 `:focus-visible`。见 [原生失败](evidence/v2-preferences/modal-native-focus-before-results.json)、[浏览器修复验证](evidence/v2-preferences/modal-focus-after.txt)。

最终候选包的一次矩阵运行在暗色 150%→200% 保存等待处超时。独立鼠标事件诊断复现了测试脚本的时序错误：下拉框已经选择 150%，坐标采样仍是中间 125% 的 880px 视口；随后实际视口变为 733px。该次保存没有收到 DOM pointerdown/click，不能推断具体落到了哪个目标。脚本现先等待宿主 zoom 与实际 WebView 宽度一致，再等待两次稳定控件坐标，仍以真实系统指针操作、不重试保存、不放宽成功断言。同一二进制的 150%↔200% 往返 12 次保存均通过，12 次 pointerdown/up/click 均命中保存按钮，事件时视口与采样一致；完整矩阵随后重新执行。[修改前事件](evidence/v2-preferences/native-pointer-before-pointer-trace.jsonl) 与 [修改后命中汇总](evidence/v2-preferences/native-pointer-after-pointer-hit-summary.json) 独立保留。

原生截图直接来自 X11 根窗口，黑色区域是测试桌面空白，不是应用内容；同时保留 WebView 截图于本地证据根目录。编辑器矩阵先断言 End 光标在可视编辑区内，再按 Shift+Home 验证非空选区并截图，因此矩阵 PNG 显示的是随后选区状态，不能把截图中的光标位置当成 End 时的位置。

| 可见问题                              | 修复前                                                                                                   | 修复后                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 居中正文两侧点击与窗口化 Unicode 行末 | [原生失败截图](evidence/v2-preferences/gutter-native-before.png)；另有窗口化 UTF-16 行端点浏览器失败断言 | [窗口化拖选及保存](evidence/v2-preferences/gutter-native-after.png)，两条路径均有字节与历史断言                                                                   |
| 200% 窄窗控件焦点被裁剪               | [原生控件下半部被遮挡](evidence/v2-preferences/modal-native-focus-before.png)                            | [浅色完整控件与焦点环](evidence/v2-preferences/modal-native-focus-after.png)、[暗色对应场景](evidence/v2-preferences/native-matrix/panel-dark-200-narrow-x11.png) |
| 快捷键错误反馈在长目录外不可见        | [错误反馈位置](evidence/v2-preferences/keymap-feedback-before.png)                                       | [操作按钮旁可见反馈](evidence/v2-preferences/keymap-feedback-after.png)                                                                                           |

全部 64 张编辑器与 16 张面板原生截图保存在 [矩阵目录](evidence/v2-preferences/native-matrix/)，按路径、模式、主题、缩放与窗口尺寸命名；[截图清单](evidence/v2-preferences/native-matrix-manifest.json) 记录每张原图 SHA-256，未使用 CSS 模拟原生缩放。原始 JSON 中的运行目录及相对文件名保留为来源记录；本仓库采用 `native-`、`all-disabled-` 前缀归档两组验收，JSON 按仓库格式整理，文本日志仅去除行尾空白，PNG 字节不变。完整原始目录仍位于 `/workspace/milkup-preferences-phase3-evidence/`。

## 未完成与平台限制

图片位置策略属于后续独立图片资源功能，仍未实现。它依赖受控资源导入、复制/移动、文档保存路径及资源引用事务，不能把一般设置插件升级成任意文件或网络访问。导出/打印、格式业务扩展等后续阶段也未由本轮代为完成。

Linux 原生和 Chromium 结果不代表 Windows 实机、Windows IME、读屏或原生 DPI 已验证。浏览器缩放仅验证 CSS 可达性，不能冒充 WebView 原生缩放。
