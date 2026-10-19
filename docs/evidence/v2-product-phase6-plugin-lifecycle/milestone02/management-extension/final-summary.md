# P6 milestone02：交付用词审阅

审阅时间：2026-10-19；仅只读核对源码、既有证据与主报告/清单。没有改产品，没有运行新全测、UI 或 Cargo。此文是给 Root 的报告更新建议，不替代原生验收结果。

## 方案 A 与公开 API

当前实现方向与用户明确选择的方案 A 一致：native catalog 是安装、代次、审批和启用事实的持久权威，localStorage 只是镜像。独立管理扩展仅依赖公开 SDK 0.3.7；敏感权限 `app:plugins` 必须显式批准，不按插件 ID 特判。

公开新增只有：

- activation host 的 `management.snapshot({signal}?)`、`describe({pluginId,revision},{signal}?)`。
- trusted command host 的 `management.requestHostView({pluginId,revision,view:'details'|'settings'},{signal}?)`，一次性可信手势，只打开可信宿主页面。

没有 approve/commit/install/enable/uninstall/delete/settings-write 管理方法，没有私有文件路径、用户设置值或授权 token。candidate fingerprint 是只读解释信息，不能拿来授权。候选执行期间导航另有门禁。列表只 logo/title/description；状态/兼容/差异/错误在详情。基础安全壳独立存在，管理扩展停用/故障不应影响安全壳；真实恢复结果须引用本轮实际运行，不能仅以接口设计证明。

边界已对齐 native 的 512 项目录。显示 title/description 可以在码点边界缩短并加 `…`，每项 JSON UTF-8 预算 256/512 bytes；权限、origin、版本和兼容要求完整保留，不用缩短文字代表审批。单个详情超过 512 KiB 返回 unavailable，不能用空差异冒充成功。最多 256 origins、32 native 加 2 compatibility diagnostics。设置只提供 schema/defaults。SDK README 的 file scope 说明仅描述已有宿主 broker：sealed `plugin-root` 只读，独立 `plugin-data` 仍按批准权限读写删；未新增 `host.files` API。

## 当前主报告/清单需要更新的准确范围

当前 `docs/v2-product-phase6-plugin-lifecycle-2026-10-19.md` 仍是 milestone01。保留其历史实测结论，新增明确 milestone02 范围和新基线 `633a6d7910f9fa44b9fa89628967e6b7105071ec`，不能把旧二进制/测试计数当作 production02 验证。

1. “没有新增任意包大小配额”“安装仍逐文件覆盖，无完整事务回滚”“差异再审批尚未实现”“独立管理扩展尚未实现”“未选择实施这一迁移”已不能作为当前源码描述。新的实现包括 native 代次/catalog/CAS、受限准备/发布、候选差异、独立扩展及失败详情迁移。应分开写“实现/单测”与“真实 Linux 验收”。
2. 公开 SDK 当前为 0.3.7。旧 pending 合同来自 0.3.6，footnotes/outline 的 milestone01 独立消费身份仍为 0.3.6，不能追写成已用 0.3.7 外部重建。
3. staged 包数量现在是 11（`milestone02/bundled-staging-proof.json`），不是十包。staging 成功不是 11 个插件全部外部安装验收。
4. 清单 P6-01 更新新增工程配额实现；P6-03/04/05/06 更新 native 事务、审批、准备/发布、cleanup 与恢复的实际代码/测试状态；P6-07 更新错误详情迁移实现，但既有24单元视觉矩阵只证明 milestone01，不能自动覆盖本轮新页面；P6-08 更新独立扩展和公开闭包已完成，原生导航/停用恢复等待最终真实运行。P6-09保留大纲0.3.6独立证明，宿主0.3.7兼容回归另列。P6-10/11旧验收保留而不冒充本轮重新执行。
5. 全仓 tests/types/build、Rust tests、生产 ELF SHA 与输入指纹需由 Root 从最终 frozen production02 结果填写。旧 `2298+4` 与 ELF `58652f…`属于 milestone01。

## 不可关闭或省略的边界

