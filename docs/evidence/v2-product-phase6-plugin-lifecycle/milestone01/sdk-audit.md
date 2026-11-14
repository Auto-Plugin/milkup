# P6 公开 SDK、管理安全壳与独立构建审计

日期：2026-10-19。只读审计基线：`1388f646703ba19c4ed501b0450d123e70388f9a`，分支 `dot/milkup-v2-product-phase6-plugin-lifecycle`。本报告不表示功能已实现或测试通过；审计阶段未运行测试、构建或原生 UI。以下路径均相对 `/workspace/milkup`。

## 结论

目前公开 SDK 为 **0.3.5**，没有 `app:plugins` 权限、plugin-management broker 或公开管理 API。已有宿主管理器和基础安全壳可以复用，但升级/回退不能仅包装现有安装方法。建议新增敏感的 `app:plugins` 能力，以有界只读元数据和可信用户触发的受控请求服务独立 Worker 插件；宿主保留校验、审批、事务、隔离和恢复入口。任何插件 ID 都走相同合同。

当前普通列表已经只显示 title/logo/description，不需要重新加入版本、权限或路径。官方 outline 已被通用仓库外构建脚本覆盖，但属于明确标记的 `legacy-non-frozen` 模式；README 的 SDK 和产物版本与实际源码不一致。

## 已有路径与边界

| 路径 | 已有行为与限制 |
| --- | --- |
| `docs/v2-product-completion-plan.md` | 当前 P6 要求升级/回退、权限变化解释、兼容诊断、设置、独立管理扩展，以及故障时仍可用的基础安全壳。计划正文部分阶段状态落后于代码，不作为完成证据。 |
| `docs/v2-product-completion-plan-history-2026-10-15.md` | 历史 P7 映射当前 P6；明确扩展拥有解释/指导/设置详情/诊断建议，宿主拥有验证/差异审批/事务替换回退。历史 P6 是快捷键，不能混淆。 |
| `packages/plugin-sdk/src/index.d.ts` | `SdkPluginHost` 有 settings/releases/workspace/output 等，没有管理目录、其他插件状态或任意宿主 action 执行接口。 |
| `packages/core/src/actions/registry.ts`、`packages/plugin/src/manifest.ts` | 有 `app:control`、`app:updates` 等；没有 `app:plugins`。不能将新增管理权限视为已经存在。 |
| `apps/desktop/src/desktop-plugin-manager.ts` | 宿主内部 `state/installFromPicker/installManifestPath/enable/disable/reload/remove/approve/revokeApproval`；向内部调用者返回 registry records，含本地路径、错误和审计，不应原样序列化给插件。 |
| 同文件 `createDesktopPluginActions` | `plugin.*` 宿主 action 包括批准，使用 `app:control`；当前 SDK 无任意 action 调用面。不能把这组 action 直接暴露成管理 API，尤其不能让插件直接调用 `approve`。 |
| 同文件 `renderDesktopPluginManager/renderPluginCard`、`desktop-plugin-manager-ui.ts` | 列表卡片只有名称、受控 PNG 图标、描述。宿主详情包含兼容版本、host、权限、审批、来源和数据路径、错误及恢复操作。基础壳没有依赖独立管理插件。 |
| `packages/plugin/src/registry.ts` | 安装时检查 engines；已有审批仅保留新版本仍声明的权限，host 变化也参与审批。兼容失败主要是字符串错误，尚无稳定结构化诊断 API。 |
| `packages/plugin/src/ui-broker.ts` | `ui.open` 只能打开调用者声明的 modal，且需要可信 command gesture；不能用它任意打开另一个插件或假定 `app:plugins` 是已有内置 view ID。 |
| `packages/plugin/src/settings-schema.ts`、`settings-broker.ts` | scope 仅 application 或调用者自己的 plugin；broker 将 schema 绑定调用者 manifest，不支持传入另一插件 ID。事务有 revision、冲突、取消/撤销检查。 |
| `apps/desktop/src/settings-service.ts` | 共享设置存储与事务服务；adapter 绑定具体 owner，不接受任意目标插件 ID。已有回滚、持久化和队列逻辑，应复用而非另建任意配置写入口。 |
| `plugins/preferences/src/plugin.ts` | 人类可读字段说明目前在独立 preferences 插件内；schema 本身只含 enum/number/boolean 约束，没有标签、帮助、单位、分组或 secret 字段语义。 |

`releases` 是应用版本更新合同（签名下载/受控安装），不是插件包更新服务，不应借名称相似直接挪用。

### 安装和升级缺口

`installManifestPath` 先解析包并调用 `manifestHost.installPackage`，之后才调用 registry 的兼容检查。`main.ts` 的安装 adapter 逐文件调用 native `install_plugin_package_file`；`src-tauri/src/lib.rs` 对目标路径直接 `fs::write`。`reload` 先卸载再从原来源重装。这里不能证明整包升级原子性、失败恢复旧包、设置保留或崩溃恢复。

