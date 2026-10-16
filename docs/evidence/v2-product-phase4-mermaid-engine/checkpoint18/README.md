# Checkpoint18：首诊断 navigation FAIL 与受控浏览器几何首 FAIL

初批收录三份明确完成的输入：checkpoint17远端/GitHub身份核验、`ui10-deadline-diagnostic-static-review.json` 静态方案、`ui10-deadline-cgroup-readonly-capability.json` 单次能力检查。checkpoint17 commit为 `cc9eb8395e893887b45d7372760834f8ac2531ae`，index SHA为 `4416fb8fb1b22be10fe19504be8005af345ebd903a2fb3d35991e41328c34804`；checkpoint06–17原件与索引保持不变。

静态方案不等于已实现的诊断或runtime结果。方案区分transport payload、精确PID/birth的有限CPU观察及必要时的独立native阶段研究，保留预算/首FAIL边界；不能把render2754绑定class、ex、fixed seed、内存、CPU饱和或调度原因。所列产品/依赖source SHA只是原报告引用，本次不重新读取完整源码树或依赖。

cgroup报告是一次只读自身cgroup/mountinfo及指定文件的能力检查，不是UI10失败窗口测量。共享累计cpu.stat/memory.events无法归因单个renderer，cpu.max不是单次render CPU配额，memory.events max不等于OOM；所查PSI路径不可用。未来采样ring仅为候选，不能写成已采样或已有因果结论。

初始静态捕获时 `native-ui10-deadline-diagnostic-01` 的 runtime 未读取；其后明确完成的首诊断按第三批独立清单归档，历史准备状态不回写。后续只在Root GO及owner completed-manifest明确冻结后，按显式清单核SHA/大小并去重；不会遍历活动目录或以估计数量替代实际结果。二进制/依赖/profile/cache主体不收录，必要产物只保留明确metadata引用。

`verify-index.py` 支持相邻checkpoint06–17；外部staging使用对应 `--checkpoint06` 至 `--checkpoint17` 路径。外部 `checkpoint18-draft/append-frozen-manifest.py` 按已完成清单执行静态归档，未以活动诊断输入执行；要求manifest/SHA/row-base/count/完成确认，先全清单核验再复制原件和保留旧metadata。本次未改仓库或旧检查点、未启动测试/构建/原生程序。

## 第二批：冻结准备文件与单次授权，不是 runtime 结果

只按 `native-ui10-deadline-diagnostic-01/prepared-inputs.json` 的57项相对 `files[].path` 收录454,194字节，另存manifest自身；`prepared-documentation-addendum.json` 的两项明确文档及自身单独补入。原PLAN与revision01/02/03、静态/有限synthetic日志原样保留。两份文档说明实际 finish-before-export 与 `harness-final` 控制次序，旧文案不回填、没有可执行输入变更。清单之外的run/profile/log、新execution/preflight没有读取，未递归展开此活动目录。

独立静态review对57项SHA/大小、完整workflow逆变换与原92870全字节相等作出审阅；18项VM observer合同与38项有限fake CPU案例属于owner已完成准备日志，不是本代理重跑、实际集成或renderer CPU证据。原cold/install前存在采集空档；完整parsed request不等于raw IPC字节，成功wire result不等于host AST接受。observer/cgroup/App采样、导出和等待都增加诊断开销，不称零扰动。

CPU准备仅针对精确App PID/birth与observer可见共享cgroup，不枚举进程表、不提供WebKit renderer CPU归因。静态修正包括exclusive sampler output、统一 `harness-final`、严格当前instance/timeout ID与取消语义等，不能由这些代码检查宣布诊断已经捕获故障或复现通过。预算及第一失败保留规则不因授权而放宽。

`root-runtime-go.json` 是已完成的单次执行授权记录，不是执行成功或运行结果。原prepared manifest的“awaiting GO”是其写入时状态，后续授权独立补齐、不改旧raw。该批只做小文件hash/原字节复制；runtime证据后来依第三批完成manifest及Root GO单独收录。初批三输入和metadata历史保留在外部支持目录，仓库及旧检查点未改。

## 第三批：已完成首诊断，保留第一次 navigation 失败

按 `product-ui-runs/control/mermaid-ui-deadline-diagnostic-01/completed-manifest.json` 的234个绝对路径文件收录17,454,917字节，另存manifest自身；其与前批相同准备文件复用既有alias，不重复计为新的原件。Root完成全部hash/大小及136张PNG引用核验，ordinary11914字节、windowed7851914字节仍与fixture原样相同。排除大文件work副本、profile、binary/archive主体，仅保存明确元数据；没有删除这些外部原件。

运行于23:22:42–23:29:31 UTC首轮exit1，70条records保留最终FAIL：ordinary coverage31、windowed coverage19、selection1、history6、matrix0。失败为windowed sequenceDiagram-000搜索后的完整marker mounted-selection readiness在原30秒内未满足；无重试、预算扩大或产品改动。Root实际看FAIL-webview：标题/路径/保存页脚仍可见，编辑区域白色且没有目标marker/source/diagram/caret。**白区像素不等于数据丢失**，最终磁盘字节另行核验；也不证明Mermaid失败、解码故障或native超时。

