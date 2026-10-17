# Checkpoint23：pidfd补充直接身份，诊断04冷gate通过但CPU覆盖仍不完整

04原Node cold gate通过，harness exit0；CPU observer因发现覆盖缺口返回exit2；外层wrapper保留原`samplerExitCode == 0`断言而返回1。三个结果分别报告：wrapper1不是Node冷断言失败，cold PASS也不是完整CPU覆盖或生产验收。新证据确认六个PID/birth身份及其中四条直接父子边，但没有独立绑定WebProcess，也不能据此关闭原production08 `render_3` 超时原因。

基线是已推送 `9498f0c1b08a71a85df19bb18586becc90999a70`，checkpoint22 index SHA256 `1fc88a10fc5bf7cc93dff4d756dad10568325c78bea1688428ff5ed7d778e2c5`。Root保存的remote-verification证明该commit远端SHA与GitHub author/committer `LarryZhu-dev`一致，本归档代理未重复联网。产品代码仍为 `ffa662077bfe696b50c43f94691bc88e5f693c14`；本轮无产品源码修改、无新native构建，原INIT10s/RENDER2s不变。04复用02/03相同诊断binary，SHA `a5fce05f06805931d9e55c2cddc80f1b9e0e4f31c5a756f2bc8eab3b185c0ac8`，不是production08 DEB。

本代理只在外部staging/draft写归档文件，没有运行产品、测试或能力probe，没有live `/proc`检查、清理、仓库修改、提交或Windows上传。旧production08冷失败、01/02 setup失败、03前缀通过及03严格wire首FAIL均保持在checkpoint22固定基线中，不用新结果回写旧结论。

## v03/v04候选与纯逻辑测试的证据口径

v03保留原CPU源码、contract、diff和首测试日志。日志明确报告21 tests、OK；但原组合shell最后执行`cat synthetic-tests.log`，外层exit0不是独立捕获的unittest退出码。`synthetic-first-execution.json`明确保存`pythonExitCodeIndependentlyPersisted:false`；没有为补退出码重跑，也不能把它写成“已独立确认Python exit0”。v03只将缺失children接口等状态显式化，不是产品运行证明。

v04冻结manifest包含7项输入，SHA `2a188f1f1a4cf157d4f29da43c75673271571e16270622995f4badc015e034ff`。Root在静态审阅后仅执行一次纯合成测试，34项通过，实际Python exit0单独保存在`synthetic-first/execution.json`，stdout/stderr原样保留；输入未变。测试不启动native或读取真实进程，不能替代04实际覆盖审阅。

独立静态审阅指出v04 contract中的“live owner”强于通用实现：owner校验检查PID/birth，保留state但没有显式拒绝owner Z/X；target则验证live state及双stat/直接PPID。故通用保证应写成“稳定owner身份与直接关联的live target”。04四份实际首绑定proof的owner/target保存状态恰均为S，这不修复通用contract表述。原contract/代码不改，限定另记。重复fdinfo不能排除同目标close/reopen ABA，绑定时argv标签不证明后续exec状态或永久角色，NSpid不作跨namespace翻译。

v04保持250ms采样、500ms发现及原协作式5ms发现/10ms采样预算；限定owner/round的fdinfo读取、entries和身份等上限保持。静态34项测试不是所有错误分支的穷尽验证；observer exit2可能与controller-stop、failure=null及有用样本同时存在，不能将这个退出码混为Node产品断言结果。

## 一次direct pidfd能力检查与未实现的native方案

Root只执行一次独立受控fixture，耗时28.856707ms，结果SHA `4d82b6ffad4874a2f66e9b289413d2d0fce3114f150040e03f794ffa6d957777`。observer470390创建worker470393/birth8961866，worker创建child470394/birth8961866并持有其pidfd。inside枚举9项、outside8项，二者均动态找到FD5，未预设FD号；fdinfo的Pid470394、目标双stat birth/PPID、owner前后身份与独立child握手oracle一致。相同birth tick不构成身份冲突，身份键包含PID。

