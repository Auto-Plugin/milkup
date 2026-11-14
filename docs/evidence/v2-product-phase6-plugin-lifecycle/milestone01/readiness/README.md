# P6 首次输出准备就绪修复链

基线：`1388f646703ba19c4ed501b0450d123e70388f9a`。本说明只汇总截至 2026-10-19 的现有源码与日志，没有重新运行测试、构建或 UI。原始失败日志均保留。**当前证据支持协议、宿主、插件及隔离构建层的修复；尚无修后首次原生输出验收，不能宣称 first native PASS。**

## 已确认的问题与修复范围

P5 milestone06 的实际首次打印中，图表和公式可见，脚注引用及定义仍是 `[^p5]` 原文；首次输出含 incomplete 和两条脚注源码警告。同一文档版本的重复打印才有脚注编号及返回引用。两次观察中脚注插件都已 enabled，因而“插件激活结束”等同于“当前文档索引就绪”的假设不成立。

[只读因果审计](../readiness-audit.md)和[受控复现](../reproduce-readiness.json)确认：脚注首次遇到 documentId/version 时建立空索引，80ms 后开始后台分页扫描，首个 render 立即返回 incomplete。旧 collector 只接受一次结果，后续索引 invalidation 仅刷新编辑器，不能修复已捕获输出。无脚注的普通文档也会经历这次空索引，能产生假性的首次 incomplete 警告。复现使用真实 controller/collector、任意 provider 标识；[基线复现 exit0](../reproduce.exit)，[首次就绪断言 RED exit1](../ready-first.red.exit)。这不是新原生 UI 运行，也不排除其他原因造成的历史 incomplete。

最终实现选择**显式 pending 合同**，没有采用早期审计提出的“把普通 incomplete 当作可能准备中”方案，也没有改为按 invalidation 事件触发重试。当前 host 按 provider 每250ms 重试明确 pending；普通 incomplete 是稳定终态，保留源码和警告。

## 当前合同与实现边界

1. **Core / SDK 0.3.6：**结果可带 `pending?: true`，只允许字面量 true 且 `complete:false`。复制、聚合校验、JSON/RPC 传输保留字段；false、显式 undefined、其他类型、未知字段和 `complete:true + pending:true` 均拒绝。原有节点、片段、大小预算继续生效。旧结果不带该字段，形状与语义不变。新插件发出字段必须要求支持0.3.6的宿主，旧严格解析器不会接受它。
2. **Footnotes 1.0.1：**同 documentId/version 的活跃后台索引尚未完成、没有永久 partialReason 且请求上下文已知时返回 pending。完成、scan-limit、读失败、嵌套上下文不支持、取消调用、销毁及未知上下文都不标 pending。render 保持同步立即返回，不 await 扫描；既有80ms调度、分页/扫描预算、版本取消和250ms invalidation 限频不变。
3. **Collector：**对每个 provider 使用相同的可信请求与原绝对准备截止时间。仅 pending:true 才在250ms后重试该 provider；已完成 provider 不随之重跑，临时结果不累积为重复片段或历史 incomplete 警告。没有 pending 的 incomplete/错误片段立即进入既有源码 fallback。一直 pending 在原截止时间结束，不续时。
4. **两种预算不混用：**既有每个 Markdown window 默认10s准备预算继续包含排队、交付和重试；不是整个文档共享10s，也不是每次重试新10s。隔离 owner 从实际 dispatch 起的2s执行 watchdog 不变。取消、延迟结果、截止时间后返回仍受守卫；准备重试没有提高权限或变相延长 native 执行预算。
5. **完整 provider 所有权：**整次 collector 捕获 `(pluginId, rendererId, activation epoch)` 集合。后续读取、调用和最终聚合阶段检查同一集合；观察到增、删或 epoch 改变即 sticky 标记变更，整个 capture 以 `DocumentPresentationError('revoked')` 失败，不把早期窗口与新 provider 的结果混合。集合后来恢复相同也不能清除已观察到的变更。检查发生在明确的守卫点；不是宣称持续监测到任意两个检查点之间不可见的瞬时变化。
6. **发布前再检查已接受 owner：**service 中先完成的 provider 结果会等待其他 provider/fence，不能只在它自身 resolve 时检查 epoch。所有 accepted owner 在最终返回 aggregate 前再次校验。collector 的跨窗口所有权检查进一步防止之前完成的窗口在后续窗口换实例后被发布。
7. **错误映射：**output-service 将 presentation 所有权变化的 revoked 映射为输出 snapshot 的 `stale`，中止已有 native job并不发布旧结果。这表示快照失效，**不是撤销调用方输出插件的权限**。已有独立 capability revoke/abort 的语义不因此被替换。
8. **Generation callback 接线：**内部 `rendererGeneration` 在通用 service/options 类型上可选，用于不具备生命周期 owner 的 screen/service 使用场景与旧测试。缺省时只能检查成员身份，不能证明同 ID 重新激活仍是同实例。真实 desktop 主宿主必须传 manager 的 `documentRendererGeneration(pluginId)`；当前 `main.ts` 对 output 和 screen 两条链都已传入。epoch 由宿主维护，不能信任插件自报。可选类型不表示生产输出允许省略。
9. **没有扩大 activation/readiness 承诺：**这次修复解决已启用 renderer 的 per-document 准备和 capture 所有权。它不是新的自动启用流程，不为未知/禁用插件授予能力，也不能仅凭这些日志宣称所有 startup/loading、重载或跨平台生命周期路径已完成原生验收。

