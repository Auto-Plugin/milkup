# Checkpoint11 工作分支检查点：Mindmap 诊断、UI06 定位首败、UI07 累计页面错误首败

最新完成批次 UI07：31 ordinary + 31 windowed coverage、2 selection、12 history、首个 matrix 组合的5个样本记录PASS，但累计 `ResizeObserver loop completed with undelivered notifications.` 自更早 ordinary flowchart-086 记录已出现；首组合末 errors-empty 断言RED，**0/64 matrix组合完成**。记录上的局部PASS不等于没有累计错误或完整产品验收通过。产品修复尚未做，历史 Mermaid deadline 因果仍未关闭。

保留前批独立 Mindmap 诊断/回放、UI06 定位30/31首败与 v1–v3 静态准备；后批结果不改写旧失败。活动 RO 研究及新浏览器测试不读取。本目录已复制至工作分支作为未验收检查点；复制不代表已提交或完整产品验收。归档过程未运行测试、构建或原生 UI，旧 checkpoint05–10 不变。初批与第二批精确 metadata 分别保存在外部 `checkpoint11-draft/initial-batch-frozen/`、`second-batch-frozen/`；这些支持材料不自动属于 raw 索引。

## 原65清单的范围错误与独立完成权威

原 `completed-manifest.json` SHA `f9a15e49d1d6fefea741a0fd94bbed12d269c7206ff8439888aba14189fcfe73` 的递归枚举误收了6个当时仍活动的analysis文件。保留原件，不覆盖其SHA或伪造当时已完成。

范围更正 `completed-manifest-scope-addendum.json` SHA `f7244405d92c27ed8cc5f615d09c3c07e59184fe51c8f258544443a1a56e004b` 明确59项runtime-owned与6项incidental rows；后者只能作为当时路径/长度/SHA声明。analysis的完成权威是独立 `analysis-current-core-01/final-manifest.json` SHA `e9f1317de2017e40ba8640f563b34c4ccd39e8a6568d89dc886680b693842b4a`，25项/963,029字节。

归档前实际检查59+25全部匹配，0不一致。旧6项目前恰好仍与final正文SHA相同，但这不能把历史误收升级成当时有效完成信号；正文按独立final25归档。`historicalIncidentalAnalysisRows`保留历史声明、当前完成正文匹配情况与资格。未复制profile、缓存、binary/archive、整个依赖目录；scope更正没有引发runtime重跑。

## 单次真实生产05诊断

使用未变production05与精确官方archive，fresh profile的一次诊断exit0，不是正式UI05验收重试。公共UI安装、打开完整ordinary fixture、一次选择Mindmap marker；在原位置保持到observer4s点，再做一次有界真实wheel手势，4ticks/1.08s将marker从575.61px移到243.61px。原10s观察期限不变，没有DOM写scroll或伪造事件。

捕获50messages、21对render requests/results、77DOM samples、598,952wire bytes，drops/errors=0；每个捕获result均ok:true、complete:true、单fragment。原位置Mindmap render16范围UTF16[4024,4425)，精确fenced SHA `650319e3661950bc5c35ab94869f2dcb70c0be830c990f5ed7e79b39fb786a1d`，page-observed往返647ms，在wheel前已返回；后续wheel前DOM仍只含Gantt/Gitgraph。滚动后目标render26/29分别795ms、479ms返回，DOM出现Gitgraph+Mindmap。它们是含观察开销的页面往返，不是native CPU时长。

自动恢复在10s+1ms完成，原fetch descriptor/function和live callback相同，未复活retired callback。保留observer开销与截断：capture总14ms/max4ms、outgoing过滤5ms、DOM采样22ms；terminal-only no-text元数据只看581children中的256行，53,356序列化字节，明确不代表完整私有source window。9个原observer guards与3个新增terminal bounds guards是工具检查，不是产品验收数量。

