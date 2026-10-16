# Candidate09 自然超时：只读结论与一次性诊断构建提案

状态：分析完成；诊断构建尚未授权实施。本次没有修改产品 checkout、创建诊断 checkout、构建、运行测试或启动 UI。

## 已核验基线与证据

- candidate09 provenance 记录源提交 `065882e4ac8c638c2fe8eb6f7050ff9228e95ecc`。
- 已安装 candidate09 二进制 SHA-256：`de057fb8899786b612c7fccf829beaf8f247dd96f6e7602edcb9209e7c609408`。
- 本次读取时产品 checkout HEAD 为 `ec521cafdc3ce15e0492163517555a1ebf535164`；下列 supervisor/RPC/module-host/worker-entry 四个源文件与 candidate09 提交无差异。实施前仍需核验实际构建的 source dirty diff 记录，不能仅以 harness 的 HEAD 字段证明二进制来源。
- 自然失败摘要：`../native/candidate09-nearreturn01-summary.json`。
- 原始主线程轨迹：`../native/run-candidate09-nearreturn01/render-trace.json`。
- 二进制、插件包、harness provenance：`../native/run-candidate09-nearreturn01/provenance.json`。
- 该次失败发生在普通文档脚注语义阶段，专门 near-return observer 尚未安装，summary 中 `observer: null`。不把该次称为 near-return 观察器捕获的因果证据。

## 当前 2000ms 的精确语义

代码行号以候选09相同的当前文件计：

1. `packages/plugin/src/worker-supervisor.ts:236–244`：监督器收到并处理 main 的 forward 后，紧邻 child.postMessage 前设 `deadline = performance.now() + 2000` 并安排 timer。main 本地队列和 main→supervisor 转发前的等待不计入。child 的排队、执行、结果校验/复制、child→supervisor 回程及监督器处理结果的调度计入。它是请求墙钟预算，不是 provider CPU 预算。
2. `packages/plugin/src/document-render-rpc.ts:73–91`：main 每端点最多一个活动 render；只有没有可信外部 authority 时才设 main timer。队列中请求尚未被监督器接收，不消耗其 native/Worker 2000ms。
3. `apps/desktop/src/desktop-plugin-manager.ts:882` 等待 `workerHost.ready`。`packages/plugin/src/isolation-worker.ts:429–433` 先建立 child RPC server，再发送 ready。正常桌面路径的 Worker/module 初始启动不计入 render budget；renderer 自身的惰性初始化会计入。
4. `packages/plugin/src/document-render-rpc.ts:245–256` 在 child 收到请求后以既有 Promise 链调用 host；`packages/plugin/src/isolation-module-host.ts:225–230` 包括输入复制、`await renderer`、输出复制/校验，然后 child 才发送 result。provider 返回不等于监督器已经接受有效 result。
5. `packages/plugin/src/worker-supervisor.ts:204–215` 用 result 回调执行时的 `performance.now()` 判断。已经进入父 Worker 待处理队列但尚未执行的消息没有被记录到达时间；回调到达 deadline（含相等）仍超时。即使 result 回调先于 timer 执行，显式时间比较也会拒绝过期结果。有效 result 若在 deadline 前完成该检查，会清除 active/timer；之后旧 timer 不会误杀。
6. `worker-supervisor.ts:182–187,243`：expire 先 teardown/terminate child，再通知 main；cancel 不解除或延长预算。
7. 前一个 render 的正常未完成状态不会被 main 并发派发绕过，但后台任务、命令、微任务与当前 render 共享 child 事件循环。脚注 `plugins/footnotes/src/controller.ts:128–133` 安排后台 scan 后同步返回；scan 在 `:68–99` 分页读取、同步 consume、显式 yield。后台 scan 可影响后来的处理时机，但现有轨迹没有证明它是此次原因。

## candidate09 能证明什么

主线程观测为：

