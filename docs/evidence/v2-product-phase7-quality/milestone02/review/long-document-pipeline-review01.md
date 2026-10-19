# P7 长文链路独立只读审查

基线：`78e9329004d2ff244585d98dbe0d7cdd98ab9495`。审查时所列关键源码无工作区修改。仅静态读取和既有 M01 报告分析；未改代码，未运行测试、GUI、产品或性能实验。以下耗时不是当前 HEAD 的新测量，候选设计也未实施。

## 既有证据与结论边界

来源 `milestone01/outline/matched-native-comparison.json` 明确限定 candidate02：large follow p95 233ms、click p95 387ms；dense collapse p95 298ms；独立 dense-scroll-fresh wheel-burst-10 p95 680ms（普通 dense 轮为619ms，不混用）。各交互20样本。large 完整索引三次 10060/10776/9168ms，相对 baseline 15834/7260/7409ms 的中位数从7409变10060；dense 中位数8231→9724ms。三个索引样本不足以确认回归原因，首轮与后续 warm rebuild 不能叫 OS 冷缓存对照。

原 harness `tests/native/tauri-p7-outline-performance.mjs:242–276` 使用可信输入捕获起点、目标DOM条件和后续不同 rAF 帧确认；wheel 还等 triggerFinished。它不是物理屏幕呈现时刻，也不是纯处理器用时。每帧遍历行、读几何的观察成本也在环境内。保留原测量及失败，不用新诊断追认旧预算通过。

## 可插桩阶段与待验证假设

1. **编辑器状态发布与调度。** `apps/desktop/src/main.ts:4356–4396` 生成公开 viewport/documentVersion/selectionRevision 快照，读 clientHeight；`4406–4424` 为普通输入/滚动设置240ms debounce，之后 idle callback（timeout500）或0ms timer。`4399–4403` 的 document-edge 导航直接 updateViewport；普通 EditorView 的 documentStart/End 在 `2231–2237` 调此入口，SourceDocumentView 使用 onDocumentNavigation。因此240ms不能直接解释那组233ms follow。分别记事件种类、计划/取消/实际触发、idle进入、快照读取起止、document/version/selectionRevision，确认该样本到底走哪个入口。多次取消可能延后普通连续输入的发布；不能把所有发布都改同步。

2. **宿主 render/RPC 与两阶段输出。** `desktop-plugin-ui.ts:224–240` 将 viewport 更新合并为 pending 位并等待各 mount；`518–568` 建快照、递增 renderSequence、等待 runtime.renderUi、检查generation/sequence/doc/version、pointer状态及输出signature。`desktop-plugin-manager.ts:1226–1260` 检查贡献与activation epoch；`packages/plugin/src/runtime.ts:622–645` 再检查capability generation。Worker transport 在 `isolation-rpc.ts:116–138,191–207` 有请求ID和收发边界，RPC服务器本身不是一个全局串行队列。记 host dispatch/receive、Worker receive/handler-return/post、输出bytes/节点数、inflight计数与每一种丢弃/相同signature/pressed-pointer延后结果；勿把wait总时长统称Worker CPU。

   `plugins/outline/src/plugin.ts:144–192` 收到新activeLine或virtualViewport后安排refresh，但同步返回之前准备好的rows；`376–394` timer→队列→prepareRows→requestUpdate，随后宿主再次render。一次用户意图可能有旧slice响应和新slice响应。应关联两者和 `rowStart/end/revision/preparedFollow`，量出旧响应是否触发无用DOM替换。只拿第一RPC返回或 uiState=ready 当终点会低估真实完成。

3. **插件内串行等待。** `plugin.ts:578–584` 的 Promise queue 共享给扫描batch append (`287–299`)、导航/折叠 (`72–114`)、prepareRows及 `await updatePanel` (`383–387,592–593`)。记enqueue/任务开始/结束、类别、排队深度、当前扫描状态。导航内部 `await host.ui.revealLine`（86）包含宿主文档窗口读取/DOM与一次viewport更新，不能算插件算法自身耗时。旧prepare请求在入口和提交时检查renderRequest，但中途页读仍可完成后被丢弃；记废弃工作量。假设：扫描期间的队列等待或等待宿主更新延后交互；若slow样本queueWait接近零，则否定此项主因。

