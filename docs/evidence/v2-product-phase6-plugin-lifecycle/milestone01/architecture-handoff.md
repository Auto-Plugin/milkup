# P6 milestone01 架构交接：下一步是生命周期事务，而非阶段结案

本检查点补上包格式拒绝、安装前兼容性检查和输出捕获的插件集合/代次一致性；**P6 尚未完成**。本文是方案交接，不实施事务，不修改产品。细节依据：[当前审阅](review-current.md)、[事务方案](transaction-options.md)、[初始缺口审计](native-audit.md)。初始审计描述基线状态，已修项目应以当前审阅为准。

## 已经取得的边界

- 包解析在任何安装写入前完整检查路径、文件冲突、保留 manifest、入口及严格 base64；未新增任意小尺寸上限。真实官方包对照无新增兼容回归，包括 5.7MiB Mermaid。此项不是 native 路径/链接防御或安装事务。
- `installManifestPath` 在安装文件、创建数据目录、registry mutation 前执行共享 manifest/host/SDK/app 兼容检查。不兼容直接安装/升级拒绝时保持旧 enabled 记录、实例、贡献和设置；**兼容升级的写入/启动回退仍未实现**。
- pending 准备重试仍受既有准备预算和每次执行硬 2 秒约束；统一 sticky guard 冻结完整 `(pluginId, rendererId, epoch)` 集合，任意观察到的变化撤销整次捕获，不发布混合代次结果。稳定实例的永久 incomplete 才走源码 fallback。
- root 已报告真实 `outline03`、`reject01`、`matrix01`、`all-off01` 通过；这些是相应场景证据，不是下列事务/故障注入项通过。其它 native 验收仍由 root 收尾；本文未运行或独立重复验收。

## 尚需交付的生命周期范围

| 范围 | 当前开放问题与验收目标 |
| --- | --- |
| 兼容升级、rollback | native 仍逐文件覆盖活动包，缺少私有 stage、单一提交点、旧版本保留和崩溃恢复；I/O/activation/持久化失败必须恢复一致包、manifest、审批和运行状态。设置/data 不得被失败候选污染；成功升级后的任意降级另有数据兼容要求。 |
| 权限变更 | 权限名/host 已有审批，`networkOrigins` 扩大仍可能继承旧 `network:access`。审批需绑定候选能力范围，差异可见、增加重新确认、拒绝保留旧版；不能把现敏感权限检查等同于全部权限增加条款已完成。 |
| reload 与并发 | reload 在读取/验证候选前卸载旧版，且须校验 source 仍属原 ID；install/approve 未全面进入同一生命周期队列。兼容更新可出现 registry 为新版 enabled、runtime 仍旧版。需统一 per-plugin 串行和持久 revision 校验。 |
| crash、禁用、卸载 | 普通非 renderer Worker 缺少完整运行期 error/messageerror 撤权链；cleanup rejection 可跳过后续收尾。删除失败可能令内存/持久记录分叉，需可重试 disabled/error 或 tombstone，避免重启复活。sidecar 直接 child kill 不等于后代全部清理。 |
| 启动恢复 | 损坏 registry 可半恢复；须先完整验证再替换或逐项隔离并保留诊断。单插件启动失败不能阻断其它插件和可信安全壳；异常存储/cleanup 路径仍需故障测试。 |
| 独立管理扩展 | 当前宿主管理安全壳及全禁用场景不等于独立管理扩展交付。扩展负责列表/诊断/差异解释/设置等体验；审批、事务、恢复权威留宿主。禁用或破坏管理扩展后仍能启停卸载、恢复故障插件，不能允许扩展自行审批或任意写包目录。 |

通用安装预算与 native ID/no-follow 写入防御应随事务补齐；不把本轮格式单测称为完整恶意包沙箱或 Windows/macOS 实测。

## 父线程需要确定的架构选择

**A：native catalog 为持久权威，不可变包 generations；推荐。** catalog 保存活动/回退代次、包摘要、审批指纹、启用意图、删除 tombstone 和 revision；localStorage 的安装记录是可重建镜像。候选私有 stage 完整验证，旧实例撤权并收尾，受限候选启动成功后原子提交 catalog，再发布贡献。启动从 catalog 恢复，镜像损坏/配额失败不得改变包或授权。优点是唯一持久决议；代价是安装/审批/恢复 API 与旧数据迁移，以及回退包和数据保留预算。

**B：保留前端 registry 接口，由 native WAL 协调。** journal 保存逐插件前后记录、包代次、revision 和 durable commit/abort；启动 enable 前依决议幂等 redo/undo。所有 install/approve/disable/remove 等权威写入都须纳入协议，不能只给升级加日志；localStorage 没有应用级 fsync，不能 setItem 成功后丢掉唯一恢复材料。迁移接口较少，但双存储重放、并发合并、checkpoint/GC 更复杂；半个 B 只能不确定时停用，不能声称完整崩溃一致性。

这不是普通局部实现选择：它决定**谁持有安装与审批的最终事实、旧数据如何迁移、候选激活可做什么、失败恢复承诺多大**。父线程需要选 A 或完整 B，并冻结以下最小语义后再分工；本交接推荐 A，但不擅自迁移权威或实施半套协议。

1. 首版采用旧实例完全 teardown → 候选受限启动 → 提交/发布；不承诺同 ID 零停机双实例。每次恢复旧代码也是新 runtime epoch，旧 broker/lease/RPC 永不复用。
2. 明确失败前设置保护：候选写入 overlay 或启动只读；需要提交 overlay 时，其增量/revision/恢复材料也进入持久协议。包回退不能撤销文档、网络和任意 sidecar 外部副作用，需在候选启动阶段门禁或明确不承诺。
3. 明确回退代次/数据保留预算、卸载保留数据策略，以及成功迁移后手动降级的范围。不得删除唯一可恢复版本来掩盖资源不足。

## 可直接执行的下一步

父线程记录所选权威模型与上述语义后，先针对兼容 v1→v2 升级写出失败矩阵 RED：每文件 stage、teardown、候选 activation、提交前后、registry quota/损坏、权限变更竞争、删除失败/重启和 late RPC。然后分为 native stage/catalog 或 WAL、manager 串行/审批/数据门禁、恢复与独立管理体验三条实现线，共享一份事务 ID/revision/状态合同。通过单元故障注入后再做 Linux 真实包升级/回退/重启验收；当前里程碑成功场景保留，未覆盖项继续开放，不用它们替代事务证据。
