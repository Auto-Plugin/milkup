# P6 Linux 插件生命周期：原生 UI 验收计划

基线：`1388f646`。本记录来自只读源码检查；未启动 UI、安装插件、运行构建或改变产品。`df -m /workspace` 本次实测仅余 **298 MiB**。所有下列结果均为待验，不是已通过。

## 入口与复用边界

| 现有文件／函数 | 可直接复用的能力 | 注意事项 |
| --- | --- | --- |
| `tests/helpers/native-production.mjs`：`startProduction` 返回 `until/probe/focus/key/shot/close` | 冻结生产应用、WebDriver ready、真实 XTest 按键、只读 DOM／文档版本观察 | 不用 Vite／私有 IPC。Unicode 不用 `app.text` 的非 BMP key-action 路径；曾发生 emoji 重复 |
| `tests/helpers/native-updates-fixture.mjs`：`nativeFixture` 返回 `list/details/menu/closeMenu/picker/ready/exists/windowId`；`action`、`x` | 正常 GTK 选择器、列表／详情返回、插件动作选择器 | 安装成功自动进入详情；等待 registry 的 id/version/sourcePath，不等列表的 details 按钮。`ready` 仅检查 rect 存在，需补 viewport/clip/真实命中检查 |
| 同文件 `writeLogoFixture` | 小 PNG、带图标的普通独立测试包 | 不必另引图片库；损坏 PNG 用小 fixture 验证 fallback，不拉远程图片 |
| `tests/helpers/native-clipboard.mjs`：`ownNativeClipboard` | 真实 X11 文本剪贴板＋Ctrl+V，返回释放自有 owner 的函数 | 用 `try/finally`，等待 paste 完成；不注入 ClipboardEvent、编辑器状态或合成 input |
| `tests/helpers/native-owned-process.mjs`：`ownedApplication` | 二进制、启动文档、PID/birth 对应的应用身份 | 只读身份优先；若专项获准停止，只作用本 run 同 birth，不按名称扫杀 |
| `tests/native/tauri-dom-plugin-lifecycle.mjs`：`installAndEnable/startMonitor/startBusy/inputAndSave/cleanupObserved`，`processObserver`＋`native-dom-process-observer.py` | 正常安装 DOM fixture、挂起／disable／remove、原生 helper/guardian/WebKit 后代取证 | 这些是现有脚本内部函数，不能直接 import 脚本顶层以免启动 UI；复用小段流程或抽取经审阅 helper。render timeout 不等于 activate timeout；新 P6 两者分别验 |
| `tests/native/tauri-all-plugins-disabled.mjs`：`assertAllInactive/auditDetails/openThroughPicker/closeNormally` | 全安装身份保持、enabled 全 false、贡献 UI/命令消失、重启不复活 | 未审批且 inactive 的失败项保留，不额外批准 updater 只为制造 state=disabled |
| `tests/native/tauri-plugin-architecture.mjs`：`mode`、完整磁盘比较 | 原生 windowed source/live、光标选区、Unicode／CRLF 全文保存 | 旧脚本依赖历史 profile；P6 使用新 profile，借其断言而非直接跑完整旧任务 |
| `tests/native/tauri-appearance.mjs`：`theme/zoom/saved`；P5 新脚本 `click/observe/disableAll` 的模式 | 产品主题、Ctrl+0/Ctrl+plus 原生缩放，真实点击与保存 | 主题入口以新产品实际 DOM 为准；CSS scale 不能替代原生 zoom |
| `tests/native/tauri-plugin-system.mjs`：`menu/picker/temporary/record` | outline 管理／索引、临时存储 readonly 观察、常规关闭 | 含陈旧“仅 1 个预装插件”断言、超大 fixture 与全进程 ps；不整段照搬，不把全局 RSS 算成本 run |

不用于原生验收：`tests/helpers/outline-fixture.mjs::outlineRegistry` 会导入仓库 SDK 源码并注入 development registry，只适合快速浏览器测试。`checkPluginVisualCombination` 的多 MB／180,000 行组合先不整套运行，以免扩张 P6 范围和磁盘占用。

## 官方 outline 独立包基线

当前 `plugins/outline/plugin.json` 与 `package.json` 版本均为 **1.3.1**；Worker，唯一权限 `document:read`，SDK engine `>=0.2.0 <0.4.0`，开发依赖声明 SDK `0.2.0`。`scripts/build.mjs` 只接受插件 `src/` 和公开 SDK 包输入，拒绝残留 runtime imports，产物名由 manifest 动态生成，故当前应为 `milkup.outline-1.3.1.milkup-plugin`。

README 的 SDK `0.1.1`、包 `1.2.0` 示例已过时；`docs/evidence/v2-full-outline/standalone-final.json` 也是旧 1.1.0 的历史证据，不能当当前 1.3.1 独立构建证明。当前计划不修正文档或构建。

