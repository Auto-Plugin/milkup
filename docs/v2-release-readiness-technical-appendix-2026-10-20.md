# 发布就绪技术附录（2026-10-20）

用户总览见[发布就绪总览](./v2-release-readiness-summary-2026-10-20.md)。只读核对时间为 2026-10-20 08:17 UTC 起；远端分支和 GitHub artifact 状态是该时点快照，不保证未来不变。核对文件在[审计目录](./evidence/v2-release-readiness-20261020/README.md)。本报告分支从 `31e05d2cd7f5f53a027c32309a7e451488339a41` 建立，仅新增文档/审计数据。

## A. 分支与精确提交

以下为实际 `git ls-remote --heads origin` 结果。表中“检查点”表示有对应范围的验收，不表示全部产品目标已完成。P1–P8、视觉与插件系统、Windows delivery/backends 都是 cf7 的祖先；无需再次把这些历史分支分别合并。`main`/`v2`/`quality` 没有被本轮更新。

| 远端分支                                           | 精确 HEAD                                  | 分类                                           |
| -------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `dot/milkup-v2-quality`                            | `566babb93fde847251a9f3f458d77c6603bf8ba4` | 旧质量基线；未整合后续视觉/产品阶段            |
| `dot/milkup-v2-visual-fixes`                       | `92f0dfd8befe0efc78fbb3e5e9f1823647a0d9a5` | 七项视觉/任务修复检查点；已在当前代码祖先链    |
| `dot/milkup-v2-plugin-system`                      | `91fbef6bc1f79e5d3ed17aa794c26a695f670cf7` | 独立插件系统检查点；已在当前代码祖先链         |
| `dot/milkup-v2-windows-delivery`                   | `0f2ccc754c138b925d0db7c925f2b1d741200fc1` | 旧标准 Windows 包与预装检查点                  |
| `dot/milkup-v2-product-completion-phase1`          | `35e03e3df37ce0bab083242b75c5214b2ac615f9` | 独立更新插件/P1 与离线交付偏差审计             |
| `dot/milkup-v2-product-phase2-workspace`           | `ffe07fe61fd28ea575f2a26dda0275c4f2d7216b` | 工作区检查点                                   |
| `dot/milkup-v2-product-phase3-preferences`         | `516577020a275fb1fca2ead9b0882e18b2582c09` | 设置/快捷键检查点                              |
| `dot/milkup-v2-product-phase4-editing-resources`   | `2184526ddfaeef6ae1e80008f0ee90e41be9fdec` | 格式/图片资源检查点，范围未全闭合              |
| `dot/milkup-v2-product-phase4-markdown-extensions` | `d3851430fac0dc85c758187b33b769c5daba7f4a` | Markdown 扩展检查点                            |
| `dot/milkup-v2-product-phase4-mermaid-engine`      | `626279df40e879cbaf9e5af2c04711351b2347c4` | 独立 Mermaid/DOM 检查点，平台及历史边界保留    |
| `dot/milkup-v2-product-phase5-export-print`        | `1388f646703ba19c4ed501b0450d123e70388f9a` | P5 输出检查点，不能当作全部质量通过            |
| `dot/milkup-v2-product-phase6-plugin-lifecycle`    | `fa530b399a5ebbd020f9bfa7ca039378604c8282` | P6 native catalog 与 Windows NTFS 检查点       |
| `dot/milkup-v2-product-phase7-quality`             | `a4d44e680478d7894450f30f3d533dc1c3131974` | 已接收大纲 1.3.3；密集折叠预算仍失败           |
| `dot/milkup-v2-product-phase8-readiness`           | `3747004b15e1dcf9c92b794b1f818c0853b98d11` | P8 编译/版本/更新取消与启动失败修复            |
| `dot/milkup-v2-windows-backends`                   | `5b62eb75615170f8a9cd8eede5fa42f275850ca7` | W1 HTML 产品代码 + W0 失败证据；DOM/PDF 未启用 |
| `dot/milkup-v2-update-checkpoint`                  | `cf7d407dbb9416232d4f2163e8cebf9d49798c57` | 当前受测产品代码基点；实际代码 b2f0efaf        |
| `dot/milkup-v2-p5-webkit-checkpoint`               | `c3d905624f638e841a57049eef27764f2427c445` | 纯报告/证据，产品树等于 cf7                    |
| `dot/milkup-v2-p7-input-search-checkpoint`         | `67cab4650973e4fba3fd26950b6b68ae5d09dc11` | 报告/测试/证据，产品树等于 cf7                 |
| `dot/milkup-v2-search-attribution`                 | `31e05d2cd7f5f53a027c32309a7e451488339a41` | 报告/回归/诊断证据，产品树等于 cf7；无性能修复 |
| `dot/milkup-v2-p7-fold-tail`                       | `b85e6a456699ecf515ec547a3b50aae2ca3e79fe` | 必须隔离：未接收 outline 1.3.4 候选及证据      |
| `dot/milkup-v2-p7-tail-attribution`                | `bdccecee406bd76c1bd26761cba82fac865c66b7` | 必须隔离：自身仅补证据，但继承未接收 1.3.4     |
| `main`                                             | `513eb48c4490b6d015a45d93d4315daf64c32650` | 未合并本轮 v2 线；不作为当前受测代码           |
| `v2`                                               | `f713d91d311ff22e7b19a01b3b94938b714ba375` | 仍为旧 f713d91d；不作为当前受测代码            |

