# Checkpoint22：冷启动诊断前缀通过，生产超时与 renderer CPU 缺口仍未关闭

本检查点保留 production08 的原首次冷启动失败、两次诊断 setup 失败，以及第三次诊断中原 cold gate 通过后主动 prefix STOP 的不同结果。03 使用研究诊断二进制，不是 production08 DEB；没有完成独立安装、完整 UI 或 64 组合矩阵，不能据此宣布 P4 完成。03 只捕获五个 accepted render 输入，原 driver 有六个 dispatch；严格全日志 wire 审计首 FAIL 原样保留，另附限定于已捕获集合的完整性审阅。

归档基线为已推送 `7ad29dc04061f60300dbe2902d29e16f00272727`，checkpoint21 index SHA256 为 `7684f3c51ea63bb2317818f37b4323ce9228cf150c55760c72c08287e2577d50`。远端与 GitHub author/committer `LarryZhu-dev` 的核验来自 Root 保存的 `checkpoint21-draft/remote-verification.json`，本归档代理未重复联网。该 commit 仅文档/证据，产品代码仍为此前 `ffa662077bfe696b50c43f94691bc88e5f693c14`。本代理只在外部 staging/draft 写文件，没有修改仓库、构建、运行产品、读取 live `/proc`、清理进程、提交或 Windows 上传。

## 分开保留的实际结果

| 运行                     | 原 harness / sampler exit | 实际结果                                                                                                               | 未证明的事项                                                               |
| ------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| production08 observed-01 | 1 / 0                     | 两条 records，原图片就绪断言超时；native render_3 在 2004.107449ms 观测到 deadline                                     | 原 render_3 完整输入、renderer CPU 与超时原因未知；0 完整 UI / matrix 验收 |
| cold diagnostic01        | 1 / 2                     | 诊断 basename 改成 diagnostic-only-milkup-desktop，原 startup helper 未匹配 WM_CLASS；CPU 另遇 guardian environ EACCES | cold gate 未执行；不是产品 cold FAIL，更不是 PASS；CPU 0 样本              |
| cold diagnostic02        | 1 / 0                     | basename 已恢复，原 App profile environ 核验 EACCES；CPU 正常落盘 App/guardian 各9样本                                 | cold gate 未执行；采样器 exit0 不等于 cold PASS；无 renderer CPU           |
| cold diagnostic03        | 0 / 0                     | 原 cold gate 实际通过，然后 DIAGNOSTIC_PREFIX_STOP；App/guardian 各21样本                                              | 不是生产 DEB / full UI 验收；无 renderer CPU；原 production08 超时未关闭   |

production08 原错误仍为 `Timeout: actual image decode block-000-first-official-example`。原截图显示字面源码及底栏渲染超时/禁用，不是白屏，也不证明图片解码器缺陷。该次 transport observer 尚未安装，不能用后续诊断中相同 `render_3` 名字重建此前 instance `32334888594142dd8481207c9921d47cfd83a3935befe193` 的未知 payload。原 build 与五项通用生命周期首 PASS 的范围仍以 checkpoint21 为准。

## 候选、纯逻辑测试与诊断构建

收录 request 审阅、native recorder 候选 v01/v02、原 diff、候选 manifest、保留的 `revision01/` 三份源码、独立 wire auditor 与纯逻辑测试证明。旧 `candidate-manifest.json` 的路径仍指向后来被 v02 替换的 `candidate/`；不修改原 manifest，而在 index 的 `historicalManifestResolutions` 中将三个旧 SHA 精确对应到 `revision01/` 原字节。不能将历史路径变化写成旧候选的无声覆盖或当前运行输入漂移。

原 recorder 7 项 Rust 纯逻辑测试通过；wire auditor 6 项合成测试通过；CPU v01/v02 分别15/19项合成测试通过。它们只验证相应逻辑，不替代 native 图像、进程身份、CPU 覆盖或完整产品验收。CPU v02 对 guardian 环境仅在 PermissionError 时记录 unavailable/null，并要求 native 创建证明、精确 PID/birth、父边、argv 与双 stat 等既定核验通过；可读但不匹配仍失败。原 v01 和其首失败没有改写。