主要实现入口：`packages/core/src/document-presentation.ts`、`packages/plugin-sdk/src/index.d.ts`、`packages/plugin/src/document-render-rpc.test.ts`、`apps/desktop/src/document-presentation-service.ts`、`output-presentations.ts`、`output-service.ts`、`desktop-plugin-manager.ts`、`main.ts` 和 `plugins/footnotes/src/controller.ts`。

## RED → GREEN 证据索引

各行是不同阶段/范围的已有运行，不能把用例数简单相加当作一次最终全仓运行。

| 环节 | 原始失败 | 对应通过证据与实际范围 |
| --- | --- | --- |
| Core pending严格合同 | [core-red.log](../presentation-pending/core-red.log)：2 failed / 11 passed | [core-green-direct.log](../presentation-pending/core-green-direct.log)：13 pending + 1 serializer =14 passed；[core类型检查](../presentation-pending/core-typecheck-direct.log) |
| 公共SDK声明 | [sdk-red.log](../presentation-pending/sdk-red.log)：TS2353，旧字段不存在 | [public-contract](../presentation-pending/sdk-contract-green-direct.log)、[SDK类型](../presentation-pending/sdk-typecheck-direct.log)；[SDK运行时6测试](../presentation-pending/sdk-tests-direct.log) |
| 首次输出等待/永久fallback/取消/不重跑完整provider | [host-red-final.log](host-red-final.log)：5 failed / 2 passed | [host-green-attempt01.log](host-green-attempt01.log)：readiness7 + 原collector13 + queue7 =27 passed |
| Service保留pending、RPC实际传递 | [service-red.log](../presentation-pending/service-red.log)：2 failed / 22 passed | [service-rpc-green.log](../presentation-pending/service-rpc-green.log)：48 passed，含17个render RPC测试及实际CPU阻塞worker终止测试；不等同于原生DOM UI验收 |
| 同ID重新激活不能复用旧结果 | [generation-red.log](../presentation-pending/generation-red.log)：2 failed / 31 passed | [host-final-green.log](../presentation-pending/host-final-green.log)：当时6文件91 passed；这是中间阶段，后续复核发现仍另列 |
| **复核一：先完成owner在aggregate等待期间变更** | [aggregate-generation-red.log](../presentation-pending/aggregate-generation-red.log)：1 failed / 25 passed；[跨窗口capture RED](../presentation-pending/capture-generation-red.log)：2 failed / 7 passed | [publication-generation-green.log](../presentation-pending/publication-generation-green.log)：76 passed；增加所有accepted owner发布前复核及跨窗口撤销 |
| Provider集合加入/移除 | [provider-set-red.log](../presentation-pending/provider-set-red.log)：2 failed / 8 passed | [provider-set-final-green.log](../presentation-pending/provider-set-final-green.log)：77 passed；[中间失败](../presentation-pending/provider-set-green.log)保留，不能因文件名含green当作通过 |
| **复核二：多窗口临时provider加入后又移除** | [transient-provider-red.log](../presentation-pending/transient-provider-red.log)：1 failed / 10 passed | [stable-provider-green.log](../presentation-pending/stable-provider-green.log)：5文件78 passed；[类型检查](../presentation-pending/stable-provider-types.log)。sticky校验阻止临时provider被调用；测试断言 addedCalls=0，不能只比较初始/最终集合 |
| 输出错误应为stale而非权限revoked | [output-stale-red.log](../presentation-pending/output-stale-red.log)：1 failed / 21 passed | [output-stale-green.log](../presentation-pending/output-stale-green.log)：output-service22 passed；断言无旧snapshot输出调用 |
| Footnotes producer | [footnotes/red.log](../footnotes/red.log)：8 failed / 21 passed | [footnotes/green.log](../footnotes/green.log)：29 passed；[汇总](../footnotes/summary.json)，含无脚注、新版本、永久partial、cancel/dispose与未知context |