### 当前代码与证据的绑定

- 更新功能代码：`b2f0efaf6f1689cd709c49985e616c0c6a15957e`。`cf7d407dbb9416232d4f2163e8cebf9d49798c57` 只增加报告/证据，在 apps/packages/plugins/vendor/release、根清单与锁文件范围无差异。
- Windows HTML 代码：`5a32efdb0de21adb783c8d806cf48c49450a19a8`。后续 `5b62eb75615170f8a9cd8eede5fa42f275850ca7` 的 W0 探针/报告未改变产品树；该代码已是 b2 的祖先。
- Windows P8 完整编译修复代码：`10af790217307b44f95c62aa6e9d7bf61f259942`，后续包含在当前代码中；完整 Windows catalog 代码由 `d6a740fdb15075aa479874864d37078c0fca6859` 检查点及 `fa530b39` 报告保留。
- `c3d90562`、`67cab465`、`31e05d2c` 与 cf7 在产品实现上相同。最后一个仅在 apps 范围增加 `large-document-search.test.ts` 测试；原生 harness、报告和证据另列。产品树一致不等于新构建二进制逐字节一致，也不意味着重新跑过全部平台矩阵。
- 当前 Linux 基线 ELF：23,255,880 字节，SHA256 `f320d5dd7baf43996ef25c39fa239d041ce4d3704e874463bf04a7dca2f0aab7`。67 的当前首次输出/长文闭环使用它；31 的诊断 ELF `c8f11431358c3e829fa8efe323a95d15634205b2aa3fd1bc1250b8544e53169b` 只是实验构建，诊断产品改动已撤回，不作为默认交付件。

### 必须隔离的候选

`8f1645cd72522c10de6714b9918d6f0dc5baee38` 在 cf7 上修改大纲稀疏读取，版本为 1.3.4；b85 为其证据检查点，bdcc 继承相同产品代码。相对 cf7 的非测试变更为 `plugins/outline/{README.md,package.json,plugin.json,src/outline-index.ts}`。本轮核对它们不在 cf7/31 的祖先链，当前暂存包仍只有 1.3.3。