唯一诊断构建记录为 build-attempt-01，exit0；诊断程序21,925,344字节，SHA256 `a5fce05f06805931d9e55c2cddc80f1b9e0e4f31c5a756f2bc8eab3b185c0ac8`。native capture overlay 与构建前后源码恢复、12项 frontend 不变、原 production08 binary 不变的证明均保留。该直接 Cargo binary 的 bundle marker 为 UNK，不能冒称 DEB；02只是按证明复制同一诊断 binary 并恢复 basename，03继续复用02的已冻结 binary/harness/sampler。实际二进制和 frontend 正文不复制。

## 01/02 setup 失败保留，不借后续通过回写

01 原 results 是空数组，startup 错误明确说编辑断言尚未开始。窗口存在，但 WM_CLASS 为 diagnostic-only-milkup-desktop，与原 helper 预期不符。独立 CPU observer 读取 `/proc/467203/environ` 被拒，exit2；保留0字节 samples、observer-error、原 stdout 与 failure。单次 lifetime ticks 快照不能构造 CPU 区间。native 另捕获1个 guardian-spawn 加8个 render-accepted，完整 wire/UTF8/SHA/身份核验通过；这与 CPU 失败、cold gate 未执行同时成立。其 classDiagram `render_3` 属于不同诊断 instance，不能归因 production08 的 `render_3`。

02 原 results 只有1条 FAIL，错误来自原 App profile 环境核验 `/proc/468107/environ` EACCES；cold gate 仍未开始。CPU v02 绑定 App468107/birth8843827 与 guardian468234/birth8844239，guardian环境检查 unavailable/null，绝不是匹配成功。9个样本的完整观测区间中，App 自身 CPU 0.22s / 2.000159561s，guardian 自身 CPU 0.09s / 2.000577965s；无 renderer/helper/WebKit 身份，也无共享 cgroup 采样。没有 deadline-observed；session cleanup 的 kill-start 不是渲染截止点。

02 的 driver 使用 require_escalated，harness/CPU 使用 use_default。事后两种工具上下文的 user namespace 自查不同，只证明这些自查和已记录启动模式，不能反向补全已退出进程的内核权限判定。03 改为统一外层执行上下文后 App profile 断言及 guardian 环境匹配走过，但 renderer 后代仍未被发现，不能声称统一 context 已解决 CPU 覆盖。

## 03 原 cold gate 通过与 request capture 的明确边界

03 `results.json` 包含 preinstalled-cold-before-render 与 preinstalled-cold-window；block-000-first-official-example `[108,342)` 图像 complete=true、naturalWidth663/naturalHeight281、inlineSvg0，live mode，无超时 notice，diagrams enabled/no errors。Root 实际查看 WebView/X11 两张原图，确认 block 图可见、下方 class 图部分可见；X11 窗口外黑色区域不是应用白屏。原官方示例的字面 `&nbsp;` 边界保持不变，没有在本轮修复。原 `run-summary.json` 的 visualReview pending 字段保留，用另存 Root 审阅记录补充，不修改原结果。

该研究运行 instance 为 `89991fca045be26f50cf9b51dabff036dbd0a170476407fc`，App468788/birth8887290，guardian468923/birth8887623。capture 共6 events =1 guardian-spawn +5 render-accepted。五份完整 serialized wire 均通过 UTF8 字节数、SHA256、16字段、request/plugin/instance 身份及唯一对应 native dispatch 核验：render_1/2/4 为 block fence `[108,342)`，render_3/5 为 classDiagram fence `[440,969)`。这是绝对 UTF16 半开区间；fixture 的中文/组合字符/emoji 使 UTF16、Unicode scalar 与 UTF8 byte 偏移不同，审阅另存精确重建证明。输入完整不等于每个请求都完成图像输出。

