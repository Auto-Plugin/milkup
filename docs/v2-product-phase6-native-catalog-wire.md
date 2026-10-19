# P6 native catalog wire v1（冻结附录）

本附录与 [事务合同](v2-product-phase6-native-catalog-contract.md) 一起解释。native、catalog adapter 与 manager 共用此协议；命令只由可信宿主调用，不向插件透传原生入口。实现中尚未通过的能力不能据此视为完成。

四个命令全部返回完整 `Snapshot`，失败返回 `[plugin-catalog:invalid|conflict|quota|io|unsupported|corrupt] message`。JS 参数为 camelCase，native root 由宿主固定为 `app_data_dir()/plugins`，前端不能指定。

- `plugin_catalog_read()`：首次进程读取执行持久 trial/startup 中断恢复；同进程后续 read 不中断 live trial。
- `plugin_catalog_prepare({archive, sourcePath, expectedRevision})`：archive 是既有 milkup-plugin v1 JSON；sourcePath 为可信宿主的来源说明，不授予路径读取能力。首次 ID expectedRevision=null，已有 ID 必须精确 revision（包括 tombstone）。stage 不改变旧 enabled/active。
- `plugin_catalog_transition({pluginId, expectedRevision, action})`：entry CAS；所有写入同时持有 native 全局锁与目录内文件锁。
- `plugin_catalog_migrate({legacyRaw, validation})`：保存原始 localStorage 字节后独立验证迁移；不得由 adapter 预过滤坏记录而丢原始备份。`validation` 为可信宿主完整共享 TS schema 验证结果：`{version:1, rawSha256, records:[{index, manifest}], diagnostics:string[]}`。`rawSha256` 是精确原文 UTF-8 字节 SHA-256，`index` 是原数组下标，`manifest` 是验证后的原始 JSON 对象，不能用规范化后的 parser 输出替换。native 必须匹配原文 SHA、唯一有效下标、hint manifest == raw manifest == 安装盘 manifest，再独立验证权限/路径/包与实际字节。缺 validation 不得回退导入；无 hint 的坏项隔离，不影响其它有效项。坏 JSON/root 可带空 records 完成备份、隔离诊断与单一 receipt。重复相同 raw 幂等；已有 receipt 后不同 raw 不可重写权威。诊断最多 128 条、每条 1024 Unicode 字符。

```ts
interface Snapshot {
  version: 1
  revision: number
  entries: Entry[]
  diagnostics: string[]
  migrationReceipt: string | null
}
interface Entry {
  id: string
  revision: number
  active: Generation | null
  previous: Generation | null
  pending: Candidate | null
  enabled: boolean
  tombstone: boolean
  startAttempt: string | null
  diagnostics: string[]
  dataRoot: string
  storageRoot: string
}
interface Generation {
  id: string
  manifest: PluginManifest
  manifestSha256: string
  contentSha256: string
  capabilityFingerprint: string
  approvedFingerprint: string | null
  verified: boolean
  sourcePath: string
  packageRoot: string
}
interface Candidate {
  transactionId: string
  generation: Generation
  phase: 'prepared' | 'trial'
  restoreEnabled: boolean
}
type CandidateIdentity = { transactionId: string; fingerprint: string }
type Action =
  | ({ type: 'approve' | 'beginTrial' | 'abort' } & CandidateIdentity)
  | ({ type: 'commit'; enabled: boolean } & CandidateIdentity)
  | { type: 'approveActive'; generationId: string; fingerprint: string }
  | { type: 'startupBegin'; generationId: string }
  | { type: 'startupComplete'; attemptId: string }
  | { type: 'disable' | 'revokeApproval' | 'rollback' | 'remove' }
  | { type: 'markFailed'; generationId: string; message: string }
```

Nullable 字段保留明确 null。generation/transaction/attempt ID 由 native 生成；packageRoot/dataRoot/storageRoot 为 native 计算的路径，不接受前端反写。所有整数均需安全非负整数；manifest 本体仍走共享 TS manifest/compatibility 校验，native 再独立验证安装与能力安全字段。

`fingerprint` 是候选 capabilityFingerprint，始终与 transactionId + revision 联合匹配，不能仅凭相同权限批准别的候选。审批只修改该候选。beginTrial 先持久记录 trial 与旧启用意图，enabled=false，再由 manager 撤旧；sidecar trial 首版 unsupported。commit 仅接受已批准 trial，标 verified=true，保留原 verified active 为 previous；enabled 参数为提交后的启用意图。未做 restricted activation 不得调用 commit。

abort 清候选；旧 verified active 和批准保留，恢复旧启用意图后 manager 用新 epoch 重新启动。startupBegin 校验 active/批准并生成 startAttempt、enabled=true；startupComplete 必须匹配 attemptId。进程在 attempt 未完成时退出，下次 read 将其停用并留诊断，避免无限启动失败。disable 清启用意图/attempt；revokeApproval 还清 active/previous/pending 审批，不能通过 rollback 恢复已撤授权。markFailed 校验 generationId 后停用留诊断。rollback 只切换已 verified previous，置 disabled，后续需独立 startupBegin；不承诺成功数据迁移后的任意降级。remove 先持久 tombstone、停用撤批，再进行可重试包 GC，默认保留 data/storage。

工程配额：manifest 1MiB、单文件 32MiB、decoded 包总 64MiB、4096 files、路径 1024 UTF-8 bytes/32层、catalog 16MiB/512 entries；stage 额外预留 16MiB 与 catalog 双写空间。已核验官方约5.7MiB Mermaid 可用。这是明确的工程边界而非任意小内容阈值，前后端应一致；磁盘不足在撤旧前拒绝。Unix fd-relative no-follow/原子替换须实际测试；未实现安全替换的平台返回 unsupported，不能回退旧逐文件覆盖。

迁移不能从旧 localStorage 推断未记录的 capability scope 审批。旧实际包校验后作为待验证候选恢复，启用/审批需可信宿主明确处理；旧 data/storage 原地保留。坏项逐项隔离诊断，原 raw 备份与单一 receipt 保留。启动后原旧 registry 只作镜像，不再授权。
