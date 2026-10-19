# P6 milestone02：原生插件目录与独立管理扩展（2026-10-19）

状态：**方案 A 的 Linux 检查点已实现；production07 管理闭环复验通过，P6 跨平台验收尚未完成。** 本轮在 `633a6d7910f9fa44b9fa89628967e6b7105071ec` 上继续，分支为 `dot/milkup-v2-product-phase6-plugin-lifecycle`。父助手依据用户继续完善 P6 的委托作出方案 A 的技术选择；这不是用户明确指定方案 A。该方案由 native catalog 持有安装与审批事实，前端 registry 是可重建镜像。此前 [milestone01 报告](v2-product-phase6-plugin-lifecycle-2026-10-19.md)保留其当时的结果；本报告更新当前实现，不回写历史验收。

实施依据为[原生目录事务合同](v2-product-phase6-native-catalog-contract.md)、[单一 wire 合同](v2-product-phase6-native-catalog-wire.md)及 [P6 清单](v2-product-phase6-plugin-lifecycle-checklist.md)。本轮证据归档至 [milestone02](evidence/v2-product-phase6-plugin-lifecycle/milestone02/README.md)，以完整索引核对复制字节；原始本地目录为 `/workspace/milkup-plugin-lifecycle-evidence/milestone02/`。下文证据路径均相对此目录。没有把旧日志、单元测试或驱动脚本存在当作新生产二进制验收。

> 后续 Windows 后端实现与真实平台验证另见 [milestone03 报告](v2-product-phase6-windows-catalog-2026-10-19.md)。本报告记录 milestone02 时点，下面的 Windows unsupported 是当时实际状态。

## 方案 A 的实现范围

**安装包与用户数据分离，catalog 是持久权威。** 包先经过 archive/manifest/兼容性和能力范围检查，再写入 native 生成的不可变 generation。catalog 保存 active、previous verified、pending、精确审批指纹、启用意图、启动尝试、tombstone 和 revision。读取实际包时验证真实字节与封存指纹；Worker 获得核验后的模块字节，DOM 与图标按 catalog generation 读取。localStorage 的丢失、损坏或写失败不能改变 native 授权事实。

Unix 实现使用描述符相对访问、no-follow、进程锁与文件锁、entry CAS、带校验的 catalog 原子替换、有效备份及文件/目录同步。工程边界为 manifest 1 MiB、单文件 32 MiB、decoded 包 64 MiB、4096 files、路径 1024 UTF-8 bytes/32 层、catalog 16 MiB/512 项；stage 预留额外 16 MiB 和两份最大 catalog 写入空间。不足时在撤旧前拒绝。GC 保留当前目录与有效备份仍引用的恢复代次；默认不删除用户 data/storage。

**候选准备、授权、提交与发布分开。** 同插件操作由 manager 串行，native 同时校验 revision、transaction ID 与 candidate fingerprint。候选能力变化必须在可信宿主详情明确批准当前候选；只读管理扩展无权批准。旧实例先撤销 epoch 并完成必要退休，再进行候选受限 activation。候选可读既有设置/data及已批准文件范围；文档/文件写、网络、输出、导航等外部副作用在提交前拒绝，即使插件捕获违规错误也不能发布。没有持久写 overlay，不能把普通缓存称为事务隔离。

通过受限验证后 native 提交 active/批准/启用事实，runtime 才发布命令与呈现贡献。提交前失败恢复旧版的新 epoch；提交后发布失败通过恢复事务处理，无 previous 的首次安装进入明确失败/停用状态。迟到 activation、RPC 和旧句柄不能复活权限。禁用与清理尝试各个独立收尾步骤；失败的精确 owner/lease 保留并可重试，未经确认不得启动替代实例。卸载先 tombstone、停用撤批，再进行可重试包清理。

**迁移不继承无法证明的旧审批。** 先备份旧 raw 字节；共享 manifest/schema 解析形成绑定精确 raw SHA 的逐行决定，native 再核对原记录、实际旧包及内容。有效旧包作为停用、未批准的待验证候选恢复；坏项隔离诊断，data/storage 保留。单一 receipt 使已提交迁移幂等；stage I/O 失败保留重试条件。该机制不是把 localStorage 重新包装成授权凭据。

## 公开 SDK 与管理体验

SDK **0.3.7** 增量加入敏感权限 `app:plugins`。activation host 只提供 `management.snapshot()` 和 `describe({pluginId,revision})`；可信命令 host 才提供 `requestHostView({pluginId,revision,view:'details'|'settings'})`。导航消费调用者绑定的一次性可信手势，并检查 revision/生命周期。它仅打开可信宿主页面，不批准能力、不安装/提交、不启停或删除数据，也不写其他插件设置。API 不返回任意原生路径、用户保存的设置值、包字节或授权 token。