P6 必须先解析/验证候选与兼容性，再计算 host/权限差异并完成宿主审批，最后执行完整事务；包文件、registry、运行实例、审批和 settings 的提交/恢复关系都要定义。不能将先 remove 后 install 称为回退，也不能以旧 approvals 自动批准新增权限。

## 建议的最小公开管理合同（提案，未实施）

新增可选 `host.plugins`，由 manifest 声明且宿主批准敏感权限 `app:plugins` 后提供。分成只读 host 与仅可信命令上下文提供的请求方法，沿用现有 gesture/broker/RPC 模式。所有对象闭合校验、有长度/数量上限，所有异步调用支持 AbortSignal；禁用、撤销和卸载清理 broker、候选和未提交操作。

| 能力 | 最小数据 / 操作 |
| --- | --- |
| `list` | 有界分页目录：id、title、description、受控 icon、revision。普通卡片只呈现 title/logo/description。 |
| `describe({pluginId})` | version/host/state、宿主及 SDK 兼容要求与当前版本、结构化兼容码、declared/approved/added permissions、可执行操作、有限诊断码与安全说明、可声明的设置 descriptor。不得暴露 packageRoot/dataRoot/sourcePath、任意 stack、整个 storage 或实例对象。 |
| `choosePackage` | 消费可信 gesture，宿主本地 picker；返回 cancelled 或绑定 caller/候选字节 hash/当前 catalog revision 的不透明 candidateId 及审阅元数据。无任意路径、URL 或外部命令参数。 |
| `requestInstall({candidateId,expectedRevision})` | 宿主确认与权限差异审批后事务安装/升级；返回 installed/cancelled/rolled-back 等明确终态。不提供 `approve(pluginId)`。升级必须校验候选 ID、版本和当前包 fingerprint，防审阅后替换。 |
| `requestAction({pluginId,expectedRevision,action})` | 闭合 action，例如 enable/disable/uninstall/retry/revoke/rollback；实际可用操作由宿主计算。可信触发、审批与删除范围始终由宿主决定；不接受代码、路径、任意 action 名或权限集合。回退仅能选宿主保留的已验证 revision。 |
| `release(candidateId)` | 清理未提交候选；超时、插件停用/撤销也回收。提交成功后不因调用者随后取消而删掉已提交包或伪报未提交。 |

`requestAction` 可以按产品需要拆成命名方法，安全语义不变。目录 revision 之外，安装候选还必须固定具体包内容；只比较插件 version 字符串不足以防 TOCTOU。

设置详情第一步可仅公开 schema/defaults/约束与受控“打开设置”请求。若独立管理扩展必须直接编辑其他插件的表单，不能把现有 `settings('plugin')` 扩展为任意 ID：需要新增宿主批准的 target settings lease，固定目标包/schema/revision/owner，复用 begin/preview/commit/cancel，禁用或升级时撤销。不能透传目标插件 storage。字段说明可增量增加有界纯文本 metadata，不能接受脚本/HTML；没有声明标签时显示字段 key。是否允许读取设置值需明确单独合同，不能默认将所有插件配置作为可公开目录元数据。

独立 `plugins/plugin-management` 使用 Worker、公开 SDK、声明式 UI，自有解释文案/兼容指导/设置详情/诊断建议、manifest、构建脚本、锁与外部验收。优先不需要 file/network/settings:write 广权限。扩展禁用后，宿主仍能从固定内置入口列出基本卡片、审阅审批、启停/卸载/撤销/恢复；不自动重新启用扩展，不按某个产品 ID 分流业务。

### 建议接线归属

- SDK：`packages/plugin-sdk/src/index.d.ts` 与 README/contract tests，必要增量版本；新 schema/broker/RPC 位于 `packages/plugin/src/`，公开导出经其 index。
- 权限：`packages/core/src/actions/registry.ts`、`packages/plugin/src/manifest.ts` 与 desktop manager 敏感权限策略。默认未批准。
- 隔离：`runtime.ts`、`isolation.ts`、`isolation-module-host.ts`、`isolation-worker.ts`、`isolation-sidecar.ts` 及 RPC；owner 与 gesture 不来自插件自报。
- 宿主通用生命周期：`desktop-plugin-manager.ts`、`main.ts` native adapter，以及 native package transaction；保留壳 UI，插件只调用公开能力。
- 产品内容：新的独立插件目录；发行目录通过通用 `release/bundled-plugins.json` 声明，不在宿主硬编码产品 ID。

最低验收应覆盖未授权与自批准拒绝、候选替换/过期、兼容失败不写当前包、权限增加重批、禁用/撤销中止、并发 mutation conflict、升级失败/崩溃后旧包与设置恢复、恶意 RPC/超限、管理插件停用后仍能恢复。以上为待执行提案。

## Outline 独立构建验收

