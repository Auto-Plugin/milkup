# Checkpoint19：静态候选及已完成原生 prefix，历史故障未解决

初批仅外部归档明确完成的输入：checkpoint18远端身份记录、两份静态机制候选审阅、`native-navigation-window-diagnostic-01/prepared-inputs-revision02.json` 的40项显式相对路径及manifest自身、独立静态review、Root单次授权。初批未读取该诊断run/control；后续第二批依Root新增GO及owner完成清单收录运行原件。profile和活动浏览器研究始终排除，未执行测试、构建或原生程序，未写仓库或提交。

checkpoint18已提交推送 `d9489a128577b6ea4fa71fd33d93f905b1b2345a`，远端与GitHub author/committer LarryZhu-dev、id40397402核验来自Root已完成记录。本批只保存记录，不重新联网核验。checkpoint06–18原始索引保持不变，相同内容引用旧对象，不重复复制。

## 静态候选的证据边界

`window-navigation-measurement-static-candidates.json` 区分旧几何下选定窗口、测量修正与anchor替换交错等候选。77行Sankey源围栏的多行恢复/折叠不同于已完成600→80图像缩小负向对照；缓存2048行、压缩阈值和focus诱发滚动均不能仅凭大文档或空白截图认定为原因。报告中的source SHA是其只读审阅引用，本批没有展开产品或依赖源码树。

`window-navigation-selection-restore-static-addendum.json` 确认一个代码级次序缺口：selectionChanged路径可以先恢复literal多行DOM、调整anchor，而未同步更新SourceDocumentView测量模型。它仍是待实测的机制与修复设计候选，不能据此宣称原生故障因果、已实施产品修复或已通过回归。原先严格几何0.21875 CSS px首FAIL及“目标/投影/光标仍存在、未复现原生脱挂”的研究结果保留在checkpoint18，不反改成GREEN。

## 冻结准备与历史版本

revision02 manifest SHA为 `f5f9e75f0d2fd9fe0e91b11393bdf8d327bbf400000ffe39432ddf003f8a2b41`。本批40项逐字SHA/大小已核验。旧 `prepared-inputs.json` 原样保留；其中五项旧路径通过manifest的 `historicalMappings` 映射到实际 `revision01/` 冻结副本，五份快照SHA均核验。旧路径后来内容变更不回填旧manifest；当前输入以revision02为准。保留各次finite fixture日志和旧static-proof，不能把其早期计数改写为最终计数。

独立review阅读owner最终8个有限fake DOM/ring合同案例及静态语法/格式结果，未重跑或启动App。revision02只在既有目标probe内加有界DOM记录：最多128个直接子节点、6个preview，明确truncation；保留原输入动作、等待、断言、observer与CPU工具。snapshot读取可能强制布局，readMs不覆盖完整序列化/IPC观察开销；有限轮询不等于连续mutation轨迹，App CPU不等于WebKit renderer CPU。

`root-runtime-go.json` 仅授权一次诊断prefix，不是执行成功记录。该prefix设计在原windowed sequence000 seek/assert/shot后以DIAGNOSTIC-END结束，不包含完整matrix。即使后续prefix通过也不关闭旧首FAIL或Mermaid历史deadline。初批冻结时尚未拿到owner completed-manifest，不作运行结论；第二批后来获得完成清单及Root GO，按下节独立追加，旧准备原件不回写。

## 内容与验证

7份externalReferences只转录冻结manifest的路径/SHA/大小，包括binary、plugin archive及外部输入；本批不读取或复制这些主体，也不采集profile/cache。原始日志、脚本、差异与准备文档按原字节收录，没有修改raw文本。

`index.json` 列出本地对象、checkpoint06–18引用、全部source alias、显式核验与历史映射。`verify-index.py` 校验基线index SHA、对象SHA/大小、alias对应、无孤儿及无符号链接。外部支持脚本 `checkpoint19-draft/verify-final01.sh` 显式列出全部基线路径；draft中的handoff/敏感模式结果是支持材料，不是原生验收证据。定向敏感模式筛查不等于任意秘密不存在的证明。

## 第二批：一次完成的原生 prefix，未复现旧首 FAIL

