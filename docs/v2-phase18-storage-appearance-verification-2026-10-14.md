# 第十八阶段：恢复存储保护与原生外观

从本地及远端已核验的 `ae42dc41821309964f7df29dcb9193337ec08af1` 接续，初始工作树干净，专用分支保持 `dot/milkup-v2-quality`。本阶段开始于 2026-10-13，验收跨至 2026-10-14 UTC；没有回退到环境默认旧 SHA，也没有重复建立工作树。实现合同见[阶段设计](./v2-phase18-design-2026-10-13.md)。不强推、不合并远端 v2、不发布应用。

## 恢复存储的行为与边界

恢复目录采用 **2 GiB 新写入准入上限、64 MiB 空闲余量、单份 256 MiB 上限**。计入已归档记录、上一代快照、未知未完成文件和目录内副本；扫描最多 20,000 个条目、8 层子目录，链接或特殊文件使统计明确失败。锁采用跨进程非阻塞文件锁，正在使用时明确报错并允许稍后重试，不无限等待。新快照完整提交后才轮换既定的旧代次，不为腾空间删除唯一恢复点或未知数据。

预算覆盖新快照与元数据写入峰值；UTF-16 按 BOM 和实际编码长度预算。内部恢复副本还预留后续打开所需工作文件的保守空间。这里是应用操作的准入保护，**不是文件系统硬配额**：外部程序以及活动工作文件的后续增长仍可能改变占用。归档不释放容量；记录分页、用户安全清理 UI 和长期保留策略仍需完成。

写入失败显示持续警告、最后完成的恢复版本、重试和存储详情。失败不会阻止原文件手动保存。恢复失败保留对话框和记录；目录超限时可选外部新路径导出，原生端验证长度及 SHA-256，独占创建目标，拒绝覆盖已有文件，不自动归档或删除原记录。每次导出先清除旧结果，碰撞给出可操作的中文提示。

生产故障用本阶段独立 profile 与真实文件系统完成：测试自己创建逻辑长度 2 GiB 的稀疏占位文件触发配额；`chmod 0500` 触发真实写入权限失败，恢复权限后点击重试。检查原始文件、已发布清单和恢复正文，确认拒绝写入期间没有覆盖或删除唯一副本。稀疏文件不是物理磁盘满；只有测试自己创建的全零占位文件被移除。

物理磁盘满的完整原生故障验收仍未关闭。当前工作盘约 27 GiB 可用，旧 `/tmp` 挂载仅约 774 MiB；证据与大夹具放在 `/workspace/.milkup-v2-phase18`。独立用户／挂载命名空间创建被只读 `/proc/self/uid_map` 阻止，未降低安全设置，也未填满共享盘。Rust 使用内核 `/dev/full` 得到真实 ENOSPC，验证写失败保留旧清单；这不等于整个生产文件系统的磁盘满、rename/fsync 失败或断电矩阵。

## 暗色、原生缩放与窄窗

菜单新增浅色／暗色／跟随系统与 100/125/150/200% 界面缩放，保留已确认设置。原生调用 WebView `setZoom`，覆盖正文、菜单、搜索和对话框；不是 CSS 放大。仅为主窗口增加主题和 WebView 缩放两项权限，没有改变安全开关。应用失败不虚报比例；浏览器预览明确禁用原生缩放入口。

真实生产页面在 1100×760、760×520 物理窗口下分别检查浅色／暗色三档缩放：例如 200% 最小窗口得到 380×260 CSS viewport、DPR 2、CSS zoom 1。150% 下 1100 / 1.5 为 733⅓，WebKit 的 `innerWidth` 与 `scrollWidth` 可相差一个取整像素，布局断言仅容许这一个 CSS 像素，不把真实溢出忽略。暗色正文、代码、表格、搜索、菜单、侧栏与错误采用统一颜色变量。浏览器检查跟随系统逻辑和六组主要文字／背景对比度达到 4.5；原生显式浅色／暗色已验，系统设置的跨平台动态切换未据此关闭，也不宣称整套无障碍认证。

