# Checkpoint06 工作分支检查点：尚未完成产品验收

本目录已按 Root copy GO 从冻结的外部 verify24 staging 完整复制到工作分支的 `docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06`。这是可追溯的过程检查点，**不是正式产品验收完成**；提交和推送由主代理统一处理，归档代理未提交。原始对象与旧证据保持原字节，只有本 README 的保存状态说明及 README/index 的仓库格式化发生变化。

下文按时间保留各批次结果和限制。“外部 staging / 未入仓 / 活跃”若出现在历史段落，描述的是该批归档时点，不覆盖顶部最新状态。正式 UI04 仍为 ordinary3/windowed0/UI640 首轮 RED；后来诊断通过不关闭该失败。

## 未随本检查点归档的外部支持材料

文中 `draft/...`、`checkpoint06-draft/...` 以及外部绝对路径指向当时执行器 `/workspace/milkup-mermaid-engine-evidence/` 下的支持审计或原件，不是本仓库内的相对链接。除 index 明确列出的历史副本外，外部 draft 的逐次验证报告、append-review、敏感模式筛查报告、freeze-handoff、部分捕获备份及辅助脚本**没有随本目录复制**；不能假称可仅从本仓库读取。它们保留为来源说明，raw 对象索引不因此扩大。

本目录自带 `verify-staging.py`，可对仓库内全部索引对象重新核验哈希、长度、别名与未索引文件；它不依赖外部原件，也不把归档完整性当作产品测试。二进制、构建缓存、profile、SQLite和正文提及但未在index中收录的文件仍未归档。

仅复制已冻结选集、计算哈希和整理证据，没有执行测试/渲染。`index.json` 的 sourceAliases 保留每个绝对原路径、组别、字节、SHA 和 stored 路径；同字节内容只存一份，PNG 采用 images/SHA.png。文本原字节追加 .txt，未格式化。排除生成 JavaScript bundle、可执行二进制/正式插件档案、SDK tgz、node_modules、profile、target/build；production03/04显式清单中的15个小型UTF8 JSON lifecycle fixture档案为例外，原样保留供复核；原来源清单中的路径与哈希仍保留，不假装这些产物随本目录交付。

## 最新状态（prefix诊断01完成后的检查点冻结）

- 最新全仓正式门禁gates05在最终8dc manager上，typecheck、test、lint、build四命令一次均exit0；**单次test为2051 Vitest + 4 Node = 2055 distinct通过**。下文gates04的2024、2008、1972等仅为各历史批次计数。
- 最新修复验证：最终8dc上199 focused、strict/format通过；8a阶段33批次整34 browser通过，最后一行scroll修正后8dc上34批次两项layout通过。实际变动AST受控Chromium观察通过，不是native验收；旧20+22组合34及其失败仍保留。
- 最新production04：五项生命周期均首轮PASS，2912捕获源输入最终全等；45 owned身份与5 drivers审计消失。production03的10次尝试5 PASS/5 RED及更早历史完整保留。
- 最新官方UI04已结束：cold、4 fallback、4 notice PASS；ordinary block/class/ER 3 PASS，随后flow等待首RED；windowed 0、UI64 0。原生render68在自身dispatch后2000.150499ms触发watchdog，payload未捕获，不能绑定flow或推定原因。transport诊断01已结束但未复现deadline，不改变正式RED；诊断02在App启动前发生harness ENOENT，已结束归档；诊断03在任何observer mutation前守卫拒绝，已结束归档；诊断04在cold首图原gate发生真实native render3 deadline，observer未安装/无payload；该批已结束归档。独立native-stage候选静态构建已结束并收录；fresh-prefix诊断01已结束并收录：75结算/无deadline仅诊断，正式UI04仍RED；CPU sampler/coldbatch/eagerload研究活跃未收录。
- 本目录已保存为工作分支检查点，尚未完成产品验收。以下章节按归档批次保留时点与边界；新的结果不回写旧raw证据。

## 已纳入的历史批次

- converter04：68 native 调用，37 矩阵为 30 官方 + 7 本地；30 converter ready、29 host accepted，Gantt text opacity 是真实 host RED。另 31 固定合同符合预期。48 ready 输出共 47 host 接受。旧 review 键名错误由 counting-addendum 单独解释，原件不改。
- converter05：新单个 Gantt converter→current core→canonical image 链路，100% 实际像素通过；不是重新扫描 37 项，也不是最终生产视图或 125%/200% canonical image 验收。family-status 的 30 接受观察混合旧 29 + 新 Gantt，保留 revision 边界。
- bounded identity：23 项 focused、93 SVG suite；最初断言文案错误与 corrected RED、整数 surface 额外 RED 原样保留。开发05的89测试/严格类型与最初 pnpm 未启动测试错误另列。
- Gantt opacity 原型：alpha redistribution 首次100%像素 RED；后续 bounded identity 100/125/200 inline 原图对照字节一致，不混作最终img。两种候选的原始文件分别保留。
- raster edge研究批次：固定探针全部168 PNG及执行元数据已纳入。7 plain exact；scroll7均可达但3 exact/4 far-edge offset，最多1CSSpx透明余量边界不等于像素全绿。有效 SVG 阴影正例和无有效 CSS 阴影对照分开；fractional clip 的11像素失败保留，shell cat exit0不代替比较结果。
- 最终 SDK install/build：SDK0.3.4精确包证明、冻结锁/闭包、独立diagrams及10插件公开SDK构建日志、源码快照、16构建合同检查与89diagrams测试。最终实际打包使用69个runtime包、分发71份notice文本；历史121记录不作为最终许可数。源脚本 post-freeze-format-only01 差异单列，不伪造重跑构建。
- repository-gates01/02/formatfix：历史记录1972个Vitest通过，但后来确认同样误收集4个Node失败，原命令不能独立算完整测试门禁；typecheck通过，首轮format两文件失败→仅格式修正→format/build通过。独立插件89与构建合同16不累加进1972。原始日志与总摘要保留。
- UI静态handoff/catalog reconciliation 仅准备，不计生产执行。

## 历史来源缺口与可追溯映射

归档准备的 historical-snapshot-mapping-update02.json 已核验旧 alpha entry、edge旧geometry、prepare及native-scroll到既有快照。旧JSON未回写，历史可变路径当前SHA不同的事实保留。

