# Checkpoint12 工作分支检查点：浏览器红绿回归与 gate06 有资格的组合门禁

本批仅收完成的 `research/resize-observer-loop-01/final-manifest.json` 显式110项，以及四份完成的独立/Root审阅、checkpoint11远端记录。归档代理只做复制、hash和文本筛查，未运行测试/构建/UI，现已将完成证据复制入工作分支，未暂存或提交；复制不代表完整产品验收。gate06首轮lint失败及唯一配置修正后的独立lint/build续跑均完成并分批保留；production06/UI08未运行，不归档。前两批冻结metadata已另存外部 `checkpoint12-draft/first-batch-frozen/`、`second-batch-frozen/`。

## 已证实的机制和修复范围

原manager SHA `8dc1f4a2571539cdb32b85bb7f8cecee6c32cf2aa2f1f757b580d1087301d8e3` 在 ResizeObserver delivery 中直接layout，并经微任务安排sync。独立静态审阅指出layout可写受观察几何，支持反馈机制；UI07原始记录只给首次错误的观测区间，不提供产生事件的准确时间或callback stack，flowchart-086样本名不能证明业务渲染器因果。

受控真实浏览器fixture使有限、幂等的响应布局从40变80，旧机制实际产生 `ResizeObserver loop completed with undelivered notifications.`，baseline exit1。候选仅将该observer通知合并到owner Window的单个requestAnimationFrame：入帧清handle，layout前后检查stopped，销毁时断开observer并取消pending frame。通用microtask schedule、立即selection/error/navigation invalidation、API、CSS和时间预算不变。执行时读取当前状态，没有重放捕获的旧response/context。

修复manager SHA `07cbcfb4d576ff148585a397195edb691ab8780fe539c2fad52e246b081462b7`。targeted green为1项一次PASS/exit0，响应尺寸收敛至height80/width360，宽度记录300→360，errors为空。销毁回调内立即记录基线后，layouts5/requests2与最后快照相同，未发生销毁后调度。Unicode正文和提供的selection快照保持；**新fixture的selection是快照closure，不是独立的真实编辑器selection/history或磁盘保存验证**。GREEN相对baseline加强了销毁基线采样并格式化测试；原有限布局/错误断言未删，差异原件保留。

随后完整 `desktop-markdown-extensions` 文件一次35/35 PASS，35attempt、0unexpected/flaky/skipped、无retry，报告duration449,518.76ms（约449.5s）。Root独立读取JSON每项result，而非只读日志汇总。该批是 **Linux Chromium**，项目名虽为desktop-msedge，也不是Windows/Edge实测、native WebKit或原生Mermaid验收。新fixture复现与修复的是受控交付周期机制，尚不能认定已捕获或关闭UI07的精确原生触发链，更不关闭历史native deadline原因。

冻结green测试SHA `cea39aac8dd8ab1893c99db75443b0ed216781f172960d961d53083ea661e656`；manager无format字节变化，测试有纯格式变化，before/preformat/final输入与diff均保留。早期static review中“green pending”是该审阅当时状态，后续完整结果另证，不覆盖旧原件。当前本批捕获时产品修复仍未提交，全仓门禁资格见下方首轮及续跑，新生产验证待完成。

## 清理与证据限制

完成时1420/5174无listener，未发现活动匹配服务；四个已知managed server PID均已退出但保留为PPID1下Z，不能称所有身份消失。归档过程没有杀进程或运行新验证。原始PNG保留但本代理未新增目视/OCR审阅。

manifest SHA `f8ddae9de80e9c736bf7ed133bb5be0a4004ce9cd113f0f77f7b1e36f7461186` 的110项长度/SHA全部实读匹配，包括37份Playwright trace ZIP。按Root授权，**37份ZIP共33,397,130字节仅作外部保留原件的路径/hash/size引用，不复制到本目录，不删除、不上传**。`excludedArtifactReferences`逐项列明；归档目录不自包含这些trace正文。其余原PNG、log、results、source与review均原字节纳入或复用固定旧对象。原始trace不因外置而从原manifest消失。