4. **索引与页读取。** `outline-index.ts:13–72` 将metadata、label、visibility共享24页LRU，满时flush脏页再删8页；prefetch去重后每4页一个getMany。`558–575` 每16行依次selectRange→metadata预取→label预取；输出范围最多500行。`plugin.ts:397–437` 还做active atLine/rank及祖先回退，但范围未变且rowsDirty=false时复用rows。记录hit/miss/eviction/dirtyFlush、page类别、getMany keys/返回bytes/时长、JSON parse/stringify与UTF8 encode、每16行批次、rows复用率。冷页/跨页或metadata-label-visibility互相淘汰可能拉长range准备，属于假设。

   `apps/desktop/src/plugin-temporary-storage.ts:155–223` 每批通过IndexedDB事务，先校验store metadata，getMany内部串行读key，setMany读取旧页并做配额累计；SDK RPC见 `packages/plugin/src/storage-rpc.ts:99–128,180–181`。分别量Worker到host、IDB排队/transaction完成、返回反序列化。不得绕过quota或把bounded prefetch改成全文内存缓存来换成绩。

   全量扫描自身随文档/标题规模增长：`plugin.ts:271–339` 用4096行段、512行窗口、128结果batch逐条append；索引append沿fanout32树路径更新（`outline-index.ts:234–260,489–524`）。fold range使用子树lazy cover（`262–297`），collapseAll/expandAll是epoch reset，不应误报为每次全18k节点重扫。`packages/plugin/src/document-broker.ts:567–577,756–759` 已复用版本匹配的有界heading context checkpoints，不应未经计数断言分段扫描O(n²)。优先启用现有 `onDiagnostics`（183，read/yield/scanCpu 683–744、1173–1180），再补页层指标。分离firstRows/fullIndex、读取/scanCPU/append/flush/呈现轮数。索引退化可能来自页往返或refresh与append竞争，也可能是扫描/存储本身；现证据不能排序归因。

5. **挂载片段重建与布局。** `desktop-plugin-ui.ts:1202–1204` 对完整输出JSON.stringify；相同signature才跳过。改变时 `588–617` 递归captureScrollOffsets、构造全部受控节点、reconcile、装饰树。`controlled-form-ui.ts:38–47` 无field的路径实际 `replaceChildren`，不是行级patch；`packages/view-dom/src/controlled-renderer.ts:64–119` 递归造节点和action监听器。`controlled-tree-ui.ts:13–44,111–147` 搜索/规范公共树，每次remember遍历当前items；是O(k)挂载片段工作，不能称O(全文标题数)。同一slice的active/revision/status改变仍可能改变signature导致重建。

   `desktop-plugin-ui.ts:1285–1297` 对每个后代读scrollTop/scrollLeft，`633–657` 焦点搜索/恢复，`767–806` 写spacer/scroll并读clientHeight，最后可能scrollIntoView。读写交错存在layout成本风险，但源码不能证明哪次forced layout耗时。记signature、节点构造、replace、decorate、scroll/focus配置各段时长及节点数；几何检查放在既有读取附近，不在每个节点额外getBoundingClientRect。真DOM后应确认实际treeitem数/首尾行/active/focus/scroll范围与输出一致，再以不同帧确认稳定。不能仅改metadata制造完成。

6. **列表滚动调度。** `desktop-plugin-ui.ts:959–1033` 每wheel/scroll重置160ms timer；pointerActive返回，用户意图过期返回；最后检查当前mount/list和可见范围，margin不足才更新。buffer至少160或visibleCount×8，当前outline输出最多500行（不是宿主通用UI的全局行数约束）。`850–857` wheel提供方向，`871–873` scroll补调度。持续事件间隔<160ms时回调可以一直延后，这是代码可证的trailing-debounce性质；是否造成实测680ms须记录首/末wheel、timer重置次数、实际触发、当前slice是否覆盖视口。不能用680−160称剩余Worker时间。

7. **编辑器导航完成。** `main.ts:4490–4511` revealLine等待Source revealSelection，再await updateViewport。`packages/view-dom/src/source-document-view.ts:742–785` 等scrollToLine并检实际目标行；`846–968` 先等editCommitQueue/待提交编辑、读取窗口、检查版本/request新旧、替换窗口，再测table/search/selection/cursor及warmup。当前scrollAnchor分支 `251–272` 已避免导航自己触发的重复scroll渲染，不再把它当尚未修的已知原因。分别量排队、source read、live parse/presentation、DOM、selection/cursor、插件反馈。真实目标行/cursor与outline aria-current共同满足才算click完成。

## 保留语义的最小候选设计（仅提案）

