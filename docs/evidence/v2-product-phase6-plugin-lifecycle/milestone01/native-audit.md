# P6 插件生命周期：package / registry / runtime / isolation / desktop 原生衔接审计

- 审计基线：`1388f646703ba19c4ed501b0450d123e70388f9a`，分支 `dot/milkup-v2-product-phase6-plugin-lifecycle`。
- 方法：只读源码和现有测试；没有运行 UI、Cargo、测试或恶意插件，没有修改产品。下面的失败轨迹是可由代码直接推导的回归设计，不冒充本轮运行结果。
- 范围：`packages/plugin/src/{package,manifest,registry,runtime,isolation*,worker-supervisor}.ts`，desktop manager/生产安装桥接、native 包文件写入与 sidecar 终止边界。DOM 既有专用限制作边界核对，未重新进行平台验收。
- 对照：`docs/v2-product-completion-plan.md:18,34`；历史 `docs/v2-product-completion-plan-history-2026-10-15.md:58` 原 P7 明确要求「宿主负责包验证、权限差异审批、隔离、事务替换/回退」，验收包括「不兼容拒绝、权限增加须重新确认、失败回退与设置保留、损坏包和恶意 RPC；禁用管理扩展后最小管理安全壳仍可启停卸载并恢复故障插件」。当前实现具备启停/审批/若干隔离机制，但不能据此判定这些管理验收已完成。

所有源码路径均相对于 `/workspace/milkup`。

## 优先发现

### N1 — 升级写入非事务；不兼容和损坏后半包能够先破坏旧安装（高）

证据：

- `apps/desktop/src/desktop-plugin-manager.ts:487` 先解析 archive，随后 `await manifestHost.installPackage(archive)`，之后才调用 `registry.installLocalPlugin` 进行应用/SDK 兼容检查。
- `apps/desktop/src/main.ts:3847` 逐文件 decode + invoke，最后单独写 `plugin.json`。无预先完整解码、stage、替换提交、旧版本保留或失败回退。
- `apps/desktop/src-tauri/src/lib.rs:445` 逐文件直接 `fs::write` 当前 `plugins/<id>/package`；可截断覆盖现有文件。没有目录事务，包中新版本不再包含的旧文件也不会删除。
- `packages/plugin/src/package.ts:25,136` 验证结构和 encoding 名称，但不验证 base64 内容；生产 `atob` 在循环中才执行。包内 `a` 与 `a/b` 的文件/目录冲突也未预检。
- `desktop-plugin-manager.ts:665` reload 先卸载、markDisabled，然后重新安装；失败没有恢复旧 package、manifest、enabled instance。

具体回归：旧 v1 可工作且有设置；v2 第一个文件覆盖 `dist/plugin.js`，第二个文件非法 base64（或写入故障）。安装报错但 v1 bytes 已变。另 v2 声明不兼容 SDK，仍先覆盖文件，然后 registry 变 failed。重新启动也无法靠旧 registry 恢复旧 bytes。该问题不是“错误包成功启用”，而是**拒绝过晚且破坏原有可用安装**。

建议最小验收：全部结构/预算/base64/兼容验证在写入前；私有 stage 写完且校验后统一提交；保存可恢复的旧 package 和 registry 状态；任何写入/激活/持久化失败恢复可解释终态；设置/data 与 package 分离保留。需要故障注入覆盖每文件写入、manifest 写入、提交、activation、registry persistence；正常升级需确认旧多余文件不残留。

已有测试只覆盖局部：`package.test.ts:49,63` 缺入口/遍历/encoding；`desktop-plugin-manager.test.ts:299` 无效 JSON 不伤 registry；`:22` 不兼容不执行 module。它们未覆盖生产逐文件写入与失败回退。

### N2 — 权限审批只绑定权限名和 host；网络范围扩大继承旧审批（高）

证据：

- `packages/plugin/src/registry.ts:65` `PluginApprovalState` 只有 permissions/hosts；`:209` 更新保留旧权限与新权限交集。
- `desktop-plugin-manager.ts:1310` `assertApproved` 只检查敏感 permission 名及 host，不比较 `networkOrigins`、版本或批准时的能力范围。
- `desktop-plugin-manager.ts:1240` 每次新 activation 用**新** `manifest.networkOrigins` 构造网络 broker，只要旧 `network:access` approval 仍存在。
- manager 卡片 `:1873` 展示权限/审批，没有旧→新来源范围差异。

具体回归：v1 获批 `network:access` + origin A；更新为相同权限名 + A/B；reload/enable 不再请求审批，B 随新 broker 自动获准。普通新增敏感权限则会被 `assertApproved` 阻止；host worker→DOM/sidecar 也有显式审批。因此这是**scope-delta 缺口**，不能概括为“所有权限检查都没有”。

