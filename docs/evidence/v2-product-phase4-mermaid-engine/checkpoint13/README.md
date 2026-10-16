# Checkpoint13：production06 生命周期、UI08 首败与导航就绪静态准备

仅归档 production06 已完成的真实Linux deb构建与五项通用DOM生命周期。`completed-manifest.json` SHA `cf0f6f152e7569bbd5b828f75a215b8ac80eac2667ecd0e931c679d852ab2b7a` 的495个显式相对路径共7,244,349字节全部实读核验；另收manifest、三份独立/Root审阅及checkpoint12远端记录，共500个初始来源，另单独追加1份完成的case资格更正。第一批当时排除活动UI08；现第二批仅按已冻结197项清单追加首次正式失败，另五份完成审阅/设计。初批及第二批metadata保存于外部 `checkpoint13-draft/first-batch-frozen/`、`second-batch-frozen/`。仍不把五项通用fixture当官方Mermaid矩阵验收，新的独立selection诊断仍活动并排除。

本目录为已完成证据的仓库快照，由根代理从外部冻结目录提升。归档代理未运行测试、构建、UI或进程清理；只读取完成allowlist与固定旧检查点。旧证据原样保留，历史Mermaid deadline原因未因此关闭。

## 精确候选身份和源码范围

实际构建HEAD `fba47d028f336ceab837be6bc4117bd17663550c`，2026-10-16 20:32:25.963104至20:33:44.378376 UTC，exit0（约78.42s）。实际deb解包binary SHA `35bf62fbad2dbe1acbd3485f77ccd554ab1ed6a2a842e47ed60bd7d735fb7819`，21,872,632字节；deb SHA `f0f246f8cf3741b2074f76b819e76610e36d6d01e56931b5a17586120796ea9c`。普通target executable SHA与实际deb不同：独立审阅确认唯一UNK→DEB bundle marker的3字节改变，其余字节一致；不能混用两个hash。

2912项capture范围在构建和生命周期后全部无变；相对production05，范围内两处差异是manager和native定位harness。manager为已提交的 `07cbcfb4d576ff148585a397195edb691ab8780fe539c2fad52e246b081462b7`；native harness为 `d93de072c9618cab38136f96c1acde9707b8f8a303341548df613c0d16e3a7a2`。另明确四份supplemental文件（.prettierignore、manager、e2e、native harness）身份；tests/e2e和.prettierignore在原capture根外，不能将“范围内两处变化”写成整个仓库仅两处变化。

独立artifact审阅实际核binary/deb/guard/archive/SDK及12份frontend，核guard完整唯一嵌入与target/deb映射；它只直接重hash选中的源码快照，不冒称独立实读全部2912源码。frontend实际文件与当时dist一致，但没有从binary独立解压重建嵌入前端。manifest和最终检查保留全量元数据，完整source身体不复制。官方archive `27db9b…b6239`、SDK `1717c0…3ad4f`、guard `5b1082…6c44c`均沿用既有输入；2s执行/10s启动预算不变。non-test Rust release未报warning，Vite原chunk-size warning保留。

## 五项真实生命周期首轮通过

五次attempt均首轮PASS，无setup RED：timeout、disable、remove、WM-close、app-SIGKILL。各自harness持续17.995494、16.571578、16.812856、25.157995、20.391514秒。timeout原dispatch后2.00018865s观察到deadline，2.02772004s cleanup-complete，2.036849424s control-emitted。它验证通用忙插件硬停止机制，不是官方Mermaid业务图的deadline归因或全图覆盖。

timeout/disable/remove的真实输入DOM延迟约7/6/9ms，两RAF为29/18/29ms；仅这些单独输入样本有200ms断言，不是所有frame gap上限。观察时rAF最大gap分别37/118/209ms（以原样summary为准）；observer/timer/process采样开销不扣除，disable/remove输入可能发生于清理后。时序是实际调度观测，非实时保证；其余phase值以raw为准。

最终审计45个DOM进程身份、5个精确driver和5个wait-only ancestor共55个PID均absent，5个private目录不在，4626/4627无listener。case PASS后driver被精确进程组终止，ancestor工具exit241对应所记child -15，是预定teardown，不是case失败。ancestor PID由launcher记录但没有独立保留的先前birth；“55 PID absent”不升级成所有55均独立birth身份核验。