独立 `management` 1.0.0 仅依赖公开 SDK。普通列表显示标题首字 logo、标题和描述；版本、兼容范围、权限/origin 差异、候选指纹、设置 schema/defaults及诊断说明在详情。候选指纹是解释信息，不是授权。可信最小管理安全壳独立于扩展；真实导航和停用扩展后的恢复验收见下表。

公开目录支持全部 512 项，响应预算 512 KiB。显示标题/描述以 JSON UTF-8 字节预算和 Unicode 码点边界缩短并加 `…`；审批相关权限、origin、版本和兼容要求不截断。256 项 origin 差异完整保留；个别详情超预算明确 unavailable，不使整个列表消失。已有宿主文件 broker 的 `plugin-root` 是封存包代次只读范围，`plugin-data` 是独立数据范围，读写删仍受审批与候选门禁约束；本轮没有新增 `host.files` SDK API。

官方 outline 1.3.1 保持原功能、版本与 `>=0.2.0 <0.4.0` 兼容声明。其 milestone01 外部构建实际使用 SDK 0.3.6，并通过24项测试及闭包检查；本轮宿主0.3.7兼容回归不能改写为大纲已用0.3.7外部重建。footnotes 保持1.0.1及>=0.3.6，diagrams 保持1.1.1和已审SDK0.3.4冻结闭包。

| 独立交付                      | 实际 SDK                                            | SHA-256                                                            |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| 最终 SDK tar                  | 0.3.7，`management-extension/sdk-dist-bounds/`      | `58973ba8b0db0dd062be5612d4c3058e339205275ebee45f2b31395e5ec965b0` |
| management 1.0.0 包，14,260 B | 0.3.7，`management-extension/external-bounds/dist/` | `800c6bc03eaa63e06dbd324caeb64eef719920be4defbb3e21d7ca8ba96844b0` |
| outline 1.3.1 包，40,695 B    | 0.3.6，milestone01/outline-external                 | `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712` |
| 大纲实际使用的 SDK tar        | 0.3.6                                               | `2043b0586c73579c06821c76a20eb0d7a852ffd7c7e8181ea555433a0c506cec` |

管理外部构建通过10项测试、类型检查、offline 安装与 frozen follow-up，SDK四个文件与tar逐字节一致，独立重构结果相同，132个依赖链接都位于外部目录，无私有源码映射或残留 runtime imports。两份插件证明均为 **external derived lock**，不能称为源插件已有冻结依赖配置。大纲第一次安装使用了普通开发依赖网络，之后 frozen offline 成功，没有下载 Runtime。

本轮 `bundled-staging-proof.json` 记录 **11 包**。staged 管理包 SHA 为 `1c47c7f35d86aca1c9ba6400df62ecfa3eaace8454d065a75f87d3a7d773f5a5`，staged 大纲为 `77ee29ce64aaba56f2085190f4a9da3b27e1949677d152b9795140419d8837fb`，与独立交付包不同；同版本不代表字节一致。staging 成功不是11包全部独立安装验收。

## 修前失败与已有检查

以下区分单元/合同测试与实际原生验收；重叠定向套件不相加为全仓总数。

| 范围                                              | 真实失败与修后证据                                                                                                                                      | 已记录结果                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native 包编码、授权状态、迁移污染                 | `native/catalog-first-red.log`、`native/catalog-state-red.log`、`native/migration-poison-red.log`；最终 `native/catalog-migration-final.log`            | 最终 catalog 24 项通过。首轮 Rust 为13通过1失败，cloud runner曾返回0，报告以 Rust 失败为准                                                            |
| Native 全套与 DOM lease                           | `native/all-tests01.log`、`native/dom-lease-green.log`                                                                                                  | 170通过、0失败、5显式 ignored；后续 DOM授权/SHA专项1通过，最终迁移24通过单列                                                                          |
| Runtime 候选发布/违规、Worker故障、迟到结果和退休 | `runtime/README.md` 所列 RED→GREEN；`runtime/targeted-frozen.log`、`runtime/file-read-final03.log`                                                      | 较早14套172通过；最终批准文件读取修正后61项通过，类型检查通过                                                                                         |
| Manager事务、退休、兼容与封存范围                 | `manager/retirement-red.log`、`manager/compatibility-red.log`、`manager/manager-final-02.log`                                                           | 最终5文件110项通过；首次发布失败另有交叉审阅RED。带夹具语法/权限错误的 sealed-red 日志不冒充安全缺陷证明                                              |
| 公开管理与512项边界                               | `management-extension/invalid-signal-red.log`、`management-extension/catalog-bounds-red.log`、`management-extension/catalog-bounds-all-green-final.log` | 最终相关20项通过；独立插件10项通过；SDK类型与既有6项runtime测试通过                                                                                   |
| 闭包与构建工具                                    | `closed-bundle/`、`closed-fixtures-final.log`、`ci-public-build-tests-final.log`                                                                        | 闭包/夹具19项，公共构建合同23项通过                                                                                                                   |
| 全仓回归                                          | `workspace-tests01.log` → `workspace-tests02.log`                                                                                                       | 首轮3项失败保留；修正候选门禁对已有Promise/撤权合同的兼容后，第二轮2406通过，第六轮 **2416项 Vitest及4项Node合同测试通过**（`workspace-tests06.log`） |
| 类型与格式                                        | `workspace-types01.log`、`repository-format-final03.log`及组件最终日志                                                                                  | 全仓类型（`workspace-types05.log`）、Prettier、Rust格式、全仓构建与production07构建通过；冻结输入无漂移                                               |