早期 `host-red.log` / `host-red-clean.log` 额外有尚未及时接住 promise 的测试错误，之后干净的 `host-red-final.log` 是语义 RED。Core/SDK 文件名含 green 的部分最初日志实际是 pnpm 自动依赖检查安装失败；[合同说明](../presentation-pending/README.md)列出这些失败及改用直接已安装执行器后的日志，原件未覆盖。Footnotes 最早插件 cwd 不匹配和未安装SDK的类型失败也保留，不能当作实现RED或最终构建结论。

### 为什么更新旧 timeout 测试

新的完整 provider 集合合同下，owner2s超时若同时撤销并移除 provider，整个输出 capture 必须 revoked，而不能继续产生一个带 timeout/fallback 的混合快照。旧 queue 测试期待 fallback，因此在 [provider-set-green.log](../presentation-pending/provider-set-green.log) 中失败。修订的是这一终态预期，并非降低超时标准：当前 `output-presentations-queue.test.ts` 仍断言 timeout trace 恰在2000ms、owner只撤销一次、之后请求 revoked、迟到结果不能恢复输出；输出层再把该 capture失效映射为 stale。不同情形——provider集合未变、准备预算耗尽或稳定incomplete——仍保留有界fallback/明确警告，不能混称“超时均改成成功”。

## 公共SDK与独立脚注交付

- SDK0.3.6公共 tar：[milkup-plugin-sdk-0.3.6.tgz](../sdk-dist/milkup-plugin-sdk-0.3.6.tgz)，SHA256 `2043b0586c73579c06821c76a20eb0d7a852ffd7c7e8181ea555433a0c506cec`。[SDK打包/合同证据](../sdk-dist/README.md)；首次默认npm缓存失败保留在 [pack.log](../sdk-dist/pack.log)，之后外部缓存打包记录 [pack-cache.log](../sdk-dist/pack-cache.log)。
- Footnotes1.0.1：[冻结独立插件包](../footnotes-external/artifacts/milkup.footnotes-1.0.1.milkup-plugin)，SHA256 `cf495f6bdf22dc6b24143a06fc34fdce8d2b2ecab90b8296b85fb49773b692a2`，要求 `>=0.3.6 <0.4.0`。
- [独立构建proof](../footnotes-external/proof.json)、[验证报告](../footnotes-external/verification.json)、[构建输入](../footnotes-external/build-meta.json)、[冻结文件索引](../footnotes-external/index.json)：实际在 `/tmp/milkup-p6-footnotes-1.0.1` 仅安装上述公共SDK tar和开发工具；安装、类型、构建、29测试、格式、diff检查全部exit0。无运行时依赖、零bundle runtime imports、没有根install或UI/Cargo。独立锁是此次file-tar安装证据，不冒充可迁移的registry锁。
- `verify-external.mjs` 已按manifest生成版本化包名，使用新SDK要求，所有pnpm调用关闭package-manager自动安装，store/cache置于外部目录。独立包只导入公开SDK，未借宿主私有接口取得pending能力。

[workspace-checks.json](../checks/workspace-checks.json)记录07:29–07:32时的全仓测试/类型/build通过，早于后续aggregate/provider/stale复核修补；因此不能把它称为最终修改后的全仓复验。本说明引用后续专项GREEN如上，不补造最终全仓或原生结果。构建日志的chunk-size警告保持原样。

## 尚待真实验收

修后实际首次 HTML、A4/Letter PDF、PrintToFile，首次/重复/多图/大文档、取消后改版本重试及生命周期变更仍需冻结新宿主与独立包后运行。应查看真实SVG/像素、脚注双向引用及警告，不能以源码文字marker冒充图形成功。P5既有WebKit Unicode复制/搜索与长块标题分页失败、物理打印未验都保持独立开放；本链不声称修复这些边界。