后续仅在构建阶段获准且磁盘可容纳时：将必要源码、manifest、package/tsconfig、build 脚本复制到仓库外小目录；用已存在公开 SDK tarball 和本地缓存离线安装（若选兼容 0.3.5，记录精确 tgz SHA、实际依赖解析与 lock）；执行原 `tsc --noEmit`＋build；保存 meta、包 SHA／长度、无私有依赖证明。不可用 workspace 源码 alias 代替公开分发，也不下载新库。

真实产品安装：菜单→插件→安装本地插件→选择独立包→读取详情权限→批准／启用。若预装同 ID，记录已有版本并按本轮升级规则处理，不用直接改 registry。分别确认正常索引、点击标题不改变正文、disable/remove 后面板与命令撤销；与独立故障测试包分开。官方包的缺图标情况应显示清晰 fallback，不伪造“官方 logo”。

## 最小串行功能矩阵

每组使用独立 profile；组内升级／回退及重启沿用同一 profile。所有包具有预先审阅的 manifest、文件清单、SHA；危险行为仅针对本 run 自有 canary，不访问真实用户资料、不连接外网。故障包使用独立 `test.p6.*` 身份，不能伪装官方包。每次失败保留当前 evidence，下一次新 run。

| 组 | 真实 UI 步骤 | 必须证明的结果 |
| --- | --- | --- |
| A 正常安装与发现 | 官方 outline 独立包安装、详情、批准／启用、标题导航、正常关闭重开 | 实际安装路径/version/SHA 对应；文档不变；列表只呈现标题、logo、description，状态／权限／错误／版本／操作放在详情；安装自动详情与返回焦点正常 |
| B 损坏／恶意／不兼容 | 顺序选择截断 JSON、缺 main、路径逃逸／绝对路径或重复归档路径、非法贡献／危险图标、不满足 host/SDK engine 的小包 | 明确可读错误；错误归属正确；旧已装包/审批/正文及自有目录外 canary SHA 不变；不执行不兼容包；重新打开管理器与编辑保存正常。只拒绝安装不能证明完整恶意代码沙箱 |
| C 权限增量拒绝／同意 | 先装窄权限 v1；同 ID v2 新增一个受控敏感权限（例如 output，无外网/凭据）；检查 added/removed/unchanged 解释；先拒绝，再重新选择并同意 | 拒绝不越权、不偷偷激活 v2，旧版持续可用；同意只审批显示的版本/权限；版本、包字节、审批、启用状态一致。删除权限也检查审批不残留；Worker→DOM host 变化按独立新增信任处理 |
| D 升级与 rollback | 正常同权限升级；再选校验有效但 activate throws 的 v3；另一个 malformed 候选在 staging 前失败；通过 UI 使用可用的旧版恢复/rollback 操作 | 失败原因与恢复动作可见；旧有效包、审批和数据一致，恢复后实际命令/UI 可用；应用重启后仍一致。仅 registry 版本号回去不足，需磁盘包/入口 SHA 和行为证明。若无真实 rollback UI，记 P6 产品缺口，不后台覆盖 package 冒充 |
| E 启动 fail／hang | 独立 Worker activate throws、reject、永不 resolve、死循环各小 fixture；DOM activate failure/hang 独立至少一例 | 管理安全壳、编辑保存和禁用卸载仍可用；明确失败／超时；重复点击不重入；按当前宿主既有 deadline 计时，不延长／关闭隔离。DOM 渲染 2 秒、激活期限和 Worker 激活预算分别记录，不混用 |
| F disable/remove 与资源 | 稳定运行和工作进行中分别 disable；再 enable；随后 remove；正常重启 | 贡献 UI、命令、监听/定时任务观察效果、pending 回调/旧 capability 失效；DOM helper/guardian/WebKit 同 PID+birth 退出且窗口消失；Worker 无独立 OS PID，需已有生命周期证明/无后续贡献，不用进程列表假证；package、授权根、数据/临时 store 按产品明示保留策略核验，不删未授权用户数据；禁用/卸载不自动复活 |
| G 全插件停用 | 真实遍历所有已启用插件，含 outline、workspace、formatting、shortcuts、preferences 及本轮测试插件；source/live Unicode paste→undo→redo→save→undo→save；普通和约 320 KiB 原生 windowed 文档各一份；重启复查 | enabled 全 false，原已启用项 disabled，未审批 inactive 项原样保留；贡献 UI/命令均 0；观察实际 native windowed 分支；中文、é、👩🏽‍💻、引号及 CRLF 完整 bytes/SHA 恢复，保存后 clean；模式/光标/选区合理；禁用不影响主编辑路径 |

