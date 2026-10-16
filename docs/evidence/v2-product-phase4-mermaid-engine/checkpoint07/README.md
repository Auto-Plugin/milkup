# Checkpoint07：机制诊断过程检查点，未完成产品验收

本批归档只静态读取、复制和核验明确已完成的来源；归档操作本身未运行 sampler、测试、构建或原生 UI。根代理核验后复制入仓，保存下述实际执行记录；未修改已提交的 checkpoint05/06。正式UI04仍为ordinary block/class/ER 3 PASS、windowed 0、UI64 0，其原生deadline RED未关闭。

## 最新追加：ABBA eager-load 实验及离线校验完成，未建立产品收益

运行 summary SHA `27b88c97bb724f1fabf3765209bf700aea1531a1ef53cb1c3b056cd22d3a9892` 的 140 项 raw evidence 原样保存；416 项 profile/cache 主体明确排除。四个 fresh hidden helper 按 A、B、B、A 各执行两次真实 class 请求，8 result、0 native deadline，预算仍为 activation 10s / native render 2s。第二次请求是公开实验设计，不是隐藏 warm-up。

| Cell | Launch→activation ms | 首次 native dispatch→settled ms | 第二次 native dispatch→settled ms |
| ---- | -------------------: | ------------------------------: | --------------------------------: |
| 01-A |          1225.596546 |                      581.370977 |                        228.746809 |
| 02-B |          1166.761672 |                      589.092911 |                        247.294897 |
| 03-B |          1038.937596 |                      559.612712 |                        224.494862 |
| 04-A |           864.856727 |                      594.433378 |                        233.408184 |

A 也包含共同 strict 初始化变更，不与真实 production baseline 字节相同。启动区间包括 guard/setup/spawn/import/fonts/preload/观察开销；native render 区间也是 wall time，不是 CPU 时间。此小样本有序 ABBA **没有明确 eager-load 收益，不支持修改产品**。20 次离散 X11 检查通过，8 个精确记录的 guardian/helper 身份不在，129 项输入/authority 记录未变；不推导未观测瞬态或正式 UI 验收通过。

离线阶段 manifest 的 23 项已逐 SHA 核对，summary SHA `e3761677210a262c2c029572e96d40a3c6a7d8c7e3657cd574d11c4eb048f4f8`。8 个实际请求除经核对的 render_1/render_2 id 外与冻结 fixture 深等；8 个实际结果均由当前 core 完整 result、共享 aggregate budget 与 canonical 检查接受。12 个跨 cell 同序请求比较对、4 个同 helper 比较对，每对均有 **160 处 typed 差异**；8 份 raw value 与 canonical SHA 各不相同。尺寸和预算计数一致不证明 AST 相同或像素相同，未进行本批 PNG 等价验收。

原运行 summary/short-results 的 `validatorExecuted:false` 是离线校验前的历史事实，保留不覆写；随后独立执行的 offline summary 提供 8/8 接受证据。构建 provenance `ef5cafa1ec26483d569f9ba8835ee8bddf80f13e76f622ef120eb36266fe5726` 是 test-only build，不是产品 release；新测试 binary 只记录路径/SHA/长度。A/B 两份约 5.31MB 的冻结 JS 输入为新内容，各保存一份，其他旧内容继续去重或跨引用。

加收的 `native-cold-cpu-binding-independent-review-01.json` 仅静态审阅：绑定失败原因仍未知，已确认缺少 bounded 分支诊断可观测性；无采样结果，不证明 native argv/environment 合同不匹配。本检查点共包含 **hidden A/C 与 eager ABBA 两个未支持修复效果的候选实验**，不是两次产品修复。正式 UI04 与历史 cold deadline 仍未关闭。新的 sampler02 / cold-run 活跃目录未读取。

## 前一完成批次：hidden A/C 八格机制诊断，产品修复未成立

