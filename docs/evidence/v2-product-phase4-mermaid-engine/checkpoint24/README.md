# Checkpoint24：native self-pidfd 首次绑定 WebProcess，诊断05冷gate通过但覆盖仍不完整

05原Node cold gate通过、harness exit0；CPU observer因发现覆盖缺口返回exit2；外层wrapper保留原`samplerExitCode == 0`断言而返回1。本轮首次记录native receiver持有WebProcess自传pidfd，并由外部observer独立绑定精确WebProcess PID/birth与helper祖先链。它只证明这一次sandboxed诊断运行中的能力，不是完整renderer树、生产DEB、完整UI/matrix或旧production08超时根因关闭。

固定基线为已推送`9b4f78d68d81d2f21b123e86e2bf4f8b90e74e8b`，checkpoint23 index SHA256 `521fdb8136c9ac55e704999afc84bb11a3c0afd96fccae606fe30db9d4d472bd`；Root保存的remote-verification记录本地/远端SHA与GitHub author/committer LarryZhu-dev一致，本代理没有重复联网。产品代码仍为`ffa662077bfe696b50c43f94691bc88e5f693c14`；原INIT10s/RENDER2s不变。此次只有单独诊断候选的一次构建及一次冷前缀运行，不能写成生产包重建或产品代码提交。

本代理只写外部staging/draft，没有运行产品、测试或能力probe，没有live `/proc`读取、signal、清理、仓库修改、提交或Windows上传。旧production08冷首FAIL、01/02 setupFAIL、03严格wire首FAIL和04覆盖不足均保持原文及固定crossrefs；setupFAIL不是产品FAIL。历史render2754及production08 render_3完整输入/截止因果仍未知；新run的相同request序号不能回填旧实例。

## 冻结候选、57项合成测试及唯一构建

native候选清单SHA `ad4bfc318bc6ff6df3b14bf4bb5e3f83081b23879b4a4693a3dc78cf3a106a72`保存3个源码overlay、contract、schema例子、patch和API引用。原manifest的PREPARED_STATIC_REVIEW_ONLY_NOT_BUILT_OR_RUN是当时状态，保持不改；prepared/final build-inputs、GO模板/准备版/最终版、静态审阅、wrapper及后续build结果并列保存，不用新结果覆盖历史准备记录。

候选沿用原C guard及guard-ready路径，添加受控native WebContext初始化数据；C扩展一次self-pidfd调用，经GUnixFDList私有message传递，helper接收一个FD并保留CLOEXEC副本至退出。记录绑定compiled extension SHA及instance；不由JavaScript提供PID，不新增页面权限、不关闭目标FD、不发送信号。静态约束包括固定0700目录、0600/no-follow/exclusive记录、每份8KiB上限及一份armed/一份result。有限字节上限不是同步IO/回调时间上限；同UID受控来源假设也不是密码学来源证明。

CPU v05设计、10输入prepared manifest（SHA `ac396381a7a52d36484dd104d5bb6fa5121b3b03b3a02194160846161c31ca33`）、Root静态审阅和request独立静态审阅均保留。外部observer只在已绑定helper下读精确record路径，以重复raw fdinfo的kernel Pid定位observer视图目标；不把innerPid/NSpid当外部PID映射。目标链最多8节点，正向读取后逆序复核，helper/guardian身份与argv读数置于bracket中。它不是原子快照，也不排除同目标close/reopen ABA。只有实际argv[0] basename为WebKitWebProcess才获得webkit-web标签，绑定时标签不保证后续exec。

v05保留原250ms采样、500ms发现、协作式5ms发现及10ms采样预算和原owner32/round128 fdinfo上限；优先native验证不能被解释为提高预算或全局进程扫描。Root只执行一次fake-FS纯逻辑测试：57项通过（原34项加23项），实际Python exit0单独保存，输入前后未变。stdout/stderr与execution原字节保留；没有通过重复测试补写首结果。57项合成测试不证明真实kernel传输或实际覆盖。

