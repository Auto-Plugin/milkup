# Linux 图表调查：可公开核查的证据

本目录保存自建测试文档、实际图片和结果摘要。目录名表示 beta.7 调查工作；下表中的原生产品证据仍是冻结的 **beta.6**，没有混入正在运行的 beta.7 测试。所有操作都在隔离测试数据上进行，没有用户私人文档。

## 结论与范围

| 证据                                                                           | 实际结果              | 能证明什么                                                                                                 |
| ------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| [官方完整引擎独立原型](official/README.md)                                     | 50/50 实际 PNG 出图   | 固定 Mermaid 12.2.0 的 37 个内置 registration ID 最小样例和 13 个选定变体；不是 Milkup 集成或 Windows 验证 |
| [原版 DOM 初次运行](native/run-default-dom/result.json)                        | 2 步通过，第 3 步失败 | 缺少正常 D-Bus 会话的测试启动环境中，DOM 激活超时                                                          |
| [诊断 DOM、无 D-Bus](native/run-default-dom-diagnostic01/result.json)          | 2 步通过，第 3 步失败 | 同一失败保留有界阶段计时，10 秒激活期限未改变                                                              |
| [诊断 DOM、正常 D-Bus](native/run-default-dom-diagnostic02-dbus/result.json)   | 41/41                 | 普通/窗口化 flowchart、sequence，Source/Live、块内光标、编辑/撤销、启停和错误诊断                          |
| [未加诊断原版、正常 D-Bus](native/run-default-dom-production-dbus/result.json) | 3/3                   | 仅普通 flowchart 的启用、实际正文显示和保存；没有重跑完整 41 步                                            |
| [确切交付 Worker 1.2.0](native/run-delivered-worker/result.json)               | 42/42                 | Linux 内卸载 DOM 后导入交付 Worker，验证上述有限图类生命周期；不是升级或 Windows 执行                      |
| [升级 harness 首次失败](native/run-pending-upgrade-harness-failure.json)       | 0 步产品导入          | 测试脚本 `scope` 未定义导致报告写入失败，随后精确清理自身测试进程；不是产品升级结果                        |
| [保留失败 pending 后直接导入](native/run-pending-upgrade02/result.json)        | 1 步通过，第 2 步失败 | 不卸载、不编辑 catalog，UI 导入被 `resolve existing candidate/startup first` 拒绝；原候选保留              |

官方原型 50 例不是全部语法组合、可选外部适配器或未来版本语法的保证。它没有进入发布包，也不证明实际 Milkup 中全部官方图类已集成。原生生命周期只覆盖 flowchart、sequence 与明确的错误样例。这里没有 Windows GUI、安装/升级、系统 DPI 或 IME 验证。

## 可直接看的像素

- [未加诊断原版：正文真实 DOM flowchart](native/run-default-dom-production-dbus/03-ordinary-flowchart-enable-and-return-real-render-system.png)
- [交付 Worker：普通 flowchart](native/run-delivered-worker/04-ordinary-flowchart-enable-and-return-real-render-system.png)
- [交付 Worker：窗口化 sequence](native/run-delivered-worker/33-windowed-sequence-enable-and-return-real-render-system.png)
- [初始 DOM 激活失败](native/run-default-dom/03-ordinary-flowchart-enable-and-return-real-render-failure-system.png)
- [保留失败候选后的直接导入失败](native/run-pending-upgrade02/02-ui-import-delivered-worker-without-removal-failure-system.png)
- [官方原型 50 张 PNG 与对应样例](official/README.md)

七张原生截图均实际查看过，内容为自建样例或插件诊断。它们是选定步骤的系统截图，保留当时窗口和显示区，未裁剪或修图。完整步骤计数来自报告，不能把七张截图说成全部步骤的逐张像素验收。图像解码和非空像素也不等于视觉质量达标；官方原型宽图标签约 6 CSS 像素的阅读缺陷明确保留在其说明中。

## 失败与修正说明

1. 原版默认 DOM 激活失败后，加入仅两文件的[阶段诊断补丁](native/diagnostic.patch)。没有延长 10 秒/2 秒门禁，也没有改变隔离或可访问性设置。
2. 同一诊断二进制的 [A/B 计时](native/diagnostics-ab-summary.json) 显示，无 D-Bus 时 GTK/WebKit 多段启动约各耗费 3 秒；正常临时 D-Bus 会话下激活约 1.44 秒、首个结果约 2.19 秒。成功运行仍有 inspector 绑定警告，因此不能把该警告认定为必然失败原因。此结论是测试启动环境修正，不是产品安全门禁修复。
3. 41 步运行期间，磁盘上的 harness 被加入 scope 参数；原报告的 persist 当时重新读取了磁盘哈希，误记为执行源码哈希。[独立来源修正记录](native/harness-provenance-correction.json) 保留原报告哈希与实际加载源码哈希。原报告没有覆盖修改。后续 harness 改为启动时捕获源码。
4. 随后用未加诊断的冻结原版二进制完成独立 3 步激活/保存确认。A/B 与来源修正是较早记录，其中“原版确认尚待执行”反映当时状态；不回写历史记录假装同时完成。
5. Worker 42 步先卸载再导入，不能替代真实升级。另行复制保留失败 DOM pending 的临时 profile，直接 UI 导入后得到明确失败。此目录不包含修复后的新 beta.7 升级结果，也不声称旧 active DOM 或旧 active Worker 升级已验收。

原版二进制 SHA256：`f9f07885dd78d1252508ca9dd077b63dc9cf012440b6552f4cb8862aa4d15971`。诊断二进制 SHA256：`ba0556087d63a380b0f1eb52fa79efc918814e8a1786a5a7a350ef043f230230`。[原版构建摘要](native/candidate-build-proof.json) 与[诊断构建摘要](native/diagnostic01-build-proof.json) 分别记录来源和输入漂移边界。此处没有附带可执行文件。

## 内容最小化与追溯

- `official/` 中选定原始结果、PNG 和 50 个自建样例逐字节复制；具体来源与哈希见 [official/provenance.json](official/provenance.json)。没有把它们称为净化后的原件。
- `native/` JSON 是明确标记的派生摘要：保留步骤结果、二进制/原报告/样例哈希、选定 UI 测量、Diagrams 状态和保存哈希；不复制 profile 内容、进程与驱动环境、进程标识、运行锁、DOM 全文、blob 地址、catalog 完整数据或堆栈。两份 `timing-events.json` 是原日志中首次激活的字段投影，仅保留 phase 和 monotonicNs。
- 原生小样例逐字节复制；较大的窗口化样例使用 `mtime=0` 的无损 gzip。`native/fixtures/manifest.json` 同时记录存储字节和解压后字节的哈希。图片没有改动。
- [native/provenance.json](native/provenance.json) 记录每份来源原文件哈希、公开目标哈希与实际变换规则。记录中的 `/tmp/` 是本次自建测试路径，不是用户文件路径。
- 原始完整报告、日志和 profile 仍仅在本地。排除账户/机器配置（含合成 passwd/group 和 machine-id）、锁 token、环境文件、进程采样、缓存、浏览器/引擎及其他可执行物。排除运行材料不意味着删除原始失败证据。

敏感模式检查和来源核对未发现凭据或私人文档；不是对任意未知数据的绝对检测保证。本集合供核查结果与哈希，不包含完整执行环境，不承诺跨环境逐像素确定性复现。

在本目录运行 `python3 verify.py` 可核验完整文件清单、哈希、PNG 结构、样例字节及报告计数。验证只读取本目录，不启动产品、浏览器或安装器。