明确未保存：alpha首败旧88MB helper二进制只有历史hash、源码与编译日志；edge旧fixtures生成脚本45d74ca6完整快照未找到。各run的entry/validated-image及冻结runtime/guard记录仍在，不用后续文件补造旧内容。外部staging本身也不包含任何二进制。

## 历史归档交接说明（production01追加时）

production01追加时，其生产deb来源证明及真实生命周期已收录，见下文；当时官方 Mermaid UI 呈现存在真实不稳定 RED，64矩阵及后续候选包尚待。最新进展以上方状态区为准。研究helper调用、全仓门禁和公开SDK构建不替代生产UI验收。现未创建仓库checkpoint06、ZIP或上传。最终一次性入仓须根代理授权；后续新结果按独立原始路径追加，不覆盖这里的first失败或历史批次。

## linux-production-01 生命周期追加（不等于 Mermaid UI 通过）

本次追加顶层 provenance/build/marker/source manifests、LIFECYCLE-README、summary、final-source-check/final-harness 检查、最终进程审计，以及14个run全部control/harness快照/原始logs/events/observer samples/15张PNG和preparation01–09修正记录。未遍历或复制profile；37MB源冻结目录中依赖/生成物、frontend bundle、deb/可执行文件/guard/插件档案本体仍留在外部原目录，以原始精确来源清单引用。此索引不声称二进制或全部2909源输入已随staging交付。

实际执行的解包deb二进制SHA为 `46cc0e09b39966bc958fb2887c97caece3debf6ad132b098447406975969ebeb`；deb SHA为 `fd67a5a3490b9b4b45247fc412d6370abf37354dc87d4f7131c1124f082275f1`。首次错误假定post-bundle target与解包binary完全相同的失败保留，后续唯一UNK→DEB三字节marker归因原样保留，不混用两种SHA。

14次记录包括5次成功、9次首败/中间失败，不重写为14次通过。成功的 timeout05、disable02、remove01、wm-close02、app-sigkill04 均在harness/driver清理前验证9个精确PID/birth和私有目录消失；WM关闭和SIGKILL另验App退出。全部14个driver身份最终均不在。最终只读审计的72个历史身份中，timeout04旧准备失败与app-sigkill01旧配置各有一个guardian成为非reaping PID1下的僵尸，PID290043/birth4415971与PID293457/birth4476597明确保留；不是活跃CPU进程，也不算成功清理。

timeout05从原native dispatch计算，2.000142597s观察截止、2.000302070s开始kill、2.020326901s到ECHILD、2.041812912s发送timeout控制。响应计时仅适用于指定可信输入样本，不能把200ms断言推广到每帧；采样/监听开销未扣除。SIGKILL后trusted ancestor仅执行正常waitid/waitpid回收，未发descendant信号或删除私有目录。app-sigkill03最终诊断缺失的原断言失败与后续自然exit0合同修正独立保留。

final-source-check为该生命周期完成时的观察：2909源输入中仅3份测试harness后改，产品输入未改；后续UI缺陷修复及新deb不能倒填到该时间点。该批次结束时 `mermaid-ui-01` 已出现真实呈现不稳定 RED，当时仍在定位，未取得官方Mermaid完整生产验收通过结论。旧生命周期成功仅属于本准确binary与运行配置。

## mermaid-ui-01 首轮真实 UI RED 追加

`product-ui-runs/control/mermaid-ui-01` 的 first-red-review、精确 harness/样例快照、命令与清理记录，以及 run 的原始 results/failure、16张未修改截图、root-first-failure-visual-review、输入文档和driver log已追加。窗口化大文档是准备好的输入，不是已执行矩阵。control 中三个 localstorage/SQLite主体、WAL和SHM未复制，仅保留已有 `diagrams-audit-after-close.json` 的摘取审计及原库SHA；未复制真实profile。

本批 **稳定基线通过数 0，UI64 完成数 0，独立 fallback 检查 4**。block/class曾观测到decoded图，block原图也曾实际显示，但后续截图时DOM已没有preview；原始harness中先写的PASS不能作为稳定通过，日志原字节不改。ER图实际decode等待30s后失败，并出现“部分预览上下文尚未加载，保留对应 Markdown 源码”。这些是真实产品呈现不稳定证据，不能由前述helper像素或生命周期成功覆盖。

已有audit还证明最初bundled provider超过deadline，之后卸载并独立安装的官方档案仍enabled且后续错误列表为空；旧重要提示延续到截图，不应将两代provider状态混为一谈。当时首次失败原因尚在定位；后续host修复、新deb及重验按独立批次追加，不回写本轮原始结果。

根代理对之前1973来源阶段的独立静态复核 `checkpoint06-draft/root-stage-review02.json` 原样保留；它不代表本次UI追加后已得到根代理复核，也不改变UI RED。

## production-ui-window 与 gates03 资格修正追加

已纳入 production-ui-window 的修前/修后日志、实际AST预算probe输入/输出、probe TypeScript源码、review/summary以及最终view/service源码快照。生成的两个probe CJS bundle不复制，仅记录原长度/SHA；探针源与build log保留。view修前缺少精确测试/源码快照的边界按owner summary如实保留，最终快照不当作修前文件。

view consolidated **379项**、service新增guard后 **20项**及长围栏 **16项guard**有交叉，不能累加为独立总数。最初viewport4失败、long-fence2失败、deadline1失败和中间178通过/2失败均原样保留。实际已捕获AST的probe证明共享canonical预算可以使整个窗口返回空结果，修后在原预算内按可见围栏保留partial；它不是新的native renderer执行，也不能直接证明首轮native RPC因果已被全程观测。窗口补读仍受256行/65536 UTF16和源/版本/配置代次约束，单元结果不代表生产稳定通过。

**gates03修正后的历史计数：2004 Vitest + 4独立Node = 2008项；这是当批次与独立runner补验组合，非最新gates04单次总数。** repository-gates03 的原 `pnpm test` 虽exit0，却把4个node:test失败误收集为Vitest零测试文件，单凭该命令不算完整门禁；gates01也有同一缺口，历史原件与旧摘要都保留。修复只从Vitest排除精确Node协议测试文件，并用所需 `--experimental-vm-modules` 的Node runner以 `&&` 串接。正式desktop命令独立重验 **475 Vitest + 4 Node通过**；不能再把475加到2004上。缺少VM flag的独立4失败复现、正确runner4通过、前后package/test comment快照、正式执行日志及资格summary均归档。没有产品运行时改动。独立diagrams89、构建合同16、Rust/native均不计入2008。