唯一native诊断构建02:46:42.840255至02:47:50.373740 UTC，首轮exit0、没有retry。build-result SHA `bdc67d410699cdc8f9b5a1ab0399c58e34092c67db50bd5d1e3cba5433f6eccb`，Root post-build review SHA `666e53453cad551a91db1c8b41b277617cfd64741ac8bb5265002a48eb84142d`。新binary SHA `b8c68aaf2d24a59f9e4cc60f1b03799b45aaecffe3379c2830866b7ac4f0e2c4`、21,962,312 B；SO SHA `0355b69f0f15e4d0efa5f5ab137d45b8342233f32b16c0240521a45695a6f8f3`、16,824 B。Root确认完整SO字节仅嵌入一次、offset1,500,320；这是Root artifact核验，本归档代理未读取这些body。

原构建日志含unused import warning，命令、结果、4份恢复源码、旧target元数据和后验恢复证明均保留；新增诊断模块在恢复后移除。构建使用3份先前accepted-wire overlay与3份新增native overlay，结束后生产源码恢复；2913源码/12frontend无drift。旧生产binary及先前诊断binary保持原SHA。build-first完整清单33项/44,610,270 B保留，其中29项690,134 B核验纳正文，4项artifact共43,920,136 B仅metadata。

## 05原断言、native身份与清理

| 记录层            | 原结果                                          | 准确含义                                               |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------ |
| Node harness      | 原cold gate PASS、exit0、DIAGNOSTIC_PREFIX_STOP | 仅诊断冷前缀，未完成fullUI或生产验收                   |
| native self-pidfd | armed=receiver-prepared；result=held            | 这次运行观察到单个有效传输，不能外推所有环境或生命周期 |
| CPU observer      | controller-stop、failure=null、exit2            | 有有效身份及样本，但发现覆盖incomplete                 |
| wrapper           | exit1，原samplerExitCode==0断言失败             | 独立保存，不改成Node冷FAIL或整体PASS                   |

run05固定清单SHA `170bcabfc28c2dc536a050964da1006cd890c03fccdc4aa4a7e95288db4cd101`。263输入、2913源码及12frontend的owner冻结检查无drift；原production08 binary仍为`cd0f892d274bb363ee663e8b36aead93cbee31a4464bdef26ac849f5018cb304`。两张原PNG纳正文，像素解释另见Root独立review；原run-summary的visualReview pending保持原文。

armed JSON SHA `7b15da622782dc6876ffeefe5cfc2b62d87840556fd9132f22b597af7f01640d`，result SHA `78e62d4e273a5867ed657a0285cbc8219880a10af3537ca96c68193bae9b11b0`。这两份是核心原始证据，不按profile排除。helper474296/birth9322901接收并持有FD22，result记录receivedFdCount1、tokenMatched、held及raw fdinfo；内核Pid474342、NSpid474342/2。真正的外部绑定来自observer的重复fdinfo、helper/guardian活身份bracket、4节点PPID链与绑定时argv，不仅是native JSON自报PID。

四节点为474342/birth9322922 → 474340/birth9322921 → 474338/birth9322921 → helper474296/birth9322901；上层guardian474291/birth9322889 → App474164/birth9322577。474342 argv[0]实际为`/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess`。保存的完整raw首绑定proof在CPU summary，包含chainBefore/After、两次fdinfo、源record digest、读取时刻和argv rawHex。四节点存在于proof不等于四节点都进入CPU采样成员；474340仅为链节点，不能据此虚构它的CPU观测。

CPU共6个绑定PID/birth：App、guardian、helper、WebProcess、NetworkProcess474299/birth9322910及绑定时bwrap474338/birth9322921。22轮采样、sampleIncomplete0，10轮发现全部incomplete，44个children接口缺口、10个pidfd gap，fullRendererTreeCoverage=false。新增WebProcess自己的采样CPU可与App/guardian/helper分开，但仍不等于完整renderer树CPU、初始/终末CPU、每请求CPU或根因；AppCPU不等于rendererCPU，leader schedstat也不是全线程等待。

共726次fdinfo读取；native-verified-webprocess状态9次不能写成9份完整独立raw首绑定proof。协作式5ms发现实际max13.732632ms，不能声称硬5ms实时限制生效或据此推断渲染超时原因。observer自身CPU84.999888ms、prelaunch hash19.219183ms、afterReady65.782989ms；proc reads2153、read wall总19.408953ms/max0.452444ms；采样wall总7.696791ms/max0.522784ms、发现wall总42.744213ms。这些嵌套wall量与CPU不可简单加减，无反事实零扰动证明。

