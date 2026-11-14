# Checkpoint14：UI09 视觉停止与 edge 截图断言红回归

本批只有完成的独立native selection诊断58项显式清单、manifest自身、Root/独立设计与实现审阅、最终harness准备三文件、最终tightening addendum及checkpoint13远端记录。`completed-manifest.json` SHA `3e8fdd5a96f35c841f74b04e9f65cbca7e0dbe79fce64cbaa655061de3c03d06`，58项16,659,970字节全部实读核验。本目录由根代理从外部冻结目录提升为仓库快照；归档工作没有新增测试、构建、UI或产品修改，初批当时排除活动UI09；现仅追加它已冻结的522项及三份独立审阅与两份Root完成审阅。初批、第二批原metadata保存于外部 `checkpoint14-draft/first-batch-frozen/`、`second-batch-frozen/`，旧诊断与新运行分开。活动中的新controlled诊断仍不读取。

**诊断仍为首次RED，不能写全通过**。两次真实Ctrl+C返回同一精确marker，中间只有真实wheel卸载/重新挂载；随后截图阶段附近又卸载，最后完整投影断言失败。新harness只修正测试的公开DOM投影语义，不是产品修复，也不关闭历史UI08精确时序或Mermaid deadline因果。

## 独立诊断的行为证据与失败

实际production06 binary SHA `35bf62fbad2dbe1acbd3485f77ccd554ab1ed6a2a842e47ed60bd7d735fb7819`，相同官方archive；运行2026-10-16 20:54:49.248445至20:55:25.860747 UTC，exit1，无自动重试。二进制/完整profile不在显式清单，未读取复制；身份元数据保留于原summary。

加载后与wheel重新挂载后，分别设置两个不同随机GTK剪贴板sentinel，再由真实XTest Ctrl+C及GTK readback取得57字符唯一marker `MERMAID-SAMPLE-sequenceDiagram-000-first-official-example`，两次逐字相同。Root读精确冻结脚本确认这一顺序；没有独立记录每次copy前sentinel回读，因此不虚构这项检查。复制是实际键盘行为，不是纯被动观察，也不证明hidden anchor/head方向或连续不变。

中间pure-wheel下17ticks、上1tick，没有再次搜索、点选或私有setter。卸载时mountedFrom8295，marker[8103,8160)之外，selection[]/cursor null；回挂载时mountedFrom8057，selection恢复同marker/cursor8160，第二次copy成功。回挂载行位于overscan，top约-607.64CSSpx，**挂载不等于viewport可见**。稍后final时mountedFrom又到8295、selection[]/cursor null，原“Final complete marker selection projection”断言RED。阶段截图名称REMOUNTED不保证拍照时marker仍挂载，更不证明其可见。

23次保存观测均version0、dirtyfalse、errors/CSP空。final version/dirty/full-file inline断言位于失败断言之后，**没有在线执行**；summary和Root另做离线观察/文件核验，windowed全7,851,914字节与UI08相同，SHA `84e661fa8af75731cbe8ff0c89c8b135303432307d7464f74a22cfceb7d1534d`。这支持已保存观察和最终文件，不伪装在线完整闭环PASS。本次count-ready已经有完整marker投影，没有复现UI08历史search-before-reveal时序；geometry与document probes分次读取而非原子，不能拿这些旧记录重放后续原子投影断言。

Root实际看loaded、absent、remounted三张X11原图：前者marker及sequence源码可见，后两者显示后续内容/图，不能从文件名证明marker可见。原10张PNG保留，不表示归档代理新增目视/OCR检查。保留native54dispatch及两组cleanup；最终App/driver等四PID absent，但guardian402273已终止且为PPID1下Z、birth7171942，不能称全部身份消失。4626/4627拒绝连接，Xvfb保留；没有新增完整后代sampler。

## 设计与实现版本关系

所有原件按其形成时身份保留：`consistency-design`为早期建议，`invariant-design`进一步区分两个view真实契约；`implementation-review`绑定中间harness **367ae35de7fde6cb683ddb3c25259efb92bc12ee33c1b3b271a475bd7e066198**，不能当成最终源码hash。后续tightening addendum SHA `6bdb38ff7f97ec3febb9b068e3579f413942a510b2912bcae7bca490a14b60a2` 明确绑定最终 **439232d486fa4a29858924412f23cc09a87023236739cf5bcd3892b7d51f280b**，与准备目录harness-after.mjs实际SHA匹配。旧审阅不回写；前文建议不是宣称最终实现覆盖每个一般化设计点。

最终候选将“前后原始overlay数组相等”替换为分别针对ordinary EditorView与SourceDocumentView的公开投影一致性检查。使用单个同步只读execute取得目标editor的mounted rows、selection层及cursor元数据，包含overscan而不按viewport可见性过滤，快照先写入日志再断言。当前fixture单行唯一marker坐标由冻结文本独立确定。