完成摘要 SHA 为 `b3b4e564725fafb617d1235e26cb0033ac3c5ca42952b90dfe74254f03b6b6ec`。仅按其 205 项显式证据清单归档；另列的 **832 项 profile/cache 主体未读取或复制**。8 cells 按 A-control、C-control、A-single、C-single、A-double、C-double、A-class、C-class 顺序全部得到 result，0 retry、0 native deadline。它们是独立机制诊断，不是编辑器安装、生命周期、正式 UI 或像素等价验收。

A hidden class dispatch→settled 为 **738.670001ms**，C offscreen 为 **1027.423529ms**；这一对结果不支持 offscreen 性能修复，也不能解释或关闭历史 deadline。原 native 2s / 外层 10s 预算未改。单/双 timer 回调两侧均快，没有证明隐藏页 1s 对齐。无 CPU sampler 或 CPU 数据；wall time 不能被表述为 CPU 成本。

A 初始 document.hidden=true、GTK container/view unmapped、allocation=1×1；C hidden=false、mapped、allocation=1024×768。JS control viewport 两侧同为 1024×768，不能据此声称 GTK 分配一致。control geometry 的观察值相同且有限/非奇异检查通过；class width/height、raster bounds 相同，但 typed content SHA 不同，不宣称 AST 或像素相同。

X11 共 32 次离散观察（每格 4 次），未观察到新增可见普通顶层窗或焦点改变；这不保证两次采样间没有瞬态窗口。所有 24 个 trace PID 在该批清理审计时均不存在；不得用该结果回写历史 coldbatch guardian 的 Z 状态。51 项构建输入运行后匹配，仅支持该独立候选输入未变化。

独立构建 provenance SHA 为 `40df378e96898d1dfbb63c1966be8a800179915970428029ef5417501e89d55a`。27 项 evidence、冻结源码与两次构建日志原样保存；其 buildOnly/runtimeStarted:false 是构建完成时的历史资格，后续 8 格执行单独由实验 summary 证明。release binary SHA `02b15a8038e694806e4cbc5f8a6b6324160529a0ab3303934a626d7c8e848982` 与 production04 不同，未作为正式产品包验收。三个二进制、正式 archive/SDK 与生成 frontend/schema/icon 构建输入只保留路径、大小和 manifest 声明 SHA，不复制主体。

plan v01/v02/v03、observer、nesting-addendum 与 root-hidden-timer reviews 按完成版本保存。历史 plan 顶层路径指向已有 revision01/revision02 精确快照，不用新源码倒填旧 SHA。class-module.js 5,313,918 字节是本批冻结运行输入，其 SHA 在当前 checkpoint06 索引无相同对象，因此本地仅保存一份；其余相同内容继续去重/跨引用。此阶段采集时尚活跃的 eager-load candidate 当时未读取；现按明确完成信号追加，其结果见顶部 ABBA 章节。

## 历史 coldbatch01：UI 通过、CPU 采样绑定失败

coldbatch01在独立诊断binary `8041da503dac6cc0ff5d45d4c11982ca4b6a898930f3e4ecc3442d8cb1e4d140` 上的cold UI原gate通过，但sampler以 `guardian-bind-not-unique-or-missing` 退出2，harness退出1。最多获准3例，实际只开始第1例并按首失败停止，无retry或后续case。**CPU samples = 0，cgroup counters = null，没有CPU结论。** 未保留绑定候选详细诊断，不能推定具体拒绝阶段或原因。

原生73条trace中6 dispatch、5 settled且ok:true、无deadline记录；最慢已完整结算的render3 class为630.801596ms wall time，不是CPU时间，剩余未结算记录不能被假定成功。36输入/快照与148历史文件未改，旧prefix01 summary未改，正文源字节一致。

App/driver/helper均不在，端口4626/4627为空；guardian361484已退出并记录cleanup-complete，但仍为PID1下未reap的Z（birth6033469），不是所有身份均消失。没有向PID1或无关进程发信号。root实际查看cold X11原图，完整block及上部class可见，class被viewport裁切；诊断cold通过不等于正式production04或完整UI验收。

## 版本与静态材料资格