## gate06 首轮完成：类型/测试通过，lint失败后未构建

只纳入 `repository-gates06/manifest.json` 的12项与manifest自身、Root已发布index完整性审阅，共14文件。保留原PLAN、run脚本、environment、execution、三份原log、before diff及两份15,413项输入元数据；不收活动续跑目录。

首轮typecheck exit0、test exit0，2051 Vitest + 4 Node bootstrap = **2055 distinct PASS**。lint exit1，报5个已发布checkpoint07–11的index.json格式差异；runner按fail-fast停止，build为 **NOT_RUN_AFTER_LINT_FAILURE**，不能描述首轮四命令全通过。前后输入各15,413项，HEAD相同、changes为空；输入JSON正文含捕获时点而SHA不同，不把原件替换成同一份。

随后Root仅调整 `.prettierignore` 中精确生成index匹配范围，以保护已发布raw索引字节与跨检查点hash引用，产品/测试lint继续启用。此处收的是完成的独立完整性审阅：checkpoint07–11各自验证exit0、oktrue、errors空，index原SHA均保持。没有将此次配置调整写回首轮输入，也没有覆盖lint失败。该段是第二批捕获时的状态；完成后的续跑与配置快照单列于下，不覆盖首轮输入。

## 独立续跑完成：lint与build通过，原首败保留

严格追加 `repository-gates06-continuation/manifest.json` 九项及manifest自身，另收Root合并审阅。Root实际核验两manifest共21项SHA/size，并从原test.log解析13个Vitest包共2051与4个Node测试，未依赖摘要推计。manifest SHA `e687c6ea3a659930c8fee2b09ac8280712d3238d6d40eb578d18fc6c3ba9006d`；summary SHA `c844cd4cfaffc6fc4f60deb090ff9bcdb4b7f6cff4891655dd2977a72048a949`。lint 91.321109s、build 27.544881s，均exit0。此续跑没有重做type/test，不把结果计数加倍，也不是首轮四命令一次全绿。

续跑前后各15,413个输入，changesDuringContinuation为空；相对原首轮只改变 `.prettierignore`（90a225…a2ee5→e3ebdf…989e1），精确配置diff/快照已原样收录。checkpoint07–11原index SHA均保持，Root独立校验来自第二批原审阅。两份输入元数据格式/捕获信息不同，保留其各自hash与长度，不把内容无变化误说成JSON文件字节相同。

组合结论是：首轮完整typecheck及2051 Vitest+4 Node通过，lint因5个生成索引格式失败；随后仅精确formatter排除配置变更，单独lint/full build通过。没有产品/测试改动或重跑测试来掩盖首败。配置与产品修复由Root后续统一提交；这不是Linux原生production06构建或UI08验收，二者未运行。本代理只核验完成清单。

## 增量完整性与旧检查点

104个来源别名、87个本地去重对象/16,836,719字节，8个旧对象/76,797字节跨引用；18个PNG来源别名归并为15个本地原PNG。110项manifest与6份manifest/review/远端元数据，共116项来源SHA/长度检查；第二批另14项，累计130项匹配；最终批再11项，累计141项匹配。原始对象不格式化。文本敏感模式筛查见外部handoff；不是任意秘密不存在保证，ZIP正文不解包筛查、PNG不OCR。

checkpoint11远端记录固定commit `5c8e01c90fbc0c7b66655c1073627b3a741c3ab8`，记录中remote/GitHub身份已由Root核验；归档代理未新查网络。base06–11的固定commit/index SHA与跨引用在index。完整验证：

```sh
python3 verify-index.py \
  --checkpoint06 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06 \
  --checkpoint07 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint07 \
  --checkpoint08 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint08 \
  --checkpoint09 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint09 \
  --checkpoint10 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint10 \
  --checkpoint11 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint11
```

同级入仓时可省略base参数。外部 `checkpoint12-draft` 是支持材料，不自动计入本目录原始对象。本批仅完成有资格的组合门禁归档，不作完整产品通过声明；新原生生产验证另待。
