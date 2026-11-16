# 原始分页机制：观察补丁与严格解析合同

基线产品/矩阵为 `491089e8`（产品仍0e4e8c58）。这是独立研究分支，不合入产品；没有行为修复、样式修复、原生运行、安装或发布。本轮把路线变成可复核的实际诊断补丁和本地合同，**真实翻译单元尚未编译，真实机制尚未确认**。

## 实际产物

- `observation-only.patch`：匹配Ubuntu WebKitGTK 2.52.6、原始源码锁定，不修改布局返回值或分页/绘制指令。四个实际翻译单元：RenderBlockFlow、RenderBlock、RenderTable、PrintContext；新增显式相对引用的内部观察头，不需要把研究API加入发行私有头集合。
- `prepare.py`：逐文件SHA锁定后生成，拒绝错源/重复锚点。原源码树未应用/修改；`git apply --check`通过。
- `fixtures/`：43693522845四个**原始**长/短、临界/宽松HTML及PDF哈希。`fixtures.py`仅加固定ID与诊断title；逐token检查原正文、CSS、其他属性和节点顺序不变。真正的布局等价仍须原生坐标确认，不以token一致代替。
- `contract.py`、`test_contract.py`：8个本地测试方法通过，包含损坏/缺失/倒序/错误阶段/缺return/实例变化/NaN/矩阵/页缺失/未确认strut重置等负例；两个假设的受控事件正例与不确定分支。它们是合成解析合同，不是WebKit原生结果。
- `evidence/`：生成patch和源hash、四份元数据改动后的夹具hash、本地结果及只读CI/缓存清单。

第一次夹具门禁失败：误取名为 `chain-baseline` 的已拒绝CSS候选，它包含 `table-heading-chain`，唯一结构断言拒绝。已改为 `baseline-baseline`，四份均保持原始样式；没有放宽断言，没有原生派发。第一次完整worktree checkout也因磁盘满失败，Git未保留完整工作树；改用稀疏研究目录后恢复约665MiB余量，未清除用户/证据目录。

## 观察点与假设判别

全部记录要求环境显式 `MILKUP_PAGINATION_PROBE`、打印状态和固定合成title；不输出用户内容/路径/内存地址。最多4096条、32个节点、32页、每节点32quad，溢出明确失败，解析字节预算2MiB。

| 位置 | 观察 | 能回答什么 |
| --- | --- | --- |
| applyBeforeBreak / applyAfterBreak 入口和每个return | 标题/相关box的有效before/after/inside枚举、输入及返回offset、页面高度/剩余高度 | `avoid`是否已解析但该函数未移动边界；不能据此宣称引擎所有路径都未考虑它 |
| adjustBlockChildForPagination | 重新估算触发的child layout入口/出口、selected-strut、向父传播或本级消耗、返回位置 | 之前已出现的位移来自哪里、如何传播，不把零strut快照当全历史 |
| RenderBlock::setPaginationStrut | 写前旧值、请求新值、实际写后值、当时活动call | 区分没有生成、合法消费、还是表格重排期间已有值被清零；零→零早退不会伪装实际写入 |
| RenderTable::layout / recursive relayout | 嵌套call、父call、递归来源与层级、前后几何/strut | 将重置绑定到实际重排调用，不凭日志相邻时间猜因果 |
| PrintContext::spoolPage，最终layout完成、CTM/clip后且paint前 | 标题、wrapper、table、thead、header row、首数据行的真实quad、有效style、逻辑尺寸、pageRect/CTM | 最后盒是否跨页/孤行；不读取PDF注释、屏幕DOM或beforeprint作为几何oracle |

解析输出区分 `observed-avoid-without-heading-break-movement`、`observed-strut-reset-during-table-layout` 和 `inconclusive`。前者须真正观察标题after-break、未变返回以及最终标题/首行盒分页；后者须有正strut写零且确认写后值，沿调用祖先找到table-layout。**重置可能是合法消费，不能直接称“keep意图丢失”**；需结合传播/消费事件和独立PDF结果。未命中钩子、匿名/未标节点之外的布局路径、Renderer地址复用未观测的情况均不支持穷尽性结论。节点token仅在这份限定打印流内关联，不能充当通用窗口或进程寿命证明。

## 坐标、时钟与身份合同

- `top/height/width/margin`为实际LayoutUnit转double（1/64 CSS px表示），逻辑top相对父对象，不能跨父节点直接相减。最终quad是文档绝对CSS坐标；用同页document pageRect求交，得到盒的可见页集合。
- CTM为真实打印GraphicsContext矩阵。没有假定96px=72pt，不从PDF反推期望位置；只有正轴对齐矩阵被接受。若需与PDF点坐标对比，必须复用原标尺/纸张/页框实测映射；旋转/非支持变换拒绝，不临时放宽误差。
- `seq`连续且无重复，`tick`是该进程steady-clock纳秒，仅用于进程内顺序；不得与Unix/外部日志时间直接相减。调用栈严格闭合。首个spool后若发生新的被观察layout事件，解析拒绝，不能把尚未稳定布局当final。
- 未来原生wrapper必须独立保存helper与WebProcess的PID+birth/UID、源码/运行时/guard/HTML/PDFhash、实际库映射和正常/失败回收记录。没有这些，解析通过只叫完整诊断流，不能宣称正确引擎或原应用通过。