这一批次的notice-cold-followup仅收录静态准备、harness快照及语法/格式检查，当时未计实际cold native验证；后续UI02的cold观察另列。production02当时仍编译，生命周期/UI尚未重验；未添加新包PASS或用后续修复覆写production01首轮UI RED。

## linux-production-02 最终生命周期追加（该时点UI/browser待验）

本次纳入最终 `RESULTS.md`、`native-validation-status.json`、根代理三张截图复核、构建来源/源输入前后及最终校验、五例 command/exit/harness 冻结副本、原始 events/native traces/observer samples/logs/截图与最终进程审计。产品二进制、deb、SQLite、profiles 和 2911 文件的完整37MB source 目录未复制；原 manifest 与 hash 保留，不将它们描述为随本选集交付。

production02 解包 binary SHA 为 `6e51db6e642207602de326549ab611486fe776484a88cc5fd28ed432a969797a`，deb SHA 为 `e1d5025ffc31b37b3ace35ba13eb06a22c93cbcb70fddeb02c97ff05fdbd164b`。timeout、disable、remove、wm-close、app-sigkill **五项均首轮 PASS**；45个精确 owned PID/birth 身份与5个driver身份最终均消失，4626/4627关闭。:126 Xvfb按根代理UI交接要求保留，不计作遗留owned renderer。production01的两个历史PID1僵尸记录仍保留，不改写为已清理。

SIGKILL 的 exact ECHILD diagnostic 缺失，不能声称测到了精确回收时刻。自然退出 observed 为 `47979396084654ns`（原dispatch后0.326476873s），waitpid为 `47979396459212ns` 且 exit0；自然退出观察仅提供相应上界。可信输入至DOM/双rAF是指定样本，不能扩为每一帧实时保证。2911源输入在这五例结束后的最终校验均一致；这不等于后来任意时刻仍未修改。

原生资格说明保留14 targeted Rust unit PASS、2 ignored、127 filtered的历史原始日志，另有精确test-no-run、rustfmt、native03与本次release编译记录。历史直接unit日志缺完整argv/time执行记录，不补造参数。**未运行完整Rust library suite或clippy**；该说明记录时native03到production02的13项源比较仅Node测试运行注释不同，不是产品native源码变化。Linux实际结果不推及Windows/macOS。

该生命周期追加时的结论为production02构建与五例通过，当时UI/browser/64矩阵尚待；后续UI02与browser结果另列，旧production01及mermaid-ui-01首轮RED不被覆盖。

## 静态归档完整性与敏感内容筛查边界

`checkpoint06-draft/sensitive-static-review.json` 记录对 checkpoint05 的931文本文件和本staging当时1390文本文件的模式筛查。凭据模式命中0；5处私人路径候选经上下文复核均为 `/home/agent/.local/share/pnpm` 执行环境用户名/缓存路径，属于允许范围，未发现私人文档内容。不是对任意秘密不存在的保证，也未新增PNG OCR或全量视觉复核；原始证据未脱改。

`checkpoint06-draft/raw-source-current-mismatch-review.json` 区分“已捕获raw字节”与“当前原路径字节”。截至该记录时间2564来源中仅 `production-ui-window/view/13-browser-before/run.log` 不同：捕获11023字节、SHA `b28e8fd2dc9862a5a0c779a1e3cd9a5c9241132a8da47eec706be386b6a23677`；当时当前16218字节、SHA `cbcf70805d6df68837c9d15f02f915d66cfde9dcfa7971f3b2070a32185432a7`。它是在尚未完成时误捕获的历史partial，所有该目录已捕获别名均明确标注partial，不计完整browser结果，也不继续读取活跃log。一次中止刷新产生的7个未入索引文件独立保存在draft/partial-browser-capture-uncommitted及其manifest，不冒充最终证据。当时要求owner确认完成后另存完整版本；其后已按此方式追加，见下文browser13完整capture，旧partial继续保留。

上述raw差异与更早历史JSON内引用的可变源码路径不同：后者仍按 historical-snapshot-mapping-update02 解释已有精确冻结副本或真实缺口。staging刷新现需显式completed-source-allowlist，并在写入前校验其冻结SHA；新文件或改变的来源须先确认完成、另存版本，不能因目录枚举而自动捕获。最终入仓仍待根代理授权。

## 已结束 browser13/16 与 production UI02 追加

本次仅追加owner确认已结束的 `view/13-browser-before`、quota14精确证明及probe、15 fixture-format日志、`view/16-browser-after`，以及 `product-ui-runs/{control,runs}/mermaid-ui-02` 与已停止driver log。该次追加没有读取当时活跃的诊断与image-feedback；后者完成冻结后在17–24章节另列。这里的完成指执行已经结束，不表示测试通过。

browser13完整33项为 **22 PASS / 11 FAIL**，11项首次fixture quota失败保留；quota14在独立origin精确复建旧helper并观察真实 `QuotaExceededError`，不是实际产品/native执行。仅fixture格式化的15日志不称类型或完整precheck。browser16完整34项为 **32 PASS / 2 FAIL**；两项图片稳定性失效在该批结束时尚待定位，该批不能称全绿，亦不以source仅测试变化推断生产通过。两批精确spec/helper/config冻结源均按execution内SHA核对。

browser13早期partial别名和原字节未覆盖。完整capture采用独立 `complete-capture-browser-ui02/` 命名空间或相同内容对象复用，并以 `captureId=completed-browser13-16-ui02` 区分。其run.log与execution.json相对早期partial已有变化，详见draft/completed-browser-ui02-append-review.json的 `historicalPartialDifferences`；这是历史时点差异，不是归档破坏，也不再把两份记录当作当前来源可同时匹配。