- **Windows 不是仅“尚未验”。** `plugin_catalog.rs` 的安全磁盘实现为 `#[cfg(unix)]`；`#[cfg(not(unix))]` 明确返回 unsupported，未回退旧逐文件写入。因此 Windows 的新 native catalog 路径目前实现阻塞；不能声称 Windows 插件安装/管理仍获本轮等价支持。
- macOS 虽属于 Unix 编译分支，当前没有构建/运行证明，不能由 Linux 推断 macOS 已支持或已验。DOM/output 等平台边界仍需各自报告。
- **Sidecar 当前 catalog 激活也不支持，不只是候选验证未验。** native `beginTrial` 拒绝 sidecar（无法安全只读 trial），`startupBegin` 同样拒绝 sidecar catalog activation。公开 host 枚举/旧 sidecar broker 仍存在不等于本轮事务路径可启用 sidecar。
- 原生进程退出/持久 attempt 恢复测试不等于任意断电；多个 cleanup 尝试不等于 OS 子进程 fully reaped；原生 trusted-host IPC probe 不等于插件取得该权限；Worker raw API 拒绝不构成完整恶意代码沙箱证明。
- 截至本审阅，production02 `proof.json` 仅有 startedUtc、inputs、command，没有 finished/exit/binary 成功字段。现存 `p6-catalog-raw-01/completion.json` 是 passed:false，failure 为等待 fixture disable control 超时。保留失败，不能将将来的修正或脚本存在计作本轮已经通过。后续成功结果由 Root 单独追加。
- P5 PDF Unicode 精确复制/搜索、长块分页、历史 Print04 原生 2 秒超时继续开放。没有引入 Chromium、Runtime 下载、Windows 构建/验证、Library 上传或 release；物理打印和系统 DPI 未由本轮覆盖。

## 独立身份和交付哈希

| 产物 | 实际身份 | SHA-256 |
| --- | --- | --- |
| 最终公开 SDK tar | 0.3.7，`management-extension/sdk-dist-bounds/` | `58973ba8b0db0dd062be5612d4c3058e339205275ebee45f2b31395e5ec965b0` |
| 独立管理包 | management 1.0.0，0.3.7 tar，14,260 B；`external-bounds/dist/` | `800c6bc03eaa63e06dbd324caeb64eef719920be4defbb3e21d7ca8ba96844b0` |
| 独立管理 entry | public SDK bundle，0 runtime imports | `49a7e597ae70677783b4a2ffc067d48201619f1e142e755a359f763f83b5a458` |
| 独立大纲包 | outline 1.3.1，0.3.6 tar，40,695 B；milestone01/outline-external | `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712` |
| 大纲实际使用 SDK tar | 0.3.6；源 devdep0.2.0未无意义升级；manifest>=0.2.0<0.4.0 | `2043b0586c73579c06821c76a20eb0d7a852ffd7c7e8181ea555433a0c506cec` |
| 本轮 staged 管理包 | bundled-staging-proof，不是独立交付包字节 | `1c47c7f35d86aca1c9ba6400df62ecfa3eaace8454d065a75f87d3a7d773f5a5` |
| 本轮 staged 大纲包 | bundled-staging-proof，不是独立交付包字节 | `77ee29ce64aaba56f2085190f4a9da3b27e1949677d152b9795140419d8837fb` |

管理的最终 SDK tar 取代较早 `6e521e…` 文档版本；旧 tar/日志保留。两次SDK tar的运行时入口相同，管理插件产物字节没变。不要混淆独立包和 staged 包的 SHA，也不要把“同功能/同版本”写成“字节一致”。

管理独立消费：10 tests、types、offline install/frozen follow-up、无私有 imports、132 个依赖链接都在独立目录、SDK四文件与tar逐字节一致、独立重构byte-identical。大纲独立消费：24 tests、types、外部派生锁和闭包；第一次需普通开发依赖下载，后续 frozen offline 成功，不能概括为第一次零网络。二者都是 **external derived lock** 证明，不冒充源码已有 frozen profile；diagrams 则继续使用已审 SDK0.3.4冻结闭包。

最后的原生安装/导航/恢复状态应来自 frozen production02 的实际 completion、截图、package/binary SHA 与退出记录。本审阅不新增任何通过项。