**原 driver 有 render_1 至 render_6 六个 dispatch；capture 缺 render_6 的 wire，其 payload/source/range 未知。** 未改动的严格 auditor 首次 exit1，唯一错误是完整 driver dispatch 集合与 capture 集合不同；`accepted-wire-audit-first.json` 保留原 FAIL，`qualified-audit.json` 只说明已捕获五份输入的完整性通过，不将严格检查降级为成功。

render_6 dispatch 为88881387251420ns，complete final checkpoint 为88881398751983ns，前者**早于 final 11.500563ms**。finish.request 只有 `cold-prefix-final\n`，没有单调时钟；writer 实际 closed.store 时刻也未记录，不能说 render_6 发生于 final 之后，也不能断言它精确发生于 finish.request 之后。源实现关闭观察后再 drain/write complete，关闭后的 capture 调用不增加 attempted/drop，因而 final 与零 drop 只证明已接受队列收尾，不证明 final 前或整个 App 生命周期的请求都已捕获。Root 首份审阅与 `root-postrun-review-addendum.json` 并列保存，时序以 addendum 精确校准。

status/complete 相同，attempted=enqueued=written=6、inFlight0、queue/error/oversize/cap计数0，五份 wire 共5362字节。该运行没有 deadline-observed，不代表每次渲染均成功；相邻 dispatch 间隔不是 renderer 执行时长，也不能把 render_3→4 的间隔当作已观测超时。原 production08 deadline 仍然开放。

## 03 CPU、调度及观测开销

21行 CPU 记录仅含 App 和 guardian 各21样本。App 首末读起点相隔5.000066079s，自身 CPU 0.34s；guardian 为5.000095762s、自身0.08s。它们是各自完整观测端点之间的累计差，覆盖不同阶段，不按单个请求分配，不对未采到边缘插值。App 绑定在其 birth 后约3.35s，启动最早阶段未覆盖。**App CPU、guardian CPU 均不是 renderer CPU**；renderer/helper/WebKit 与共享 cgroup CPU 均未测，不能用低App CPU推断renderer空闲。

`/proc/PID/schedstat` 仅反映thread-group leader：App runqueue wait 增量99.738376ms，guardian7.065732ms，不是各进程全部线程等待总量，更不是renderer调度证明。10次 discovery、19个task、incomplete0仍只发现两个身份；候选源码对某些 children/stat 的 FileNotFoundError 静默跳过，未保存逐次errno/原始children/候选拒绝原因，故不能由incomplete0推定接口可读且无后代，也不能将namespace、权限或进程不存在之一宣布为唯一原因。原CPU03审阅写出时，受控父子fixture仍只是后续建议；随后Root单独授权并完成了一次direct case，原审阅不回写，结果和独立审阅作为下述追加证据保留。

CPU nativeEvents 也仅保留render_1..5。最后sample先于render_6 dispatch，controller-stop前没有再次完成log poll；eventDrops0不补足driver尾部漏观测。21样本无丢槽/eviction/error，最大迟到143.337982ms，说明“无丢槽”不等于准时。

独立observer自身 CPU75.795591ms，其中 prelaunch hash18.261164ms、afterReady57.537785ms，读取时点略不同，不能将三项相加。185次proc读取总8.742531ms；sample累计9.025382ms、discovery累计6.581704ms属于可能重叠的wall成本。native writer thread CPU27.228049ms已经属于App自身CPU；captureTotal1.415286ms、max1.356979ms是同步wall时间，包含可能调度等待，不能当额外CPU相加或解释renderer超时。没有renderer树采样或无observer对照，不能宣称完整观测开销已达标或扰动为零。

## 后续独立direct能力检查：当前children接口确有ENOENT

Root随后执行一次独立受控fork fixture，没有启动产品。observer469726创建fixture parent469729/birth8925421，parent创建child469730/birth8925421并用pipe握手保持其存活。内部parent与外部observer各进行一次快照；8份前后原始stat字符串经独立审阅重解析，PID/birth稳定、PPID直接关系正确，child均为S而非Z/X，task枚举各成功返回1个TID。