production UI02在准确production02 binary上，**cold bundled稳定capture PASS、4项独立fallback和4项notice可见检查通过；稳定ordinary/windowed基线均0，UI64完成0**。首次block在截图前decoded，coverage PNG也有图，但截图后same-range断言实际失败，FAIL原图转为源码，随后DOM恢复图片不能洗绿。本批原生audit没有deadline事件；不能将之前UI01 deadline原因移植到本次，也不能从相邻dispatch或enable时间推算成功render耗时。完整控制/日志/25冻结输入、原始PNG、root三张及owner四张实际视觉复核均保留。windowed大文档是准备输入，不代表已执行该矩阵。

本追加168来源中80项manifest/截图/冻结输入SHA声明已逐项核对，新增文本敏感模式候选0；未做新的全量PNG/OCR审查。源文件和原始日志不格式化，未复制profile/SQLite/binary。归档完整性核验另见 `staging-verification07.json`。在该次追加时，下一候选包、修复后browser及完整native/UI64尚待；后续browser修复另列，不以本批宣称production03或最终产品验收完成。

另收 block-label-entity-review 的完成摘要/README，仅引用11原件，不复制大型原件。官方strict/htmlLabels:false基线raw SVG及同次DOM text已含literal `&nbsp;`，后续typed/canonical保留同文本；跨批次链路不冒充同次生产追踪，没有配置A/B或新产品验收，也不据此双重decode。

## 共享图片呈现反馈修复：17–24 冻结追加

按owner冻结的 `24-feedback-evidence-manifest.json` 显式103文件清单逐项核对SHA与长度后，追加17历史诊断、18/19时序修前修后、20独立静态review、20整批browser、21启动错误、22完整受影响单项、23最终summary及原始源码/PNG；另收两份root review。未枚举活跃gates04或后续生产目录。manager精确冻结SHA为 `77ca976c31736df2ce84c10c0ef9da887c2f366609e7badf42b3f5a7ad876a8c`。

修前两条保留的1200-event上限trace各含172 provide / 171 create，另有208/348 dropped，**不是完整运行总数**。修后18行样例1 provide、63行样例2 provide，各只create1；各30个样本同一decoded image、0 empty、0 dropped，单次revoke仅最终样本后finally destroy。此为受控共享view browser机制证据，不是官方Mermaid生产运行记录。

最终focused 168项、view strict、fixture strict及format通过。20完整34项为 **33 PASS / 1 FAIL**；最后失败是旧SVG focus选择器，此前实际数学点击/源码显露断言已通过。21锚定grep造成 **No tests found**，属于启动错误、不算产品RED或测试通过。22修正selector后跑完整受影响单项PASS，保留真实click/Tab/ShiftTab及20帧稳定观测：每帧3张decoded图片、同一URL列表。结论为 **跨整批与单项补验的34 distinct覆盖，不是单次完整34全绿**。受控图片fixture不冒充官方Mermaid；math/footnote真实Worker及native-unavailable明确分开。

18最初wrong-cwd未找到测试、executable路径错误，以及19真实不同overscan触发request导致guard预期错误的首败也原样保留，不能把执行错误都称产品回归。最终同窗口guard修正不降低取消/版本/配置代次要求。owner已实际查看23summary列出的三张PNG，root独立review另存；归档代理未重跑浏览器或冒称自己看过这些图。

本次106新增来源的敏感模式候选0，索引核验见draft/staging-verification09.json；没有复制二进制、profile、SQLite或生成bundle。该修复证据冻结时，gates04、新生产包与官方Mermaid ordinary/windowed/UI64尚待；随后gates04完成并在下一节记录，production02 UI首RED继续作为历史真实失败保留。

## repository-gates04 完整正式入口追加

root确认本批已结束后，仅收8个显式完成文件：execution/run.py、typecheck/test/format/build原始日志、test-count-review与summary。四条全仓命令typecheck、test、lint、build均exit0；四日志SHA逐项核对，manager SHA与已冻结77ca976c…a8c副本一致。

本次是修正正式Node runner及图片稳定性后 **单次全仓test入口2020 Vitest + 4 Node = 2024项通过**。各包数值求和已复核；standalone plugin、generic build、browser和native不累加。前述gates01/03误收集缺口仍按历史保留，browser34仍是跨批次组合覆盖，与这次单次全仓绿不同。

gates04追加时production03生命周期尚在运行、UI03尚未启动，因此该次未捕获两者；其后完成批次在下节独立记录，官方Mermaid完整生产稳定性/UI64仍待。本批文本敏感模式候选0，完整归档检查见draft/staging-verification10.json。该批追加时仍为外部staging，尚未入仓。

## production03 与 UI03 已完成批次追加

production03按owner明确冻结的 `completed-manifest.json` 收录精确1038文件/13,061,339字节，manifest自身另收；SHA为 `ddd79c6805c5c7159b9ba0fc20b4566097a33e801a02aa3a9dde69b9cff725cf`。未重新展开目录，未复制source大树/install/artifacts/frontend/profiles/SQLite。清单明确允许的10个约2.4KB `fixture.milkup-plugin` 是UTF8 JSON测试fixture，原样以文本存储；不是正式5.7MB插件bundle或可执行二进制。root四图实际视觉复核、原始PNG/日志与逐run harness/observer快照都保留。

精确解包binary SHA为 `dbf6239f8fadd9026afa6fda7ede65736e93a9672b3f4227aa285575dc4a16a1`，deb SHA为 `f97a942665e617ccf038200f71e14eb04bf3ff6a07f3eeb75cd4c9a788d15f0a`；这些原件外部留存，此处只有来源证明，不宣称随选集交付。

生命周期共 **10 attempts = 5 PASS + 4 setup RED + 1 WM诊断RED**。成功run为timeout01、disable05、remove01、wm-close02、app-sigkill01；不是五例均首轮成功。disable01的picker setup根因仍未充分定位；02 observer GI getter冲突、03/04角色字符串条件错误分别保留，未发生实际fixture loop/disable动作，不改写为产品生命周期失败。WM-close01清理与App退出已发生，但旧断言要求best-effort终端异步trace而RED；后续02以准确Child成功wait/cleanup-confirmed提供上界，不虚构精确ECHILD。

