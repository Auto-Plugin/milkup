# beta.7：Linux 最终候选交互证据与 IME 有限验证

原生候选源码：`cc2cfc1d44b937e56cfcbd6e8f3cdcf3ded10189`。二进制 SHA256：

```text
ca0b00526f756528e9513fa528f654c2b166455d81b24eb5a1351db9595c197b
```

本目录保存自建材料的精简证据，不是 Windows 安装包或系统输入法验收。原生 harness 独立核验二进制哈希和关于页版本；源提交来自冻结构建 proof，不能把它描述为 harness 独立证明可复现构建。[candidate.json](candidate.json) 记录 525 个构建输入、空 inputDrift 和来源哈希；工作树另有交付流程修改。

| 范围 | 实际结论 |
| --- | --- |
| 最终列表原生轮 green03 | 退出 0；12/12 功能步骤、64/64 命名保存阶段、另 2 次最终原字节回环。12 次任务光标几何检查实际均为左边 49、checkbox 右边 44。 |
| 最终外观原生轮 06 | 26/26 功能、16/16 宽窄/缩放/亮暗配置通过；末尾清理工具断言失败，**整轮退出 1**。后来只读核验全部 6 个所属进程已不存在，没有匹配新进程；没有把原轮改记成功。 |
| IME 预编辑浏览器组件 | 普通视图修前 6 个单测失败；最终该阶段 77 项目标测试、16 个 Chromium CDP 组合通过。初修虽过 DOM 断言但像素叠字，保留中间失败。 |
| IME 事件顺序后续 | 独立源码快照的 39 项合成事件/DOM 焦点测试通过，包含 8 项新增失焦顺序/提交/取消用例；没有重跑浏览器矩阵或真实系统 IME。 |

这些证据不重复旧 d73 的 32 步 failed-pending 恢复记录，也不计入官方 Mermaid 独立原型的 50 例。

## 列表与空任务光标

[最终逐阶段结果](list/run-list-green03.json) 覆盖普通和窗口化视图：逐键输入 `- [ ] `、checkbox 真正编辑 Markdown、撤销/重做、删除分隔符、`+`/`*` 规则、Source 字面量、代码块字面量。两份夹具含 CRLF、中文、emoji 与组合字符，最终文件逐字节回到原文。两个 session 分别打开普通/大文件，不是一次恢复重启验收。

- [修前：裸 `-` 误成圆点](list/screenshots/bare-marker-red.png)。red01 在第一阶段即失败，保存字节正确；后续步骤没有执行。
- [中间轮：空任务光标在框前](list/screenshots/empty-task-caret-old.png)。green02 虽 12/12，但漏掉相对位置断言；12 处旧几何为 29 < 44，不能作为最终通过。
- [最终：普通空任务光标在框后](list/screenshots/empty-task-caret-final.png)；[窗口化同路径](list/screenshots/empty-task-windowed-final.png)。最终 harness 谓词为 `caret.left >= checkbox.right - 1`，有 1 像素容差；本次实测 49 >= 44，无须依靠容差。
- [窗口化代码仍保留字面量](list/screenshots/windowed-code-literal-final.png)。Source 逐键验证依赖阶段记录；没有拿清空尾行后的截图替代逐键像素证明。

中间 green01 是 harness 对保存后焦点的预期错误：保存前应是 checkbox，保存后应回 editor。修正为分别检查前后焦点，不把它计作另一个产品缺陷。最终 64 个阶段是命名保存断言数量，不等于全部保存动作总数。窗口化系统截图下方只含该轮自建默认 CSS 查看窗口，未裁剪；普通图选用原始 WebView 截图避免无关背景。

## 外观、CSP 与完整失败历史

[修前 CSP 观测](appearance/csp-before.json) 显示动态主题/面板 style 无授权 nonce、无 stylesheet，布局没有生效；[修前界面](appearance/screenshots/csp-before-mode-timeout.png) 与[最终默认界面](appearance/screenshots/csp-after-default.png)可直接对照。归档不含实际 nonce 值，也不声称放宽了隔离策略。

[第 06 轮逐项记录](appearance/final-functional.json)覆盖亮/暗/系统模式及重启、标题栏拖动/菜单切换、带 Unicode 特殊字符路径导入、自建 CSS 的 Live/Source 编辑和历史、表格对齐、代码高亮/语言选择、正文图形标签与连接线、取消导入、拒绝 URL/`@import`、原 CSS 删除后保留导入副本、恢复默认与重开。图形只测试本夹具，不是完整 Mermaid 语法验收。harness 的“打开主题文件”断言本身只验证现有 OS 关联请求接受。此轮另由主执行者实际查看系统截图中的 Mousepad CSS 窗口，并只读核对处理器 argv 指向精确自建 default.css；随后按所属进程 birth 核验清理，CSS 前后哈希不变。这些独立窗口/进程证据与请求接受断言分别记录，不扩大为其他平台的编辑器验证。