原生记录的captureEnd位于序列化/发布之前，C callbackEnd位于message发送之前；不是完整开销终点。outer time/time_for_children namespace links均ENOENT，未独立证明WebProcess与外部observer时钟namespace等价。数值先后关系不能替代该证明，不跨时钟直接相减来生成传输延迟或请求CPU端点。

cleanup冻结清单21个已知PID absent，专用端口无listener，ancestor reaps11。范围包含保存的native祖先链节点，仍不证明未知进程树全空；本代理没有另作live检查或清理。

## wire窗口、独立复核与未关闭问题

capture保存1个guardian-spawn与6份accepted render，共7 events，attempted=enqueued=written7、wire6244 B，记录drop/error/inFlight为0。完整wire及原driver日志均保留，严格auditor首次结果须按独立request review原文报告；final仅表示已接受观察集合drain，不是整个App生命周期、每个request settled或deadline观测。finish.request没有单调创建时刻，final checkpoint不是关闭marker实测时刻。UI PASS、相邻dispatch及cleanup kill均不能代替请求终点。

三份独立冻结审阅已纳入：CPU review-manifest SHA `325ae674733f36c48638de1d848211eb901e4cb09f9b2040051d749608a56fdf`，request review-manifest SHA `e019ebee24a618e3f307dffbd4209603dd60621102f48cee8e078cbaf12dcbfa`，Root pixel/hash review SHA `a7415ec7dc77eb6ecb47f610f38d1050faf5d72875c5bb9536397cd7547db6f9`。CPU离线审计准备manifest/脚本、原首执行命令/stdout/stderr/actualexit0与前后脚本SHA均保存；prepared里的尚未执行状态不回写。Root与两位reviewer各自对完整204文件核验无差异，这是它们的完整读取报告，本归档代理仅核选择性正文。

Root实际查看WebView/X11两张PNG：light live editor、DB/A/B/C/D block图及已知字面`&nbsp;`标签、部分Animal class图，saved且无timeout notice；X11黑色区域在应用窗外。原cold结果block-000 `[108,342)` 图片complete、663×281、inlineSvg0，无notice/diagnostic errors。这只覆盖原冷前缀viewport，不能扩写为完整UI或缩放matrix。

CPU独立审计确认22轮共120个有效成员样本；App/guardian各22，其他四PID各19。各行端点不同，不能当共同区间求和或请求总CPU：

| PID / 绑定时标签      | 样本数 | 首末样本跨度秒 | 自身CPU秒 | leader wait毫秒 |
| --------------------- | -----: | -------------: | --------: | --------------: |
| 474164 App            |     22 |    5.250250668 |      0.49 |      130.442957 |
| 474291 guardian       |     22 |    5.250284700 |      0.07 |        3.588684 |
| 474296 helper         |     19 |    4.500123039 |      0.16 |      204.587351 |
| 474342 WebProcess     |     19 |    4.500132008 |      2.52 |      113.762610 |
| 474299 NetworkProcess |     19 |    4.500133309 |      0.00 |        0.396629 |
| 474338 bwrap          |     19 |    4.500133643 |      0.00 |        0.000000 |

WebProcess首末计数44→296ticks（100Hz），2.52s不含首44ticks；首绑定约晚于10ms粒度birth tick282.162110ms，绑定后再195.005084ms才有首样本。首身份proof里的23/24ticks不能另加成一个CPU区间。Network tick增量0但leader runtime增加0.647638ms，直接说明零tick不能写成没有执行；bwrap的零tick更不能说明其子进程没有CPU。WebProcess own CPU包括其自身线程，但leader runtime/wait非全线程合计，不能相减提取JavaScript CPU。

逐轮计数确认共享预算：9个活动round里helper各32读取，含2次native精确FD读和30次普通读，在FD28之前触及cap；不能推定FD28身份或未读FD内容。726次总读取=645次ordinary non-pidfd+27条普通verified边的54次读取+9次ordinary non-direct-child+9次native proof的18次读取。9次non-direct-child正是helper FD22→WebProcess：ordinary direct-child规则拒绝它，native有界祖先链规则接纳。native优先级保留已完整proof，ordinary枚举仍被截断，不是完整树。