SIGKILL原case具体记录有 `exactEchildMonotonicNs=70677468765461`、`terminalDiagnostic=observed`，自然退出观察70677479712933、waitpid70677483080006、exit0且noSignalSent。顶层limitations仍有“缺少异步ECHILD、精确时刻未知”的通用文字；原件保留，不能用该通用句抹掉本case具体已记录的值。没有重新运行或补造trace，owner完成的 `qualification-addendum.json` SHA `11b5aefe70c2eaeb96fcdafde8922a53140a63dccb23675c58a15f4e26a33348` 已独立核原events/trace/ancestor逐值一致，明确本次没有missing ECHILD；以单独新增文件纳入，原completed-manifest和summary字节不改。

## 审阅和保留边界

Root实际核495文件SHA/size，另核5产物、读5份raw event及55PID absence；实际看timeout failed-card、disable complete、remove complete三张PNG。截图只能证明可见状态，remove是否彻底删除由raw registry断言支撑，不以viewport截图推定列表之外。归档代理没有新目视或OCR审阅。一次离线metadata inspection将knownPidBirth对象当array切片触发KeyError，原RESULTS如实记录，修正读取后没有runtime重跑、没有改变断言或时序。

显式清单中的5个小型JSON fixture.milkup-plugin是测试证据，原样保留；正式binary/deb/guard/archive/SDK共5项35,138,778字节**仅保留owner manifest路径/hash/size引用**，没有读取复制这些body。source2912、frontend12、install3、artifacts4、profile/cache730等排除按原manifest说明保留；排除数是owner清单，不是归档代理新扫描。没有复制完整profile/SQLite/生成前端或依赖树。

## UI08 首次正式失败：挂载选区投影改变，尚非逻辑选区结论

完成manifest SHA `4975f6a197420d1be4de353ea9f3550b05316b4bc74c271d3f70fb821165cbce`，197 owned文件/136PNG；summary SHA `061bf8d1a419f24c3fe2b2a8480c748072c048d52af0f82596e617e87c248abb`。加manifest自身及五份完成审阅共203来源（包括Root逐项核197项的独立清单审阅），长度/SHA均实读匹配。沿用实际production06 binary35bf…7819和相同官方archive，未复制二进制、deb、profile或重复的大fixture身体；已有同SHA固定对象跨引用。

70条记录=69个局部PASS+FAIL：ordinary coverage31、ordinary selection1、ordinary history6、windowed coverage19；windowed history与全部64matrix未进入，matrix样本/完成组合均0。首败发生在windowed `sequenceDiagram-000-first-official-example` 定位完成后的原“must preserve selection”断言，不抹除、不重试洗绿。页面已保存diagnostics的errors/CSP均空，保留native trace1026dispatch、0deadline及两组cleanup；这是本次有限记录，不证明所有历史RO/deadline原因已关闭。

目标fence UTF16[8162,8293)，唯一marker[8103,8160)。最后定位744ms、2wheel ticks、1reversal，几何完成；前快照version0/dirtyfalse/selection[]，后快照version0/dirtyfalse/selection[{from:8103,to:8160,line:398}]，保存文件字节未变。60次定位都几何完成（58first-visible、2physical-scroll-end），不等同于选区守恒断言全通过。

原probe只枚举挂载 `.milkup-selection` overlay，不是逻辑anchor/head getter。首次采样mountedFrom8832已在marker之后且目标未挂载；后经真实wheel窗口回到5742起点，marker与目标出现。静态代码审阅指出搜索count/status更新先于await reveal完成，虚拟化也会令选区overlay为空或重建；已有记录不能区分延迟导航paint与虚拟化，更不能从[]→范围直接证明逻辑选区真的变了。before/after精确wall时点未记录，逻辑私有状态未捕获。原失败仍有效，不把它降级成已证明无害的fixture问题。

Root实际FAIL-X11看见选中sequence marker、完整短sequence源码及随后autonumber源码、保存状态；像素不能重建定位前逻辑选区。独立像素审阅仅实际看9张：小Mindmap/Unicode目标完整，大Mindmap只中央/上部可见、Origins在内部预览底部被裁切，下部可达性未证。外部X11黑色画布不当成应用黑屏。136张原图全归档不等于全经过目视审阅。