inside FD8返回ENOENT原样保留，不能解释成所有FD可读或猜其消失原因；outside无记录的读取错误。该次同namespace直接子能力成立，不证明跨PID namespace映射、历史guardian可读性、无pidfd后代或完整GTK/WebKit树。原始fdinfo重复相同与源中持有descriptor的协议支持本次结果，但不提供一般性的同目标ABA不可能证明。

worker记录releaseReason=pipe-eof，child及worker两次waitpid均exit0；child自己的EOF原因没有单独输出，不能称已独立记录。productStarted=false、globalProcScans0、signalsSent0。CPU与request两个独立审阅分别保存原始身份重解析和退出核对，未由本归档代理重跑。

`native-owned-pidfd-plan-01/PLAN.txt`仅静态方案。它描述当前held pidfd路径及可能的未来native WebProcess自传pidfd方案；没有实现、测试、构建或产品运行。该方案不是04输入变更，也不证明sandbox中相关API实际可用。不能将静态API存在或可选native设计写成已测WebProcess身份。

## 04原冷gate与三个退出状态

原harness记录PASS preinstalled-cold-before-render、PASS preinstalled-cold-window后`DIAGNOSTIC_PREFIX_STOP`。results中的block-000-first-official-example `[108,342)` 图片complete=true、natural size663×281、inlineSvg0，live mode，无notice/diagnostic errors。这里的cold PASS来自原图像断言，不来自sampler退出码。Root已实际查看WebView和X11两张原PNG：light live editor中DB/A/B/C/D block图可见，保留字面`&nbsp;`，下方Animal class图部分可见，saved且无timeout notice；X11窗外黑色是未使用桌面区域。此视觉范围仅原cold-prefix viewport，不是缩放矩阵或Windows。Root像素审阅另存，原run-summary里的visualReview pending字段不回写。

| 记录层       | 原结果                               | 准确含义                                             |
| ------------ | ------------------------------------ | ---------------------------------------------------- |
| Node harness | exit0，原cold gate PASS后prefix STOP | 仅诊断冷前缀通过，未执行独立安装/完整UI/matrix       |
| CPU observer | controller-stop、failure=null、exit2 | 有样本，但发现/children/pidfd覆盖不完整              |
| wrapper      | exit1，原samplerExitCode==0断言失败  | 保留原断言真实结果，不改写为Node cold FAIL或整体PASS |

04输入174项、源文件2913项、frontend12项的冻结检查均无drift；production08原binary SHA仍为 `cd0f892d274bb363ee663e8b36aead93cbee31a4464bdef26ac849f5018cb304`。这不是新生产包验证；完整fallback、ordinary/windowed、history、64组合matrix、edge与Windows验收仍未完成。

## 六个实际身份与CPU范围

App471101/birth9048074 → native guardian471230/birth9048492 → held-pidfd helper471235/birth9048502。helper另持有指向NetworkProcess471238/birth9048508及bwrap471277/birth9048524、bwrap471272/birth9048522的pidfd。首绑定实际FD依次是guardian FD0、helper FD13/26/30，均由有界枚举发现，未假定固定号。

四份首绑定完整proof经独立重解析，重复raw fdinfo、target前后PID/birth/直接PPID/live state、owner前后PID/birth、argv hex与读时刻一致。36条verified-direct-child是这四条边各重复9次，只有首绑定保存全套raw证据；不能说36次都有可独立重解析的完整raw proof。

helper argv为诊断程序加`--milkup-internal-dom-helper`，是GTK host，不是独立确认的WebProcess。NetworkProcess有对应argv；两个其余PID的argv[0]仍为`/usr/bin/bwrap`，其中参数分别包含WebKitWebProcess和xdg-dbus-proxy，参数文字不等于该PID已成为对应程序或存在另一个已绑定子PID。没有`webkit-web`身份；后续exec未被确认，CPU始终归于精确PID/birth。