C/D 的“权限解释／批准事务／旧版继续可用／rollback UI”是 P6 目标，不是基线已具备。当前 `desktop-plugin-manager.ts::installManifestPath/reload/approve` 路径没有足够证据保证这些语义；旧 `tauri-plugin-system.mjs` 也没有对应完整原生矩阵。先让新回归实际失败，再由实现阶段修复；不得通过重写本地存储或直调私有 IPC 跳过缺口。

## 管理 UI 风险矩阵

先复用 A 的正常包、长中文名称/description 包和可见错误包。窗口 **1280×900 / 760×520**，主题 **light / dark**，原生缩放 **100/125/150/200%**：列表 16 格均真实访问，确认每项内容仅标题／logo／description、长文截断可理解、选中/键盘焦点清晰、图标失败有 fallback。不要将状态/错误技术细节塞回列表。

详情按风险加测 8 格：宽窗 100% 双主题；窄窗 200% 双主题；窄窗 125/150% 双主题。选择长权限增量、兼容错误、失败恢复三种详情覆盖这些格，真实到达最下方批准／拒绝／恢复／卸载操作；窄 200% 实际点击最边缘按钮/下拉箭头，Tab/Shift+Tab 到达，Escape 返回列表并恢复原项焦点。focus 后检查完整矩形在可用 viewport 内、祖先 clip、覆盖物和 elementFromPoint，不能只凭 1px 相交判可用；native select 命中不一致须用真实菜单打开确认，不靠 CSS 注入修图。

关键“拒绝权限”和“恢复旧版”各在窄 200% 真执行一次；其他故障无需乘 16 格。全部停用组先设定主题/缩放再停用 preferences，不为切主题临时重启插件；在 source/light/100 与 live/dark/200 覆盖真实 Unicode 操作即可，不扩成 64 个管理器格。

## 每组证据与裁决

记录：冻结 binary SHA／来源 commit+patch、harness/所有 helper SHA、包 SHA/manifest/版本、profile、DISPLAY、源文档 SHA/UTF16/行数；每个动作前后 `probe`、只读 registry（审批/状态/错误/版本/路径）、实际可见详情、单调时间、截图。插件存储与 package 只读清单/哈希前后比对，安装写入必须走 UI。安装失败只保留 install-error 也算真实结果，不能自动重试覆盖。

进程证据按本 run 应用 PID/birth 建根，扩展 DOM helper/guardian 后代时复核 birth；记录退出状态和 X11 窗口消失，zombie 仅说明不执行，不等于完整回收。不要复用 P5 `outputProcessEvidence` 证明 DOM 清理，它只追踪 output helper。outline 临时索引可只读既有 IndexedDB metadata；不要向不存在数据库发升级写入请求来“探测”。资源/监听不可见且无现有诊断时标未测，不凭 UI 消失认定全部释放。保留正常关闭与重启持久性；本矩阵不要求额外 App SIGKILL 压力实验。

报告分开：UI 操作通过、权限/包状态一致、资源释放通过、视觉可用、未验项。fixture恶意样本覆盖不是通用恶意代码沙箱保证；全部插件停用不是在修改 outline 实现。

## 298 MiB 可用空间约束

本轮仅写此文本计划。后续不能在该余量下无预算启动新 Cargo target、复制整仓、安装 Chromium/Runtime、下载依赖或保留全部 profile。建议串行即时度量：

| 新增项目 | 上限规划（非实测用量保证） |
| --- | ---: |
| 一个独立冻结 Linux binary | 24 MiB |
| outline 仓库外源码/离线工具目录（本机现有 outline node_modules 约 34 MiB） | 36 MiB |
| 同时一个活跃 profile、插件包与小测试 fixture | 40 MiB |
| 原始截图＋文本日志／JSON＋包档案 | 32 MiB |
| 合计 | **132 MiB** |

至少保留 **128 MiB** 未分配余量。298−132−128 仅约 38 MiB 机动，不能视为够编译的证明。若已有同 hash 的安全冻结二进制/独立 archive 可复用，仅记录来源，不复制；不得硬链接会再次覆盖构建的 target 二进制。单个组之前检查 `df`/本 run `du`，低于保留量暂停并报告，不自动删旧 P4/P5、他人 profile、缓存或失败证据。

只保存关键原始 PNG，不录视频/全页 PDF 栅格；先记录每张 bytes/SHA，不能为了预算覆盖失败截图。完成 profile 的最小持久证据导出并经负责者确认后，才按已有授权清理本任务自有且已停止的临时 profile；若没有清理授权或证据不完整，保留并暂停后续组。不要用 sparse 文件/超大归档做空间压力；超限校验尽量在组件测试验证，真实 UI 用小的明确非法结构复核错误呈现。