ordinary overlay使用整个选区from/to，常没有data-line；按此契约去重完整范围。Source view按挂载源行与marker求交，保留line身份、去重同范围物理rect。marker行挂载时缺失/偏移/额外overlay必须失败；确实未挂载时预期为空，stale非空overlay必须失败。cursor按该view与已知marker行挂载契约检查，缺失不转换成0。此检查是公开投影契约，不证明卸载期间私有逻辑选区连续守恒。

最终addendum另核两项收紧：先检查所有mounted行数字元数据，invalidRows不再被交集filter静默排除；已有positioning错误与新的after-projection错误同时发生时，保留前者并记录后者，而成功定位下的projection错误仍正常抛出。文档完整性断言仍可按原顺序先终止，不宣称所有错误优先级被普遍重写。数字检查是当前DOM契约，不称通用安全验证器。

独立精确字节重建证明：移除新增helper/调用/logfield并恢复原数组断言，等于已提交的导航readiness基线4d3e797…2fbc8。所有其余图像、历史、页面error/CSP、完整catalog/matrix、version/dirty/full-file断言保持。已有readiness仍是单独30秒等待，可增加总seek时长；产品2秒render/10秒init、定位10秒/20ticks/2reversals不变，没有新增重试/skip/源padding或合成选区。

准备记录含语法、formatter、diff检查；实现与最终addendum是静态核查，不是harness runtime验收。UI09后来完成但因独立视觉门槛失败主动停止，详见下节；不用新断言回写旧诊断RED；独立copy行为证据始终单列，不升级为完整逻辑状态证明。

## UI09：STOP ON VISUAL GATE FAILURE

完成manifest SHA `ee051bf8d2d49589965925e426ece139ded4141300edbf59ca8655189b923afa`，522个owned文件/41,766,488字节；summary SHA `da3943282a16fa1f5c2f75aec2e2a25f6f9874785f9ba30861b4ec6accdad5e8`。其中462张原PNG共29,430,415字节，内容去重458个新增PNG/29,210,928字节全部本地原样保留，完整alias映射，不曾重编码、裁切或打包ZIP。大fixture复用固定旧对象；二进制/profile/完整生成资产不收。

实际production06 binary35bf…7819与archive27db…6239不变，正式harness439232d。运行21:03:14.362437至21:26:39.771488 UTC，Root发现独立视觉失败后要求对精确Node身份pidfd发SIGINT，exit-2。**原results的258条记录没有伪造assertion FAIL，也没有overall PASS**；独立 `visual-gate-abort.json` 记停止原因，原记录不回写。

ordinary/windowed coverage各31，selection2、history12；matrix完成26/64、样本134，另edge记录10。剩余38组合未完成，包含已部分执行的第27个组合，均不能计PASS。26个完成标记只是原harness计数，不证明它们全部通过独立像素审阅。207次定位、414份projection快照保留；所有已存errors/CSP为空、文档最终字节相同，不能替代视觉门槛。

直接失败证据是 `edges-ordinary-live-light-200-narrow-classDiagram-000-first-official-example-bottom-right`，range440..969：scroll容器294×397/client169×328，wheel后top125/left69，图URL尾463d…；同次截图后DOM变为top0/left0、新URL尾bf2a…，`sameScrollStateAtSnapshot=false`，实际截图回到上部Animal。10个edge样本有1个该类snapshot mismatch。此处不能凭wheel后瞬时达到最大滚动就宣称底右边缘已被截图验证，也不能继续以完成数量覆盖已见失败。Root另完成522项实际hash/size复核，并实际查看class WebView原图确认上部Animal；两份独立Root原件已追加。class报告保留完整before/after preview及document，明确相同尺寸不等于相同语义/内容，根因仍待诊断。

已有summary记录native2169dispatch及两组cleanup/3条cleanup-confirmed；有限trace和空JS错误不构成历史deadline原因关闭。25项原准备输入、source difference与停止清理原件均在522清单：对production06 source范围的差别仅正式harness d93de→439232d，不能把整个源码说成无变化。

## 三份独立视觉审阅的不同结论

独立像素review实际看25张代表PNG，不是462张全审，也不是全部matrix验收。它覆盖普通source light/dark若干zoom以及普通live light/dark代表、windowed短sequence light100一对；没有windowed高zoom/dark matrix。外部X11黑画布不等于应用空白；source当前横向位置裁掉行首不自动证明不可达，但也不能声称完整源码可见。

Sankey对照实际查看旧original/controlled与当前150%原图，标签拥挤在旧官方strict/htmlLabels:false基线已存在。旧100% fixed研究AST的original/canonical-inline/canonical-img对应PNG逐字相等，且记录 `productPluginTested:false`；这是旧研究对照，不是当前production payload或跨zoom像素等价证明。当前上中部可见、下部超viewport；不得为消拥挤擅改官方source、删label或宣称当前不存在额外问题。报告引用的旧支持路径仍是原证据引用，本批未递归复制node_modules/engine或重新渲染。