native保留32dispatch和两组kill-start/cleanup-complete/cleanup-confirmed，无retained deadline；未宣称有限异步trace涵盖所有事件。App/driver/launcher不在、4626/4627拒绝连接，最后guardian379763已终止但仍为PID1下Z，不称全部身份消失或完整后代census。48项准备引用、2912生产源码与完整ordinary字节无变。最初文字插入断言在mutation前拒绝stale formatting anchor，`insertion-note.json`原样保留，是准备问题而非runtime重跑。

## 独立current-core回放与精确预算结论

一次离线回放exit0，没有新native/browser运行。选中这一instance的17对实际captured request/result均通过当前完整single-result validator。Mindmap render16/26/29的canonical输出在滚动前后相同。

用同次实际文档和捕获的完整fence blocks**重建**whole-window请求后，render15+14+16三份actual结果不通过 `copyDocumentPresentationAggregate`。原结果JSON为92,363字节，而独立公开image-codec共享ledger累计canonical SVG **269,397字节**，超过原262,144上限7,253字节。三种两图组合以及两份实际post-wheel Gitgraph+Mindmap组合均通过（共5个两图aggregate；加三图失败共6次检查）。presentation serializer的单项字节和269,477因deterministic ID prefix不同，不能与codec ledger混用。

没有用旧run AST或改原捕获；input/source/request切片与hash均保留。此结果证明这三份实际结果的预算不可接纳及与两图显示相符，**不是捕获了私有service分支、visible priority或内部入队顺序**。不将本诊断request ID回填到原UI05首次失败，不宣称历史UI04/cold deadline因果已关闭。

## 静态建议与Root审阅

`ui05-visible-reading-priority-design-review.json`提出的是有条件的adjacent-reading优先级方案，不是已实现。后续 `ui05-reading-priority-positioning-addendum.json`明确先通过真实公共UI定位测试，不因同时可见重图受有限预算约束而直接改产品优先级。

Root联合审阅 SHA `38d65eb3c500f83e4af94b5e4194ee407bf3f94003bd2ca182e8531f7a6ef6a4`实际核25analysis、12input/support并再次看原X11。图中Mindmap上部/中央蓝色节点可见，下部分支在viewport外，不是全图像素忠实证明。Root决定保留预算/优先级，后续验收用真实wheel明确阅读位置后保留原图像断言；这是初批形成时的决定；后来完成的 UI06 结果单列于下，不回填到该 Mindmap 诊断。归档代理没有新增像素审阅或产品实现。

## 定位 harness v1/v2 的历史完成静态准备

只收 `formal-ui06-positioning-preparation/manifest.json` 的6个显式文件与自身，以及 `revision02/manifest.json` 的7个显式文件与自身、根目录两份独立review，共17个文件；不递归扫目录。v1 manifest SHA `94e56af1d0533de786d85e3ce1d1a41595a08d6bd4fabfb2beaba6c3ad0133bb`；v2 SHA `a1195cd52b542c31f1d0b7fb95a3bfef714e269710704d800be56405f52d5048`。v1 harness SHA `8d34bc24e0fc60b4588c008a1402abe3384bf1e3dde6c17045845df8e75bebc0`，v2 `a00f14ca30d468fd33f92c14c9f060fcf658e10cbc046cdbb135fbfb4441fc6b`。

独立静态review确认原cold/fallback/ready/decode/history/save/64matrix断言保留、真实pointer/wheel边界不降低；v1建议两项精度修正，v2仅实现editor client viewport（排除border/scrollbar）及readPosition返回后接受success前再次检查elapsed。20ticks/2direction reversals等边界保留。100ms观察不是全局渲染静止证明，同步工具调用不能被抢占，返回后拒绝超时不等于严格系统调用wall上限。

这是harness准备和静态检查证据，不是产品优先级修改，也不表示窄窗口/缩放/nativeUI06成功。初批当时未读取活动 UI06 control/run/log；第二批只按其完成 manifest 追加。`report-addition-draft.md`为待编辑草稿，明确不归档为最终材料。两版原件及review建议/落实差异均保留，不用v2覆盖v1。

