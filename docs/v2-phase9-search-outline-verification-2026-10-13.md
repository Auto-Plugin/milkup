# 第九阶段：当前文档搜索、替换与大纲导航

## 环境与范围

从已核验的专用分支 `dot/milkup-v2-quality`、完整 HEAD `b4266d6ac6052883f94c06dab9082e492aef4ca3` 开始，工作树干净。没有重新使用环境默认的 `f713d91`，没有合并远端 v2、强推或发布应用。继续使用同一原生云环境：Node 24.19、pnpm 11.7、Rust 1.99、GTK 3.24.49、WebKitGTK 2.52.6、Xvfb `:99`。没有切换模型或委派子模型；工具仍不提供可独立核验的运行模型标识。

大纲是仓库提供的 `milkup.outline` 插件，不是空白安装自动启用的内置侧栏。本次浏览器与原生测试通过既有开发注册表加载**实际插件源码**，权限仅 `document:read`，走真实 Worker／document broker／UI broker；原生脚本结束恢复先前注册表。没有新增默认插件安装行为。

## 修复前证据与设计选择

| 项目             | 修复前证据                                                                                                                                | 本阶段行为                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 搜索焦点／导航   | 原有 Enter 搜索后焦点落回正文；再次 Enter 可能编辑正文。每次搜索都重置到首项                                                              | 输入防抖刷新，Enter／Shift+Enter、F3／Shift+F3 循环导航；导航保留搜索控件焦点。Ctrl/Cmd+F 打开并选中查询，Ctrl/Cmd+H 聚焦替换框；Esc 清除高亮并回到当前选区 |
| 查询／文档版本   | 非空查询改变仍保留旧结果；正文改变不更新匹配                                                                                              | 按文档 ID、版本、修剪后的查询、大小写选项标识结果。改变时立即取消旧扫描／清除旧高亮；正文刷新不移动用户正在编辑的光标；迟到结果不应用到新文档               |
| Unicode 字面偏移 | `İ foo 😀 FOO` 查找 `foo` 返回错位片段，包括末尾 `OO`                                                                                     | 保留原有 locale 小写匹配规则，将扩展后的比较位置映射回原始 UTF-16；替换前再次校验原始切片                                                                   |
| 底层正则推进     | 对原 HEAD 提取的 `compileRegExpQuery`，在 Unicode 零宽分支与 `x` 的交替模式、`😀x` 输入上独立进程 1 秒超时并被终止（具体模式见探针 JSON） | 忽略零长度匹配时按 Unicode code point 前进，避免落在代理对中间无限循环；界面**不新增正则模式**                                                              |
| 大纲版本与高亮   | 原 HEAD 插件 mount 后同一文档由版本 1 改为 2：扫描次数仍为 1、旧标题仍在、新标题不出现、正文行没有活动标题                                | 将文档版本传入插件；版本变更重扫有界区域。活动项对应实际光标所在章节的最近前置标题，提供 `aria-current`；移动到现有扫描区域外时重新居中                     |
| 精确窗口化定位   | 原搜索／大纲只滚动到行，未移动 SourceDocumentView 编辑选区                                                                                | 新增带文档身份／版本／请求代次保护的 revealSelection；查找选中精确 UTF-16 区间，大纲设置标题行起点；返回输入代理焦点                                        |
| 普通 Home／End   | 大纲跳转后按 End，光标仍为 0；随后输入落在 `#` 前，导致原标题不再成立                                                                     | 支持逻辑源行 Home／End 和 Shift 扩展选区；CRLF 不进入换行中间；live 表格限制到当前单元格边界，不加入撤销历史                                                |
| 密集匹配刷新     | 205 项查询逐条更新高亮导致浏览器检查超时                                                                                                  | 扫描状态按动画帧合并刷新，保留最终完整状态；不为每条命中同步重建所有高亮                                                                                    |
| 窄窗布局         | 搜索浮层可覆盖正文；760×520 下原有顶置大纲占 40vh，加入替换栏后正文仅约 130px                                                             | 搜索栏在编辑区上方占正常布局空间。保留既有窄窗顶置大纲策略，将高度限为 `min(160px, 25vh)`；不改 Tauri 760×520 最小窗口约束                                  |