按 `product-ui-runs/control/mermaid-ui-navigation-window-diagnostic-01/completed-manifest.json` 的215项显式绝对路径逐一核验17,459,675字节，另保存manifest自身，SHA `d2de83776296de48e1f1a116da35d17ce63de697b572b4c74c4df3e3e7d17a90`。与初批重复的准备文件按相同source/SHA复用；136张PNG原样按内容去重。本代理只做静态hash/复制，未重新运行、未以归档动作作新的像素验收。Root独立运行审阅随后按第三批明确完成文件单独补入。

本次23:45:30–23:51:16 UTC，exit0、71条records，以DIAGNOSTIC-END结束：ordinary31、windowed20、selection1、history6、matrix0。没有重试；旧第一次navigation FAIL原件不变。此次prefix目标就绪不等于完整UI通过，也不能关闭历史Mermaid deadline。静态候选与实际本次未复现分别陈述，未宣称产品修复。

导航ring保存12行、16次实际snapshot、19次recordCalls、7次重复，没有容量eviction/incomplete。search-ready window276..394、scrollTop7166，164ms后ready window318..449、scrollTop8377；目标398行rect top37/bottom58，选区8103..8160与caret均在该观测存在。terminal明确复用最后一次ready probe，**不是新的终点DOM采样**。preview fallback最多扫描128子节点，在rows9/10/11确有截断；没有ring丢失不等于完整DOM或连续轨迹。额外DOM读取累计约10ms/max1ms不覆盖Node/IPC/总观察成本。

transport记录1032 render/1032 matched result envelopes、307cancel，active:null/firstFault:null，但只保留63完整inputs，969evicted/2117dropped，`incoming-instance-not-observed-since-install`启动空档仍在。成功envelope不是host AST接受或paint证明。best-effort native trace1050行中deadlineObserved0，不保证trace无丢失，更不提供历史render2754的payload/原因。

CPU仅绑定App及共享cgroup：保留120 App samples、60 cgroup samples，App区间59.639084844秒内900user+370system ticks、100Hz即12.70秒App自身CPU；不是WebKit renderer CPU，不进行逐请求插值或故障归因。观察器自身CPU/读成本均留在原summary，不从产品时限扣除。

冻结清理记录中driver/launcher/harness/App/sampler均absent，最终native trace emitter445881为PID1 Z，不能写成全部身份消失；其live birth未捕，当前birth8196063不是历史复用证明。另trace emitter445729当前absent同样缺live birth限定。端口4626/4627拒绝连接、Xvfb126保留来自原记录，本代理没有重新探测或发送signal。

本批7项externalArtifacts与初批externalReferences完全相同，继续仅元数据引用，不重复复制binary/archive、profile或大型work副本。活动浏览器/后续原生研究未读。初批metadata保留在外部draft，第二批验证与handoff独立编号。

## 第三批：Root独立运行审阅与静态guard清单

`navigation-window-diagnostic01-root-review.json`（SHA `37d9630a424ba16580a823f643a07760c00376d0755099e62fb34ea5d03f8ef6`）记录Root已核验215文件和136PNG引用，ordinary11914字节及windowed7851914字节的最终SHA与此前独立重建catalog fixture完全相同。Root实际查看sequence000 WebView截图：完整marker选区与caret在viewport顶部，Alice/John标签和箭头可见，后有AFTER及下一图局部；这张图没有白屏。仅该图实际目视，不扩大成136图全目视或完整matrix通过。

`window-navigation-restore-guard-review.json`（SHA `316c3e78881224ca507cbcefb36b8af75a45ed1f232917573192b6ef0af0d8b8`）为静态guard盘点与设计：复用既有context变更测试机制，但须在真实restoration callback内另测；列出同步测量顺序、重入、八项context变化、paint内部restore、no-op/stopped、throw/finally和invalidate避免重复测量等必要验证。报告未编辑代码、未运行新测试，也未将已有guard当成新分支覆盖。单位矩形mock不证明真实原生布局因果，后续77行selection-change受控研究尚不属于本批。

新增两审阅与选集metadata分别保留，前两批raw与metadata未改。没有读取活动浏览器研究；本次仍无产品修复、常规回归GREEN、完整原生验收或历史deadline关闭声明。

## 第四批：multirow browser01 首 setup FAIL，尚未执行目标导航

