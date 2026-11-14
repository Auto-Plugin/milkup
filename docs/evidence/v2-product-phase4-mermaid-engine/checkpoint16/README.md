# Checkpoint16：生产生命周期与有界 corner PASS，完整 UI 未验收

本工作分支检查点保存六个已完成阶段：production07 构建/五个通用 DOM 生命周期、class 内滚动机制、Journey 两轮配对研究、corner smoke 首 RED及静态测试修订、最终8-corner smoke PASS。**不代表完整 UI/64组合验收；Journey zoom2 文本像素差异仍未闭环，历史失败均保留。** 正式 UI10 结果不在本检查点。

checkpoint06–15 原件与索引保持不变，按原 hash 复用相同对象。checkpoint15 提交为 `74c72c61a42a0d37fcd882005b44861dc11e588b`，远端/GitHub 身份记录随附。本目录只包含明确冻结清单，未完成研究和活动目录不在收集范围。外部 `checkpoint16-draft` 的逐批 metadata/support 文件不是本目录已归档对象；索引内原始证据可按 verifier 核验。

## 本批实际结果

严格按 `linux-production-07/completed-manifest.json` 的 494 项显式清单复制并核验原 SHA/大小，另保留清单自身、Root 生命周期和完整清单审阅、checkpoint15 远端记录。Linux deb 构建首轮 exit 0，五项 timeout / disable / remove / wm-close / app-sigkill 生命周期均首轮 PASS。它们是通用 DOM fixture 的生命周期验证，不代表官方 Mermaid class 滚动、Journey 像素或完整矩阵通过；旧 UI09 视觉门禁失败及历史 deadline 仍不因本批而关闭。

实际提取 binary SHA 为 `df7b509fefa335df89b004a9992d16cb3a712f062281f418518d3e59d96e5d72`；官方 diagrams archive 为 `9889f1796f9080ff230a1c51147522e83e065bc191a258035208f69403a327df`。构建 HEAD 为上述干净 commit，2912 项配置范围内源文件在构建与生命周期后全部相同。相对 production06 的该范围有 8 项变化：renderer 源码/测试、原生 UI harness、staged 官方包和四个 local dist 输出；这不等于整个仓库只有 8 项差异。local dist 明确来自成功外部构建复制，不另计一次独立本地构建。原始 2s/10s 安全预算保持。

最终审计与 Root 复核记载 45 个 DOM 进程身份、5 个 driver、5 个 wait-only ancestor 共 55 PID 均不存在，5 个私有目录清理。ancestor PID 来自保存记录，没有独立保留的先前 birth；不扩大为更强身份依据。端口状态取自 owner 释放前的冻结记录，本归档代理未重新探测可能被后续诊断使用的端口。

**本次 app-sigkill 的 exact ECHILD 为 null / unobservable，不能套用 production06 的 observed 精确值。** guardian 自然 exit 0，wait-only ancestor 没有向它发信号；退出观测 `75264430401382 ns` 是清理完成上界，waitpid 完成于 `75264431143063 ns`。原 4.5s 清理门禁通过，但该证明不产生精确 ECHILD 时间。正常 teardown 后 ancestor 工具 exit 241 对应已记录 child -15，不写成生命周期失败。

Root 额外实际看过 timeout failed-card PNG，只确认该图的 deadline 失败卡及手动启用动作，不将一张图扩称五例全部像素验收。独立 artifact review 在 494 项原清单内；本代理只做静态归档，没有新测试、渲染、构建或原生操作。

## 第二批：class 原生内滚动机制 PASS，外层 corner 未完整可见

按 `native-ui09-class-scroll-diagnostic-02/completed-manifest.json` 的 93 个绝对路径条目归一到 evidence root 核验并保存，另收清单自身和 Root 最终审阅。production07 的新 binary/archive 运行旧同一 diagnostic harness（SHA `ee4e27c099bd17a61e7b168b7337afb70fd2bf0f8fb92d8413bb3e94b47f6ced`），首次 exit 0。旧 class01 的 native 首 RED/160 差值保留在 checkpoint15，未改写。

本次保留 23 wire events、56 离散 DOM samples、三个成功完整 class 请求/AST；Root 实际比较三请求完全相同、三完整 typed results 完全相等，单 fragment complete。另一个 render22 被取消后返回 unavailable，不混入三个成功结果。内层滚动偏移 top 125/left 69 及同一 blob 保持到最终；没有触发不同语义 fragment 替换分支，不声称该分支已回归。observer 恢复记录、开销、0 drops/errors、该次无 native deadline 均保留，不能推导种子对耗时的单独因果或关闭全部历史 deadline。

Root 实看 bottom-right 原图，Zebra/Duck 下部内容可见；但外层 preview bottom 260.5 超过 editor bottom 229，最底方法被裁切。因此仅可称 **内滚动稳定机制 PASS**，不称整个 bottom-right corner 可见、完整 UI/64 组合或 Journey 已验收。新 test alignment 准备中，未读取归档。最终 guardian 是已终止的 PID 1 僵尸，不是 absent；与前一批 production07 五生命周期的 55 PID absent 属于不同运行，不能混用。

