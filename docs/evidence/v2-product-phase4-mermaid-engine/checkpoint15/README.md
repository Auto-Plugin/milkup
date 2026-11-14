# Checkpoint15：固定图形种子的机制回归与门禁

本目录由根代理从外部冻结目录提升为已完成批次的仓库快照。checkpoint06–14 原件及索引保持不变；checkpoint14 已推送 `e6772555e9a420b1dcf4581c8436e92b82dfb10b`，远端和 GitHub 身份核验记录随本批保留。

## 初批：原生 class 首 RED 与机制审阅

严格收录 `native-ui09-class-scroll-diagnostic-01/completed-manifest.json` 的 106 项及清单自身、三份完成审阅和 checkpoint14 远端记录。该次原生首运行 exit 1：四份完整请求相同，三个相邻 typed result 对各有 160 个数值差异，均为 14 个 path 的 cubic 控制点。真实滚轮到 left 69/top 125，截图后及最终观察均回到 0/0。源字节未改，保留阶段 errors/CSP 为空。完整请求的规范化 JSON hash 不冒充原始 wire 字节 hash；wire 对应关系精确，blob 与 request 只有时序关联，未建立私有映射。

只读机制审阅将 160 差异对应到四个 class 外框、八条分隔线、两个 note 外框；Mermaid classic 也使用 roughjs，零 roughness 不会消除 seed 0 的随机 cubic 控制点。`handDrawnSeed: 1` 加 secure 配置是该机制候选；这份审阅自身没有运行修复，也不保证全部图型确定性或像素相等。原生首 RED 不因机制审阅而变 GREEN，历史 deadline 与完整 UI 验收仍未关闭。

此诊断记录 33 wire events、15 requests/15 results/3 cancels、75 离散 DOM samples；有界 observer 开销保留，产品 2s/10s 预算未变。四个列明 PID absent；guardian 411973 已终止但仍为 PPID 1 的 Z，不能称所有身份消失或全后代清理证明。共享 Xvfb 保留。

## 第二批：独立真实 Chromium 重复渲染 GREEN，保留像素差异

按 `repeated-official-renderer-01/archive-manifest.json` 精确收录 46 项、清单自身及两份完成审阅。最早 `before/` 因默认浏览器可执行文件缺失而 setup 失败，不是产品 RED；`before-02/` 使用已安装 Chromium 执行实际基线，同一完整请求三次得到不同结果，首对 152 个差异，exit 1。这里的 152 不替代原生的 160。修改配置后同一 runner/request/assertion 三次完整 typed result 和 canonical 输出相等，exit 0。

五个 guard 变体各真实渲染两次：source/theme/width 变化仍更新图像；frontmatter/directive 请求 seed 0 不能覆盖 secure 固定值，每个变体重复结果相等。配置静态 addendum 本身没有运行 GREEN；实际运行证明来自另一个冻结批次，原审阅不改写。

像素原件保留：原始 SVG 与 canonical 图像在基线/修后分别有 5/4 个像素差异，最大通道差 1；随机基线与固定 seed 原图有 3268 个像素差异，最大通道差 11。Root 实看三张图的审阅随附。这是 Linux Chromium、1200×900、light、width 1100、scale 1 的有界结果，不是所有像素等价、原生滚动 GREEN、完整矩阵或 Windows 验收。原生首 RED 和历史 deadline 仍未关闭。

三条外部可重建 bundle 引用总计 37,731,106 字节（含同内容两次路径引用），仅保存冻结清单中的路径/hash/大小；未复制或重新读取其主体。依赖也仅由报告引用，不声称本归档自包含完整构建环境。第二批捕获时仍活动的 gate07 被排除；其完成后另按第四批冻结清单归档。新原生复测和其它未冻结目录仍排除。

## 第三批：diagrams 独立产物与 trusted staging 首 PASS

`diagrams-gate07/completed-manifest.json` 的 48 项及清单自身均按冻结 SHA/大小核验。独立仓库外验证首轮约 9.573s，89 tests、strict typecheck/build 通过；另一次 trusted staging 约 2.829s 首 PASS。新包 SHA 为 `9889f1796f9080ff230a1c51147522e83e065bc191a258035208f69403a327df`，5,726,838 字节，external/local/staged 三处整包字节相等。local dist 来自成功的外部构建复制，不算另一轮本地独立构建；其它九个 staged 包未变，不算重跑十包完整验证。

冻结独立审阅核对实际 minified entry：只新增 `handDrawnSeed:1` 和 secure 中的 `handDrawnSeed` 两项共 32 字节，精确逆去后与旧 entry 全字节相同。公开 SDK、view 语义比较、预算与 2s/10s deadline 未借此放宽。归档保留源码、测试、锁文件、构建日志和产物身份审阅；archive、dist、vendor SDK、node_modules 及 local-dist-before 主体按清单排除，仅保留原报告中的路径/hash/大小或计数。不重新读取包体，不宣称完整依赖或构建环境自包含。

这是 diagrams 子项目产物门禁，不等同于当时仍在活动的全仓 gate07，也不是后续生产包/原生生命周期/UI 通过。固定 seed 的原生 GREEN 尚待，Journey 的视觉问题尚待，旧 UI09 仍为独立视觉门禁失败后 STOP，未完成的 38/64 组合不能标为通过。

## 第四批：全仓 gate07 首 PASS，原生仍待

全仓 gate07 结束后，按 `repository-gates07/manifest.json` 收录 11 项及清单自身，另收 Root 对 diagrams 48 项和全仓 11 项实际 SHA/大小的独立核验。typecheck 36.849s、test 61.430s、lint 85.813s、build 28.097s 均首轮 exit 0；2051 Vitest + 4 Node = 2055，16,356 个输入前后相等。保留原始日志、输入清单和计数审阅；独立 diagrams 的 89 tests 不重复累加为本次全仓计数。

当前可确认两层门禁均完成，但 production07、新二进制生命周期及原生 UI 尚未纳入本归档，Journey 与旧 UI09 的未通过状态不变。不得用全仓构建或单元测试替代原生像素、滚动和完整 64 组合验证。初/二/三批 metadata 在外部 draft 各自冻结，原始对象未回写。Root gate 审阅首次捕获后补入原 test.log 的 13 包合计 2051 与 Node 4 解析；首次捕获和最终版本使用同一来源路径、不同 captureRevision/SHA 分别保留。历史版本不声称仍匹配当前源文件。

## 存储与核验

`index.json` 保存来源路径、原 SHA/大小、内容去重 alias 和旧检查点引用。PNG 原字节保存；其他原件按原字节存为 `raw/*.txt`，扩展名不代表重写。原生 binary/archive 仅在已保存原件中保留路径/hash/大小元数据，不复制其内容；依赖、profile/cache、活动研究不收录。外部 draft 的 capture/verification/handoff 为支持材料，不包含在此目录的归档对象中。

在仓库内相邻检查点齐备时运行 `python3 verify-index.py`；外部 staging 需显式传入 `--checkpoint06` 至 `--checkpoint14` 的仓库目录。这是静态完整性校验，不是产品测试。本代理未运行渲染器、浏览器、原生程序或构建。