检索语义没有扩大：只查当前文档，默认忽略大小写，字面匹配、逐行扫描，沿用查询首尾空白修剪。`.*`、`[` 都是字面字符，空白查询为空查询；不把它们解释为正则错误。大小写开关是显式新增选项。Unicode 使用原有 locale 小写规则，不声称完整 Unicode case folding 或跨行匹配。

普通内存文档新增“替换／全部替换”。替换文本是字面值（`$1` 不作捕获组），空值用于删除；同一次全部替换是单个隔离的撤销事务。完成扫描、文档 ID／版本／查询一致、可编辑且未保存中，才允许替换。结果显示仍限前 200 项，截断时标记 `+` 并说明，禁用“全部替换”，不会只替换可见 200 项却称为全部。原生大文件模式暂不支持替换按钮，原因常显；仍可导航至匹配后用编辑器正常编辑、撤销和保存。

关闭搜索保留最后成功导航的选区；未导航时保留原编辑选区。正文变动触发的后台刷新只更新高亮／计数，不强制跳回首项。搜索输入中的 Ctrl/Cmd+A、Z、Y 交给输入框自身，避免误操作正文。

## 失败与测试夹具的区分

- 完整浏览器回归进一步捕获插件启动竞态：已恢复的注册表贡献早于 Worker runtime 加载，侧栏 mount 抛出 `Unknown plugin: milkup.outline` 且相同贡献签名阻止重挂载。主界面现在等待插件恢复和初始文档打开完成才提供 UI 贡献；浏览器大纲夹具显式延迟模块 600 ms 验证恢复路径，不通过延迟用户输入来掩盖问题。

- `red-browser-verified.log` 中搜索焦点失败是产品复现。大纲第一次浏览器尝试未加载插件，不能作为产品缺陷证据；随后改为加载实际源码，并用独立原 HEAD 插件探针验证版本同步失败。
- 大纲测试曾把异步命令后的按键发得过早，已加实际输入焦点等待。等待后仍复现 End 不移动光标，另存截图／状态并修复产品 Home／End。
- 初次添加 `aria-current` 被受控渲染器拒绝；仅将这一无执行能力的标准属性加入现有允许表，没有放开事件、任意 HTML 或 URL 权限。
- 原生窗口化断言曾发现焦点停在容器而非输入代理；保留失败结果，修复后重验。没有用合成 composition 事件替代系统输入法。
- 首次全仓 JS 与浏览器同时运行，100 MiB 搜索超过既有 5 秒单项时限。独立运行同一测试 4.199 秒通过；没有提高或删除断言／超时。最终完整 JS 验证单独运行。

- 最后完整浏览器运行还出现一次既有表格逐字符输入的撤销断言失败：撤销后剩 `line`，而测试期望整个 `line|value` 同属一组。产品既有合并窗口为 1 秒，测试没有约束事件间隔；没有据此修改产品历史。将这一单事务断言明确为一次 `insertText` 提交，保留同一测试的 Tab／Shift+Tab／Enter／Shift+Enter、逐字符 `second`／`x` 与严格撤销内容断言，定点重验。最终结果将区分完整运行和该项复验。

## 验收矩阵

| 检查                                         | 结果                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 全仓 JS 单元／集成                           | **759 项通过**；按 workspace 串行运行，未提高既有单项时限                                                                                        |
| 实际大纲插件独立测试                         | **2 项通过**；有界分页、版本重扫和前置章节高亮                                                                                                   |
| 完整浏览器覆盖                               | **56 个场景通过（分运行）**：最终完整运行 55 通过、1 项既有表格输入分组断言失败；明确单输入事务后该项定点复验通过。不是“某次完整运行 56/56 全绿” |
| Rust / cargo fmt                             | **46 项通过，格式通过**；unset 会掩盖退出码的 runner                                                                                             |
| 本阶段真实 Tauri 导航                        | **6 组通过**，见下表                                                                                                                             |
| 此前原生文档安全                             | **12 场景通过（分运行）**：前 11 组通过，重开窗口启动超时后只补验最后放弃关闭场景                                                                |
| 原生 Unicode／列表代码回归                   | **6 + 8 组通过**；新驱动下各套件完整执行                                                                                                         |
| 原生表格回归                                 | **本阶段阻塞，7 组未执行**：串行和隔离驱动均在会话创建时超时，不沿用第八阶段通过结果充当本次通过                                                 |
| workspace types/build、独立大纲 types/bundle | **全部通过**；根 workspace 不包含 plugins，另行检查大纲类型并用已安装 esbuild 构建实际插件                                                       |
| 全仓格式 lint                                | **通过**（`pnpm lint`）                                                                                                                          |