两侧实际open `/proc/469729/task/469729/children` 均得到errno2 ENOENT。这证明该指定接口在本次两个读取时刻不可用，**不是成功读到空children，更不是没有子进程**。三者记录相同user/pid/mount namespace及uid/gid映射；不能由此推定所有挂载/机器或历史guardian均相同，也不能确定内核配置、虚拟化实现等底层原因。

首结果耗时25.643025ms；pipe EOF正常释放，child和parent两次waitpid均reaped=true、exit0，signalsSent=0、globalProcScans=0、productStarted=false。独立direct-review的28项检查通过，结果SHA256 `dc1cf84464901f1119d76491e48ad4d6e0079d76aa764dc801576195eb0b9004`，原脚本与prepared manifest SHA一致。prepared文件原“未执行”状态保留为准备时点记录，不改成执行结果。

冻结CPU v02会静默跳过children的FileNotFoundError，当前fixture证明这种不可用分支实际能够出现，支持后续明确标记coverage缺口；但历史02/03没有保存对应open errno，不能宣称已逐次证明它们都是ENOENT、回填renderer CPU或归因production08超时。本检查点未执行额外bwrap对照或candidate-v03，不等待后续候选研究。归档代理仅读取已完成结果，没有重跑fixture。

## 已记录清理与归档范围

01/02/03 frozen run-summary 分别记录16/15/16个known owned PID absent，专用端口无listener，ancestor reaps11/11/10。01先完成sink finalization，再按精确App PID/birth pidfd TERM及原guardian路径清理；02/03由原session close后，在 `/status` No sessions及精确owned group核验下停止driver。03 guardian kill-start→cleanup-complete为47.531405ms，是prefix session清理，不是deadline或render_6终点。这些是冻结历史记录；本代理没有重扫进程、发signal，也不将known PID集合扩称全系统后代身份/CPU证明。

| 冻结清单 | 原清单条目/字节  | 本代理核验并归档正文 | 仅保留profile/cache/安装主体排除元数据 |
| -------- | ---------------- | -------------------- | -------------------------------------- |
| run01    | 172 / 16,901,946 | 30 / 7,948,643       | 142 / 8,953,303                        |
| run02    | 172 / 15,932,434 | 31 / 8,070,705       | 141 / 7,861,729                        |
| run03    | 172 / 16,883,782 | 32 / 8,092,092       | 140 / 8,791,690                        |

三份完整manifest原文保留。归档代理实际逐项核验93份非profile运行正文；423份profile/cache/插件安装主体共25,606,722字节仅保存原清单元数据，未读取/复制。独立request/CPU/Root审阅各自对完整172项的核验结论按其原记录引用，不冒称由本归档代理重做所有主体核验。runtime之外的候选、测试、build、准备和审阅文件均逐字收录；原production08 firstFAIL的37个来源通过跨检查点引用保留。

最终 index 共311 source aliases、33,853,574来源字节；202个本地唯一对象共1,743,737字节，55个跨checkpoint唯一对象共8,237,487字节；6个PNG来源，其中4个新增唯一PNG。相同fixture（含7.85MB windowed.md）、helper及已有失败证据按SHA去重，跨引用指向checkpoint06/09/21，基线链checkpoint06–21固定index SHA与commit。24项artifact/frontend/runtime工具/诊断binary引用共90,787,550字节是来源路径元数据，包含相同诊断binary的两个路径，不是新增正文或唯一artifact体积。

binary、frontend、profile/cache、node_modules、target、pycache正文均不纳入；原始日志、截图、严格审计首FAIL、历史manifest和Root更正前后记录不修改。`verify-index.py` 校验固定基线index、对象SHA/大小、aliases、无重复对象、无孤儿和无symlink；外部 `checkpoint22-draft/verify-final01.sh` 再核验来源、选择性manifest范围、历史v01定位及明确结果边界，生成handoff01。README另用仓库Prettier规范化，raw不格式化。上述PASS仅归档完整性/格式结果，不是产品测试通过。