按 `window-navigation-multirow-browser-01/completed-manifest.json`（SHA `0d86eee8a0eb9fb30db84298f22636db02be7da1d85a27f8deae53c4069e4b32`）23项逐一核验。22份原始文本/PNG按内容去重收录，trace.zip（1476677字节，SHA `6dad83a5ab5160509d17527d0e1bd0e3237897cc95a5629a64214186c79deae0`）保留外部原件并记录核验，不复制或解包，不能称仓库自包含这份trace。另收原manifest与Root独立review，旧证据不覆盖。

首次setup没有建立完整已呈现的77行围栏：saved trace为mounted43、collapsed0、range291..360、images[]，三次provider结果均为空fragment。navigationState仍not-started，newProviderPending=false；因此target398导航和primary assertions未执行，**这是研究fixture setup FAIL，不是产品navigation RED**。sourceVersion0、pageErrors[]和原selection5692..5740另有记录，不能由此补算未执行断言通过。

Root核23项SHA/大小并实际查看final.png：Sankey marker选区与caret位于顶部，显示literal源码而非蓝色研究preview。早期native407/Chromium406 intrinsic rounding只是旧假设，不是此次已观测失败原因；不得把setup失败解释成舍入机制复现。本批只保存首失败与冻结脚本，不改产品、阈值或重跑；新的browser02准备活动完全未读。

## 第五批：parser准备修正后的首次Chromium PASS，未复现原生脱挂

`window-navigation-multirow-browser-02/completed-manifest.json`（SHA `d2dad9f8abea4304f5eb5d606ef98b73c2cb509c6c36ed3b5a4ad51f896f1d4b`）的32项均逐SHA/大小核验，31项原件及manifest自身纳入；trace.zip为828780字节、SHA `c25e47a5cf82a1a2af9d06a7d16c62b6fd2a01b3fd1ef22747ae693f009e4a34`，仅外部引用，未复制/解包。原01 setup失败不回写；02的parser准备校验、fixture/case差异及首次Chromium运行分别保留，不把parser准备纠正称产品修复。

这是580行prefix研究fixture：18个更早diagram block替换为等长plain text，保留目标源码/offset；受控蓝色SVG采用captured dimensions，不是真实Mermaid或WebKit，初始owner430.6875px也不同于native423.6875px，不主张几何等同。首次运行retries0/exit0、source输入前后不变；7reads/20events/35phases、无drops/errors。本批没有运行新测试。

已实际建立77行围栏、76行collapsed及decoded600×407图片；真实public navigation切到selection8103..8160后恢复77行literal，collapsed0/literalHeight1617，marker398 top37.59375、projection和caret保留。provider hold经过8个观察帧约160.4ms释放，未触safety deadline；后续合法provider窗口7748..9181不包含旧Sankey opening5742，因此返回空数组。**没有重新collapse或导航后Sankey重新decode阶段**。final pending字段是“曾遇到gate”的布尔latch，不是仍未完成的job计数；gateReleased另记录完成。

该有界Chromium案例在观察的自然scroll与16个settled frames中保留目标，未复现native目标脱挂/大top-spacer白区。没有直接观察私有测量cache或request ID，不能据此确认哪次layout修正模型；没有执行source/version变化、user-scroll-away、focus/Escape或压缩大文档控制。01 setup首败、历史原生navigation首FAIL及Mermaid deadline均仍保留，不因本次PASS关闭。

owner已查看result.png，记录目标marker选区和literal源码可见、无整viewport白区；caret几何以saved DOM核验，截图可受blink影响。本代理未新增视觉验收。Root独立hash/图像审阅随后按第六批单独补入；新的同WebKit研究活动目录未读取。

## 第六批：Root完成browser02独立审阅

`window-navigation-multirow-browser-02-root-review.json`（SHA `a6278e26f679bd69470deac607ca761bfaf7d1608c6bc529289b07ec25964352`）记录Root实际核32项SHA/大小并查看result.png。选中的sequence000 marker及后续literal源码可读，没有viewport顶部白区或marker缺失；截图不独立证明闪烁caret，其精确position8160/line398与可见rect由saved DOM另证。review再次限定合法空provider结果、未覆盖重新collapse、首次Chromium研究PASS不等于生产WebKit/桌面文件历史复现，原native首FAIL未解决。该审阅是单独追加，不改前五批raw或旧metadata。