WM02 exact ECHILD timestamp缺失，App成功Child-wait确认在原dispatch后0.638218327s，仅作清理上界。SIGKILL此次保留实际ECHILD与精确guardian自然ancestor waitpid exit0，二者分开记录。最终审计54精确owned身份（五成功context另加WM01）与10driver均消失；共享Xvfb按交接保留。200ms输入断言只适用于指定输入→双rAF样本，remove期间最大rAF间隔393ms仍原样保留；disable/remove输入发生于清理后，不能证明输入与清理重叠。

编译源资格按最终audit区分：一处运行后lifecycle harness编辑、一份新增只读GTK测试observer和一处fixture README文档更新，compiled产品输入不变。原build source-after不回写；post-freeze doc update及fixture-README-final单独冻结。无需也没有借后置测试/文档快照伪造原构建输入。

UI03另按owner完成summary的49项SHA及25冻结输入追加，准确binary与上述production03一致。**cold bundled稳定capture PASS、4独立fallback、4notice可见PASS；ordinary稳定block 1项，classDiagram-000 after-screenshot首RED；windowed 0、UI64 0。** 初报将失败误称block的短报更正在原summary的progressCorrection中保留，不能沿用ordinary 0。coverage原图有class图片，但后续same-range查找无精确range，FAIL图为class源码；block保持decoded、selection在class fence外、原始文件字节未改。后续状态不能把该失败洗绿，也不能未经诊断假定与UI02相同根因。audit无deadline事件，无成功完成时间phase，不从dispatch间隔推算render耗时。

此追加1115来源、1112项manifest/冻结输入SHA检查全部一致；root审图引用另核对，新增文本敏感模式候选0，未新增OCR或重跑测试。完整索引核验见draft/staging-verification12.json。该次追加未读取当时活跃的view25；其完成后的独立静态记录在下节追加，新修复及后续生产验收仍待。该批追加时仍为外部staging，尚未入仓。

追加后对已索引3950个唯一原路径作静态当前SHA对照，只有browser13旧partial的execution.json与run.log两个别名不同；其完整结束版本已另存且匹配。详见draft/raw-source-current-mismatch-review02.json。不存在未说明的完成批次raw来源变化；此结论只适用于该审计时间点，不是未来源文件永久不变保证。

## view25–27 与失败快照补充：已完成静态批次

view27冻结manifest SHA `2181ead9384940da2987b61c01f8cf6657c26eaa7985b1f2883da09735eea0ae` 的23文件按清单逐项核对，manifest自身另收。25首次为 `Selection.single is not a function` 的夹具API启动错误，不算产品RED；26改用现有Selection.range后，历史固定block/class/ER AST与当前真实service在Chromium做90个样本、实际15.75秒观察，后段class保持decoded，**未复现原生UI03消失，不能称修复或生产通过**。其输入宽1100与native1048不同，固定AST不能证明实际Mermaid跨请求输出相同；启动/selection失效仍有source-only状态。无产品改动，原始启动错误、trace和限定均保留。

failure-snapshot-followup仅静态harness增强：旧SHA `3504017324bb5ad71f3f26274f3271cecbc79f40740f210f9c67efd3e8ab0125`，新SHA `2b0ec01dd0c86e551bb4a43d3bc4d0024f92c218f2cba1da98d91e282c1c313a`，旧/新原件、diff、execution与format/syntax日志已冻结核对。失败时持久化已有DOM/expected/stage/error，随后抛出同一原错误；不新增浏览器观测、重试或deadline。before-shot没有现成document probe时明确存null，不补读来改变时序；UI03继续使用旧快照，不倒填新harness。

本次31新增来源的敏感模式候选0；完整索引验证见draft/staging-verification13.json。该次追加时新短原生诊断仍活跃，未读取/捕获；其完成记录在下节独立追加，UI03 class真实RED与完整生产验收待完成状态不变。

## 原生UI03短诊断01/02与root独立复核

仅按两份已完成summary的显式清单追加：01的38文件、02的89文件，另含各summary及root review，共130来源。127项来源SHA/长度与root trace/原图引用均核对；未遍历新28/29回归或实现目录。

01为前置枚举错误：`Object.keys`错误地要求Tauri listener为enumerable，`Object.values`同样不适用，observer没有安装，也没有transport payload捕获。renderer dispatch和截图可见图片不使它成为稳定性通过；这次是harness precondition RED，不是产品RED。后续改为精确own-property descriptor读取，旧失败原件保留。

02实际捕获 **41 events、598173 payload字节、67 DOM samples，0 dropped、0 observer errors**。计划100ms间隔受event-loop延迟影响只有67实际样本，last sample9968ms，10000ms捕获截止、10002ms触发恢复；时钟观察存在开销且不扣除，零测量仅指低于可用时钟分辨率。fetch描述符/同一函数及原listener恢复的记录保留，原UI03历史hash不变。

selection保持384..438且在class fence外，source version0、无编辑/保存输入；block108..342 URL不变，class440..969 decoded后两次消失，再出现时换Blob URL。render11/13/16/18/21五份请求JSON对象完全相同；对应result AST的path数值不同，相对render6计160个numeric command差异。root使用sorted-key compact UTF8 JSON独立比较得到一致请求hash，不称原始序列化字节hash相同。该观察本身未证明官方引擎随机path的具体来源。

root实际检查诊断原PNG并与UI03 FAIL原像素比较，只有header路径文字区域不同，下方像素完全相同：block图片保留，class区域为源码。此链路是**诊断，不是验收**；仅观察service切分后的per-fence transport，不等于直接观察aggregate请求。接近截止的render23在窗口内无response，不作为失败。clone启动与原完整验收流程不同，开销不扣除，不从相邻dispatch推算render耗时。

新增文本敏感模式候选0；完整索引核验见draft/staging-verification14.json。官方Mermaid完整ordinary/windowed/UI64仍未通过，该批诊断追加时28/29回归与实现仍活跃，未归档；后续冻结修复证据在下节独立追加，仍仅外部staging。

## 28–35 whole-fragment替换修复：最终8dc冻结证据

仅按 `35-decoded-replacement-final-evidence-manifest.json` 精确147文件/5,312,786字节清单追加，manifest自身另收；SHA `e1433f9ff09854c5ae46dda25db2f63cdfe41d8acec4d240044fdab94d5bcf42`。147项长度/SHA全部匹配，最终source-final三份源码也与最终manifest匹配；旧source-manifest的8a快照保留，不覆盖。