原生全套的5个 ignored 包括需真实显示/沙盒的WebKit集成、私有helper入口及明确的历史profile；它们不计为新的原生成功。此前 `p6-catalog-raw-01` 实际失败保留：base激活后，后续退休遇到远程dispose RPC与owner传输关闭竞态。定向修正已验证，不能据此自动把该失败轮改记通过。

## 生产构建与真实 Linux

**production02 不用于验收。** 其构建退出0并生成 ELF，但 `proof.json` 记录构建输入 `apps/desktop/src-tauri/src/lib.rs` 在 rustfmt 后发生 drift，`acceptance` 为 `input drift: rebuild required`。其二进制 SHA `f3e5df27da9c45430195d54cef8c5f31ed369242ba8ca94d8269398ffdbeb40d` 只用于识别被替代产物，不能作为源码冻结一致的验收依据。

最终 **production07** 构建退出0、冻结输入无漂移，ELF SHA-256 为 `b909794f6d83b5e27a92e852f4c2b81d0b5630a336ca182b85f0bea310e26f94`，见 `production07/proof.json`。production03至06的真实中间验收原件全部保留。04→05仅补拒绝候选动作；05→06仅把已知 activation 错误转为可读提示；06→07仅补可信详情持久诊断与各自回归测试。布局CSS、编辑、输出及native catalog源码相同，逐轮差异见 `production05/compared-with-production04.json`、`production06/compared-with-production05.json`、`production07/compared-with-production06.json`。11份bundled archive字节保持不变。

真实 UI 另发现以下单测未覆盖的问题；失败原件、定向 RED 和修后原生复验分别保留：

- production03 大纲挂载 UI 停用时，旧清理回调在撤权后调用只允许启用状态的 renderer，导致正常停止被汇总为失败。保留真实失败、确定性 RED 与修后57项回归；现在先撤权并清宿主 UI 追踪，由可信 owner 等待退休，真正 owner 失败仍阻止替代启动。production04 大纲完整启停/卸载复验通过。
- production04 管理验收发现“拒绝候选”有按钮与 manager 方法，却漏注册动作。真实 ActionRegistry RED 后补齐 `app:control`、精确必填 fingerprint/revision 和过期校验；拒绝只撤候选，保留旧 active/approval/enabled/epoch。宿主9个固定插件动作已逐一核对连接，production07 完整复验见下表。

- production05 的失败升级暴露结构化 runtime 错误被显示为 `[object Object]`。仅在 catalog activation 边界识别本插件的已知错误记录并转换为可读 Error，保留 cause，不改变回滚流程或全局文件错误处理；production06 原生断言已确认具体失败原因。
- production06 管理闭环暴露可信详情遗漏原生历史诊断：native 已保留两条 abort，公开扩展正确显示两条安全提示，但活动 registry 清空 errors 后详情没有渲染 entry.diagnostics。该轮按产品失败保留；可信详情合并诊断、保留重复事件并转义后，production07 完整闭环通过。

另保留两类驱动/夹具失败：ping 夹具最初未声明 UI 却调用通知，已补合法公开 modal/renderer，完整 nonce 断言保留；旧同名 profile 被新驱动保护拒绝，改用全新 profile，旧资料未覆盖。

