# P6 native catalog 事务合同 v1

基线 `633a6d7910f9fa44b9fa89628967e6b7105071ec`，继续 `dot/milkup-v2-product-phase6-plugin-lifecycle`。父线程 2026-10-19 明确选择方案 A。本文件先于本轮产品实现写入；实现或测试发现需要改变本合同，须在同一变更中写明，不允许各组件各自解释协议。P5 PDF 与历史超时仍开放。

## 唯一持久权威

native catalog 持有安装包代次、批准的能力范围、启用意图、启动尝试、卸载 tombstone、revision 与恢复材料。localStorage registry 仅为可重建 UI 镜像，清空、损坏、配额失败不能授权、复活或改变 native 指向。插件设置/data 与包分离，默认卸载不删除用户 data。

包位于每插件不可变 `generations/<opaque-generation>/`，不使用 symlink current。catalog 只引用完整验证、封存的 generation；读取实际包必须核对 catalog 与真实 manifest/内容指纹。保留当前和至少一个最近已验证可回退代次；无足够空间准备候选和恢复材料时，在撤掉旧实例之前拒绝。GC 只清理无引用且确认可回收的 generation，不删除唯一恢复副本或用户 data。

安装候选、审批、启停、重载、撤权、卸载、恢复共享同插件串行队列；native 以 entry revision、transaction ID 和候选指纹检查 CAS。catalog 文件的整体替换还需全局锁/revision 协调，防止不同插件写入互相覆盖。事务 ID 与 generation 由 native 生成，前端不能选择路径。

## 候选与提交顺序

1. 全部 archive/manifest/兼容与能力范围校验后，native 预检配额/可用空间，完整 stage、同步文件、生成内容与能力指纹，并持久记录候选。旧 active、旧审批与旧数据保持不变。新安装或待审批候选可显示待处理详情，但不能自动运行未批准能力。
2. 比较完整权限、执行 host、networkOrigins 等范围；扩大或改变能力必须由可信宿主明确确认当前候选指纹。拒绝/候选已被替换时保留旧版，不让迟到审批批准另一个包。独立管理扩展只能请求打开可信详情/诊断，不得自行批准。
3. native 持久标记 trial/start attempt；宿主先撤销旧 epoch 和全部 broker/lease/任务，完成 teardown。未完成必要隔离收尾不得同时启动候选。恢复旧代码也创建新 epoch，旧 RPC、回调和句柄永久失效。
4. 候选以受限 activation 运行。首版默认只读现有设置/data；文档写、文件写、网络、输出、工作区变更、任意 sidecar 外部副作用均不可在提交前发生。贡献先准备，不向 UI/命令/渲染请求公开。不能安全约束的 host/初始化明确拒绝并恢复旧版。不得以“插件可信”暗中放过候选门禁。
5. 若确需初始化写入，仅允许独立 overlay；其 data/settings revision、变更与恢复材料必须进入同一持久决议。**本轮不以普通内存缓存冒充持久 overlay；未实现完整 overlay 的写入初始化须失败。** 不使用硬链接复制可写用户数据。
6. 候选成功后 native 原子提交 active generation、已批准指纹、启用意图与 previous verified generation，然后宿主发布贡献/解除候选门禁。提交前失败 abort 候选、恢复旧运行；提交后发布失败使用新一笔恢复事务切回已验证旧代次并重新激活，不能把旧 epoch 复活。
7. 安装为停用状态的候选也不得被记为“已验证可回退”直到完成受限启动验证。待审批/尚未验证候选与 active 安装在 catalog 中明确区分；它们不向 renderer/actions 发布。重启可继续审阅，不能自动批准。

## 启动、故障与卸载

读取 catalog 先验证完整结构、重复 ID、generation/路径、审批指纹、状态和大小。未知/损坏项隔离并保留诊断，不能半恢复后自动运行；可恢复备份不能被无效空 catalog 覆盖。未完成 trial 按持久状态 abort，并保留旧完整版本。已提交 generation 的启动尝试必须有完成标记；崩溃/失败不能无限自动启用同一个坏插件，进入可解释停用/恢复状态。

旧 registry 迁移先备份原始字节、逐项完整验证来源与实际安装内容、保留幂等 receipt，最后单一 native 提交。无法验证的旧 approvals，尤其 networkOrigins，不自动扩大或重新授予。未知/损坏项隔离诊断；失败重试不得覆盖唯一旧备份、丢 data、半提交或绕过 tombstone。localStorage 写失败不能回退 native 安装事实。