最终manager SHA为 `8dc1f4a2571539cdb32b85bb7f8cecee6c32cf2aa2f1f757b580d1087301d8e3`。通用修复在同范围最多保留一个已decoded完整fragment和一个候选replacement；候选独立校验、所有图片decode完成后整体替换。保留层仍受原aggregate预算和不可续期10秒deadline约束；omission/error、hard context、源码模式/选区显露/dispose等撤回边界不放宽。成功decode在现有reference pointer lease结束后合并刷新当前cache；错误/超时撤回不等待lease。scroll捕获以实际仍mounted fragment为准，新语义不继承旧内滚动。

真实首RED分别是完整fragment暂时消失2项、跨代保留层aggregate预算1项、pointer activation前被detach2项、不同语义继承旧[37,19]而非[0,0]滚动2项。pointer首RED使用public-view JSDOM合成事件，不当作native XTest。wrong-cwd、无jsdom配置、缺少public refresh的identity guard夹具及TS2367旧测试条件等执行/夹具错误也原样保留，不混作产品RED。最初两项RED未保存精确完整测试文件快照，保留原日志与baseline源码并明确缺口，不用后来扩展测试补造。

最终8dc **199 focused / strict / format PASS**；33-browser-pointer-final在此前8a manager上 **整批34 PASS**；最后单helper scroll修正后，34-browser-scroll-final在8dc上 **2项layout PASS**。不能把8a整批称作8dc整批重跑。32实际变动AST probe为90样本、实际13.4484秒、59个selection-ready样本、期间2个class URL，0 dropped、源不变；6次create/decode/revoke的最终revoke发生在sampling结束后的destroy。该probe在pointer和最终scroll修正前，属于当前service+历史真实变动AST的受控Chromium观察，不是官方引擎native验收。原native五份请求相同的严格证据仍是结构化JSON独立比较，不扩为未经证明的原始序列化字节相同。

root31/33实际PNG复核、root最终static/scroll及release最终pointer/scrollreview均在选集内。新增文本敏感模式候选0，hash/alias/无未索引文件检查见draft/staging-verification15.json。该修复批次追加时gates05仍活跃、production04 runtime未开始，因此当时均未读取/捕获；后续gates05完成记录在下节追加。UI03原class首RED继续保留，完整ordinary/windowed/UI64尚待。

## repository-gates05：最终8dc上的完整正式门禁

仅追加root指定的run.py、execution、summary、test-count-review及四份原始log，共8文件。typecheck、test、lint、build四命令单次均exit0；四日志SHA已逐项匹配summary，manager SHA与已冻结8dc最终副本一致。

本批 **2051 Vitest + 4 Node = 2055 distinct**，包计数求和与Node失败0已复核；standalone插件、构建合同、browser、native和历史测试不累加。8a整34 browser及8dc最后scroll修正后的199 focused/2 layout仍按独立资格记录，不由本次全repo结果冒充最终native验收。gates04及更早原始失败/资格保留。

新增文本敏感模式候选0；hash/alias/无未索引文件检查见draft/staging-verification16.json。gates05追加时production04正在native独占执行，该次未遍历或捕获；其后完成记录在下节追加。完整官方Mermaid ordinary/windowed/UI64仍待，该批追加时仍为外部staging，尚未入仓。

## production04：五项首轮生命周期PASS（该时点UI04 pending）

按 `completed-manifest.json` 精确492文件/7,232,413字节清单追加，manifest自身另收；SHA `b4d9f753fdfd8d4bf8d9d60bb461b765866b31d277c882958512f049af078e42`。492项SHA/长度全匹配，没有重新展开目录。清单包含root三张原PNG实际复核及root-lifecycle独立顺序/5artifact核验；source大树、binary/deb/guard/正式插件档案/SDK/frontend/profiles/SQLite主体仍外部留存，归档只保留其来源证明。5个小型UTF8 JSON lifecycle fixture按显式例外原样收录。

精确解包binary SHA `323213867fda26d1de66f67c5a428dd26d0a78f0334d40f8d15f1e94b161a172`，deb SHA `3e9574e28cbb2cd00cdfe7a1814f022fcd6e7da26c65c6cdc5da9e27cf0d2200`。timeout、disable、remove、wm-close、app-sigkill全部 **首轮PASS（5 attempts / 5 PASS / 0 RED）**。最终2912捕获源输入全等，无本批后置repo/harness/fixture README变更；docs目录按既定capture规则排除，不把源全等扩大到未捕获目录。root外部报告不属于产品输入。

45精确PID/birth owned身份与5个driver在最终审计时均消失，4626/4627为空；共享Xvfb126按下一UI套件交接保留，审计不声称后来UI04进程也已消失。WM本次有精确ECHILD与App Child-wait确认；SIGKILL exact ECHILD为null，精确guardian自然exit0观察 `55721806605936ns`、waitpid `55721808627214ns` 提供成功清理上界，不补造精确ECHILD时间。所有阶段时间从原render dispatch起算。

指定输入→双rAF样本为34/58/29ms，disable最大rAF间隔 **369ms** 原样保留，不能宣称所有帧均小于200ms。disable/remove输入发生于清理之后，不据此证明输入与清理重叠；观测开销不扣除。本批没有额外Cargo unit/clippy或官方Mermaid UI通过主张。该生命周期追加时UI04仍活跃，未遍历或捕获；其后首轮RED在下节独立记录，完整官方ordinary/windowed/UI64仍未完成。

同时收录root-stage-review16的历史独立核验：当时4280 aliases/2101 objects、hash/引用/无orphan通过。首条命令漏列verify-staging.py元文件导致orphan断言错误，修正元文件清单后通过，raw对象未改变；此审阅不冒充对后来追加批次的root复核。

本次494新增来源敏感模式候选0；完整hash/alias/无未索引文件核验见draft/staging-verification17.json。该批追加时仍为外部staging，尚未入仓。

## UI04正式首轮原生deadline RED及独立只读复核

按owner完成summary的84文件精确清单追加，summary本身另收，原84清单不修改；再独立收root class与FAIL原图复核、render68只读audit的READOUT/evidence。总新增89来源，84项SHA/长度全匹配，root原图和driver-log引用另核对。