还需明确产品语义：`document:read/write` 等现有普通权限靠启用授权，新增这类权限时是否必须展示差异；历史 P7 的“权限增加须重新确认”比当前敏感权限集合更宽。更新安装没有统一差异确认，不能默认为已满足条款。

建议测试：A→A+B 重新确认，A+B→A 不多授权；新敏感 permission、host 变更、批准后安装另一版本的 race；拒绝更新保留旧实例/设置。现有 `registry-dom.test.ts:21` 证明 host 变更不继承批准；`desktop-plugin-manager.test.ts:415,463,519` 证明首次敏感能力/sidecar 审批与撤销，但不是权限升级测试。

### N3 — install / approve 不经过生命周期串行化，registry 可与正在运行的实例不一致（高）

证据：`desktop-plugin-manager.ts:487,697` 与 `:1338`。enable/disable/reload/remove/revoke 进入 per-plugin 队列，`installManifestPath` 和同步 `approve` 没有。`registry.ts:191` 相同 host 且兼容时直接沿用 existing.enabled，即使 manifest/version/权限已变；此时 runtime 仍是旧 module/旧 actions/旧 brokers。

具体回归：已运行 v1，安装同 ID v2；UI registry 展示 v2 enabled，实际 commands 仍来自 v1。v2 删除 file 权限后，旧实例原有 file RPC 也未因这次安装撤销。并发 install 与 disable/remove 可以在文件、registry 与实例上交错。`approve` 对运行中的记录直接设 disabled，也不执行 runtime 卸载（正常卡片可能不显示这个按钮，但管理 API 本身未维持一致性）。

reload 另有身份边界：它重新读取 record.sourcePath，但未断言新 manifest.id 等于原 pluginId；与 `PluginRuntime.reloadPlugin` 的显式 ID mismatch 拒绝不同。原来源文件若被换为另一 ID，会卸载 A 并安装/可能启用 B，结果未必符合“更新 A”。

建议：解析候选后按稳定 pluginId 串行事务，更新/批准/撤销共享统一状态机；提交前校验来源身份；新权限未经确认不发布 enabled 状态。保留 activation epoch 旧回调防护。现有 DOM `:210,248` 和 manager `:627,680` 测试证明 enable/disable/timeout 的串行及旧回调忽略，未覆盖 install/approve 并发。

### N4 — 删除失败及 cleanup 异常缺少一致失败终态（中高）

- `desktop-plugin-manager.ts:684` 在 native 删除前先 `registry.remove`，仅成功后 clearPluginStorage/persist。native 删除失败时：内存记录已消失，旧持久化记录仍在，UI 难以重试；若旧记录 enabled 且磁盘包仍完整，下次启动可恢复运行。应测试删除拒绝/部分删除/registry 持久化失败，保留可重试的 disabled/error 记录，而不是提前移除。
- native `lib.rs:471` 删除整个 plugin 根目录，包含 package/data/storage。当前是硬删除语义，无保留设置选项；不等于升级设置保留已经验收。需要产品明确卸载保留/删除数据选项或解释。
- `unloadRuntimePlugin` (`desktop-plugin-manager.ts:1385`) 顺序 await 服务 dispose。仅 settings dispose 有 catch；其他 service dispose 或 loaded module dispose 抛错会跳过后续清理/registry markDisabled。
- 特别是 `storage-broker.ts:146` 用 `Promise.all` 关闭临时 store，拒绝会传播；manager `:1430` 后面的 document cancel / prepared lease release 会被跳过。`outputServices.dispose` 在更早位置，公共注入合同允许 reject。生产 output dispose 会等待 native abort，不能用粗暴 timeout 宣称已取消提交，但应确保其它独立资源收尾仍运行并记录错误。
- `failDocumentRenderer` (`:1351`) 同步撤销若干 broker 是正确的；但 persist 或外部 callback 抛错会阻止后面的异步卸载排队。不要将 registry 存储故障等同于可以跳过资源释放。

建议：强制撤权与必要进程/lease 收尾用分阶段 finally/all-settled 保证，报告实际未成功的清理，不隐藏取消/提交不确定状态。现有临时存储测试 `desktop-plugin-manager.test.ts:37` 检查常规 disable/close 后旧 store 失效，测试标题虽提 close fails，其测试体没有注入 cleanup rejection；不能作为这些失败轨迹已覆盖的证据。

### N5 — 损坏 registry 恢复可留下半恢复集合，并无逐记录诊断（中高）