窄窗侧栏改为覆盖层，打开时背景编辑区域 inert，关闭或选中大纲后返回正文；搜索打开时收起侧栏，正文不再被挤成狭列。小高度菜单分类压为一行，设置正文滚动，全部入口保留。搜索和替换控件换行，确认框及恢复列表可滚动。

原生验收通过真实 XTest 按键／点击、生产 DOM 观察和磁盘字节比较；文件选择测试仍只代入既有路径选择 seam，不算操作系统文件对话框验收。200% 的鼠标点击精确落在中文／emoji 后的预期 UTF-16 位置，普通及窗口化文档编辑、保存与撤销恢复完整字节；主题与比例经过真实进程重启验证。截图只支持可见布局结论，不代替输入法或字节证据。

## 测试发现与修复

- 普通 `EditorView` 原先忽略 Ctrl/Meta+Home/End，窗口化视图已有对应逻辑。生产复现中搜索选区未离开，随后输入替换了命中。补齐文档首尾跳转、Shift 方向扩选，不改文本或历史；source/live 单元与原生编辑闭环覆盖。
- 200% 最小窗口菜单原为两行导航，挤占设置内容；依据生产截图改成短窗口单行导航，保留滚动与键盘入口。
- 恢复导出失败原可与上次成功信息并存；现在新尝试清除旧信息，错误滚动到可见区域，并对既有文件给出明确拒绝覆盖说明。
- 外观脚本的首次失败分别来自分数像素取整、错误搜索容器选择器、原生 select 忙碌时发送下一按键、上述真实 Ctrl+Home 缺失，以及把保留 CRLF 的文档位置误按 LF 计算。每次保留失败记录、定位原因后修改；没有增加交互超时。最后一项实际鼠标位置是正确的 18，旧测试预期错误。后续下拉框补验发现脚本 `[data-appearance-zoom]` 同时匹配诊断属性所在的根节点，错误聚焦了 DIV；隔离观察和真实 Tab 证明控件可达，测试改为限定 `select` 后复验。
- 新窄窗策略会保留侧栏收起状态。旧原生导航脚本直接聚焦隐藏大纲项，再把 Return 发给正文，导致验收失败。脚本现在先通过真实侧栏入口展开，并断言目标确实取得焦点后才按 Return；不把隐藏 DOM 存在当作可操作。

## 检查与证据

全仓 JS/TS **829** 项、补充大纲／原生工具 **9** 项、Rust **69** 项（另 1 个性能基准默认忽略）、Chromium **65** 项通过。类型、工作区构建、格式与本地生产构建独立检查。原生外观 **18** 项、恢复配额／权限／导出 **7** 项、既有六套编辑回归 **49** 项、生产表格 **7** 项、Unicode 搜索 **8** 项、完整 100 MiB 搜索替换 **14** 项通过。测试数量仅用于核对证据，不等于 Typora 级质量达标。

恢复重启复验覆盖未命名、已有文件、窗口化大文件和 UTF-16；归档、重复重启及校验损坏保留数据路径通过。100 MiB 保存中断观察到真实临时文件写入 1,703,948 字节后终止；替换准备中断观察到真实 `before.utf8` 创建、长度 0 后终止。两者原文件 SHA-256 保持 `d9b2dd396a2624d9563c3bfc43e69a3c1e7c1dd4b1f0239f28bc5a8bafcbf6e1`，恢复副本均与预期 `4e64f5c50ea958c98658c01aef9f7344c031f8e734192c47df374e011d550b99` 一致。没有宣称覆盖所有 rename/fsync 时刻，或者已提交替换的中断。所有终止均核验二进制、启动夹具、PID 与出生时间。

生产窗口的 50 条出现时序记录为 1.032–1.553 秒（仅窗口出现，不等于大文件全文加载或搜索完毕），WebDriver 在本阶段可用；没有增加启动／交互超时。截图曾出现 X11 合成画面落后于 DOM 的情况，因此恢复窄窗补验同时记录消息矩形、WebView 截图和系统截图；最终配额、导出成功和碰撞消息均在对话框可见区域内。旧滞后截图保留但不独立用于视觉通过结论。测试结束后逐份校验本阶段保留的 69 份已发布恢复正文，均与清单的长度和 SHA-256 相符；没有执行恢复数据清扫。