初批 metadata 原样保留在外部 `first-batch-frozen/`。本批是冻结原件的静态复制与去重，没有新增运行，也未把后续活动结果提前标绿。

## 第三批：Journey 同源配对历史结果（“仅标题”范围由第五批纠正）

按 `journey-current-native-paired-01/completed-manifest.json` 收录 166 个绝对路径条目、清单自身及三份完成审阅。首次研究 validator 因 request fromLine 0 非法失败，改为 1..12 后重新 capture02；第二次 validator 漏传精确官方 renderer declaration 而触发 protected-range 拒绝，validator03 补足声明并复用同一 capture02 AST/request。两次原始失败、修正和所有 PNG 均保存，不改写为一路成功或产品故障。

Root 独立比较六份 pre/post 状态，两 arm 各位置的状态保持相同；重算完整 RGB 帧：full-canvas 1106 像素不同、top-left 1106 像素不同，均在标题区域；bottom-right 0 差异、两张 PNG 字节相等且呈空白。Root 实际查看 original-full-canvas、canonical-full-canvas、original-bottom-right 三图，确认官方原始 SVG root 同样有大片下部白区，不把未看的图宣称已目视。**1106 个标题像素差异仍是开放 fidelity 问题，不是已接受容差或像素等价 PASS。**

原图 `width=100% / height=565 / viewBox=0 -25 1300 540 / xMinYMin meet`，typed 宽高 380×565，paint native zoom 2。原始标题 `4ex` 与 capture zoom 1 得到的 `33.8125px` 分属不同阶段，没有标题 paint computed metrics，不能据此认定相对字体就是差异原因。原 inline SVG 的 scrollHeight 569，canonical img 为 565；client326×167 下最大偏移为原图402/54、标准化图398/54。4px baseline/linebox 是独立布局候选，不用它解释标题差异，也不强制套用历史 UI09 的413/69。研究容器不同于生产 preview，且本次是研究 native helper/当前 renderer/core 链，不是官方 archive 在完整编辑器中的实例闭环或 UI09 精确重现。

原图/源码/画布未裁剪或去白，没有放宽像素误差或产品预算。各研究 namespace 与自有 Xvfb128 退出/socket 清除记录保留，Xvfb126 未碰。静态字体审阅只提出后续有界度量方案，不宣称已实施修复或新对照。第三批捕获时 smoke 和后续研究尚未收录，后来完成部分按第四至六批分别补入。

先前 Root pixel review 中的 manifest pending 是其写入时事实，原件保持；后续 `root-journey-paired-manifest-review-01.json` 单独补齐166项/6,797,885字节 SHA/大小通过。前两批 metadata 均冻结保留，现有 class 机制 PASS、Journey 标题未闭环与完整 UI 未验收分别陈述。

## 第四批：corner smoke 首 RED，新 outer alignment 未执行

精确收录 smoke completed manifest 的 53 个绝对路径文件及清单自身；alignment `implementation-manifest.json` 使用不同 schema，其 `files[].file` 为相对 design 目录路径，共 11 项，另存清单自身。无递归扫目录。设计 README 和 implementation-summary 属于不同写入时点，保留“未实现/未运行”等历史表述，不修改原文；实际 test-only 改动由 before `22c07075…` 与 after `d150a401…` 快照、diff、核验日志证明。

离线旧 class02 固定记录在 offset69/125 稳定时，preview bottom260.5 仍比 editor229 多31.5 CSS px，新的可见 corner 断言真实 RED（exit1）。这与 UI09 的内偏移复位是不同失败。实现只改测试：每 corner 增加独立最多5秒、10个单 wheel tick、2次反转的外层 gutter 对齐，原 inner wheel body 保持；这增加两个 corner 最坏10秒对齐工作，不冒称整个测试总时限不变，也未延长产品 renderer/host/原定位预算。

随后生产07 native smoke 首次 exit1，6个 records、0/8 corners 完成。失败发生于原 inner horizontal wheel 的 `Wheel reaches diagram left bottom-right`，**尚未进入新的 alignScrollCorner**，不能写作新 alignment 完成后可见性断言失败或 GREEN。日志里的 `PASS FAIL` 只是 shot/record 函数记录名为 FAIL 的截图，不代表该用例 PASS。

失败记录内 top125/left0，同一 blob，preview 已向上移至约 -120.3125..48.6875；outer movement 与未到达水平右边缘均保留。原 loop 无逐 tick 轨迹，链式滚动仅是待验证假设，不能从截图认定因果。该次 errors/CSP 为空、无 retained native deadline 事件，不扩大为全部历史问题关闭。第四批捕获时活动的相对字体研究和未完成 harness 修正当时排除，后由第五批独立冻结清单补入；Root 独立 review 已另行追加，实核53项/8,581,334字节并实际查看 FAIL 图。起初计算的 CSS 鼠标坐标[190,164.75]已不在最终 preview 的 y[-120.3125,48.6875]内，最终可见交集 midpoint 为[190,42.84375]；但未采实际 X11 pointer，只能说明 stale 指针机会，不能确证 wheel chaining。