Journey空白审阅是旧成对图与条件几何分析：原官方SVG width100%但显式height565、viewBox0 -25 1300 540、xMinYMin meet。若当前内层仍此契约，CSS380×565时viewBox高约157.846，剩余约407.154为画布留白；max scrollTop413可能已滚到绘制区域以下。**当前canonical payload/root属性未由该审阅捕获，故这是条件解释，不是当前native正确性证明**。不能只因自然尺寸760×1130相对CSS380×565是2倍就推断二次缩放bug。新同宽/同zoom原生paired诊断只在报告中提出，当前活动实验不归档。

## 停止、清理及剩余门槛

Root主动visual abort与正式assertion失败分开。Node精确SIGINT停止后核App PID/birth/argv与所属窗口；记录含WM_DELETE_WINDOW请求，App最终由SIGINT中断。App absent后才精确driver pidfd SIGTERM，launcher exit0，6个列明PID均absent，4626/4627无listener，Xvfb未动。driver在App退出后仍报告session，因此不宣称WebDriver DELETE成功；没有新增完整后代census。首次cleanup因缺正常PATH而xdotool ENOENT发生在X11动作前，仅cleanup补正常env后再做，不是测试重跑。

此时只完成证据归档，产品/正式验收仍未完成。新controlled诊断由独占CPU/UI owner执行，不读取其活跃目录，不把其未来结果反写UI09。后续须定位并验证滚动/替换、给Journey当前条件的实测结论，完成余下矩阵及独立视觉检查；不宣称26组合已覆盖64。

## test-only 截图 edge 断言补强，真实旧记录仍 RED

只追加 `research/ui09-scroll-edge-stability-01/manifest.json` 的15项与manifest自身，SHA `4a154327d5380f8d93eb713d835ef7f1819c8207f13475d4fe086c4f2c70d5fe`。before439232d与after正式格式化候选 `22c07075c87ede32b280f6d1aeffc1d4b4577a9b91c8d3c2a441cde606ad4e68`、未格式化版、diff、真实UI09固定记录、两次offline RED及静态检查均原样保留。

新helper在截图前和截图后验证同range仍decoded、image尺寸正数；两个轴均须finite且有效scroll尺寸。以前overflow的轴不能变成不可滚以逃过断言；当前位置距目标corner及原已到达offset按当前extent clamp后的值都须不超过1CSSpx。这样旧记录中的wheel后top125/left69→截图时0/0不能只靠“图仍存在”通过。不是只绑定blob URL，也不是同尺寸即语义相同的假设。

初次offline helper与从**最终after源码精确提取的helper**分别在冻结UI09实际记录上exit1：预期left69/top125，观察0/0，原错误日志保留。目录中的早期 `scroll-edge-assertion.js` 不含最终新增image正尺寸检查，不能冒称它等于final helper；最终权威为after源码及offline-final-helper-red.mjs对应提取。没有重跑或篡改UI09原结果。

这是新增测试断言的失败证据和syntax/format PASS，不是产品修复，也没有native/browser runtime GREEN。原有projection与其它模块字节通过移除新增helper/dispatcher/shot/record分支并恢复单个scrollEdges块精确重建。没有修改生产预算、渲染算法或正式source，活动classnative诊断明确排除。最初可选source环境脚本路径不存在但pnpm本已可用；原summary说明最终检查直接成功，不把准备小错误删掉。

## 增量完整性与跨引用

613个来源别名，550个本地去重对象/34,647,122字节，34个旧对象/8,049,099字节跨引用；472张PNG来源去重为466张本地原PNG。累计614项SHA/长度检查（初批finalharness额外一次），均匹配。两份7.85MB windowed/body work文件复用固定旧对象，没有重复复制。原raw字节不格式化；live绝对路径只表出处，正文读取应按固定index对象或旧检查点引用。

敏感模式筛查结果见外部handoff，模式扫描不保证任意秘密不存在，PNG不OCR。随机clipboard sentinel是明确任务fixture数据，非凭据。外部checkpoint14-draft支持材料不自动入本raw索引。

checkpoint13远端记录固定commit `83d5593bddb6bb25bd6342df06b57c5c7c27d2ea`，Root已核remote/GitHub身份；API email为null、git配置和连接profile提供email，归档代理不重新联网。旧checkpoint06–13保持不变，完整固定indexSHA/commit在索引。校验：

```sh
python3 verify-index.py \
  --checkpoint06 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06 \
  --checkpoint07 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint07 \
  --checkpoint08 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint08 \
  --checkpoint09 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint09 \
  --checkpoint10 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint10 \
  --checkpoint11 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint11 \
  --checkpoint12 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint12 \
  --checkpoint13 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint13
```

同级入仓可省略base参数。本批已含Root完成审阅并由根代理提升为仓库快照；UI09视觉失败已停止，后续诊断另批，不宣布完整产品通过。