本地生产二进制 SHA-256 为 `91742ecc2863e2faba6b8bce8a4fe77d5a28fa4cda9f54f99187494f52efbc67`，构建参数为 `--no-bundle`，没有发布或安装包交付。仓库旧 hook 仍引用缺失的 `scripts/verify-commit.js`；独立检查后以单次 `SKIP_SIMPLE_GIT_HOOKS=1` 提交，不修改 hook。

主要证据：[外观最终矩阵](./evidence/v2-phase18/regression-appearance-controls-attempt3/results.json)、[原生视口](./evidence/v2-phase18/regression-appearance-controls-attempt3/metrics.json)、[鼠标位置](./evidence/v2-phase18/regression-appearance-controls-attempt3/pointer.json)、[存储与可见性最终矩阵](./evidence/v2-phase18/regression-recovery-storage-visibility/results.json)、[保存中断](./evidence/v2-phase18/regression-save-interrupt/results.json)、[替换准备中断](./evidence/v2-phase18/regression-replace-interrupt/results.json)、[保留正文核验](./evidence/v2-phase18/recovery-disk-audit.json)、[全部原生运行记录](./evidence/v2-phase18/native-checks.json)、[全仓检查](./evidence/v2-phase18/checks.json)、[构建清单](./evidence/v2-phase18/production-build-manifest.json)、[证据哈希清单](./evidence/v2-phase18/manifest.json)。

代表截图：[暗色正文](./evidence/v2-phase18/regression-appearance-controls-attempt3/dark-1.25-wide.png)、[200% 最小窗口缩放设置](./evidence/v2-phase18/regression-appearance-controls-attempt3/dark-200-zoom-select-focused.png)、[表格工具栏](./evidence/v2-phase18/regression-appearance-controls-attempt3/dark-200-table-tools.png)、[未保存保护](./evidence/v2-phase18/regression-appearance-controls-attempt3/dark-200-unsaved-confirmation.png)、[恢复配额失败](./evidence/v2-phase18/regression-recovery-storage-visibility/recovery-quota-details.png)、[导出碰撞](./evidence/v2-phase18/regression-recovery-storage-visibility/export-conflict.png)。原始日志和 PNG 保持字节不变；结构化 JSON 仅格式化，值与外部原始证据逐项比对，原始字节摘要另见 `raw-source-manifest.json`。

## 距离 Typora 级质量仍需完成

1. 稳定真实中文 IME 会话，普通／窗口化 × source/live 的预编辑、候选、取消、失焦、替换、撤销与保存重开。既有 IBus 安装事实、Unicode key actions、剪贴板和合成事件不算通过；本轮没有重复安装或虚报验收。最小外部矩阵沿用[第十六阶段](./v2-phase16-visual-keyboard-verification-2026-10-13.md)。
2. 当前分支 Windows/macOS 原生编辑、保存冲突、恢复、文件对话框、系统主题／DPI与输入法；Word 2016 互操作仍未验。历史旧分支报告不可替代。
3. 恢复的完整物理磁盘满、断电、原子提交各窗口与跨平台锁行为；长期保留／迁移／分页／用户安全清理；大文件检查点持锁期间连续输入排队与尾延迟。
4. 同一 100 MiB 完整夹具的 200/500 ms 搜索和跳转性能矩阵，尤其 live 暖跳转 200 ms；不以缩小夹具、放大超时或功能完成宣称性能通过。
5. 复杂 Markdown 表格、极长行、屏幕阅读器文本／选区模型、不同操作系统下主题和缩放的进一步体验验收。本阶段闭合的是当前 Linux 支持范围内的基础外观与缩放，不是完整 Typora 替代声明。

第十四阶段未知 WebKitWebDriver allocator 故障仍是未归因调查；没有新证据把它升级为用户可见产品 P0。最小下一步保持驱动／WebKit 退出与回溯记录、独立最小页面对照。