| PID / 绑定时标签                    | 有效样本 |  观测区间秒 | 自身CPU秒 | leader wait毫秒 |
| ----------------------------------- | -------: | ----------: | --------: | --------------: |
| 471101 App                          |       20 | 4.750291980 |      0.47 |      128.351054 |
| 471230 guardian                     |       20 | 4.750341402 |      0.09 |        2.809980 |
| 471235 helper（renderer-leader）    |       17 | 4.000052520 |      0.12 |      141.998909 |
| 471238 NetworkProcess               |       17 | 4.000007899 |      0.00 |        0.000000 |
| 471277 bwrap（renderer-descendant） |       17 | 3.999982670 |      0.00 |        0.000000 |
| 471272 bwrap（renderer-descendant） |       17 | 3.999978708 |      0.00 |        0.000000 |

20轮采样共108个有效成员样本。各PID表内时间是自己的首末观测端点，不是同一公共区间或单请求总量。App首次发现约比birth tick晚4.195s，helper约467ms、network约409ms、两个bwrap约249/269ms；birth为10ms粒度，不能当精确生存时长。后代首次发现后还约197–199ms才获得首样本。helper首采样已有22 ticks，末为34，表中0.12s不包含此前22 ticks；network首末均8 ticks，bwrap均0，只证明这些样本窗口没有记录到自身CPU增量，不证明此前/此后空闲、子进程无CPU或JavaScript无CPU。

`/proc/PID/schedstat`只反映thread-group leader，表中wait不是全进程全部线程等待，更不是WebProcess调度总量。App、guardian、helper与bwrap必须分开；无共享cgroup数据，也无独立WebProcess CPU。本次新增helper的可归属CPU证据不等于完整renderer执行CPU。

## 发现缺口与协作式预算的实际开销

实际是20轮采样、10轮发现，10轮发现全部incomplete。304个task entries、44个children接口缺口，仅保留32个例子；部分例子包括两个bwrap的children open errno2 ENOENT，不能称成功读取空children。剩余12例没有原文留存。

555次fdinfo读取 =483次普通not-pidfd +36份双读验证。非普通状态保留38条，即36条verified-direct-child与2条timeout；status-record drops0。未记录枚举/读取cap状态；逐轮最大34 task entries、59 fd candidates、63 fdinfo读取低于128 round cap。每owner运行时读取计数没有单独保存，`<=32`是源码限制，不冒称已独立复算每owner实测总数。

普通not-pidfd只存聚合计数，没有每条owner/FD/raw记录，因此不能列出某个bwrap所有读过的FD、证明它的fdinfo被穷尽检查或推断没有pidfd/子进程。两条显式timeout分别是NetworkProcess471238和bwrap471272。即使完成fd枚举，held pidfd也不等于任意后代全集，WebProcess覆盖缺口仍未解决。

协作式5ms发现预算实际有一轮9.479359ms、另一轮5.342969ms；最大单次proc read耗时6.330800ms，记录没有逐路径latency trace来确定是哪项读取。这是已观测的预算超时，不是“硬5ms限制已生效”，也不能把可阻塞读取/调度等待写成一个硬实时限的违反或渲染超时原因。没有提高预算或引入全局进程扫描。

observer自身CPU82.223314ms，prelaunch hash25.281424ms、afterReady56.945087ms；计时点略异，不作精确分割加和。1694次proc读取累计wall23.882614ms，采样wall总5.780106ms/最大0.435706ms，发现wall总35.744625ms/最大9.479359ms；这些嵌套wall成本不能与自身CPU简单相加或从目标CPU扣除。20样本全保留、sampleIncomplete0、无ring eviction/跳槽，最大迟到4.839344ms；但errorCount45只保留32个例子，不能宣称错误为0。native writer CPU20.752323ms已含在App CPU中，captureTotal0.108538ms/max0.020852ms是另一组wall量。没有反事实对照，不声称零扰动或完整树观测开销达标。

## 六份wire通过严格原范围审计，仍不是生命周期完整性

