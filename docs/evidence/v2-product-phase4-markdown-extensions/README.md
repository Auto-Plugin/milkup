# P4 Markdown 扩展证据索引

主报告：[公式、图表与脚注](../../v2-product-phase4-markdown-extensions-2026-10-15.md)。

此目录保存选取的原始日志、证明清单及实际截图；完整工作目录为 `/workspace/milkup-markdown-extensions-phase4-evidence`。大型本地 `.deb`、解包二进制、外部插件工作副本与全部原生截图不提交到 Git。未上传 GitHub artifact、未构建 Windows/Runtime。

当前检查点**尚未验收**：候选 04 原生 run02 失败，矩阵完成数为 0。`native/deadline-diagnosis-candidate04.json` 保留 Worker 超时、主线程停顿与窗口请求循环；`candidate04-gates.json` 区分已通过的检查与阻断项。

## 证据含义

- `candidate01-source-manifest.json`、`native/candidate01-provenance.json` 对应第一生产候选，不能作为后续修复的验收证明。
- `candidate02-source-manifest.json` 对应 CRLF 公式与可见选区锚点修复后的源码冻结。最终生产包、原生矩阵与截图清单需以主报告指定的最终候选为准。
- `external-compat/verification.json` 为最新十插件仓库外构建、测试、源码/资源字节与公开 SDK 安装核验；旧 `verification-candidate01.json` 保留第一候选包记录。外部插件包和预装构建使用各自记录的构建工具，SHA 不要求相同；生产验收另通过真实安装入口验证外部包。
- `view/46-visible-selection-before.log` 是异步块增高导致可见选区移位的修前失败；`view/50-anchor-integrated.log`、`view/52-anchor-browser.log` 是修后视图与浏览器验证。原生修后结论必须另看最终矩阵。
- `math/crlf-range-before-valid.log` 与 `math/crlf-range-after.log` 是公式范围差一个 CR 的红绿回归。`footnotes/native-crlf-context-review/proof-before.json` 与 `proof.json` 使用实际原生夹具核验上下文、插件输出和核心校验。

- `view/55-selection-collapse-before-final.log` 为方向键折叠选区的 4 项真实失败；`view/57-collapse-after.log` 为修后 225 项相关测试通过。它们晚于候选 02，不能作为该旧包通过的证据。

- `browser-comparison/early-integration-three-extensions-live.png` 是本轮早期集成连线路由问题的截图，**不是基线提交截图**；`candidate03-three-extensions-live.png` 为候选 03 的 Linux Chromium 截图。窗口按钮外观属于测试夹具，不能称为 Windows 原生验收。

- `view/69-focus-before.log` 的两个失败是共享预览 graph/reference 刷新丢焦点；`72-focus-view-before.log` 的 windowed case 和 `79-focus-ordinary-before-final.log` 的 ordinary case 是真实视图 DOM 替换丢焦点。`81-focus-integrated-final.log` 为修后 229 项相关测试通过，原生修后结论需看下一候选。

## 保留的失败与环境记录

- `math/crlf-range-before.log` 是错误测试入口引发的未发布 SDK npm 404，**不是产品修前失败**。随后直接调用已安装 Vitest 得到 `crlf-range-before-valid.log` 的真实失败。
- `rust-tests.log` 在 proot 下有四项文件系统/符号链接相关失败；同一编译测试二进制在配置好 sysroot 动态库路径后直接运行，`rust-tests-direct.log` 为 118 通过、1 忽略。没有为通过测试修改 Rust 代码。
- `native/run-candidate01-run01` 的图表执行超时属于真实首轮失败。后续两次原生诊断响应正常，记录于 `native/rpc-diagnosis-candidate01*.json`；这不等于已经确定或修复原始超时原因。
- `native/run-candidate01-diagnostic04` 和 `diagnostic05` 的截图证明真实搜索目标被异步布局移出视口；它们均为修前诊断，不计入最终验收数量。
- `native/run-candidate03-run01` 在插件列表保留滚动位置后，严格点击检查拒绝了离屏图表卡片；这是安装脚本未先揭示列表项。修正仅限列表卡片公开 focus 后真实 pointer，正文预览断言未变。`candidate03-harness-revision.json` 区分生产冻结与这次测试脚本修正，各后续运行另记录 harness/helper SHA。
- `native/run-candidate02-run01` 在脚注跳转后的方向键选区折叠处失败；`run-candidate02-keys02/keys.json` 记录真实系统按键。
- `native/environment-recovery-2026-10-15.json` 记录执行环境断连和恢复；`source01` 中断未出诊断结果。`run-candidate02-source02` 则是真实关闭搜索后的滚动偏移，导致预览中心落在标题栏下，与环境断连分别记录。
- 焦点测试的 `72` ordinary case 及 `74`、`77`、`78` 日志含错误测试配置；`75` 含临时诊断包装的 JavaScript ASI 错误，均不计产品失败。合法 ordinary 夹具的真实修前失败另见 `79`，临时修改已恢复。
- `view/65-restore-browser.log` 的最后一项失败是测试使用 CRLF 归一化前偏移定位了不存在的节点；改为实际 MathML 节点定位后，`68-restore-browser-final.log` 的五项通过。严格源码完整可见断言保留，未放宽产品要求。
- `full-format-candidate-final-2.log`、后续带 `-2` 的格式日志表示修正证据/报告排版后重新检查；格式修正不替代产品测试。

JSON/Markdown 证明副本可按仓库格式化；原始日志和截图保持字节不变。`evidence-copy.json` 记录原文件与存储副本的 SHA，便于区分内容证明和格式变化。