本次在准确production04 binary、独立fresh profile、冻结2b0ec01d harness上正式执行，无passive transport hook。**cold bundled、4独立fallback、4notice PASS；ordinary block/class/ER 3 PASS；随后flow等待decode首RED；windowed 0、UI64 0。** 原文源字节保持不变，没有手动重新启用或验收重跑。root class早期图仅可见class上部，底部在viewport外，不称整图可见；其原review当时run尚活跃的资格不回写。后来的FAIL原图显示class尾、ER和flow起始源码及fence外marker选区，无可见notice；插件failed由registry/phase另证，不从截图猜测。

同一native instance实际接受render68后，2000.150499ms观察deadline、2000.247443ms启动kill、2167.983510ms清理/ECHILD、2177.997059ms App确认、2178.034497ms发timeout控制。该预算从render68自身dispatch起算，没有继承前请求deadline的证据。render67→68的3833.547429ms仅为dispatch间距，不是render67执行时长；未记录请求68的payload/range/hash，UI当前flow目标不能唯一绑定该native请求。transport、WebKit调度/layout/GC、转换和返回工作均可能在dispatch后的端到端预算内，现有记录不能分配耗时原因。

首个harness调用曾被自动审批错误判为driver并发而在进程创建前拒绝；只读ready/noSessions证明后，同一动作获准执行。原审批与证据记录保留，拒绝未产生runtime，不记作验收重试，也不是放宽deadline。harness finally关闭App，exact driver353251经身份核验退出，4626/4627为空，共享Xvfb保留；profile不归档。

新增文本敏感模式候选0，另新增root失败图review只含任务fixture观察；hash/alias/无未索引文件核验见draft/staging-verification18.json。UI04首RED追加时新的transport诊断01仍活跃，未读取/捕获；其完成记录在下节独立追加。最新官方生产结果仍为首RED，完整ordinary/windowed/UI64未完成；仅外部staging，未入仓。

## native-ui04 transport诊断01：未复现deadline，不算验收

summary SHA `83ff3248ce46ba432738550f20fb4e7438f7ed10aa75ebd8f426ba413203d5ab` 与100文件清单逐项核对后追加，summary自身另收。此为独立clone的有界诊断，预先完成block/class/ER同范围decoded截图检查再安装observer；不是原正式cold/fallback/install至68请求的完整历史重放。

捕获15 render、15 result、2 cancel，共32 events / 382999 payload字节，77实际DOM样本，0 dropped / errors。窗口内15请求均有结果，无孤立request/result；安装前warmup及截止后callback不追认完整。实际flow43/45/48三份结构化请求一致，均成功，往返55/58/50ms；这些是观测roundtrip，**不是helper CPU执行时间**。另两份flow请求46/49也有成功结果，但请求组不同，不能混作相同payload。ER35及class39取消后ok:false按原记录保留。

本窗口无deadline，不能解释或清除正式UI04的render68超时。历史render68 payload仍未捕获；源/profile hash保持不变，observer恢复原fetch函数/描述符与listener。100ms目标间隔只有77实际样本，event-loop延迟及capture/DOM观测开销保留不扣除；inclusive filter成本不重复累加，预算未改。清理App和精确driver后端口为空，共享Xvfb保留；profile主体未归档。

新增101来源敏感模式候选0，完整hash/alias/无未索引文件检查见draft/staging-verification19.json。正式UI04仍为ordinary3/windowed0/UI640首RED；该次追加时诊断02仍为活跃static准备，未读取/捕获；其后结束记录在下节单列，该批追加时仍为外部staging，尚未入仓。

## UI04诊断02：App启动前harness相对URL错误

按summary SHA `c7b6c90b01a99f361d8d3e9323d7f57db33250ade15fef03422b0e5a81663dfc` 的55件显式完成清单追加，summary自身及root preflight review/addendum、CPU采样静态提案另收，共59来源。55项SHA/长度全部匹配；原preflight review不覆盖。

派生harness迁出repo后，import声明已改绝对路径，但plan输入自记录仍使用既有 `new URL('../helpers/...', import.meta.url)` 相对路径，触发ENOENT。此时 **App未启动、WebDriver session未创建、observer未安装，无产品/cold/wire执行**，results为空；这是harness前置错误，不是产品RED或正式验收重跑。idle driver按精确身份关闭，历史UI04源/profile/summary hash未变。

root先前32输入SHA/字节核对仍有效，但差异审阅漏掉既有相对URL，不能据此称运行前置全部就绪。独立review-addendum明确该遗漏，保留先前review原件，不倒改决策记录。CPU sampling仅静态提案，**未实施、未执行、未纳入获准诊断**；其未来设计不作为实际CPU或开销证据。

新增文本敏感模式候选0，hash/alias/无未索引文件检查见draft/staging-verification20.json。正式UI04仍ordinary3/windowed0/UI640首RED；该次追加时诊断03准备活跃未读取/捕获；其结束记录在下节单列，该批追加时仍为外部staging，尚未入仓。

## UI04诊断03：observer守卫拒绝，无wire捕获

按summary SHA `df6e2308551993a435f6da2ee955a14686b66a3a025b09cfeb2889c458df7729` 的102文件清单追加，summary及root前置复核另收，共104来源；102项SHA/长度全部匹配。

本诊断完成cold、独立安装、4fallback/4notice及block/class/ER前缀，但在observer安装守卫处停止：检测到两个listener entry，对应Map callback类型为undefined与function，旧守卫按总entry数量要求唯一而在**任何wrapper mutation前拒绝**。源码摘录确认Tauri unlisten从Map注销callback却留下non-enumerable entry，因此不应声称存在两个live handlers。observer未安装，flow seek未开始，无transport payload；这是诊断工具守卫失败，不是产品RED或正式UI通过。64 native dispatch无deadline也不能消除正式UI04超时。

root预检32冻结输入SHA/快照及修正helper URL实际读取通过属于该阶段真实检查，未等同于后来observer条件已满足。原文源字节及148项历史hash未变，App finally关闭、exact driver退出、端口为空；FAIL截图为守卫之后观察，不作为flow尝试或失败证据。

新增文本敏感模式候选0，hash/alias/无未索引文件检查见draft/staging-verification21.json。正式UI04仍ordinary3/windowed0/UI640首RED；该次追加时诊断04 static准备活跃，未读取/捕获；其后结束记录在下节单列，该批追加时仍为外部staging，尚未入仓。