| 真实 Tauri 检查                                         | 证据与边界                                                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter／Shift+Enter、F3／Shift+F3、Esc、字面查询／无结果 | 真实 WebDriver 按键，关闭后用命中选区编辑并核对磁盘                                                                                                                                       |
| Unicode 单项替换、大小写、删除式全部替换、撤销／重做    | `İ foo 😀 FOO` 和字面 `.*`；替换 `$1中` 保持字面内容；保存后精确字节校验                                                                                                                  |
| 正文更新与文档切换                                      | 结果刷新不移动继续输入的光标；新文件没有旧高亮／旧匹配                                                                                                                                    |
| 大纲层级、重命名、键盘跳转与文档切换                    | 实际 Worker 插件；H1/H3/H2、活动章节、Home／Shift+End、输入焦点；新文档清除旧标题                                                                                                         |
| 最小窗口与 source/live                                  | 760×520；正文高度 **207 px**（修复前约 129 px），搜索控件均在容器内且不覆盖正文，H3 缩进 **32 px**；三次切换检查原始文本及实际背景／边框样式                                              |
| 原生窗口化导航                                          | 约 1.1 MB、100,000 条 body 行、CRLF；搜索六万行后的 `İ target 😀`，选区终点精确；直接编辑为 `changed` 后保存字节一致；大纲跳到第 60002 行并恢复输入代理焦点。大文件替换按钮禁用且原因可见 |

真实系统 IME 没有在本阶段验收；以上 Unicode 按键／输入测试不等价于中文候选窗口或 OS 组合输入。

### 运行时取证与恢复点

原生验证保留了五次既有 **20 秒**请求超时：导航第二组前的聚焦调用、安全套件重开第二个原生窗口、Unicode 套件新会话启动，以及随后串行与隔离驱动两次表格套件的会话创建。导航随后以逐请求 UTC 日志完整通过六组；安全套件前 11 组通过，最后的放弃关闭独立补验通过。没有延长超时，也没有重跑已经通过的安全断言。

2026-10-13 11:51:51 UTC 实际检查确认 Vite HTTP 200、驱动 `ready:true, No sessions`，对应测试进程已退出，没有可见编辑窗口。**这不等同于所有应用进程均已退出**：后续按完整 executable 参数核查，发现失败会话留下了隐藏 Milkup PID 79598。仅停止本任务运行了约 4 小时的 4446/9517 驱动后，该进程及旧 WebKitWebDriver 已成为僵尸状态，X11 根窗口无子窗口；没有操作其他测试端口。随后新建一套本任务驱动，Unicode 六组和列表／代码块八组全部通过。第三个套件（表格）在会话创建时再次超时，未执行表格断言；12:22:04 UTC 驱动实际返回 `ready:false, A session already exists`，X11 留下 PID 80515 的 10×10 隐藏启动窗口，Vite HTTP 200。停止仅本任务驱动与这个残留应用后，另起驱动、确认 `ready:true, No sessions`，仅补跑未执行的表格套件，仍在 `POST /session` 20 秒超时，未执行断言；停止继续重试并保留阻塞。本阶段实际共 32 个原生场景通过，不能称为 39 个全通过。驱动／应用生命周期延迟的根因仍未确定，不能据此宣称“产品无问题”或已精确定位环境故障。

收到 12:09 UTC 控制面环境断开通知后，12:11:56 UTC 的真实命令仍返回 `/workspace/milkup`、HEAD `b4266d6ac6052883f94c06dab9082e492aef4ca3` 和全部未提交变更。已保存 `/workspace/milkup/.tmp/phase9-disconnect-checkpoint-20261013T121157Z/`：52 个源码／证据文件、tracked patch、验证材料归档和 SHA-256 清单。之前的恢复点为 `/workspace/milkup/.tmp/phase9-checkpoint-20261013T115450Z/`。没有根据状态标签假定恢复、重置工作树或重新检出旧版本。完整运行材料位于 `/tmp/milkup-v2-phase9/`。

### 仓库证据