普通 Worker 的 error/messageerror、DOM/sidecar 故障都必须触发该 epoch 撤权与可见失败。任一 cleanup reject 不能跳过其它独立收尾；用分阶段 finally/all-settled 记录真实失败，不能把 zombie/未收尾描述为 fully reaped。先同步撤销能力，再等待异步任务结束；不能因保存诊断失败跳过清理。

卸载先 native 持久 tombstone（enabled=false、授权撤销），立即阻止旧 epoch 和重启复活，再做可重试包清理。删除失败保留明确诊断/重试入口；默认用户 data/settings 保留。重新安装必须是新的明确事务。成功数据迁移后的任意手工降级不在首版承诺，只能按已验证 schema/快照恢复。

## 组件边界和并行所有权

- native `plugin_catalog.rs`：不可变 stage、完整原生校验/空间预检、原子 catalog/CAS、候选/提交/abort/恢复/tombstone、迁移备份、引用 GC；native command 仅可信宿主可调用。DOM/icon 按 catalog generation 解析，保持 no-follow。
- desktop catalog adapter：严格 wire 解析、旧 registry 验证/迁移输入、native record → UI registry 镜像；不把 localStorage 作为 authority。实际 IPC command/type 在 native 与 adapter 共同确认后统一冻结，不另建第二套协议。
- desktop manager：同 ID 队列、候选差异审阅、撤权/受限 activation/提交/贡献发布、失败恢复及完整 cleanup，所有入口走同一协议。
- runtime/worker：准备与发布分离，普通 Worker 故障回调，提交前无外部副作用；实际隔离能力如实报告，不宣称完整恶意代码沙箱。
- 独立管理扩展：仅公开 SDK，列表只标题/logo/描述，状态/兼容/权限/错误/动作在详情；宿主最小安全壳独立可用。不得按扩展 ID 特判授权。

root 统一 `main.ts`、原生 command 注册与最终 UI/生产构建。各 agent 不同时运行 Cargo/原生 UI；共享源码不覆盖他人改动。磁盘有限，所有新增大体积临时构建先制定存储安排；旧证据和唯一构建不删除。

## 必须实际失败再通过的矩阵

| 编号 | 注入/场景                                               | 必须保持的不变量                                       |
| ---- | ------------------------------------------------------- | ------------------------------------------------------ |
| T01  | 中段文件写入失败、非法编码/路径、缺入口、磁盘不足       | 旧 package/manifest/审批/data 字节不变，旧插件仍可用   |
| T02  | stage 同步前/后中断、trial 启动前/中断                  | 重启只运行完整旧版，候选不得获新授权                   |
| T03  | 候选 activate 抛错/挂起/非法副作用/sidecar 不支持       | 撤掉候选全部能力，旧版新 epoch 恢复，原设置/data 不变  |
| T04  | catalog 原子提交前/后中断、提交后贡献发布失败           | generation+manifest+审批一致，恢复决议可重入，无双实例 |
| T05  | 权限/host/origin 扩大、拒绝、迟到审批、候选更换         | 必须确认精确候选；拒绝留旧版，无旧授权复活             |
| T06  | 同 ID 安装/禁用/移除并发、不同 ID 并发提交              | 队列/CAS 明确拒绝或串行，无丢更新/混用                 |
| T07  | localStorage 损坏/清空/quota、native catalog 损坏       | mirror 不能改变授权；有效备份/诊断保留，不半恢复       |
| T08  | 迁移重复执行、坏记录、重复 ID、未知 origins、备份写失败 | 单一幂等提交、隔离坏项、不扩大批准、不丢旧数据         |
| T09  | 卸载包删除拒绝/中断、重启、再安装                       | tombstone 阻止复活，删除可重试，data 默认保留          |
| T10  | Worker error/messageerror、多个 cleanup reject、晚 RPC  | 同步撤权、所有收尾尝试、旧请求永久拒绝、编辑器可用     |
| T11  | 独立管理扩展禁用/故障、大纲仅公开 SDK                   | 安全壳可恢复；无私有导入或插件 ID 特例                 |
| T12  | 所有插件停用，普通/窗口化 source/live                   | Unicode、历史、保存与恢复既有保护不退化                |

每项区分单元故障注入、真实 Linux UI、实际重启/进程中断、未验平台。保留修前失败、源码/程序/包/文档 SHA、实际截图和剩余边界。Windows/macOS、物理打印及完整恶意代码沙箱不由 Linux 结果推断。禁止发布、上传 Runtime/Windows 构建或合并其它分支。
