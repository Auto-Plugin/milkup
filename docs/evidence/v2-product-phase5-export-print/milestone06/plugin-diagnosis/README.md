# Diagrams 1.1.1 首次渲染超时：只读诊断

基线 `53f043e86bf162a18db67acef941811a867d1d20`，2026-10-19。最初完成只读审查；随后 Root 授权下述独立候选及单测。未修改SDK、超时、隔离、取消或缓存机制；未运行新的浏览器/helper，未安装依赖。采集脚本和 SHA 清单保存在同目录。

## 可确认与不可确认的原因

三份真实产物的 Mermaid 围栏逐字节相同，SHA-256 为 `ac0e10676e2c52103883a895de1913262339b00841807037b3de0354d1d1c960`：`flowchart LR`，三个中文节点、两条边。PDF05 与 print-file04 整份源文件也相同；HTML10 没有后面的分页段落。三次都是同一 production frontend asset `index-jb4juTWB.js`，但使用不同 native instance / process。

| 历史 run | 已观察事实 | 不可扩展为的结论 |
| --- | --- | --- |
| pdf05 | 图表成功输出；首 dispatch 到下一 dispatch 为 518.919 ms | 日志无结果 phase，该差值不是已测完整 renderer 耗时；首请求也可能被取消。 |
| html10 | 图表成功输出；首 dispatch 到下一 dispatch 为 563.821 ms | 不能证明所有冷首次均小于 2 秒，不能归因成功缓存。 |
| print-file04 | `render_1` 后 2000.313 ms native deadline，随后杀 helper、确认清理、发 timeout control；UI 标记 diagrams failed/disabled，PDF保留源码 | 缺少 helper 内阶段时间，不能确定是懒初始化、布局、转换、CPU调度还是桥接延迟。 |

旧 `DOM_NATIVE_TIMING` 没有完整 request payload、target 或 renderer ID。因此不能把 `render_1` 直接称为某个 export 请求，也不能证明三次首请求 JSON 相等。打开文档可能先发 screen 请求，export 随后进入同一 host；首次 screen 超时同样会使 export 看见失效 renderer。这是需要关联 requestId 和 target 验证的假设。

**现有 success-memo 不可能是这些 flowchart 成功的原因。** 它仅在返回 `diagramType === 'sankey'`、非空、完整、全部 ready 时发布；flowchart-v2、class、gantt 和混合结果明确不缓存。`render_1` 也不可能命中当前实例之前不存在的成功结果。扩大缓存既不能解决首绘，也不能作为已知根因修复。

## 冷启动路径

`plugin.ts::activate` 等待 `prepareRenderer` 后才暴露 renderer。当前 prepare 只 `clearSuccessMemo()` 和 `await document.fonts.ready`，没有调用 Mermaid initialize、load、parse 或 render。

完整 Mermaid 引擎已在单文件插件中离线打包；构建检查明确禁止 runtime imports，entry 上限仍为 8 MiB。但是打包在同一文件不等于内部模块工厂已执行。精确安装的 Mermaid 12.2.0 `mermaid.core.mjs` 注册 lazy diagram loaders，首次 `mermaid.render` 仍可承担对应图型注册/初始化、解析、字体测量、布局和 DOM 构造；之后插件还执行 SVG插入、`convertSvgElement`、JSON结果计费。初始化配置也在每个围栏执行。

native activation 完成意味着顶层模块 import + prepare 已完成，不代表 Mermaid 所有内部 loader 或绘制路径已执行。`fonts.ready` 仅覆盖当时 FontFaceSet readiness，也不等于首个中文 SVG 的所有字体测量成本已支付。以上是源码可支持的候选成本来源，尚无阶段测量可定位本次 2 秒耗在哪。

宿主还存在两个不同起点的 2 秒：native watchdog 从真实 dispatch 开始；当前 `output-presentations.ts` 外层 race 在调用 `options.render` 前启动，包含RPC/排队时间。排队等待和首个screen请求可能令外层先取消export。此项由 Root 调整通用调度，不应通过增加native 2秒、重试超时请求或插件ID特例修复。

## 请求与缓存完整 identity

公开 `SdkDocumentPresentationRequest` 的 `version` 就是该请求的 documentVersion；不是另一个字段名。实际字段为：

`documentId, version, source, from, to, fromLine, toLine, completeStart, completeEnd, contextKnown, protectedRanges, blocks(kind/info/complete/contentRanges), selection(anchor/head), theme, target, width`。

导出适配器固定 `target:'export'`, `theme:'light'`, `width:760`，来自同次冻结文档的 ID/version/source/selection。文档按有界Markdown窗口扫描，pure-fence provider又缩为一个完整围栏请求，绝对offset和绝对行号仍保留。不能只按 Mermaid body 字符串缓存，也不能忽略version、selection、target、宽度或可信block范围。SDK请求不包含 format/pageSize/landscape/resources：这些是后续输出选项，当前不会改变图表width760。PDF/HTML/print走相同 rich capture 路径，不能把打印文件后端特异性当作 renderer 语法差异。

当前 memo 的 `JSON.stringify(request)` 保留以上全部字段，另外限定 Document/FontFaceSet/ready Promise/URL/viewport/DPR，最多4项、2 MiB，环境改变清空，结果克隆，取消后不发布，无进行中Promise复用。

当前 SDK 没有 captureId，也没有 capture结束通知。根据 Root 后续明确的用户边界，**同doc/version/full input允许复用**，不要求绝对禁止跨capture；当前完整JSON key满足该版本绑定要求，不修改任何cache key、不禁用export缓存。新capture若任一输入或版本变化必须miss；取消、disable/revoke及环境失效继续走现有保护。最初任务提到“不能跨capture”的表述已被这一澄清替代，不作为产品更改依据。