## UI04诊断04：cold原gate真实native deadline，observer尚未安装

summary SHA `0bce2b1cc5790556d2d9c09df579df541927b37b06835416ccd661a60ba2288c` 的75显式文件逐项SHA/长度匹配，另收summary、root前置复核及root实际X11视觉复核，共78来源。未读取新native阶段诊断设计目录。

本次在cold首图原gate即失败：native render3于自身dispatch后 **2011.385012ms** 观察deadline，插件被停用，界面等待block decode超时。但observer尚未安装、无payload映射，**不能把render3绑定block**。cold稳定gate未通过，独立安装、fallback、ordinary前缀与flow均未开始；此为诊断运行中实际产品native deadline证据，不是正式UI验收通过，也不同于02/03的纯harness前置错误。

9项VM合同只验证诊断工具guard，不证明本次native guard已通过；guard安装阶段未到达。35冻结输入与148项历史profile/源hash一致，源字节原样。App finally关闭、exact driver退出、端口清空，共享Xvfb保留；无重试、手动enable或profile修改。

root实际读取FAIL-x11原图，完整block源码和class上部可见，底部明确显示渲染超时停用及已保存状态；class下部在viewport外，不称完整可见。截图不能识别render3 payload或阶段时间，trace/registry证据另列。原summary截图条目早期reviewed:false不回写，独立root实际审图记录补充其后观察。

新增文本敏感模式候选0，root审图记录仅任务fixture观察；hash/alias/无未索引文件核验见draft/staging-verification22.json。正式UI04仍ordinary3/windowed0/UI640首RED，诊断04 cold失败独立保留；该次追加时后续native诊断设计活跃未捕获；完成的静态候选构建在下节独立收录，runtime另待，该批追加时仍为外部staging，尚未入仓。

## 独立native-stage候选01：仅诊断构建完成

manifest SHA `870209975a9dd7ebfb9297f52f63effc456d35a9900139e5bc8da22a16c7fca8` 指定根目录为research；按其36件/322985字节显式清单追加，manifest自身另收，共37来源，全部SHA/长度匹配。只收设计、两版review/diff、六份Rust快照、build/cache/来源记录；不遍历或复制target、binary/deb、bundle、profile和大型source/frontend树。

诊断构建首次exit0，108.918459秒；日志仅观察到本地desktop Rust crate重编译与deb封装，没有前端JS或依赖重编译。候选binary SHA `8041da503dac6cc0ff5d45d4c11982ca4b6a898930f3e4ecc3442d8cb1e4d140`，deb SHA `0959c7a36920a071c34594195127fb6ffb3c0f0da1256ce10b3925e09066bc6a`，**与production04不同，不是产品修复或正式生产候选验收**。source manifest记录三个trace-only Rust文件变化；50捕获候选输入构建前后相同，主工作树对应三Rust仍等于04。复用的04 frontend、guard、SDK和官方档案hash保持一致，artifact主体只外部引用。

新增诊断区分input callback near-entry与后续转换发事件时间；near-entry不是JS promise完成时间，dequeue记录在有界metadata解析之后，receive-entry在JSON解析之后。best-effort64-entry try_send仍可能丢记录，尤其退出阶段；没有空poll日志、JS promise await、协议/安全设置或deadline变更。两版trace差异、首轮rustfmt失败和修正保留，revision02当时“未编译”陈述属于该设计阶段，后续build结果另列。

cache原件保留CoW/reflink探测因Operation not supported失败、根授权的可丢弃debug incremental回收与4698文件普通独立copy记录；没有hardlink或共享可写target。早期preflight“未删除/未copy”仅其记录时点，不能覆盖后续动作。归档代理没有执行这些cache操作、构建或测试。

新增文本敏感模式候选0，hash/alias/无未索引文件检查见draft/staging-verification23.json。本批没有任何UI/runtime结论；该静态候选批次追加时prefix01正在runtime、未读取/捕获；其后结束记录在下节独立追加。正式UI04仍3/0/0首RED，外部staging未入仓。

## native-phase prefix诊断01：检查点冻结，正式RED未关闭

summary SHA `9398d67701c8d68d58fa3759bfd80bb7dc4223a4272a2b8ed95f075e5c8caf01` 的 **manifest** 字段显式108文件逐项SHA/长度核对后追加，summary与root独立review另收，共110来源。root原图review只确认flow上部与前方ER部分可见，不称完整两图可见；decode断言和native时序为分开的证据。

本次使用独立trace-only binary8041…d140，诊断prefix完成cold、独立安装、4fallback/4notice、ordinary4，windowed0/matrix0。910 trace记录、75请求均观察到结算（71 ok:true、4 ok:false），13请求有cancel观察，deadline0；最慢class请求dispatch→settled **1246.782176ms**。这些是受诊断hash/序列化/queue开销影响的单调wall time，不是CPU时间，也不能绑定历史formal render68 payload或关闭其真实RED。取消求值时序不证明异步renderer已在产出结果前观察cancel，ok:false本身也不揭示具体错误原因。

跨进程post-write日志可能晚于receive-entry，保留有符号重叠区间，不叫负transport latency。dequeue包含metadata解析；callback entry另记；原始共享预算不变、无wire observer/CPU sampler或重跑扩大矩阵。实际opened ordinary/fallback源使用JS UTF16 slice和精确UTF8 SHA匹配，windowed未打开；native metadata无selection，不从后来UI倒推。

148项历史文件与31输入最终相同，driver358185已退出、4626/4627为空。**guardian358538已退出且有cleanup-complete，但被reparent到容器PID1后仍为未reap的Z；不是所有owned身份消失。** 无live helper/App/driver，不向PID1发信号；该边界与旧production01僵尸分别保留，不把无CPU运行冒称完整回收。

新增文本敏感模式候选0。此检查点仅冻结已完成记录；CPU sampler、coldbatch、eagerload等活跃研究未读取/捕获。hash/alias/无未索引文件核验见draft/staging-verification24.json；已按Root copy GO保存本工作分支检查点，未由归档代理提交或推送。正式UI04仍ordinary3/windowed0/UI640首RED，后续诊断继续。
