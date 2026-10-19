# P6-03：跨 native package 与 localStorage registry 的两种事务方案

只读设计，未实施/构建/运行。建议选 A；B 可渐进实施，但不能省略持久化协调协议后声称两份状态天然原子。

## 两方案都必须先确定的语义

- 事务只覆盖安装包、安装元数据/审批与受控插件数据。不能自动撤销用户文档、网络请求或原生 sidecar 的任意外部副作用。
- `reload`、安装同 ID、enable/disable/remove/approve/revoke 必须进入同一 per-plugin 队列，native 再以 expected generation / revision 做 CAS。共享 registry/settings 大 JSON 的写入还需要全局 revision/合并，不能回滚 A 时恢复整个旧 blob 并抹掉 B 的新设置。
- 新包先完整验证/解码/写到私有 stage；native 自己执行 ID/路径/链接/预算校验。包文件写完并 flush 后才可成为候选。不要继续每文件覆盖活动目录；也不要用 symlink `current` 绕开 DOM 现有 no-follow snapshot 约束。
- 有一个持久安装 generation 和一个每次激活都更新的运行 epoch。恢复旧版也是**新 epoch**，不能继续使用旧 Worker、broker、lease、回调或取消令牌；待旧实例完成受控收尾后才启动替代实例。
- 审批绑定候选 manifest/host/权限及网络 origins 等能力范围的指纹。能力增加必须先确认；拒绝保留旧版。回退只恢复旧版实际批准的范围，不继承新版本额外授权。
- “启动失败回退并保留设置”要求候选激活在提交前不能修改唯一旧数据：普通 plugin storage/settings 用临时 overlay 或延后写入；native 私有 data 用隔离副本/显式迁移事务。不要用硬链接复制可写数据，会共同修改旧 inode。候选激活期间文档/任意文件/网络写等不可回滚动作应拒绝或延迟至提交；无法保证这些约束的 sidecar 不能声称任意副作用均回滚。
- 若允许候选 storage/settings overlay 在提交时生效，增量、原值及 expected revision 必须进入 native durable decision 并可幂等重放；否则先限制候选启动对既有数据只读。不能因为包 catalog 原子，就把跨 localStorage 的数据提交也称原子。
- 当前 PluginRuntime 一个 ID 对应一个实例且共享 ActionRegistry；先完整卸载旧实例，再准备候选，失败后重启旧版，是较小可行方案。候选贡献在提交前不得对 UI/命令派发开放；需要暂存贡献或执行门禁。无须承诺无停机热替换。
- 包回退不等于任意时间的数据降级。安装/启动失败发生在提交前可以恢复未改旧数据；新版本成功运行并进行不可逆数据迁移后的“用户手动回退”必须有独立数据兼容策略，不能复用启动回退的承诺。

## A — native 安装目录为持久权威，localStorage 为可重建镜像（推荐）

布局示意：每插件保存不可变 `generations/<opaque-id>/`，native catalog 保存 active/previous generation、manifest/content hashes、审批指纹、启用意图/卸载 tombstone 和 revision。localStorage 保留 UI/audit 缓存、普通设置及既有插件存储，但不独立决定启动哪个包、使用哪些审批。

流程：

1. native `prepare` 创建私有候选 generation，完整验证并持久化 files/manifest；返回不透明 transaction ID 和实际摘要。旧 active 不变。
2. 宿主审阅差异/审批，串行撤销旧 epoch 和贡献、等待 teardown。候选以隔离存储 overlay/受限副作用激活。
3. 激活成功后，native 以原 catalog revision 为条件原子替换小 catalog 文件；这是唯一安装提交点。对应平台必须验证文件同步、同卷原子替换及目录同步/恢复语义；不以一次 rename 推断所有平台断电安全。
4. 宿主发布新贡献，刷新 localStorage 镜像。镜像写失败只影响缓存/可见诊断，不能退回旧包配新权限。若发布失败，进行一笔**新的**恢复事务，撤销新 epoch、切回旧 generation、重启旧实例。
5. 启动先读/校验 catalog，修复或丢弃镜像，再激活。未被 catalog 引用的 stage 仅作为待清理垃圾；回退版本在明确定义的保留期前不删。删除也先持久 tombstone，后台 GC，避免因删除失败复活。