| 原生范围                                     | 实际程序与原件                                                                                            | 结果与边界                                                                                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 原始 API / 动态代码入口                      | production05，`p6-final-raw-api-01`                                                                       | 通过；14 项封禁与动态候选拒绝、旧版恢复、Unicode 编辑保存；不是完整恶意代码沙箱                                                                                                                        |
| 失败升级 / CPU 挂起 / 迟到命令               | production05，`p6-final-{manager-rollback,manager-hang,late-command}-01`；production06 前两项复验         | 通过；同 package 的新 activation nonce，真实 CPU 循环超时后恢复，已启动的迟到命令不能再发布                                                                                                            |
| CAS / 持久 trial / startup / 镜像 / 损坏恢复 | production05，`p6-final-{catalog-cas,trial-restart,startup-restart,mirror-restart,catalog-corruption}-01` | 通过；原生持久事实、revision、目录字节与重启后权限核对；注入点重启不等于任意断电                                                                                                                       |
| 卸载失败重试 / 旧版迁移                      | production05，`p6-final-{remove-failure,legacy-migration}-01`                                             | 通过；先 tombstone、不复活、重试后无 generation、保留 Unicode 数据；自动迁移三次启动、精确 raw backup、坏项隔离及幂等                                                                                  |
| 独立大纲完整启停卸载                         | production04，`p6-m02-outline-02`                                                                         | 通过；source 贡献与真实 UI 退休，包文件清理及编辑保存；独立像素复核 `runtime/outline-retirement-green-review.md`                                                                                       |
| 管理列表布局与焦点                           | production04，`p6-m02-manager-matrix-01`                                                                  | 24 单元、176 卡片、216 焦点/裁剪/命中检查；16 张实际 PNG 复核。宽窄窗、明暗、100/125/150/200 原生 zoom；不是系统 DPI 或完整 Tab 遍历                                                                   |
| 全停用编辑                                   | production04，`p6-m02-all-off-01`、`p6-m02-all-off-windowed-01`                                           | 普通与 180060 行窗口化 source/live 的 Unicode、undo/redo、保存 SHA 通过；从未激活 pending 单独列明                                                                                                     |
| 首次冷启动 HTML                              | production04，`p6-m02-cold-output-01`                                                                     | 实际 MathML、中文 Mermaid、脚注 backlink、内嵌 PNG、104 个正文 marker 各一次；788.950 ms 接受呈现，精确 DOM guardian/helper 退出证据。仅 missing/remote 两条预期警告；独立原生与本地 HTML 像素复核通过 |
| 独立管理扩展与安全壳                         | production07，`p6-m02-management-04`                                                                      | 通过；独立包审批/只读详情、完整权限与origin差异、真实宿主导航且catalog不变、拒绝候选、失败回滚与可读错误、两条脱敏摘要→可信完整诊断、停用管理扩展后由安全壳拒绝候选并恢复旧版命令                      |

上述11个 catalog 场景在同一 production05 冻结程序全部通过，production06 的失败升级/挂起重复通过；5个布局/编辑/输出场景的实际截图属于 production04。相应源码未变以构建输入差异核对，不把旧截图改称新程序截图。自动 completion 的 `visualReview: pending` 保留原字节，后续独立评审单独记录结论。

驱动只通过出货UI、GTK picker和原生键盘进行用户操作；专门的native catalog IPC故障/CAS probe须标注为可信宿主探针，不是插件权限证明。完整的 completion、截图与产物比单一进程exit code更重要。驱动修正后应使用新run目录，保留失败产物。

## 平台与安全限制

- **Windows当前实现阻塞，而不只是未验。** 安全catalog磁盘操作仅有 `#[cfg(unix)]` 实现；`#[cfg(not(unix))]` 返回明确unsupported，不回退旧逐文件覆盖。因此不能声称本轮Windows插件安装/启停已交付；基础编辑/保存也需独立的平台验收。
- macOS属于Unix编译分支，但本轮没有构建/运行证明，不能从Linux推断已支持或已验。DOM/output等后端限制仍分别成立。
- **Sidecar catalog激活不支持。** native不仅在 `beginTrial` 拒绝无法安全只读验证的sidecar，也在 `startupBegin` 拒绝其catalog activation；旧host枚举和broker存在不代表此路径可用。DOM仅允许严格只读文档呈现profile，广泛DOM扩展不能绕过限制。
- Worker继承CSP、封闭入口检查和原始网络/持久存储/代码生成入口封禁，属于实际能力边界加强，**不是完整恶意代码沙箱**。native commit依赖可信manager完成受限activation，不是native自行运行JavaScript验证。
- cleanup尝试/拒绝重启不等于全部OS资源fully reaped；显式重启故障测试不等于任意断电。保留旧data不承诺成功数据schema迁移后的任意手工降级。未知或损坏审批不自动继承。
- P5 PDF Unicode精确复制/搜索、长块分页、历史Print04原生2秒超时继续开放。原生执行硬截止不放宽，产品仍保留现有WebKit依赖；没有改用Chromium，没有下载Runtime。物理打印、Windows/macOS输出和系统DPI未由此阶段覆盖。

本报告和更新后的清单不宣布跨平台或整个P6完成。Linux关闭范围以本表、原始completion及独立复核为准。本轮未上传Library/运行时/Windows包、未Release/部署，未合并main/v2/quality。
