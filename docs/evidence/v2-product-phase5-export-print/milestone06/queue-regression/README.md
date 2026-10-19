# Output presentation queue regression — RED evidence

Baseline53f043e8；只新增desktop回归测试，没有修改产品。Diagrams五个候选源码文件已核对候选SHA后恢复53f043e8；外部1.1.2候选包、源码输入快照、patch和测试仍保留，不采纳。

测试通过真实 `createDocumentRenderRpcClient` 与 `createTrustedPluginRenderEndpoint`，模拟可信隔离owner的dispatch、2秒watchdog、cancel与result/control。真实客户端负责单任务队列、取消、结果解析、late-result丢弃和revoke；不是把render替换为简单delay。owner是内存测试模型，不是实际native执行证明。

关键用例：t0 screen真实dispatch，export只enqueue；t1500 screen结果settle后客户端才dispatch export；旧collect外层timer在t2000发cancel，此时export仅运行500ms。两个任务原本各1500ms，owner都未超过2秒且未触发stop/revoke；这是错误消费队列时间的确定性反例。

运行结果1fail/3pass，详见red.log。另三项通过：真实owner2秒超限仍停用/revoke且忽略晚结果；queued export取消不dispatch、不取消screen；active取消的晚成功结果不发布，下一任务等待原owner结果settlement后才dispatch。

此回归不证明历史print04已修：print04记录的是native dispatch后真实2000.313ms超限，缺少内部阶段信息。Root另行实现已有10秒preparation预算与owner2秒execution预算的分离。

命令（desktop目录）：`node ../../node_modules/vitest/vitest.mjs run src/output-presentations-queue.test.ts --maxWorkers=1 --minWorkers=1`。RED时测试源码逐字节保存在 `.red-snapshot`，源及测试SHA见red-proof.json。

## 扩展GREEN：7项通过，desktop typecheck通过

新增测试仍只编辑 `output-presentations-queue.test.ts`。最终通过公开 `createRpcPluginIsolationHost` 调用内部真实RPC client，避免相对引用package内部源使desktop rootDir越界；没有新增公共API。Root负责两个产品实现文件和独立service测试。最终测试源码及产品SHA见green-proof.json，源码快照为 `.green-snapshot`。

新增3项：

- owner在1500ms接受结果、清除2秒执行watchdog，前端3000ms才交付：仍在10秒preparation期限内，结果成功，不再次按前端2秒超时。
- v7的owner结果已接受但尚未交付，此时编辑为v8并排队新capture：v7晚结果令旧capture拒绝revoked；队列随后实际dispatch v8并返回v8源内容，无版本串用。
- screen在1500ms完成但前端延至11000ms交付：export在10000ms的preparation deadline到期，从真实RPC队列删除；之后screen交付也不会dispatch已过期export。

首次扩展运行6pass/1fail，发现timeout回调先abort使真实RPC的aborted抢先赢Promise.race，导致错误被记作presentation-unavailable。Root将callback改为先reject(timeout)再abort；本测试保留要求准确timeout告警。首次失败的完整日志green-authority-attempt01.log保留，其中未settle editor在失败清理时产生的Unhandled属于测试噪声；最终已重排断言，等待editor正常settle后再检查，无Unhandled。

最终green-authority-expanded.log：7pass/0fail；desktop-typecheck-expanded.log：exit0。原RED日志、proof和源码快照保持不变。测试采用同步推进的Date/performance假时钟和可信owner模型，只证明队列/期限/版本/cancel控制逻辑，不声称改善了历史native首render_1实际执行超时。