- [浅色正文：表格、代码与图形](appearance/screenshots/imported-light-body.png)
- [暗色正文](appearance/screenshots/imported-dark-body.png) · [暗色主题预览](appearance/screenshots/imported-dark-preview.png)
- [760×520、200% 原生应用缩放的可滚动预览](appearance/screenshots/narrow-200-light-preview.png)

16 个配置为 760×520 / 1280×800 × 100/125/150/200% × light/dark；这是 Linux 应用缩放，不是操作系统 DPI。每张所选图已查看，原 PNG 未裁剪/重绘。

[历史轮次概览](appearance/prior-runs.json)保留：01 在观测响应被 helper 误判时中止、0 步；02 的真实 CSP/模式动作失败；03 的 14 步和 04 的 17 步之后 OCR 标签断言失败；05 的 19 步和 13 个配置后 `X_QueryTree BadWindow` 工具竞态失败。03/04 原图的 Start/End 与连接线已被实际查看；OCR 曾漏识别彩色标签或把暗图 End 识别成 ene。仅 OCR 做浅色 60% 阈值/暗色反相 40% 归一化，连接线仍查原 RGB 像素；[离线重放结果](appearance/ocr-offline-replay.json)是对旧截图的新检查，**没有回写旧原生轮为通过**。

第 06 轮功能结束后，清理程序在所属进程正在退出时读到空 argv，精确身份断言失败、整体退出 1。[随后只读记录](appearance/post-cleanup-readonly.json)核验 6 个原所属 PID 全部消失且无同 binary+fixture 新进程，未发送信号，原报告哈希不变。这是后续无遗留证明，不能代替原轮成功退出。另行[所属 OS CSS 查看器清理](appearance/os-css-handler-cleanup.json)对唯一自建 CSS 查看器发送 SIGTERM 并确认退出/僵尸状态，CSS 前后哈希不变；不能把这项动作混称“没有发送任何信号”。汇总范围另见 [acceptance-scope.json](acceptance-scope.json)。

## IME：保留像素失败与平台边界

[预编辑阶段记录](ime/preedit/RESULT.json)与[后续事件顺序记录](ime/event-order/RESULT.json)属于不同源码哈希，分别保留。普通视图之前只保存 composition 文本却没有绘制，而输入 textarea 本身透明；初次补画又与后文重叠。最终临时 overlay 使用最近不透明背景与行字体，不把预编辑内容写入文档或历史。

[修前不可见](ime/preedit/before-ordinary-paragraph-light.png) → [初修叠字，不能验收](ime/preedit/after-ordinary-paragraph-light.png) → [该浏览器阶段最终可读](ime/preedit/final-ordinary-paragraph-light.png)；另见[窗口化暗色代码](ime/preedit/final-windowed-code-dark.png)。16 组合包含普通/窗口化、Source/Live、正文/代码、亮/暗，检查输入节点/锚点稳定、提交一次、撤销/重做、缩短候选、取消。初修 16 个 DOM 断言全过仍保留像素失败，未以测试数字掩盖。

后续事件顺序测试另外发现窗口化提交后抢回外部焦点，并做有限修复。首轮测试声明位置错误、真实 24 过/2 败、最终 39 过的证据均保留。迟到 input 检查按浏览器“通知已发生 DOM 变更”的合同执行，不证明 compositionend 之后任意新的 DOM 再修改。浏览器阶段是 Chromium CDP、后续是 jsdom 合成事件，均非原生 Milkup 系统候选窗；**真实 Windows IME 未验**。半透明/渐变背景只保证最近不透明背景兜底可读，不承诺复原任意背景图。

## 来源与离线校验

[provenance.json](provenance.json)逐文件记录原始来源 SHA 与精简规则。自建 Markdown/CSS、选定 PNG 和 IME 小日志保持原字节；大列表夹具无损 gzip。外观的 good.css 原路径是测试主动删除项，因此仅取自该测试应用保存的、哈希完全一致的自建副本。未复制完整 profile、完整进程环境、运行锁、安装器或二进制。原始清理记录使用有限 PID/birth 核验进程归属；它们不是凭据，本目录的清理摘要仅保留计数、信号与核验结论，原始记录哈希仍可追溯。文本凭据模式检查无命中，所选像素已看。原始本地失败证据未修改。

```bash
python3 verify.py
```

仅检查保存材料的 SHA、PNG 结构、阶段计数与原字节，不运行应用，不把记录验证等同重跑或 Windows 验收。