`parsePluginRegistrySnapshot` (`registry.ts:513`) 仅检查 version 和 records 数组，未完整验证记录、approvals、状态、根路径、重复 ID。`restore` (`:226`) 先 clear，再逐条写入。第二条畸形 record 抛错时第一条已留在内存；desktop `restore` (`:1537`) catch 只删除持久化 key，不清空半恢复 registry、不保留诊断。之后 `restoreEnabledPlugins` 可启动这个残留集合。全部记录失效时也只是删除 key，不提供恢复解释。

建议先完整解析到临时集合再 swap，或显式逐条隔离并保留失败记录；不要悄悄半恢复。验证 valid-enabled + malformed、重复 ID、错误 approvals/state/runtimeFailure、读写 storage 抛错。现有 registry restore 测试验证正常持久化和兼容重新检查，不是畸形 snapshot 恢复。bundled receipt corrupt 测试是另一个存储键，不能替代。

### N6 — 无 documentRenderers 的普通 Worker 缺少运行期 error/messageerror→失败撤权链（中高）

`desktop-plugin-manager.ts:912` 只有 documentRenderer 插件使用 supervised endpoint，其它 Worker 直接 new Worker。`isolation-worker.ts` host 监听初始化 lifecycle message 和 RPC message；没有注册 native Worker `error` / `messageerror` listener。`isolation-rpc.ts:107` 的 `onIsolationError` 来自 trusted render authority，raw Worker 没有该 authority。普通 RPC timeout (`:124`) 只 reject 单个请求，没有改变 manager 的 enabled 状态或 terminate Worker。

因此，普通 Worker 在 ready 后宿主失效/终止时，当前代码无法保证及时标为 failed 并撤销；若命令无限循环，页面仍可活着且 RPC 会报超时，但 Worker 仍可能继续耗 CPU，直到用户 disable 的有界 RPC 清理后 terminate。普通 JavaScript error 事件本身也不必然意味着浏览器已终止 Worker，需要定义 fail-closed 策略，而不是声称每次 JS throw 都是 crash。

建议为所有 Worker 接入实例绑定的 error/messageerror/termination 状态，失败同步 revoke、然后有界 teardown；对普通命令 timeout 是否销毁实例明确产品策略，不改变现有 document render 2 秒。测试 raw Worker ready 后 error/messageerror、旧实例晚错误、失败插件不阻止后续启动。已有 `isolation-worker.test.ts:189–307` 强覆盖启动失败/静默 startup/晚到 import 清理；`worker-supervisor-real.test.ts:65,81` 强覆盖 document renderer 真实死循环/页面阻塞，不等于普通 Worker 全覆盖。

### N7 — 通用包预算与 native 路径防御弱于 DOM 专用模块（中）

- archive parser 无文件数、单文件/总 decoded bytes、路径深度/长度预算；native read 插件文本为全量 read_to_string，安装 data Vec 也无限额。malformed 超大本地包可消耗内存/阻塞解析，现有 DOM snapshot budget 不保护之前的安装步骤。
- `normalizePackagePath` 会将 `/x`、`\\x` 规范化成 `x`，不是拒绝绝对输入；这本身未证明越界，但与 native 的拒绝绝对路径不一致。应选择明确、跨平台一致的允许语法；文件路径 alias、Windows reserved/path collision、控制字符也应有测试。
- native `validate_plugin_id` (`lib.rs:1259`) 只按字符集和长度判断，允许 `.` / `..`；`ensure_plugin_directories` / remove 随后 join 该 ID。正常 TS manifest 严格 ID regex 拒绝这些值，所以**不能据此声称普通包已可越界或插件可直接调用 IPC**，但 native mutation 自身缺乏正确 ID 边界。
- `install_plugin_package_file` 使用词法相对路径校验 + fs::write，不拒绝现有 symlink/祖先 symlink；预先被本地进程/获批 sidecar 改写的 package 目录可使写入跟随链接。当前包 JSON 不包含 symlink 条目，不能将其描述为单独恶意 archive 即可制造 symlink。

建议收紧通用包 budget/完全解码/路径前缀冲突/固定 manifest 文件名冲突，native ID 与 TS 规则一致、目录/文件不跟随链接；测试不改变外部 sentinel。DOM `plugin_dom.rs:428–490` 的 confined snapshot 安全读机制可参考，但不能以它替代安装写入边界。

## 已有机制与测试覆盖（静态核对，未重跑）