- 失败：[搜索焦点](./evidence/v2-phase9-red-browser-verified.log)、[Unicode 偏移](./evidence/v2-phase9-red-unicode.log)、[原 HEAD 大纲／正则探针](./evidence/v2-phase9-red-outline-and-regex.json)、[Home/End](./evidence/v2-phase9-red-home-end.json)、[插件启动竞态](./evidence/v2-phase9-red-plugin-startup.log)、[单次驱动超时](./evidence/v2-phase9-native-driver-timeout.log)。
- 验证：[全仓 JS](./evidence/v2-phase9-unit.log)、[大纲测试](./evidence/v2-phase9-outline-tests.log)、[完整浏览器运行](./evidence/v2-phase9-browser-before-fixture-fix.log)、[表格定点复验](./evidence/v2-phase9-browser-table-rerun.log)、[Rust](./evidence/v2-phase9-rust.log)、[最终原生逐请求记录](./evidence/v2-phase9-native-confirmed.log)、[导航结果](./evidence/v2-phase9-results.json)。
- 回归与构建：[原生安全前 11 组及重开超时](./evidence/v2-phase9-native-final-quality.log)、[放弃关闭补验](./evidence/v2-phase9-native-quality-discard-results.json)、[Unicode](./evidence/v2-phase9-native-fresh-unicode-results.json)、[列表／代码块](./evidence/v2-phase9-native-fresh-blocks-results.json)、[类型](./evidence/v2-phase9-types.log)、[构建](./evidence/v2-phase9-build.log)、[格式](./evidence/v2-phase9-lint.log)、[表格隔离启动失败](./evidence/v2-phase9-native-isolated-tables.log)、[驱动生命周期状态](./evidence/v2-phase9-driver-lifecycle.json)。
- 截图：[窄窗搜索](./evidence/v2-phase9-native-narrow-search-live.png)、[窄窗源码](./evidence/v2-phase9-native-narrow-source.png)、[大纲层级](./evidence/v2-phase9-native-outline-hierarchy.png)、[窗口化搜索](./evidence/v2-phase9-native-windowed-search.png)、[窗口化大纲](./evidence/v2-phase9-native-windowed-outline.png)。

执行入口：`pnpm -r --workspace-concurrency=1 test`、`pnpm test:outline`、`MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:e2e --workers=2`；本阶段原生入口 `TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:navigation`。原生脚本启动前使用环境 env.sh、运行 Vite 1420 和 tauri-driver；Playwright 运行前停止人工 Vite，由测试自行启动。

## 剩余必办与验收边界

1. **先解决当前 Tauri/WebKit 会话启动阻塞并补验七组原生表格回归**。之后继续 live 表格方向键跨单元格、隐藏分隔符和复杂选区语义；窗口化表格语义仍须单独实现和验收。
2. SourceDocumentView 窗口化列表／代码块语义、原生大文件替换事务与撤销；不能把普通视图结果外推。
3. 真实中文系统 IME、Windows／macOS 快捷键／剪贴板／文件占用语义。当前环境无 ibus/fcitx，中文候选、组合取消、标点及跨平台 IME **未验收**。
4. 原生系统文件选择器仍受 GTK/proot 限制；测试路径通过既有 seam 指定，后续操作使用真实磁盘。
5. 第六阶段输入／滚动 200／500 ms 目标与帧尾延迟尚未全面达标；本次 Unicode 回归附带的页渲染加两帧样本，source 约 549–2969 ms、live 约 260–793 ms，仅为当前环境样本，不是完整基准；本阶段不宣称完整性能基准通过。超大文档搜索仍须全扫描才确认最终完整性，大纲保持有界区域扫描／分页。
6. 历史反馈 [#243](https://github.com/Auto-Plugin/milkup/issues/243) 在本阶段检查 source/live 多次切换的实际样式，不只检查字符串；仅覆盖当前 Linux WebKit／Chromium fixture。历史 [#232](https://github.com/Auto-Plugin/milkup/issues/232) 最小窗策略、[#240](https://github.com/Auto-Plugin/milkup/issues/240) 高分辨率全 UI 可读性仍待更广泛验收。
7. [#252](https://github.com/Auto-Plugin/milkup/issues/252) Win11／Word2016 表格粘贴；已关闭 [#258](https://github.com/Auto-Plugin/milkup/issues/258) outgoing 非表格富文本与关键样式；[#241](https://github.com/Auto-Plugin/milkup/issues/241) Word H1–H6 样式／大纲级别，继续保留第八阶段约束。

历史 issue 是验收来源，不等于当前 v2 自动复现；本阶段没有发布产品，也不以通过测试数量宣称达到 Typora 整体质量。