04 instance `95dc66282a839dd15baf4f1cc4e26ea61af30a9d0c007bab` 的capture共7 events：1 guardian-spawn与render_1..6。未修改的严格auditor首次exit0、ok=true、errors[]；六个instance/request key与完整冻结driver.log的六个dispatch逐一对应。没有首FAIL后缩范围，也不把03严格首FAIL改成通过。

六份serialized wire保持完整UTF8、字节数/SHA/16输入字段/身份/原fixture切片核验：render_1/2/4为block `[108,342)`、body `[119,339)`、各950 bytes；render_3/5为classDiagram `[440,969)`、body `[451,966)`、各1256 bytes；render_6为ER `[1087,1257)`、body `[1098,1254)`、882 bytes。均为绝对UTF16半开区间，另存Unicode偏移证明。04的ER render_6不能回填03缺失的render_6，class render_3也不能回填production08未知输入。

CPU nativeEvents同样保存六个dispatch。本次冻结driver没有额外缺wire的dispatch，但native_trace没有完整loss/response计数，六份输入不证明六个结果均settled。没有deadline-observed或response-completion时刻，不能计算dispatch→deadline CPU区间；相邻dispatch、UI PASS、capture final或guardian kill-start都不是请求终点替代物。

末render_6 dispatch为90489654299727ns，末captureAfter为90489654348501ns，final checkpoint为90489855285842ns，guardian kill-start为90489892089077ns。因此末dispatch早于final200.986115ms，kill-start晚于final36.803235ms。finish.request仍只有字符串、无单调创建时刻，实际closed.store也未记录；final checkpoint不能替代精确关闭时刻。final只确认关闭观察范围内已入队记录drain，不能覆盖之后或整个App生命周期。

末成员sample read结束于90489686427367ns，observer结束前仍有224.969854ms尾部未采样。parser只接受App事件，因此guardian kill-start不在其nativeEvents schema中，与遗漏App dispatch是两回事。没有将session cleanup kill当deadline或render_6终点。status与complete相同，attempted=enqueued=written7、wire总6244 bytes，记录的drop/error/inFlight为0，也只属于该capture窗口。

## 清理与选择性归档

冻结cleanup列20个已知PID absent，其中17个有expected birth、3个仅PID；专用端口无listener、ancestor reaps11。原session close后，按精确driver PID/birth/PGID与No sessions执行既有owned group停止，subreaper仅等待回收。未知后代不能由这份known清单追认为完整已发现/已采样/已清理，本代理没有重扫或发signal。

run04完整manifest199项共17,329,086字节原文保留。本归档代理实际核验并纳入55项非profile文件共8,318,628字节，其中21项准备文件、34项运行产物；另144项profile/cache/安装主体共9,010,458字节只保留排除元数据，没有读取或复制。CPU/request/Root各自完整199项核验按其冻结审阅引用，不冒称本代理读了全部主体。pending准备文件、原template、最终GO及运行结果分别原字节保存，不回写旧准备状态。

最终索引112个source aliases、8,918,389来源字节；94个本地唯一对象共999,423字节，12个跨checkpoint唯一对象共7,914,234字节，2个新增PNG。24项artifact/frontend/runtime工具/诊断binary引用共90,787,550字节沿用基线元数据，按来源路径计数，并非新增正文或唯一artifact体积。原candidate、合成首日志、能力probe、原wire审计输出、截图与审阅均按SHA去重；旧证据由checkpoint06–22固定index SHA/commit基线链保留；历史render2754的未知输入/截止因果同样未关闭。后续WebProcess Cguard私有FD-list诊断候选尚无build/runtime结果，不纳入本检查点。binary、frontend、profile/cache、node_modules、target、pycache主体不复制。

`verify-index.py`检查固定基线、对象SHA/大小、aliases、无重复对象、孤儿或symlink；外部`checkpoint23-draft/verify-final01.sh`复核来源、选择性范围与结果边界，生成handoff01。README用仓库Prettier规范化，raw不格式化；定向敏感模式筛查不是任意秘密不存在证明。所有归档检查PASS只表示证据完整性/格式，不是生产、fullUI、matrix、Windows或P4完成。