## UI06 首次正式运行：定位首败，目标图可见

严格收录 `control/mermaid-ui-06/completed-manifest.json` 的140个 owned 文件（82张原始PNG），manifest自身及四份完成审阅，不递归收profile、缓存或runtime/binary。manifest SHA为 `48cf9895d1684f85538dcff1f307f333c9a9a6acbaf852d8715f4ccaffafca34`，summary SHA为 `3798d5bb22ebac96794b5e0c526c94c03dd3a1de81298b92a5ca97d57c529e77`。Root另有140项长度/SHA实读核验。原始25项准备快照中的v1 harness 与最终运行v2记录均原样保留，不把准备版本改写为运行版本。

同一 production05 产品和官方 archive 未改；运行 harness 是 v2 `a00f14ca30d468fd33f92c14c9f060fcf658e10cbc046cdbb135fbfb4441fc6b`。源码审计明确存在这一 harness 差异，不称整个源码树无变化。43条记录中42条PASS，ordinary30/31，末项 `local-unicode-roundtrip` UTF16[11754,11839)在定位先决条件处失败：20ticks、7477ms、0reversals。其后原图像断言尚未执行，不能据截图计31PASS。

最后目标框 top500/bottom598.390625，client viewport top37/bottom730；Root实际查看FAIL-X11，确认两个Unicode节点及连接完整可见。ticks5–20的scrollTop均11900、前一图仍可见。UI06没有记录scrollHeight/clientHeight，故“物理底部”只能是重复scrollTop与尾部像素支持的推断，不能写成已测量事实。早期几何仍有变化，不能将全段描述成静止。

文档version0、selection11714..11752、dirtyfalse、源字节保持；JS/CSP错误为空，插件仍enabled。保留的native trace有809dispatch及两组cleanup，无retained deadline；有限异步记录不能证明全部事件。此首败是定位边界断言，不是已证实解码器故障或native deadline。windowed、source/history及64matrix未进入，未重试洗绿。四份完成审阅保留原资格；独立像素审阅只看其明确列出的原图，不表示逐张目视82PNG，归档代理没有新增像素判断。

## v3 与消息更正：第二批完成的静态准备

按两份manifest的7+2项、manifest自身及两份独立addendum收13文件。v3 manifest SHA `7a9caeb876dd1f70741737acd1ec36ca644741453b6f1186c5f6f21ccaa8ded4`；消息更正manifest SHA `876a6437cf3699fa09e3bf61ef3db3bfbe8533ccd904625e398491b5eb911cf9`。原v3 harness `0f328ee283b7080c8efc08322ca73450904d1248d16e60b5a3768577a0bc5111`，最终仅消息更正为 `d93de072c9618cab38136f96c1acde9707b8f8a303341548df613c0d16e3a7a2`。

新增完成分支使用可见目标与实测 `scrollTop + clientHeight >= scrollHeight - 1`，这是单边近底部关系，**不是对称相等判断**。须相隔既有100ms的两次连续观测：scrollHeight/clientHeight、targetrange及preceding列表相同，其余几何变化不超过1CSSpx；几何变化重置。20ticks/2reversals/接受成功前10s检查及原decode/图像/历史/保存/64断言保留。两次局部观测不是未来异步布局静止或windowed文档EOF证明。

旧v3失败消息只提first-visible、旧summary措辞不够准确，原件保留；独立addendum和message-only patch明确更正为同时包含stable physical scroll end，没有改条件或扩大预算。本节是harness静态准备与已有检查记录，不是产品修复；UI07执行结果单列如下。第二批当时排除了活动UI07 control/run/log；现第三批只按完成manifest追加，待编辑report草稿仍排除。

## UI07 正式首败：覆盖记录完成，累计 RO 错误未通过