候选确定性等待轮数从 8 降至 ≤5、RPC 有减少，不能替代端到端预算。十轮观察中基线 25/500、候选 64/500 暖态样本超限；有时段依赖，不能直接断言环境根因，也未排除候选影响。原生主测候选折叠 p95 199/223/307 ms，第三轮失败。见[候选报告](https://github.com/Auto-Plugin/milkup/blob/b85e6a456699ecf515ec547a3b50aae2ca3e79fe/docs/v2-product-phase7-fold-tail-2026-10-20.md)和[有界归因](https://github.com/Auto-Plugin/milkup/blob/bdccecee406bd76c1bd26761cba82fac865c66b7/docs/v2-product-phase7-tail-attribution-2026-10-20.md)。bdcc 自身是证据提交，但整条分支不能归类为可直接整合的纯证据。

## B. 平台、更新链和插件的一致性

| 对象              | 已有真实证据                                                                                                                                                                        | 不能外推的范围                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 最新 Windows 代码 | [run 39373808628](https://github.com/Auto-Plugin/milkup/actions/runs/39373808628)，b2，15/15 阶段；2565 Vitest+4 Node、Rust 185/0/3 ignored、另 2 项安装启动失败回归；生产 exe 链接 | 无安装器、未上传 exe、无安装后 GUI/IME/升级验收；ignored 不计通过                            |
| Windows HTML      | [W05 / attempt 2](https://github.com/Auto-Plugin/milkup/actions/runs/39362396405/attempts/2)，5a32，174/0/3 ignored、22 项新增 OS 回归及完整链接                                    | 同 run attempt 1 的 outline 时序失败保留。COM 配置/NTFS/Job/选择器协议测试不等于实际用户点击 |
| Windows catalog   | P6 真实 NTFS 36 单元+3 进程测试；本地盘符、句柄固定、原子替换、锁/CAS、迁移/恢复                                                                                                    | 不支持 UNC/非 NTFS；不承诺任意断电目录元数据持久性；Worker/UI/安装应用完整集成未验           |
| Linux 功能        | 视觉七项、Source/Live/窗口化保存/恢复/Unicode 历史、公开插件安装/启停/撤销、全停用编辑及多个输出闭环                                                                                | 每项绑定其报告候选；不能把早期矩阵写成所有后续候选都完整重跑，也不能替代 Windows/macOS       |
| 更新链            | 签名 payload 后解析 product/channel/SemVer/平台 URL/包签名，清单 256 KiB、包 256 MiB、拒绝重定向、取消/迟到防护；Windows ShellExecuteW 失败不 cleanup/exit                          | 仅合成签名/不可执行包向量及 OS 拒绝路径；正式渠道、公钥、真实安装器内版本和成功升级未验      |

当前两个关键 Windows run 的 API 均为 success，且 artifact 数为 **0**。b2 的生产 exe SHA256 为 `ca8ed97c15c40877ce2a907fb6f47c3e098b85bbbcf7526ef5e17f4f1a810dc2`；这只是 runner 内链接证明，不存在本轮可下载的相应 exe/安装器。

应用为 `2.0.0-beta.1`，公开 SDK 为 `0.3.7`。`release/update-channel.json` 是 `channel=beta, endpoints=[], publicKey=null`。插件不能设置信任根或下载 URL；当前没有真实在线发行渠道。

当前源码有 **12** 份插件 manifest，`release/bundled-plugins.json` 与已有冻结构建的暂存目录为 **11** 包。只读核对 ID/版本一致，并不重新构建或安装：

| 插件                                                                                    | 版本     | 分发/平台边界                                                                               |
| --------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| outline                                                                                 | 1.3.3    | 已接收 Worker；不混入 1.3.4                                                                 |
| footnotes                                                                               | 1.0.1    | 首次 pending 准备修复已包含                                                                 |
| diagrams                                                                                | 1.1.1    | DOM；冻结 SDK 0.3.4 输入；Windows/macOS 无已启用 DOM 后端                                   |
| updates / workspace / preferences / shortcuts / formatting / images / math / management | 各 1.0.0 | 8 个 Worker，加上 outline/footnotes 共 10 个；版本相同不保证与历史档案字节相同              |
| export-print                                                                            | 1.0.0    | 独立源码/包，**不在 11 包预装清单**，需单独安装及批准输出能力；不把预装构建当作它的交付验证 |

十个预装 Worker 的已有 Windows 独立构建仍标为 legacy/non-frozen；diagrams 是审查过的冻结闭包，不能把 11 个都称为冻结。已安装包升级的 native catalog、审批指纹与不可变 generation 已实现；不能沿用 P6 milestone01“仍逐文件覆盖”的旧结论。sidecar 的受限激活则仍明确 unsupported。完整依据见[P6 native catalog](./v2-product-phase6-native-catalog-2026-10-19.md)、[Windows catalog](./v2-product-phase6-windows-catalog-2026-10-19.md)及[更新检查点](./v2-product-phase8-update-checkpoint-2026-10-20.md)。

## C. 三份现有 Windows 安装包

本次只查询元数据，不重新下载或执行安装器。下面大小/文件 SHA 来自原有下载核验和 manifest；API 状态单独列出，不将 404 的具体原因推断为人工删除。旧包源码均为当前代码的历史祖先，均未包含 Windows W1 HTML、当前 native catalog、outline 1.3.3、脚注 pending 或 b2 签名清单修复。

| 包             | 精确打包源码 / 内容                                                                                                      | 文件字节与 SHA256                                                               | 本次可用性核对                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 最早质量试用包 | `8909f2fa9c1615e7e9e9b525d3f135be1446b892`；配置/安装器 0.1.0；尚无后续七项视觉和独立插件系统修复                        | 2,263,872；`5edaa1e9b7e74421876653f9381f22d345c8322b0e9816501ae0c42d60a375ec`   | artifact `11876145389` 元数据成功，expired=false，2026-10-21 07:04:13 UTC 到期；这是历史试用件，不是当前发行候选                 |
| 标准小包       | `a55a9ce85cb967153db983f7f4318b39a98f1977`；0.1.0、默认联网 Runtime bootstrapper、outline 1.2.0；包含视觉/插件系统检查点 | 2,280,435；`6a8ac86b48b5c4801105ef4ce9fbad23d8c329c04ea31d528d87ab29f4d74b5c`   | artifact `11942341220` 当前 404；历史到期 2026-10-16 01:43:32 UTC。原报告有 Library 回执，本轮未读取/下载验证 Library 当前可用性 |
| 离线审计保留包 | `24bc2c40adea48924161dc137526f1f729803f6c`；2.0.0-beta.1、offline Evergreen、outline 1.3.1 + updates 1.0.0；仅早期 P1    | 220,293,486；`2c653c06ae0c283cd1db8d91c07cf6b35c3ec0d078c8c96adbc4efc8c18fbc84` | artifact `11948532962` 当前 404；历史到期 2026-10-16 04:34:13 UTC；执行范围偏差必须保留，不作为新交付授权                        |

最早两份包的历史根 `package.json` 仍是 0.0.0，Tauri/实际安装器为 0.1.0；版本统一是在后续 P1 实现，不能把旧根版本误称为已交付安装器版本。三个包均未签名，最终交付件均没有当前用户机器安装/启动/编辑/升级完整验收；更早其它 SHA 的 CI 安装成功或启动失败不替代它们。

依据：[最早包](./windows-v2-test-package-verification-2026-10-14.md)、[标准包与 Library 历史回执](./v2-windows-standard-delivery-2026-10-15.md)、[离线执行偏差审计](./v2-product-phase1-plugin-correction-2026-10-15.md)。三项 request JSON 全为 `enabled=false, uploadConsumed=true`。历史弹题批准回复与布尔门禁不能覆盖后续明确禁止本轮新构建/上传的指令，不得重启请求、重跑上传或据此生成新包。

## D. 阻塞分类与精确边界

### P5：实现缺陷、构建资源缺口和未测试项分开

1. **已知引擎输出失败：** 当前 WebKitGTK 2.52.6/Skia m145 的 PDF 中 `中文搜索` 被提取为含 U+2F42 的文本、`office` 变连字、分解重音被组合；原码点搜索失败。两份最小 PDF 共 3 页均没有链接注释/目标。不是本例 HTML href/ID 缺失，也不能靠归一化文字计为通过。见[c3 定点证据](https://github.com/Auto-Plugin/milkup/blob/c3d905624f638e841a57049eef27764f2427c445/docs/v2-product-phase5-webkit-checkpoint-2026-10-20.md)。
2. **仍开放的布局/执行失败：** 长代码/表格等标题与首内容孤行，Letter 警告独占尾页；历史 Print04 diagrams dispatch 约 2000.31 ms 触及原 2 秒硬截止并降级。P4 的 `render_1037` 和早期单次图表启用失败有独立历史边界，不能与 Print04 混为一个已证明根因。
3. **已经修复，禁止重新列缺陷：** `633a6d7910f9fa44b9fa89628967e6b7105071ec` 的 footnotes pending/有界准备已包含在 cf7。67 使用当前基线复证首次 HTML 和 A4/Print-to-File；HTML 字节与 P6 相同，14 页 PDF 像素与已审 P6 产物相同。脚注编号/返回引用可见和 HTML 双向锚点通过，不等于 PDF 中存在可点击链接。见[67 时间线更正](./v2-p7-input-search-checkpoint-2026-10-20.md)。
4. **缺环境/未授权部署方向：** 当前容器只有运行库，没有匹配 WebKit 源码/生成头/构建树和完整 C++ 构建工具；不能把应用 Rust 编译器当成引擎编译环境。用户已选择保留依赖、走 WebKit 补丁；没有私有 Runtime 替换、新 Chromium 运行依赖或系统库改写授权。需要现有版本的匹配构建资源及正常上游/发行版维护路线。
5. **仅未验或后端缺失：** 物理打印机未验；Windows PDF/打印后端未接入，macOS 输出未实现；实际目标平台选择器/辅助技术/最终安装应用不能由 Linux Print-to-File 代替。历史工具容量/审批服务故障是当时的执行阻塞，不重新列为当前产品缺陷。

### P7：预算失败与平台覆盖缺口

- 已接收 1.3.3 的完整索引、取消、导航和滚动改善成立；密集折叠 p95 256 ms 仍超 250 ms，历史个体长尾保留。未接受 1.3.4 的证据不能关闭此门槛。
- 67 原六轮 10 MiB：Source 首次查询 519/500/512 ms，Live 514/921/573 ms，5/6 超 500 ms。输入/删除分组 p95 达标，仍保留个体删除 210 ms、导航超限等原样本；没有“所有输入都小于 200 ms”的结论。
- 31 的限定诊断为 491/595 ms；首 Unicode 回退分片往返 Live 143 ms、native 内 2.50 ms，其余尚不能拆成锁/序列化/调度。没有解释此前 921 ms 长尾。诊断代码已撤回，不再无假设实验。见[归因报告](./v2-search-attribution-2026-10-20.md)。
- 真实系统 IME、候选框提交/取消、连续中英、读屏以及目标系统 DPI 均未在当前候选关闭。合成 composition、XTest 和剪贴板 Unicode 不是 IME。仓库 7 月旧 Windows IME 报告不等于本轮二进制/新版插件验收。
- M01 候选03有 Linux 64 组合/332 检查；M02 候选04没有重跑完整矩阵，后续性能检查只用局部窗口/主题。原生内容 zoom 不等于系统 DPI，完整 Windows/macOS GUI 仍未验。

### Windows 与 R04–R09

W0 D03 的受限原生 helper 重复 UDP 和 Runtime TURN 在三个地址有 24 个 canary 收据，正对照有效；反例可在该 helper 启动 Runtime 前出现，不能只归因 WebView2 broker，也不能声称通用 Windows 漏洞。当前代码保持 DOM/PDF 关闭。完整 DNS/文件选择器/全部短命后代边界仍未关闭。详见[W0](./v2-windows-w0-udp-diagnosis-2026-10-20.md)。

WFP 只是评估过的候选，普通用户默认缺 ADD 权限，特权安装/服务/规则生命周期会改变分发与信任边界；当前没有被验证可直接接入的小修，也没有修改策略授权。[评估结论](./v2-windows-wfp-deployment-assessment-2026-10-20.md)是不把它作为轻量普通用户首版的默认方案。

R02 的标准联网 bootstrapper 在缺/旧/新 Runtime、离线网络和普通用户权限下没有当前候选的安装矩阵；历史离线包不能关闭它，离线分发按已更正指令推迟至正式整合时另行决定。R03 仍保持 beta，不能仅改为 2.0.0 就关闭产品门槛。

R05 已认证的是签名发布者声明与包签名/下载字节的绑定；尚未独立核对安装器内部应用版本，没有持久化最高已见版本/冻结检测。R07 自动应用回滚未实现，文档恢复和插件 previous generation 均不能替代它。R06 的 Windows 缺失目标拒绝路径通过，OS 接受 ShellExecuteW 不等于安装成功。R04 正式 endpoint/key 和签名构建资源未配置；R08 最新候选安装/升级/卸载/关联未验；R09 当前只授权本次报告工作，不授权合并、发包或 Release。

## E. 最短依赖顺序及可执行性

| 工作               | 当前 Linux 环境可做的部分                                            | 外部资源/用户动作；不能提前承诺的结果                                                                                              |
| ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 代码与包来源核对   | 本报告已完成，现有六份关键证据 archive 哈希一致；不需重新构建        | 确认后续只以受测产品线为基础，1.3.4 继续隔离                                                                                       |
| R05/R07 工程       | 后续另行任务可设计安装器内版本门禁、健康确认与回滚合同并写确定性单测 | 真实 Windows 安装器、旧/同/新 beta 版本及升级中断实测；正式签名/渠道负责人，不在聊天中传私钥                                       |
| P5 引擎修复        | 可整理现有失败/源码归因；当前不能编译或验证引擎补丁                  | 提供匹配现有版本的可用 WebKit 构建机/完整工具链与足够磁盘内存；依赖与分发约束仍须遵守                                              |
| Windows DOM/PDF    | 可保留关闭状态、评审设计；不能从当前 W0 结果直接实现宣称安全的后端   | 明确普通用户、无新增特权/运行时的约束；若考虑特权方案须另行评审授权，但尚无验证保证                                                |
| P7 预算            | 保留完整分布和有界归因，当前没有可信最小修复假设                     | 只有取得明确慢调用证据后再提出限定实现与同协议验证，不重复实验直到偶然变绿                                                         |
| GUI/IME/读屏/DPI   | 当前 Linux 可做源码和已有自动化维护，不能冒充目标平台                | 普通用户 Windows 交互桌面、固定 Runtime、真实 IME/读屏、系统 DPI；macOS 需对应设备，物理打印需打印机                               |
| 最终安装/升级/发行 | 当前只可准备可审查的版本/包/检查清单                                 | 先完成代码/平台门槛或明确获准的试用范围，再批准具体 SHA、版本、构建、上传预算、签名/渠道、安装与发布动作；旧 consumed 请求不可复用 |

所有资源缺口、未授权动作、未实现能力和已知失败分别保留。获得签名或构建预算不能自动关闭代码缺陷；获得 Windows 桌面也不能代替尚未实现的 DOM/PDF 后端。本轮没有产生新的安装器、插件包或运行时。