## 独立插件最小候选（已获授权实现；原生效果未验证）

可先只改 `prepareRenderer`，在原有 activation watchdog 内调用：

```ts
clearSuccessMemo()
await document.fonts.ready
await mermaid.registerExternalDiagrams([], { lazyLoad: false })
```

这是 Mermaid 公开接口；[官方 API](https://mermaid.js.org/config/setup/mermaid/interfaces/Mermaid.html#registerexternaldiagrams) 定义 `lazyLoad:false` 立即加载图型。精确12.2.0安装源码的该方法先 `addDiagrams()` 注册内置detectors，再调用 `loadRegisteredDiagrams()`；后者逐loader加载并registerDiagram，不读取当前文档、不调用parse/render。传空数组不会引入外部diagram或网络模块，既有单文件bundle约束继续生效。这个“空数组同时加载全部内置loader”的具体行为由固定版本源码支持，应以测试固定，不能只依赖方法名推断未来版本兼容性。

这能把数据无关的loader初始化移至激活阶段，保持真正文档绘制2秒和现有隔离，不用隐藏fixture预渲染，不跨capture复用结果。但它会提前触发全部图型模块，可能增加activation时间/内存，失败会导致activation失败；也未预付布局、实际字形测量、转换成本。仅是最小可测候选，**不能在实测前声称解决了print04**。如果加载全图型太重或无改善，应停止该候选并依据阶段日志优化实际热点，不增加deadline、不重试一遍掩盖首次失败。

成功memo保持原样，包含其完整请求键、Sankey限定、预算与环境失效条件。

## 最小验证要求

1. 诊断构建关联requestId、完整request SHA（包括version）、target、范围；在renderer入口、initialize后、Mermaid render后、转换后、清理/结果发出记录阶段时间。记录activation开始/prepare结束。诊断开销单列，最终性能验收使用无额外日志的正式包。
2. 同样真实请求和新实例，比较原版/loader候选的activation、首绘、后续绘制、峰值内存；记录全部尝试，不挑成功样本。至少覆盖flowchart、Sankey、另一个非缓存图型；独立区分screen后export和直接export。
3. 验证prepare不读取用户文档、不执行parse/render；loader reject令activation失败；相同输入图形/typed output不改变，全部引擎仍离线封闭。
4. 保持2秒超时与helper终止；首绘进行中取消、插件disable/revoke、文档version改变不能发布晚结果或命中缓存。相同完整输入允许成功复用，但version/source/target/范围等任一变化必须miss；不缓存取消/失败/部分结果。
5. 当前尚无新native试验，不能给出新版耗时或修复通过率。Root已授权独立候选与RED→GREEN单测；后续结果单独记录。

## 补充安全 / 期限 / 体积审查

- `registerDiagram` 保存diagram对象、注册detector、把styles函数登记到内部map并调用可选injectUtils；不是把用户HTML/CSS注入DOM，但会执行全部builtin模块顶层和注册副作用。不能只看load循环就断言所有模块没有副作用，需真实隔离helper验证。加载失败会从detector列表移除该项再抛错，候选不得吞掉此错误继续暴露半初始化renderer。
- 图型loader与布局loader是两套注册。`rendering-util/render` 的dagre、elk、swimlane、cose-bilkent仍按实际render请求懒加载。该候选未保证移走这些首次成本。
- native `INIT_DEADLINE=10s` 从process start起算，包含process/页面/bootstrap/import/activation，并非prepare额外获得10s。桌面DOM生命周期RPC也设为10s；保持全部原值。render watchdog仍2s。
- 当前1.1.1正式构建proof：entry 5,315,382 bytes，archive 5,728,276 bytes，archive SHA `2351692438a2083a72bcb8cddce28c7a530a8557734926992a3a2e3120c68a19`；SDK0.3.4 tarball SHA `1717c0114aa165fa3e48a1bfa7687ffd0d9b2e5392d33e99d8b2dc59a1f3ad4f`。已有全引擎被打包，源码两行调用不意味增量就是固定字节数：需同配置构建后量实际entry/archive增量并验证imports为空、8MiB约束、依赖profile不变。Root排期前不构建external。
- 最小新增单测应通过真实plugin.activate调用证明：fonts未ready时不暴露renderer；fonts ready后仍等待模块加载；loader reject使activation reject；准备期间无parse/render/convert调用，既有清memo测试继续通过。mock单测不证明真实load成本或修复效果。

## 候选实现与验证状态

Root授权后仅修改 `plugins/diagrams` 的renderer、renderer测试、package/plugin版本及README，共5文件；候选版本1.1.2。SDK仍0.3.4，success-memo、依赖版本/profile/lockfile和宿主均未修改。完整差异见 `candidate.patch`、源指纹见 `candidate-source-manifest.json`。

旧实现的新增测试先运行：2失败、53通过（`renderer-red.log`）。加入公开loader调用后插件完整单测129通过、0失败（`plugin-green.log`），TypeScript检查退出0。两个新增测试经实际plugin.activate入口检查等待字体和模块、准备不parse/render/convert，以及loader失败拒绝激活。全部是mock-engine单测，不能代替真实WebKit阶段耗时。

Root排期后独立verify-external已通过（129tests/typecheck/build/closure检查）。结果冻结于 `../diagrams-candidate/`：entry 5,315,435B、archive 5,728,329B，相对1.1.1均+53B；包SHA `2e54b8326935b28b6b727315ccef163fd288e1374514f1783e0722d539abdd78`。`baseline-bundle-proof.json`保留1.1.1精确指纹。候选是否进入正式包由原生pre/post对比决定，历史print04根因仍未定位。