前三级 metadata 都保存于外部 draft 的冻结目录，所有历史 raw 保持原 SHA。

## 第五批：同一冻结 SVG 的 zoom1/2 配对，纠正“仅标题”概括

按 `journey-relative-font-native-01/completed-manifest.json` 收录99项绝对路径/1,883,946字节、清单自身与两份 Root 完成审阅；另按 `ui10-scroll-inner-hit-review-01/implementation-manifest.json` 的10项相对 `file` 清单及自身收录 test-only 准备。所有旧 raw/前四批 metadata 保持原样。

同一冻结 native binary 使用相同未修改 original/canonical SVG，无第二次 Mermaid render：zoom1 的 full-canvas/top-left 各0像素差异，PNG逐字相同；zoom2 各1106差异，原PNG SHA完整复现上一阶段。Root 实看四张完整原图并独立重算。**纠正第三批原报告的“仅标题/标题区域”概括：zoom2 full-frame差异为1060个标题像素加46个 Cat 图例像素。** 原报告不回写，此处及新增 review 明确补充，因此不能继续把1106全归标题，更不能将本结果写成全缩放像素等价 PASS。

原始标题 computed font size 在 zoom2 变半，但 bbox width 保持255.46875、height由37.640625变41.0625；单个 computed px 值不能代替完整物理缩放解释。img 内部 computed style 不可读取；相对 ex 仍未证实是唯一或实际原因，产品字体未修改，没有建立 remediation。inline root565/ancestor scrollHeight569 与 canonical565 的布局观测继续单列，不借它解释全部像素差异。原白区与全部 SVG 字节保留；本次研究执行/清理首轮完成，不是完整编辑器/Windows验收。

另一个已完成静态 test-only 修订从 d150 到 `92870c895fceef1e1761e1e6285a68b3608d1cd45b53d4ab1ba354f59d10957a`：每 axis 和每原有3-event batch 前重取 preview/viewport 正交集、真实 hit、mousemove、实际 X11 pointer 后再 hit；离线计算证明旧推导坐标在最终 preview 外，新 intersection 坐标在内。历史旧坐标并非当时物理 pointer 记录，不据此确证 smoke01 因果。原30步、每批3事件、70ms间隔、120ms等待、固定端点和1px容差不变；新有限观察开销会改变测试时间，不能宣称零开销。此清单只证明代码准备/静态及离线检查，该静态批次**没有 runtime GREEN**；其后完成的 smoke02 按第六批另行归档，不能回写本静态记录。

## 第六批：8-corner smoke 首次 PASS，限定两个配置组合

按 `native-corner-alignment-smoke-02/completed-manifest.json` 的74项绝对路径清单及自身、两份 Root 完成审阅归档。19个 records、8/8 corners 首次 PASS，范围仅 ordinary/live/light/200%/narrow 与 windowed/live/dark/200%/narrow 两个配置，各包含 class/Journey、top-left/bottom-right。它不是全部31×2覆盖或64×5矩阵；旧 smoke01 首 RED原样保留。

Root 实际查看全部8张 webview corner PNG，独立核对16 axis records、56次实际 X11 pointer/DOM hit、8次 alignment记录及文件未变。Class bottom-right 可见 Duck/quack 下部/右边缘，top-left 可见 Animal/title；Journey top 可见标题/任务/actors，bottom 为原白色画布且对应 corner 可见。只要求当前所拍 corner 处于 editor viewport，相反边缘可以合法裁切，不能写成每张图整个 preview 都完整可见。owner summary 的 `reviewed:false` 保留其写入时状态，Root 后续完整8图目视由独立 review 补齐，不回写原件。

alignment ticks 为0/0/1/0/1/0/5/0；对应 class内偏移125/69、Journey413/69以及返回0/0均保留。新增观察改变测试时序，所以有界 PASS 不能证明此前 smoke01 失败的唯一原因，也不产生全组合、Windows或历史deadline根因结论。产品未因这轮测试对齐修订而修改，先前 Journey zoom2 的1060标题+46图例差异仍未接受为容差。

前五批 metadata 的冻结副本留在外部支持目录；本检查点所有原始对象保持捕获字节、原 SHA和完整历史资格。后续正式 UI10 另行留证，不提前计入。

## 存储与边界

`index.json` 保存原路径/hash/大小、按内容去重 alias 和旧检查点引用。PNG 保留原字节，文本原件以 `raw/*.txt` 原样存储；小型生成 fixture 包属于清单明确的测试证据，按实际原件保存。binary/deb/guard/官方 archive/SDK 共五个外部产物只保留清单元数据，不重新读取、复制或冒充已打包。整 source、frontend、profile/cache、依赖和构建目录均排除。本目录不自包含这些外部产物。

在仓库相邻检查点齐备时执行 `python3 verify-index.py`；外部 staging 显式传入 `--checkpoint06` 至 `--checkpoint15`。校验只证明归档对象/hash/引用/无孤儿，不证明运行结果以外的产品性质。外部 `checkpoint16-draft` 的 capture、verification、敏感模式筛查与 handoff 为支持材料，未列入本目录原始对象。