源码记录2912项和25项准备输入未变。完成后App/driver等四个已列PID不在；guardian398900已终止但为PPID1下Z、birth7081924，不能称全部身份消失。4626/4627无listener，Xvfb保留，未新增完整后代sampler，也没有用无关signal/namespace/profile删除来代替清理。此UI清理局限与前批五生命周期55PID全absent不同，不能混用。

## 独立选区验证设计仅静态完成

四份新增审阅分别是Root首败复核、部分像素审阅、独立selection静态审阅、verification design。设计建议：等待已知唯一marker的完整挂载投影/尾cursor；保留原version/dirty/full-file等守恒断言。去重wrap overlay只能规范投影，不成为虚拟化独立的逻辑selection getter。

真正剪贴板路线须每次独立随机sentinel、真实Ctrl+C、完整挂载原marker并逐字节核对；wheel卸载后再挂回不得重新搜索、点选或调用私有setter制造成功。卸载期间copy不可观察，不把sentinel未变当空选区，也不以两端同文本证明持续不变或anchor/head方向。另一路独立fixture可真实替换/保存/undo检查整个文件，但那是有意事务，不是纯只读证明。当前这些均为未执行设计；活动selection诊断文件、结果或新代码没有纳入。后续完成结果须独立追加，不回写UI08首败。

## 导航就绪候选：仅四份静态材料，未作运行验收

追加 `ui08-navigation-readiness-preparation/{summary.json,harness.patch,harness-after.mjs}` 及独立review（SHA `91d18c65bc7598bf34bde7cf1d07a4815641bc8e26a6f91e2f82d7503b0ffe97`），四份文件均冻结完成。候选harness SHA `4d3e797a75d0377306fd3a4da5d839ad08bafaafcaa2698c51de608fda82fbc8`，只在seek增加16行；去除该插入后逐字节还原UI08的d93de原harness。新候选不是UI08运行输入，不覆盖原首败版本。

新增readiness要求cursor在预期marker尾、至少一个selection投影且每个投影端点等于完整marker；同一wrapped marker的重复rect允许，但原定位前后comparison及所有版本/字节/历史/64matrix断言保留。markerTo=sample.from-2的计算依赖当前fixture固定两个LF分隔；独立审阅核31个UTF16唯一marker、5个matrix样本及4个isolated fallback，不宣称通用Markdown或未来CRLF公式。

这是**新的独立30秒导航等待阶段**，可让每次seek最坏增加30秒；不能说整个harness总预算不变。原搜索30秒、定位10秒/20ticks/2reversals、产品render2秒/initialization10秒均没有改。没有skip、重试、断言删除、文本padding、合成selection或error suppression。

准备记录有node syntax、目标formatter及diff检查；独立review仅静态核输入/公式/差异，没有执行harness。当前不声称运行通过或逻辑anchor/head可观测；后续wheel若卸载marker或改变rect数量仍可能令原comparison失败，须保留失败。独立selection诊断与后续正式UI结果均尚未纳入，留给之后独立检查点，不能回填本批。

## 增量完整性

708个source aliases；297个本地去重对象/12,376,386字节，100个旧对象/8,761,541字节跨引用；159个PNG来源归并154个本地原PNG。累计708项来源SHA/长度检查匹配；敏感模式结果见外部handoff，筛查不保证任意秘密不存在，PNG不OCR。raw不格式化，所有源绝对路径只表出处，读取归档应按index中的固定对象/旧检查点引用，不依赖未来可变化live路径。

checkpoint12远端元数据固定commit `fba47d028f336ceab837be6bc4117bd17663550c`，Root核验remote/GitHub身份，归档代理未重新联网。base06–12固定index SHA和commit均在index。完整校验：

```sh
python3 verify-index.py \
  --checkpoint06 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06 \
  --checkpoint07 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint07 \
  --checkpoint08 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint08 \
  --checkpoint09 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint09 \
  --checkpoint10 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint10 \
  --checkpoint11 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint11 \
  --checkpoint12 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint12
```

同级入仓时可省略参数。外部checkpoint13-draft是支持材料，不自动纳入raw索引。等待新的独立selection诊断完成结果和Root授权，不宣布完整产品验收。