目标marker唯一范围8103..8160、围栏8162..8293；四个真实outgoing request快照携带正确逻辑selection，其中render1129直接对应该围栏，后三个对应邻近围栏。最终public DOM projection为空、cursor:null，不能由mounted overlay缺失推出逻辑selection从未设置；四个快照也不能证明整个时间段连续正确。静态navigation审阅把几何变化/窗口替换列为候选交错，未确认Escape直接取消reveal、旧search count误用或preview reflow就是原因；新browser/native研究未读取。

## Transport、CPU与时序限定

observer记录958 render sends与958 matched result envelopes，289取消不释放pin；export时active:null、firstFault:null。仅保留63个完整recent parsed inputs共130392字节，895个completed inputs和1951个metadata events按有界策略淘汰。`incoming-instance-not-observed-since-install` incomplete仍保留，cold/startup/install在安装前有空档，相关早期事件已淘汰，不能称gap-free。累计capture503ms/max47ms、3913 calls，是额外观察开销，不从产品时间扣除。有效result envelope不等于host接受或paint成功，parsed JSON不是原始IPC序列化字节。

离线 `map-deadline-transport.mjs` 与完成map JSON只映射63个保留请求，exactTimeoutInputKey=null；不重新运行映射脚本。该次native best-effort日志deadline-observed为0，不能恢复历史UI10 render2754的未知payload或关闭其根因。

CPU sampler仅绑定App441230/birth8057507，firstDeadline:null，最后保留59.626725546秒实际App区间527 user+219 system ticks（100Hz，共7.46秒自身App CPU）；它不是WebKit renderer CPU，不能解释历史deadline。共享cgroup为其自己的59.050257159秒区间，不能独占归因该renderer。窗口、读取开销、启动日志空档及采样限定保留；没有把无deadline当成正式验收通过。

`actual-integration-order-correction.json` 单独纠正旧PLAN-final/integration文案：实际是发送 `harness-final` →导出/停止page observer→最多5秒等sampler自然完成→持久化completion→调用原App.close。旧文档曾把App.close排在natural-await前，原件不回写。诊断导出/等待可延迟FAIL截图，不能与正式UI10截图时间直接等同。

## 完成审阅与清理范围

ordinary-new-range review清单为1个相对path metadata：所请求的新矩阵record没产生，实际审图0，不挪用旧UI10图。windowed review按 `files[].file` 相对schema收6份metadata，仅实际查看1张FAIL图；matrix/corner available和reviewed均0。Root独立失败审阅、两份navigation静态审阅保留各自写入时scope/未证明事项，不表述为已修复或回归GREEN。

该次App、driver、launcher、harness、sampler与先前trace emitter均absent；最终guardian441550为已终止PID1 Z，不能写成所有身份消失。trace guardian在live时未捕birth，当前PID状态有该限定。driver经NoSessions、精确身份匹配后单独终止，端口ECONNREFUSED、Xvfb126保留的证据来自冻结记录，本代理没有重新探测或运行原生程序。

原静态三输入/准备metadata及首FAIL均原样保留。第三批完成时不含后续browser/native-navigation研究；第四批只追加随后明确冻结的浏览器首跑。活动原生导航研究、产品修复或完整验收仍不在范围；本次仅静态归档、未改仓库或提交。

## 第四批：浏览器首跑严格几何失败，未复现原生脱挂

`window-navigation-reflow-browser-01/manifest.json` 实际为23项相对 `files[].path`；逐项SHA/大小均核验，22项原件按内容去重收录，唯一 `trace.zip`（770921字节，SHA `fe86d4f3898bdd7f4e337be77ae1486285f9cc018989c8e49599900040674eb6`）仅保留外部原件引用。原manifest、summary、run/report/execution/cleanup、冻结源码、两张原始PNG，以及独立静态review与Root实际图像/清单审阅分别原样保留。该trace未解包、未复制，不能称本检查点自包含全部trace原件。

单次Linux Chromium研究case、retries0、exit1：在公开SourceDocumentView路径已设置selection且marker挂载后，受控provider刷新使实际已解码图像高度600→80，并等待实际布局。第一条严格几何断言要求marker整行top≥editor top，实测36.78125<37，差0.21875 CSS px，故首FAIL。没有调整阈值、重试或产品修改。

保存的24帧RAF记录中目标marker均仍挂载，logical selection仍正确，projection count1且范围一致、cursor1、version0、source不变、pageErrors为空。这些是对已保存结果的独立观察；**第一条失败后其余测试断言没有执行，不计为后续断言PASS**。Root及owner实际查看result.png，Unicode marker、选区和光标可见，没有复现原生白区/目标脱挂；截图不能判断0.21875 CSS px盒偏差是否意味着字形裁切。此受控路径不等于原生搜索/Escape完整历史，也未执行高度增长、用户wheel或source/version变化guards。

研究测试冻结副本 `source/tests/e2e/desktop-window-navigation-reflow.spec.ts` 为13621字节，SHA `b04579f774949c6c11419409b8e3a71c98079a1d5800dbfaf47f24c399285184`；捕获时与repo未跟踪测试逐字相等。该fixture未提升为全仓常规回归，Root可移除未跟踪入口，冻结副本仍按索引保留。本批只存研究首FAIL，不将未复现机制称为产品regression PASS，更未关闭历史Mermaid deadline。

`checkpoint18-draft/verify-final04.sh` 是外部支持命令，明确列出checkpoint06–17全部基线路径；`handoff04.json` 和静态敏感模式报告也是外部支持材料，不冒充已收录raw运行证据。活动native-navigation目录没有读取。