| 插件/请求             | main send | main receive | main 观察间隔 | 结果               |
| --------------------- | --------: | -----------: | ------------: | ------------------ |
| math / render_22      |   59128ms |      62719ms |        3591ms | supervisor timeout |
| footnotes / render_14 |   59133ms |      62850ms |        3717ms | supervisor timeout |
| diagrams / render_18  |   59132ms |      62925ms |        3793ms | 成功 result        |

这些时间不是监督器的 dispatch/expiry 时间。diagram 主线程接收较晚仍成功，说明不能直接用 main send→receive 间隔判断是否突破独立监督器预算。math 的上次 render_21 与 footnotes 的 render_13 均已在约 57600ms 被 main 接受；当前轨迹不支持“上一活动 render 一直未结束”这一解释。

主线程采样最大间隔 2019ms 只是采样事实，不能区分 child CPU、child 排队、监督器暂停/调度、结果复制与回程处理。实际 renderer 的旧 wrapper 诊断只覆盖部分 child receive/result-post 阶段，且未复现自然失败；它没有 provider 精确 enter/settle 和监督器内部时间，不能排除这些段。

## 待审阅的一次诊断构建方案

只在新的独立 checkout 基于精确 candidate09 源提交加诊断 hook。当前产品 checkout、公共 SDK、core、插件归档与 2000ms 常量均不改。若发现 candidate09 构建存在未记录源差异，先报告并停止，不用当前 HEAD 冒充候选源。

### 最小文件范围