- sampler v01/v02/v03源码、差异、contract、static checks及独立review保留。早期preparation内 `runtimeExecuted:false` 属当时静态阶段；v03后来的实际执行在coldbatch记录，不能把静态review通过替代绑定成功或开销测量。
- 历史v01/v02 manifest引用的可变顶层路径已由v03覆盖；索引 `historicalManifestMappings` 将其指向原有revision01/revision02精确快照。原JSON不修改，不用新内容填旧SHA。
- 独立review指出的枚举上限、候选/身份上限、retained dispatch锚点与Z/X/x资格修订按版本保留。review说无剩余静态阻断，不意味着实际运行已验证。
- cold gate函数两份hash差异由hash-addendum解释为唯一终端LF边界：1141字节含LF与1140字节不含LF；函数体相同，旧review不回写。
- 最初 hidden-page review 仅为源码/API静态审阅；新增 nesting-addendum 与 A/C 实验保留各自资格，八格结果没有建立历史超时的因果关系。wall-time间隔不是CPU或调度根因证据。
- 最初 Mermaid eager-load review/计划属于未执行的历史静态阶段；之后 ABBA 执行和离线校验分别保存。公开模块预加载候选不等于完整 warm-up，layout/JIT/font-use/转换等成本仍可能留在 render。本批未改产品、未证明能修复历史 deadline。
- checkpoint06 remote-verification小元数据记录提交 `2c3ff12bf3caa50520c8b6d49601e2f33a5f7da0` 的远端与身份核验，归档代理没有重新查询远端；该提交是未验收过程检查点。

## 精确归档范围与排除项

coldbatch summary SHA为 `f06714a024ab8c6f684aef23040ffd5ad90a6486242070331048e5ba3f2a029c`，原manifest172项原样保留。其中166项文本/PNG主体按声明核对，另6项为三份diagnostic binary与三份正式插件archive快照，总83,011,644字节：**只存路径/长度/原manifest声明SHA，不读取或复制主体，也不冒称本归档代理重新核过这些body**。根代理独立172项核验记录作为单独原件保留。profile、SQLite、target、二进制及正式bundle均未归档。

采集只涵盖已完成coldbatch精确清单、owner确认冻结sampler顶层与revision01/02、明确指定reviews、hidden-page review及eager-load自身index列出的4件静态材料。没有跟随源码审阅引用去复制node_modules或系统库。首批采集时尚活跃的 hidden timer plan/harness 当时未读取；本次收到完成信号后才按上述清单追加。eager-load candidate 后续完成才按其明确清单追加；新 sampler02 / cold-run 仍活跃，明确排除。

首批敏感模式候选 0，A/C 增量 4 个、ABBA 增量 5 个均逐处审阅：通用 `/home/agent` 构建 PATH/只读错误，以及 `example.test` 凭据拒绝测试夹具，无实际凭据。相同字节按对象去重，候选次数不等于不同秘密数量。保留原件，不做替换；这不是任意秘密不存在的保证，也没有新增 PNG OCR/视觉验收。归档代理没有声称自己查看过 root 审阅的 PNG。

## 增量对象与跨检查点校验

`index.json` 的 772 个 source aliases 保留原路径、SHA、长度与 capture 资格；本地 501 个去重对象 / 28,839,570 字节。52 个 checkpoint06 对象（8,635,114 字节）以精确 stored 路径/SHA 及固定提交引用，不重复复制。累计 50 项排除主体引用 / 183,185,246 字节均只声明元数据，不冒称重新核验主体。832 + 416 项 profile/cache 不读取、不复制。两张历史 cold PNG 按 SHA 命名，后两批未新增 PNG。manifest 与原始文本保持字节，不格式化 raw。

校验本增量及其固定base：

```sh
python3 verify-index.py --checkpoint06 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06
```

脚本校验base index SHA、本地与跨引用对象SHA/长度、每个alias、全对象被引用、无orphan和symlink；不是产品测试。本目录已作为同级 checkpoint07 入仓，可省略参数使用相邻 checkpoint06。外部 `checkpoint07-draft/completed01-capture-review.json`、`completed02-capture-review.json`、`completed03-capture-review.json` 与验证报告是当前执行器支持材料，未自动计入raw索引或宣称随本目录交付。