严格收录 completed-manifest 的240个owned文件/184张PNG、manifest自身、Root失败及清单核验、独立像素审阅，共244个新来源。manifest SHA `0e68b04290e8a6d86c9278942c1c68802018344c641a267eb351211377b33b32`；summary SHA `9045dff5218229d87de799194f752f594cc00bf1fdb219c47d771f5e4334c9a8`。所有长度/SHA实读匹配。没有递归扫profile/runtime/binary或活动研究目录。

该次仍使用production05 binary `63205c85b11fbaa7ec0ec0316737eabb8fe9a96115a4a06367dbd8d59322af7a`、相同官方archive，最终v3 harness为 `d93de072c9618cab38136f96c1acde9707b8f8a303341548df613c0d16e3a7a2`。源码比较明确仅有harness相对production snapshot的差异，不称所有输入字节未变。

94条记录中93条PASS：普通与windowed各31个coverage，2个selection、12个history、首matrix组合5个样本完成；ordinary/windowed文档最终字节均精确一致。全部77次定位完成（75次first-visible、2次physical-scroll-end），最大6ticks/2100ms；这只说明本次定位记录，不保证未来所有布局稳定。

**首次记录到RO错误的是ordinary `flowchart-086-animated-edge`，时间20:01:26.585Z**；前一记录069-image在20:01:21.410Z仍空errors。后来首matrix `ordinary/source/light/100/wide`的5个样本完成，组合末原errors-empty断言读取这个累计错误而失败，不能归因为进入matrix才新增错误，也不能把该组合计PASS。windowed等后续局部PASS仍带有早前累计错误，不是整段无错误声明。

UI07补齐实测底部数据：Unicode目标连续两观测scrollTop11588、scrollHeight12281、clientHeight693，elapsed158/283ms，0ticks，以physical-scroll-end完成且源字节保持。这是UI07新观测，不能回填UI06缺失尺寸。Root实际FAIL-X11为完整Journey源码及后续XY源码、选中marker、保存状态；截图不能识别RO原因。

插件仍enabled、CSP为空；没有安装observer，没有请求payload、RO stack或精确产生时间。保留native trace有1145dispatch及两组cleanup，无retained deadline；不据有限trace推断全部事件或关闭历史deadline。未自动重试、未抑制错误。产品修复和对应新生产验证尚待，0matrixcomplete保留。

独立像素审阅实际看10张（7X11/3webview），只声称列明的区域：Unicode小图完整，大windowed Mindmap仅上部/中央可见，预览内底部可达性未证。selection/history静态帧不独立证明字节语义。一次工具高细节预览呈黑，重开原图正常，不能记为原生黑屏。未覆盖125/150/200%、窄窗口、暗色与windowed matrix。全部184原PNG归档不意味着全部经过目视审阅。

## 增量完整性

510个source aliases，406个本地去重对象/19,269,897字节，39个旧对象/8,124,472字节跨引用；270张PNG来源别名、266张本地去重PNG。累计513项SHA/长度检查匹配（含重叠review与manifest自身）。第三批244个显式来源检查0不一致。敏感模式扫描结果见外部最终handoff；不是任意秘密不存在保证，也没有PNG OCR。raw字节不格式化。所有live路径只表来源，正文定位应使用index中本地/固定base对象，不读取未来被修改的路径。

checkpoint10远端元数据记录固定提交 `a5658985ff3d8fc6d06d49025f9d9babfe2b3ff6`，归档代理未重新查网络。完整base06–10 index SHA/commit在本索引；验证所有对象、别名、引用、无orphan/symlink：

```sh
python3 verify-index.py \
  --checkpoint06 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06 \
  --checkpoint07 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint07 \
  --checkpoint08 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint08 \
  --checkpoint09 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint09 \
  --checkpoint10 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint10
```

同级入仓可省略base参数。外部checkpoint11-draft预核/生成/验证报告是支持材料，不自动计入本目录raw索引；静态校验不是产品测试。