| 文件（诊断 checkout）                                    | 拟插入观察点                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin/src/worker-supervisor.ts`               | forward 内创建 active 后记录 dispatch/deadline；child listener 入口记录匹配 result 的 handler-enter；原判断/状态转换后记录 accepted/expired；expire 入口记录 timer-expire 与 active ID。保持原 timer、判断、teardown 和 control 发出顺序。                                                                                          |
| `packages/plugin/src/document-render-rpc.ts`             | child listener 识别 render 时记录 receive；为重建后的 request 对象登记内部 WeakMap 关联 ID；既有 send() 中在原 postMessage 前后记录 result-post-enter/result-post-return。不改 Promise 链或增添 await。                                                                                                                             |
| `packages/plugin/src/isolation-module-host.ts`           | 从内部 WeakMap 获取 request ID，在原 renderer 调用前记录 provider-enter，原 await 成功后记录 provider-fulfilled；原异常离开路径记录 provider-rejected。可在既有输出复制前后记录 validation-enter/return，用来排除“provider 已返回但输出检查仍未完成”。不能用新 Promise 包装 renderer，也不能将 async provider 时间称为纯 CPU 时间。 |
| 新内部 `packages/plugin/src/render-timing-diagnostic.ts` | 仅诊断 checkout 的有界记录器、WeakMap 请求关联和非权威输出；无 index/SDK 导出，无权限或执行能力。                                                                                                                                                                                                                                   |
| 外部 evidence 内复制的普通语义 harness                   | 在正常安装插件之前捕获 debug frame；收尾导出有界记录。只运行普通语义链一次，关闭专门 near-return observer 和矩阵扩展；不向产品 main 添加诊断接口。                                                                                                                                                                                  |

无需修改插件实现、Worker factory/模块 URL、public renderer API 或生产 app 的 main。helper 初次由 supervisor 与 child RPC/host 内部 import，仅使用所在 realm 的 global postMessage/performance，不创建额外 Worker。

### 非权威采集与开销边界

- Debug frame 使用唯一协议 `milkup.diagnostic.render-timing.v1`，绝不使用 supervisor control 或 document-render result 的协议/类型。它在原 authority parser 中不匹配，不能清 timer、设置 active、取消、重试或触发 manager 状态变化。
- supervisor 自身 debug frame 直接被外部 main 观察器收集，产品 facade 忽略；child debug frame 走现有 ordinary child-data 通道，由外部观察器只解一层读取。父监督器保留原 readDocumentRenderResult 检查，不将 debug frame 当 ACK。
- 记录只能包含：固定 realm/stage 枚举、每 realm 序号、RPC request ID、`performance.timeOrigin`、`performance.now()`、原 deadline 数字、固定成功/异常代码和可选数值计数。禁止 source、AST、TeX、diagram、文件路径、用户文本、selection 内容、异常 message/stack。插件身份由原 Worker 名称关联，不复制模块 specifier。
- 建议每个 realm 最多 1024 条、整个会话最多 8192 条、单条编码上限 384 字节；到限后只累加 dropped 计数并停止新增。frame 按既有边界输出小批次（最多 16 条）；禁止无界队列、轮询、console 洪泛、定时 heartbeat 或额外文件/网络 I/O。
- 精确阶段先同步记录几个 scalar；原生产操作保持相对先后顺序。provider-enter/receive 的短批次需要在原计算前发出，才能在 child 被杀后保留已发生阶段；正常 result 的调试批次放在原 result post 后发送，避免调试 ACK 取代正常完成路径。
- Debug 传输和记录本身仍有观察开销，并可能影响事件调度，不能宣称零扰动。它不参与仲裁，但新增消息任务是已知诊断限制。debug 发送失败必须吞掉并增加 dropped，不得改变生产成功/失败结果。
- 跨 realm 比较保留 timeOrigin 和本地 now，不直接减两个裸 performance.now。主要结论优先来自同一 realm 的间隔；跨 realm 运输差值需说明时钟分辨率及采集缺失。trace 是诊断观察，绝不是可被子插件用来延长预算的可信时间戳。

### 如何证明差异仅为诊断 hook

实施获批后先保存候选源提交、工作区状态、candidate09 provenance、插件归档 SHA、lockfile 和构建工具版本。对独立 checkout 保存完整 patch 与逐文件 SHA-256；差异 allowlist 仅上述四个 package 文件（含新增 helper），外部 harness 另留 patch。对生产语句逐段核对：原 2000 常量、timer 创建位置、原 await/Promise 链、child.postMessage、readDocumentRenderResult、超时比较、teardown/terminate 顺序不变；不新增预算重试或成功兜底。

保存诊断二进制/前端 assets 的 SHA 与原 candidate09 SHA，明确不是同一二进制、不是验收候选。Rust、manifest、权限、SDK/core、插件归档不得出现产品差异；若出现则停止构建并报告。确认当前产品 checkout 状态与实施前完全一致。不签名、打包发布、上传或部署。

### 单次运行与停止规则

1. 经 root 审阅后再创建独立 checkout、构建 Linux 诊断二进制；构建与原生时序采样分开，不并行重负载。
2. 使用新 profile，沿 candidate09 同一普通文档、相同三插件归档及真实系统输入走普通语义链：安装启用、根公式/图表/脚注导航与源码返回。保留原断言、原等待与操作顺序；不人为 stall、spin、延长 deadline、改变 provider 输入或重试失败步骤。
3. 只跑一次，普通链完成或首次失败即停，不启动矩阵/大型文档阶段、不自动重开重跑。不因未复现而追加第二轮。
4. 导出 correlated realm trace、drop 计数、原主轨迹、failure/screenshot、PID/provenance；停止并清理本次自有 App/driver。结果只能归为“观察到某段超时”“只有部分阶段可见，仍不能定位”或“本次未复现”。
5. 若 provider-enter 未出现，不能直接归因排队：也可能该 trace 未送达/被终止前丢失。若 provider-settle→post 很短而父 handler 在截止后才运行，才有证据指向回程/父调度段；若 child receive→provider-enter 很长，检查 child 本地调度；若 enter→settle 很长，仅证明 provider 墙钟等待/执行慢，仍不能仅凭它宣称 CPU 超限。

建议：先由 root 审阅此提案，再授权独立 checkout 的 hook diff。当前没有执行实施步骤。