| 要求 | 已有机制 | 证据与限制 |
| --- | --- | --- |
| 畸形 manifest 拒绝 | IDs、已知 host/permissions、贡献数组/引用、命令权限子集、network exact origin；DOM 只读严格 profile | `manifest.test.ts:168,182,197,224,261,286,367,463`；`manifest-dom.test.ts`。不是 package 内容完整性/预算证明 |
| 包最低完整性 | format/version、files 类型、规范化重名、相对入口存在、Worker/DOM UTF8、资源存在 | `package.test.ts:11,32,49,63`；`package-dom.test.ts:28,38,41,48`。无事务/解码全量预检 |
| 不兼容不执行 | registry SDK/app semver range 与启动 restore 重新检查，manager blocking errors before load | `registry.test.ts:53,76` range 参数化；manager `:22`。安装写入仍先于 compatibility |
| 敏感能力/host 审批 | enable assertApproved；brokers 只向批准实例提供；revoke unload | manager `:415,463,519`；registry DOM `:21,41`。无 scope delta 绑定 |
| 命令及 renderer 故障容错 | runtime ActionRegistry transactional command；renderer fallback；capability generation 与撤销 | `runtime.test.ts:117,167,321,478`；不等于执行进程总是停止 |
| 禁用释放 | action unregister、presentation abort、broker revoke、UI dispose、module/Worker terminate、prepared dispose | manager `:79`、DOM `:152,210,248`；runtime `:21`；isolation `:216`。失败 cleanup 路径缺口见 N4 |
| startup 失败 | Worker ready timer/启动错误 cleanup；enable catch failed state；普通失败后恢复其它插件的设计存在 | isolation-worker `:189–307,962`，bundled `:136,269`。异常存储/异常 cleanup 仍可能让 ready reject |
| 旧实例隔离 | activation epochs、per-plugin lifecycle queue；DOM/sidecar instance identity；旧 timeout 不污染新实例 | manager `:598,627,647,667,680`；DOM `:248`；sidecar `:18,142` |
| 预装不复活 | durable attempted receipts、已有安装不升级；敏感默认未批准 | bundled `:114,189,246,256,280`。保留这些不变量；不是完整 upgrade transaction |
| 管理安全壳 | main 固定 `[data-plugin-manager]` 区域及 trusted actions；manager 在宿主 | `main.ts:413,1519,3705`。未新运行全禁用；独立管理扩展及其故障后的安全壳交互仍需 P6 验收 |

## 不可夸大的隔离边界

1. Worker 的真实执行线程、序列化事务、broker 能力收口、监督线程 2 秒 render 截止是有价值的防护。`isolation-worker.ts:500–555` 通过替换 globals 禁用网络/动态代码/子 Worker；这是 JavaScript 层防护，不是证明任意恶意 JS 已被完整安全沙箱封住。代码仍用 import 加载入口；不能从“测试禁止 global Function”推出所有构造器/语言级 import/同源存储攻击面都被证明封堵。
2. 项目已明确这一限制：`docs/v2-plugin-system-design-2026-10-14.md:28` 称 Worker 与禁用全局 API 为执行隔离和能力收口，本轮只安装可检视本仓库包，不宣称防御任意恶意 JS。P6 不应悄悄变成不可信市场沙箱承诺。
3. Sidecar 启动是 `lib.rs:861` 的普通 `Command::new`，继承当前用户权限/环境，需显式 host 审批。`plugin_sidecar.rs:326` kill/wait 仅直接 child，没有 DOM guardian 那样的后代进程收割机制。获批 sidecar 生成后代可能在直接 child 退出后存活；因此不能声明“所有 sidecar 后代均清理”或“sidecar 被 OS 沙箱约束”。若 P6 包含恶意 sidecar 后代验收，应单独定义范围/实现与真实测试。
4. Linux DOM 专用 prepared lease/只读 snapshot、禁用桥接和独立 helper/guardian 是不同安全等级；不能把其边界外推到普通 Worker、sidecar、安装路径。Windows/macOS DOM 支持及既有 P4/P5 未结项不在本审计中变成通过。

## 建议 P6 实施/验收顺序

1. 先写 N1/N2/N3 的 RED：更新事务、不兼容不触盘、恶意后半包无损、权限 scope 差异、启停/安装并发、source ID mismatch。它们直接对应历史 P7 管理条款。
2. native 受控 stage/commit/rollback + registry 相同事务语义；保留独立 data/settings；定义崩溃恢复 journal/receipt，不靠 UI 顺序假设。持久化失败也要有可恢复终态。
3. N4/N5/N6：清理失败仍收尾、删除失败可重试、snapshot 完整验证、普通 Worker 故障撤权。先单元故障注入，再 Linux 独立真实包/进程/UI 验收。
4. N7 的预算与路径边界随安装重构一起补，避免把不可信数据验证继续分散到逐文件 native writes。
5. 基础管理安全壳仍由宿主掌握审批/事务入口；管理扩展只获得只读诊断与受控请求，不得自行批准自己/他人、直接写包目录或任意删除数据。清楚区分本仓可信插件支持与不可信第三方安全模型。

本报告没有动态通过声明；报告列出的现有测试名称/位置仅证明覆盖意图及源码断言，结果需由 root 统一运行并保存。产品文件保持未修改。