**滚动：先试有界leading/trailing合并，而非无条件每帧发RPC。** 保留被动wheel/scroll、pointer gesture保护和现有buffer/margin。事件只更新“最新期望range、edge、user epoch”；可用rAF采样几何，但每帧采样不等于每帧render。给首次待处理意图记录时间，设有限最大等待；窗口内只保留最新一次，队列里不累积旧range。优先考虑维持约当前上限频率的leading+trailing throttle，实测再选间隔，不能随意降低预算或把等待移出计时。

- 调度键必须含mount generation、document/version、当前list身份、user epoch以及期望range；新doc、dispose、手动focus离开、旧list替换时失效，保留现在latest-wins判断。
- 仅当期望range不被当前真实slice覆盖且越过margin时请求；同一range已在途则合并。旧请求结束只释放自己的inflight标志，不能清掉新意图。当前RPC可能返回旧slice，故不能把promise settle当range满足；等待后续requestUpdate实际提交，并重新比较当前真实slice。无新事件/新revision时不得循环重发同一需求。边缘请求requestId只消费一次，不把旧edge反馈当新用户行为。
- 程序写scrollTop、followActive、键盘Home/End/cross-slice intent不得重新标成用户wheel。用户继续滚动时旧preparedFollow不得把视口拉回active heading；保持插件现有“新user范围立即清preparedFollow”的语义。不要为了调度吞掉keyboard intent或恢复已离开的focus。
- 应测持续2秒高频wheel、突发10wheel、正反向、pointer拖动、flight中doc切换/关闭/撤销、Home/End后立刻wheel。验收同时看最大未覆盖窗口时间、RPC数/丢弃数、实际DOM覆盖、最终scroll/focus，不只看mean速度。若buffer始终覆盖且timer并非慢样本关键段，就不改调度。

**field-free替换：先判定metadata-only/精确未变子树，避免直接引入通用keyed diff。** 当前公共UI没有可靠通用row稳定key；标题、aria-label、数组位置都不能假定跨折叠唯一身份。最小试验只对输出受控结构、action command/input和整个row subtree逐值相同、仅允许的虚拟列表metadata/spacer变化的情形保留旧行节点；active class/aria-current/expanded变化若不在严密支持的属性patch范围内则退回现有全替换。若这种命中率极低，先不做没有收益的复杂优化。

- 首先通过现有activation/capability/mount/sequence/doc/version检查和受控tag/attribute/action验证；复用不绕过authority。不得按pluginId、command前缀或outline私有状态分支。
- metadata改变前校验真实DOM的行数、结构、当前slice与旧输出契约一致；splice/replace及spacer、aria、range、revision在一次提交内完成。所有后置几何/焦点判断针对真实节点。对重复标题、text-only名称、任意未知结构和不满足预检的情况fallback。
- 被复用节点的action闭包必须对应完全相同command与完整input；否则更换节点/监听器。禁止只改属性而保留指向旧文档/旧ordinal的闭包。field表单的dirty revision/composition路径仍独立保留，不推广此快路径。
- 若进一步做行级复用，必须有一般化稳定身份契约与实测收益，不能凭文本哈希当身份；改变公开SDK需另审，此提案不要求新API。保留focus departure、不抢焦点、text-only restoration与旧请求失败不覆写新UI的既有回归语义。

## 最小诊断执行顺序与结果判据

先冻结诊断source/package/hash；关闭逐行console，以有界事件缓冲记录阶段duration、计数及请求关联，不记录全文/标题正文。宿主与Worker各用本realm monotonic clock，跨realm用RPC ID配对并报告roundtrip；未校准时不可直接减两realm timestamp。关联现有RPC ID与host renderSequence/document/version/selectionRevision，诊断信息不成为public SDK权限。

先做一次phase诊断定位，诊断版本自身开销需单独注明；随后用同binary/profile策略、同fixture/hash、同trusted-trigger/真实DOM观察器重测非诊断候选，串行占用CPU/GUI。把各样本的queue、timer、RPC、页、DOM及frame段绑定原始总耗时，说明重叠段不能简单相加。再选择单一最小修改；保留原首结果、超预算样本和失败，不通过缩小文档/渲染行数、放宽完成条件、提前ready或ID特判取得PASS。

本报告无已证明慢样本归因；无建议绕过独立插件的sealed package、Worker isolation、公共document/storage/ui broker或真实DOM完成条件。当前行动建议是先插桩阶段边界，不直接重写索引/通用renderer。