当前 `plugins/outline/package.json` 和 `plugin.json` 为 **1.3.1**；devDependency `@milkup/plugin-sdk` 固定 **0.2.0**，manifest 接受 **>=0.2.0 <0.4.0**；当前仓库 SDK 为 **0.3.5**。Worker 仅声明 document:read，源码只依赖公开 SDK。`scripts/build.mjs` 检查 esbuild 输入限于插件 src/与 SDK，拒绝残留 runtime imports，输出 bundle、metafile 和 `.milkup-plugin`。

`scripts/ci/verify-public-plugin-builds.mjs` 会读取 `release/bundled-plugins.json`，其中已有 outline；将目录复制到 checkout 外，打包当前公开 SDK tarball，注入外部 package.json 依赖和已安装工具版本，执行 build 与本地 src tests，并记录 SDK/package hash 和命令结果。`public-plugin-build-contract.mjs` 将没有 dependencyClosure 的 outline 标记为 `legacy-non-frozen`。脚本覆盖 outline，不代表本次已执行，也不证明原 package.json 的 SDK 0.2.0 精确依赖已经独立验过。

outline 自身没有 verify-external/test script、lock 或 dependencyClosure profile；现通用脚本会改变复制后的 package.json，因此不能称为“输入不变、锁定闭包”的构建。`tsconfig.json` 的 include 是 plugin.ts，测试由外部 Vitest 单独发现。README 仍示例 SDK **0.1.1** 和产物 **1.2.0**，应纠正。

P6 验收建议：先修文档版本、决定并明确实际验收 SDK；按已有冻结构建模式增加 lock/公开 SDK tarball hash/复制输入清单、真实外部解析路径、可信重建比较与 archive hash；保留本地单测和 native outline 用户流程验收。若只复用现脚本，必须继续标注 legacy-non-frozen，不能因文件在 checkout 外就声称依赖闭包已冻结。不要为管理功能升级所有官方插件依赖。

## 附：显式呈现 pending 合同只读评估

`plugins/footnotes/src/controller.ts` 在新 documentId/version 的首次 render 创建索引，80ms 后启动后台扫描，却同步返回 `complete:false`。activation ready 无法覆盖后续每个新版本。`present` 的永久 scan-limit/entry-limit/contextUnknown/fragment-limit 同样可能 incomplete，因此不能对所有 incomplete 盲目重试。

建议新增 `DocumentPresentationResult.pending?: true`：只允许 literal true，且必须 `complete:false`；缺省保持原语义。它表示当前同版本后台准备可能改善结果，不表示已成功、延长执行限额或允许混合版本。后台停止/失败/永久 partialReason 不得继续标记 pending。可含已验证的部分 fragments，但导出必须在同 request 上等待终态后再决定使用/降级。

必须同步 `packages/core/src/document-presentation.ts` 类型、严格 whitelist/copy/aggregate 和 SDK d.ts。当前 `copyDocumentPresentationResult` 只允许 fragments/complete，并重新创建对象，会拒绝或丢失未经同步的新字段。runtime 与 isolation-module-host 以及 desktop service 都复用该 validator。`document-render-wire.ts` 校验结果 envelope，value 为 unknown；不必为字段增加改协议号，但须用实际隔离往返测试证明保留。合并结果不能漏掉 pending；只要任一结果 pending，聚合 complete 必须 false。

宿主只对 explicit pending 在原 absolute preparation deadline 内有界等待/重试；每次 native/Worker owner 的 2 秒执行限制不变。重试保留整个 request identity、document/version、source/range/context/theme/target/width，取消和 renderer revoke 立即停止；不复用旧版本后台索引，不续期 10 秒预算。普通 incomplete 一次终止。应有最小间隔、最大尝试次数，并对终态/超时仅记录最终警告，避免第一次 pending 提前形成永久 fallback warning。

现 `document-broker.ts` 的 invalidatePresentation 已验证 owner renderer、document/version，并按 250ms 合并；但 desktop manager 回调丢弃 request identity，main 只清 context cache 并刷新 screen，没有 export 订阅机制。最低实现可用仅 pending 的有界重试；若复用 invalidation 做唤醒，需内部增量 generation，先订阅再 render，比较水位避免 scan 在订阅前完成导致丢 wake-up；waiter 需 keyed owner/renderer/doc/version、可撤销且有数量上限。invalidation 只表示“重新取结果”，不能直接视为 ready。它的 promise 是宿主收到刷新，不是渲染完成。

旧插件省略 pending 在新宿主保持原行为；新插件若向旧严格宿主发送 pending 会被拒绝，所以 emitting 插件的 engines.pluginSdk 必须提高下限至新版本，不能把“新增可选字段”误称为新插件对旧宿主自动兼容。应覆盖 false/string/unknown keys/complete:true 拒绝、aggregate 保留、旧 payload 精确不变、真实 Worker/Sidecar/DOM 往返，以及取消/版本变化/永久 incomplete/到期/晚结果。