## 不改变的原始门禁

保留58c78973 deb、原始failure PDF、GTK12mm设置、1024×768窗口分配、同字体、loaded/guard-ready时序。诊断ID/title加入后，原baseline的693词/坐标必须与原来一致；如不一致先停。原72表格行、100代码行的完整/不重复/顺序/裁剪检查、A4/Letter纸张方向、短表及长表/重复表头合同不改。基线孤行仍失败，不能把“诊断完成”写成产品验收通过；纯文字/链接已知缺陷也不抹掉。

没有再加caption或CSS链，没有复制首行/标题，没有整表不可断、固定位置、空白页或截图代替正文。观察补丁保持原engine/输出协议、CSP/guard和默认sandbox。

## 本地执行与证据

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s research/pdf-pagination-mechanism-20261116 -p 'test_*.py' -v
python3 research/pdf-pagination-mechanism-20261116/prepare.py MATCHED_SOURCE observation-only.patch
git -C MATCHED_SOURCE apply --check /absolute/observation-only.patch
python3 research/pdf-pagination-mechanism-20261116/fixtures.py NEW_FIXTURE_DIRECTORY
python3 research/pdf-pagination-mechanism-20261116/contract.py owned-process.log diagnostic.json --pages ACTUAL_PDF_PAGES
```

缺失记录/不完整收尾会写失败报告并非零退出。只有原子日志/进程结束后解析完整流，不在中途看零计数宣布通过。

## 原生诊断前的实际阻塞与最小后续门禁

只读排重：在检查时GitHub `in_progress`/`queued`清单为空。可见最新ccache键来自43672149274，439,993,725字节，另有两个旧键；这是**编译对象清单**，不是已恢复完整私有prefix或匹配本观察补丁的缓存证明。

这些历史缓存来自叠加文字、URI和数字研究改动的源配置；本补丁锁定未改的2.52.6布局源码。复用时必须固定保留/剥离哪些研究输入、配置/编译器/flags/依赖并核对源码哈希，不能伪称当前所有对象匹配。当前本机仅有历史CMakeCache/报告与源码，没有匹配的可执行构建树、完整生成头/compile_commands及GTK依赖；没有足够空间全量建立。故本轮**不满足原生派发条件，没有CI运行号**。

下一步先在既有受控构建环境为上述四个实际TU生成准确依赖图，保持原严格诊断编译参数（包括undefined-inline），检查新头依赖并编译实际对象；不使用假的API stub当通过。再验证完整cache input receipt和有界链接余量。预算应明确包含源恢复/头生成/四TU/链接/四fixture/原PDF比较/清理上传，阶段失败即停，不能退回全量无界重建。只有该门禁满足且再次排重，才可用一次显式有界原生诊断。源码/哈希/解析合同通过不替代这一点。

未发送上游材料、未冻结旧引擎为产品、未改main/正式渠道/通知/安全。真实诊断前不写行为补丁。

## 受控远端四 TU 接线（2026-11-16）

在已有 `dot/linux-webkit-build-probe-20261114` 研究分支增加同一手动工作流的 `pagination-preflight` 操作，因为历史缓存只对该分支可见；旧 build/resume job 被明确排除。不自动衔接，不保存或伪称新完整引擎缓存。作业总计45分钟、源码12分钟、配置/依赖/对象前置30分钟内部总预算，单对象180秒，失败即停止并上传原始记录。

先精确恢复43672149274缓存，核对官方APT认证的四份源码包hash和原配置参数（含FLAGS/ABI/沙箱），保持ccache content校验；两份不受改动影响的原始bmalloc对象必须首次调用命中。它们只证明这两个对象可复用，不证明全引擎均命中。随后沿43660565818方法生成官方头、审核实际执行与命令图对应，定位四文件所属的真实/Unified TU，保留严格undefined-inline并关闭选中对象的ccache，真实编译至多四个对象。没有cmake --build/--install、链接、应用启动或PDF路径。

本地源码API审阅修正了absoluteQuads缺少第二参数，并显式包含ElementTraversal/RenderBoxInlines；未修改布局行为。11项前置守卫测试和8项解析/夹具测试通过。最初新增静态禁止检查把只读`ninja -t targets all`误认为构建all，已用AST区分查询；运行时对实际编译/头命令的严格审核未改变。原2989的前置记录保存为prior-2989-preflight.json。

只有远端四TU与缓存输入实证通过，才有资格评估原生诊断；本入口本身绝不隐式升级为完整构建。当前仍没有原生布局结论。

## 唯一实跑 43788232168：前置失败后停止

精确测试候选 `4738deb05d7134dc8a173e30f6a3dcb5176df7b9`，[运行](https://github.com/Auto-Plugin/milkup/actions/runs/43788232168)。源码四包哈希及配置参数严格匹配；恢复指定缓存后，Allocator/Cache 两个对象各首次 hitDelta=1、missDelta=0（0.168/0.067秒）。官方头生成32.340秒，实际执行5835条获审命令、一次glob检查；没有非选定对象的构建。

| 真实TU | 结果 | 秒 |
|---|---|---:|
| PrintContext | 通过 | 36.149 |
| RenderBlockFlow | 通过 | 45.263 |
| RenderBlock | 通过 | 33.641 |
| RenderTable | 失败 | 20.750 |

唯一错误是观察头调用`element->renderer()`，但RenderTable所属Unified TU缺少`ContainerNodeInlines.h`的inline定义，严格`-Werror=undefined-inline`拒绝。前三个TU的其他间接include碰巧提供定义；这不能替代显式依赖。现已仅给观察头添加这一include，原错误日志及测试patch保留，12项前置/错误分类测试、8项解析合同和精确源码apply-check通过；**修正后未做真实编译**，没有追加派发。没有取消/降低编译警告，没有分页行为修正。

前置实耗313.811秒，runner image20261111.196.1、4 CPU、MemTotal16365628kB、初始空闲90,456,547,328字节、结束89,587,560,448字节。现有runner能承担此窄前置，失败是研究头依赖，并非资源不足；本机仍不能硬构建。实际四TU未全部通过，故完整链接、私有库加载、原安装路径PDF与机制观察全部未执行。不能据三份对象或两个缓存命中跳过前置。

原工件14191153889（1,626,235字节，SHA256 `d4fd51743a08a398e76c2a639b2896ae35cdc7c4dfcf976c33e0322c01588d63`）CRC及每条路径检查通过；保留在Actions至2026-11-23T01:52:24Z，本地完整副本`/workspace/milkup-pagination-tu-43788232168/original.zip`是工作区副本，不冒充长期存储。本目录43788232168子目录保留原始报告、精确失败编译输出、测试时patch及receipt，不依赖绿色状态推断结果。Artifact直链一次403后通过已授权GitHub连接器取得同一ZIP，未改变权限。

遵守本轮失败即停条件；未来若重新授权接续，先对显式include修正重验受影响TU，才可评估20分钟受限链接及完整原生机制门禁，不自动继续，不更换出口、不跳过原失败控制。

## 授权后的单次修正前置与条件原生诊断

继续授权后新增显式`pagination-diagnostic`操作。固定15f9观察patch SHA256 `3a84a75ae9aad83e8f93940c4d55b886c6cf2cba069ca087893fa2efe2e443c8`；没有改变产品或诊断返回行为。共享观察头改变，四个受影响真实TU必须都重新编译，不能沿用前三个对象冒称新头已通过。旧源hash、原配置参数/FLAGS及缓存来源继续固定。

同一作业75分钟：先原有有界前置；四TU全过、初次cache命中及资源成立后，独立continuation最多20分钟compile/link、最多64个新增cache miss、最少8GiB磁盘及2GiB可用内存，否则停止。启动continuation时作业前段不得已耗30分钟，保留安装/原生/收尾时间。不把前置命令变成全引擎调用，也不把两个cache hit当完整链接成功。这里的完整引擎恢复仅在明确条件分支内执行。

原生阶段复用58c78973原deb（9e71…ddde）、原输出binary（42394…76ed6）和嵌入guard（296131…52fa），在全新CI实际安装到`/usr/bin/milkup-desktop`。原命令/FD/guard/载入打印/12mm页面设置及1024×768原生窗口分配均复用；独立采集PID+birth/UID/窗口归属、实际私有WebKit/JSC映射及文件hash、WebProcess沙箱状态。只通过进程环境指定本轮受控prefix，不替换系统库、不更改系统安全或沙箱配置。安装包不是重建包；私有观察runtime不是可交付产品依赖。

支持代码冻结自9f4af4d1，唯一适配是把旧系统库路径断言替换为严格私有manifest校验。使用原4份HTML只加ID/title，核对原长/短临界/宽松各自PDF；基线693词及原坐标0.5点门槛、内容/裁剪/顺序/表头错误完全保留。最终布局标题、thead/header row及首行的可见页集合必须与独立PDF唯一标签页相等，拒绝整页/多页框宽泛匹配。不会跑chain/caption方案，不更改标记结构。

此次本地额外10项原生接线合同（包括实际自有FD子进程正常退出）及原12+8合同通过。精确包/参考ZIP解压、CRC、长度/hash和四夹具对照已在本机验证，但这仍不是原生输出通过。全局诊断status只能是`diagnostic-complete-original-product-failure-retained`或failed，`productAcceptancePassed`始终false。出现失败即终止本批，不自动再派发。