native累计18次固定记录读、9次target attempts、36节点访问、72chain stat/108native total stat；每活动round2files/1target/4nodes/8chain stat/12total stat，未提高原声明上限。发现13.732632ms那轮，WebProcess在round start+2.842724ms已完成绑定，后续扫描该目标才记录TimeoutError。完整首proof可保留与该轮incomplete同时成立。没有逐路径wall trace，不据此指认某个调用、调度或CPU负载造成超时。

未修改strict wire auditor SHA `b6cd88e6a7990a06212879a294ab874d7d49499f6a1efce1bdb9d5932c53b2f9`对完整冻结driver/fixture/plan只运行一次，actualexit0、ok=true、errors[]；没有缩范围重跑。六个instance/request key与全部冻结dispatch严格一致，完整UTF8字节/SHA、16个字段、UTF16半开源区间均复核：render_1/2/4为block fence `[108,342)` / body `[119,339)`、各950bytes；render_3/5为class fence `[440,969)` / body `[451,966)`、各1256bytes；render_6为ER fence `[1087,1257)` / body `[1098,1254)`、882bytes。run05 render_3不能回填production08，run05 render_6也不能补run03缺失原输入。

末dispatch93233628396053ns、末captureAfter93233628436428ns、final checkpoint93234334673267ns、guardian kill-start93234394775937ns。因此末dispatch早于final706.277214ms，kill晚于final60.102670ms；无后续dispatch出现在这份冻结日志。CPU review中“capture closes”使用的是final数值，本README按request审阅严格限定为final checkpoint，不能当实际closed.store时刻；原review原文保留。最后成员sample read至observer结束仍有235.741523ms未采样尾部。六个dispatch没有response-completion或deadline endpoint，deadlineRequests为空，不构造dispatch→deadline CPU区间。

native writer自身CPU22.517400ms属于App自身CPU，不额外加到表内App数值；capture wall总0.073287ms/max0.017806ms与writer CPU是不同范围。native helper prepare→captureEnd0.265622ms、C自身准备0.013681ms、helper receive→captureEnd0.087897ms仅各自进程局部片段，不是全发布开销；recordIo1.541261ms是observer读取成本，不是native文件发布耗时。outer时钟namespace缺失、publication尾部及cleanup未记录FD释放精确时刻等限制不因成功绑定而消失。

## 尚未实现的stage timing方案

`cold-render-stage-timing-static-01`完整静态清单SHA `5512fee79d5a20e128f1f2d174b951c000980599a20b322b06af6bd02eca867f`，纳入PLAN与source-inputs两文件及11项源输入核验metadata；未复制依赖安装主体。方案先考虑native/bootstrap边界，再按证据决定是否需要renderer内部initialize/render/converter/serialization四区间；第二层会改变研究插件字节，不能当官方包验收。

这里只冻结计划，没有实现、仪表化、构建、测试或运行。JS marks为不受信诊断wall时刻，不赋予native身份、settlement或deadline权限；performance.now不能直接与CLOCK_MONOTONIC相减。同步堵塞可阻止私有drain，kill前未导出的marks会丢失，缺失记录不能证明某阶段没有运行或定位堵塞阶段。未来研究不纳入本检查点。

## 选择性归档与复核

run05完整清单204项/17,483,313 B原文保留，本代理实际核验60项非profile文件/8,360,950 B；另144项profile/cache/安装主体9,122,363 B仅排除metadata，不读取或复制。Root与独立review的完整主体核验各按其报告引用，不冒称本代理读过全部主体。binary、SO、target/target-before、frontend、node_modules、profile/cache主体不复制。

最终索引149个source aliases、9,708,423来源字节；125个本地唯一对象1,683,707 B，17个跨checkpoint唯一对象8,022,042 B，2个新增PNG。28项artifact/frontend/runtime工具/诊断binary引用134,707,686 B沿用或追加元数据，按来源路径计数，不是新增正文或唯一artifact体积。

所有来源按SHA跨checkpoint去重，旧对象固定commit/index哈希；raw保持原字节，只有README经过仓库Prettier。`verify-index.py`检查基线SHA、对象大小/哈希、aliases、重复/孤儿/symlink；外部`checkpoint24-draft/verify-final01.sh`复核来源、选择性范围和关键结果边界。定向敏感模式筛查不是任意秘密不存在证明。归档检查PASS只表示证据完整性和格式；生产、fullUI、matrix、Windows与P4完成仍为0。