崩溃判定：catalog 提交前一律旧 generation；提交后按新 catalog 恢复。若有启动待确认策略，可把 `candidate-starting` 与 previous 记在 catalog 中，恢复时回退旧版并留下失败诊断，而不是无限重试坏版本。activation 成功后到 catalog commit 前崩溃不会破坏旧数据（前提是上述 overlay/副作用门禁有效）。

代价：需迁移安装元数据与审批/启用权威到 native，改启动恢复和 DOM prepared-root 解析；现有同步 `approve`/persist 调用改异步受控请求。旧 localStorage 迁移必须验证记录和磁盘 manifest，一次性生成 receipt，异常则 disabled/需确认，不能把任意缓存字段当作新授权。保留旧包及可写数据快照占磁盘，需有可解释预算/清理政策；不删除唯一可回退版本。

优势：持久事实只有一份；localStorage 清空/配额失败不会出现新旧包混用或权限复活。包/注册表恢复路径可由 native 独立执行，管理扩展坏掉也不妨碍可信安全壳。

## B — 保留前端 registry，native write-ahead journal 协调双存储

仍用不可变 generation（或 journal 管理的 old/new 完整目录），前端保留现有 registry 形状及大部分操作。native 保存每笔事务的 prepare、commit/abort 决议及需要恢复的**该插件**前/后记录、摘要与 revision。localStorage 对应记录包含 txn ID / generation / revision；它不是第三个独立判断源。

流程：

1. native 写入并同步 prepare journal，保存旧/新包定位和精确前/后安装记录；完成候选 stage，旧 active 可用。
2. 宿主卸载旧实例，以隔离数据激活候选；持久记录候选的批准指纹，不让候选自行审批。
3. native 持久 commit 决议；之后前端把匹配 txn/revision 的新记录写入 localStorage；native 完成包 active 切换/清理阶段。每一步都可重入，事务 ID 重放只能得到同一结果。
4. 启动在任何自动 enable **之前**读取 journal，按 durable decision redo 或 undo，并核对 localStorage 的 generation/hash。不存在 commit 决议就回到旧记录/旧包；存在 commit 就重放新记录（或明确启动失败恢复事务）。清理动作的失败不能改变提交决议。
5. checkpoint/GC 不能只因为 localStorage.setItem 返回就丢掉最后恢复材料：Web Storage 没有应用可调用的 fsync。保留 native durable commit receipt/恢复记录，或先写 durable checkpoint；否则进程/系统崩溃后 localStorage 回退时无法确定应使用哪个包。

关键代价：**所有会改变启动/审批/禁用/卸载权威的写入**都必须进入 journal/revision 协议。若仅升级走 WAL、disable 仍只写 localStorage，恢复旧 journal 可能复活已停用插件或旧审批。共享 registry blob 需逐插件合并和全局 CAS；恢复不能恢复整个过时快照。保留一个“较新的 localStorage 就信它”的捷径同样破坏权限恢复依据。

优势：前端管理模型迁移较少，较易先接现有 registry 序列化和故障 UI；native 无需一开始实现完整 catalog 查询模型。代价是状态组合更多、重放/GC/多次连续升级验证更重；最终仍需 native 持久权威记录来弥补 localStorage durability，不能得到“零 native 元数据”的原子升级。若团队暂时不愿将所有权威写入纳入协议，只能做到不确定时 disabled + 可重试恢复，不能宣称完整崩溃一致性或自动恢复 enabled 状态。

## 决策及最小故障矩阵

推荐 A：一次明确迁移安装事实，减少之后每个管理动作维护双写协议的成本。B 适合愿意保留前端 registry 接口、同时接受完整 WAL/replay 工程量的渐进路径；不建议做半个 B。

两者都必须测试：每文件 stage 失败；stage 完成前/后；旧 teardown 未完成；候选 activate 抛错/挂起；审批变更/撤销竞争；提交决议前/后崩溃；localStorage quota/损坏/落后；连续两次升级中断；A/B 两插件并发更新；删除后重启；旧回调/late RPC；设置 overlay 失败；GC 失败。检查 active bytes+manifest+approval generation 一致、旧数据不变、无重复实例/旧授权、失败可见且可重试。真实 Linux 结果与模拟故障注入分开，Windows/macOS 不凭该设计记为通过。
