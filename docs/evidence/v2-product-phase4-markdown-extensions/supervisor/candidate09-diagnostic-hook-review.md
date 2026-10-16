# Candidate09 分段诊断 hook：静态审阅交付

状态：仅准备完成，待 root 审阅；未安装依赖、未构建、未编译/typecheck、未测试、未安装应用、未运行 UI。没有诊断 commit/push。当前产品 checkout 的产品文件未改动。

## 工作区与差异

- 独立 worktree：`/workspace/milkup-render-timing-diagnostic`
- Detached 基线：`065882e4ac8c638c2fe8eb6f7050ff9228e95ecc`
- 工作区原先不存在，使用 `git worktree add --detach` 创建；没有覆盖既有工作区。
- 唯一变化：`packages/plugin/src/worker-supervisor.ts`、`document-render-rpc.ts`、`isolation-module-host.ts`，以及新增内部 `render-timing-diagnostic.ts`。
- 无 node_modules，未创建依赖 symlink；未来安装需在诊断 worktree 内独立解析 workspace 包，不得借用主仓 workspace 包 symlink。
- Patch：`candidate09-diagnostic-hooks.patch`
- 文件与 patch SHA-256：`candidate09-diagnostic-sha256.txt`
- 可重放静态检查：`verify-diagnostic-hook-diff.py`
- 机器报告：`candidate09-diagnostic-static-report.json`

静态检查已证明：

1. changed/untracked 文件集合恰等于四文件 allowlist。
2. 三个原文件的新增代码均位于 `DIAGNOSTIC-BEGIN/END` 标记内。删除这些块后，各文件与候选09 `git show` 字节完全相同，SHA 完全相同。
3. 插入块和 helper 无新增 `new Promise`、`await`、`setTimeout(...)`、`setInterval(...)`、`queueMicrotask(...)`。原 renderer await、RPC Promise 链、timer 创建、仲裁与 teardown 语句保留原顺序。
4. `git diff --check` 无错误。尚未做 TS 编译或运行验证，不能将这些静态检查写成测试通过。

## 已插入阶段

- Supervisor：dispatch（原 active/timer 建立后）、result-handler（匹配 ID 的 result 进入 listener）、result-late、result-accepted、expire（原有效 active 检查之后、teardown 之前）。expire 记录先只进入内存，原 teardown/timeout control 完成后才发送 debug。
- Child RPC：render-receive、result-post-enter、result-post-return。原 result post 不被替换、包装或等待。
- Provider：原调用前 enter、原 await 成功后 fulfilled、原 finally 中尚未 settle 的调用 rejected；输出复制前 validation-enter。没有捕获/改写原异常，没有新增 Promise handler。原异常仍由原 RPC catch 处理。
- 请求 ID 通过 helper 内部 WeakMap 关联原 request 对象；不修改对象、public request 或 SDK contract。

## 通道与预算

- Debug 协议固定为 `milkup.diagnostic.render-timing.v1`，frame type 固定为 `trace`，不是 result/control。
- Supervisor 直接发送的 debug 不匹配现有 authority 协议；child debug 仍是 ordinary child data，现有 readDocumentRenderResult 因协议/type 不同而拒绝。新增诊断 matcher 只决定是否记录，不参与任何状态转换。
- Helper 通过 `WorkerGlobalScope.prototype` 检查实际 Worker realm。main RPC client 虽导入同模块，创建函数在 Window 中只返回 noop。没有调用全局/window.postMessage 的 fallback；发送只使用 Worker server/supervisor 注入的 endpoint 回调。
- 每 realm 最多 1024 条、每批最多 16 条、每条编码最多 384 ASCII 字节；到限静默停止新增并标记 capped。发送失败不重试、不产生 timer，不向产品调用传播异常。
- 帧含 realm/realmInstance/timeOrigin，记录含 sequence/request ID/stage/monotonic at/可选原 deadline。没有 source、AST、路径、用户文本、selection、异常字符串或 stack。
- `droppedLowerBound` 只表达已知丢弃下界，达到 cap 后不持续发送统计，避免诊断本身变成无界消息源。外部收集器 `install-render-timing-collector.js` 已准备全会话 8192 条、32 个 Worker、64 个 realm 上限及 drop counts；尚未执行或接入 harness。

## 解读限制与下一步门槛

新增观察仍有计时、JSON 小对象和 postMessage 的开销，不能宣称零扰动。provider-fulfilled/validation/post 的批次在原 result post 后发送，父已超时/终止时可能丢失这些阶段；缺少记录不等于对应代码未执行。Worker 被杀或父监听器清理可丢弃待交付 debug。这是有意保留原正常 result 优先顺序的代价，不能用缺失字段作排队或 CPU 的直接证据。

本轮没有修改原外部运行 harness；新增外部 collector 供后续获批后注入。后续 GO 应包括：独立依赖安装、静态 TS 编译检查、检查构建只使用该 worktree 的 workspace 包、Linux 诊断二进制生成、单次自然普通语义链及有界 main debug 收集器。运行不得人为 stall、不得扩大 2000ms、不得自动重跑；首次失败或普通链完成即停。所有结果标记 diagnostic-only，不能取代未插桩候选的验收。

## 外部 collector 静态准备

`install-render-timing-collector.js` 应在插件安装/启用前由外部 harness 一次性注入；它只监听 Worker message，不包裹 postMessage、不发送 ACK、不 preventDefault/stopPropagation、不创建 timer/Promise。仅采集固定 debug 协议，并只解一层 ordinary child envelope。使用 `window.__milkupRenderTimingDiagnostic.snapshot()` 取有界副本、`stop()` 移除自有监听器并在仍拥有 wrapper 时恢复原 Worker constructor。两个方法都是诊断 harness 提供的观察接口，不是新增产品 API。

记录集最多8192条；超过上限计入 droppedRecords。每 realm 保存 accepted/droppedLowerBound/capped，整体有 invalidFrames/invalidRecords、realmLimitDrops、workerLimitDrops、observationErrors。插件名只允许固定的三种 supervisor 名称，其他名字记null；不记录URL/path/用户文本。若helper已capped或Worker被杀，缺失条数无法精确反推，报告只给下界。

Provider fulfilled→result-post 仅表示输出校验、清理及微任务调度的合计区间，不是精确 validation CPU。收集器尚未执行，只有静态检查；等待依赖/构建/运行 GO。
