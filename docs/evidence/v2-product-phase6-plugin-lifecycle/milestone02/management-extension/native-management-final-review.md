# P6 独立管理扩展原生复核：production06 / management03

当前结果：**FAIL，可信宿主详情遗漏持久诊断；不是selector/timing错误。** 本文件记录截至 `p6-m02-management-03` 的事实，不能作为最终通过证明。后续修复/新run应追加独立结果，保留03原件。

本次只读检查了 `../native-ui/runs/p6-m02-management-03/` 的 preflight、events、failure、completion、readable-activation-error，以及 `../native-ui/control/p6-m02-management-03-harness.log` 和driver日志；实际打开了 `launch-1/management-failure-diagnostics.png` 与 `failure-observation.png`。没有改产品或harness，没有启动新UI/测试。

## 身份及已到达步骤

- 正式 ELF：production06，SHA256 `c1ff46f3bffea3cea3a85b07c14ea5753faba4622e8ffaaa46d579401c42aded`。
- 独立管理包：1.0.0，SHA256 `800c6bc03eaa63e06dbd324caeb64eef719920be4defbb3e21d7ca8ba96844b0`。
- completion：passed=false；源文档SHA `1704d1855305b320d9d8f316d69a90a9c734ac8a242faf6e39ab575f87687bd6`。
- 独立包未批准状态、显式批准/启用、简洁列表、只读schema、details/settings真实导航均产生记录；导航函数在返回时核对完整catalog不变。
- 1.0.2候选权限/origin差异显示并被拒绝；1.0.3 deliberate activation failure后旧1.0.0重新启用，native pending=null。
- 可读错误notice为：`命令执行失败：Plugin activation failed: P6_MANAGEMENT_EXPECTED_FAILURE`，并保存在专门JSON与实际截图底部。不是`[object Object]`。
- **扩展禁用后的独立安全壳恢复步骤未到达。** 它位于失败断言之后；completion静态limitations中的“Disable and safety-shell recovery tested”不能覆盖passed=false或执行顺序，不能借此记为通过。

## 时间/身份排查

早期09:47:47 `trusted-details-navigation` 的确显示pending1.0.2，同时仍有先前的 `resolve existing candidate/startup first` notice。那不是最终失败状态。

最终09:47:54公开诊断、09:47:55可信导航及failure-observation均为同一正确条目：`example.catalog-lifecycle`、entry revision11、active1.0.0、pending=null、enabled=true。notice已变为上述可读activation error，页面标题也是 `Catalog lifecycle fixture`。因此不是错误条目、陈旧候选页面或导航未完成。

native精确保留两条：

```
Candidate aborted; old installation retained
Candidate aborted; old installation retained
```

公开modal精确呈现两条 `catalog-diagnostic` 与 `Plugin lifecycle needs attention. Open host details for the full diagnostic.`，且没有native raw消息或profile/output/dataRoot/storageRoot/packageRoot/sourcePath。截图能看到两条诊断及“打开宿主详情/设置”按钮；诊断行受显示样式影响有省略号，DOM保留完整guidance，不能声称截图完整显示了英文长句。

随后真实trusted command成功关闭modal、打开同一插件的可信详情，catalog和entry不变。可是可信shell全文没有上述两条持久诊断，`.plugin-detail .plugin-errors`出现次数为0。截图显示正确的已启用详情、操作和schema，确实没有原始诊断区域。下方全局“插件目录诊断”只含另一条 `Candidate failed: Error: Plugin activation failed: P6_MANAGEMENT_EXPECTED_FAILURE`，不能替代丢失的两个native entry事件。

## 源码原因与处理

源码链与证据一致：

1. `catalogEntryToRegistryRecord`起初会把native entry.diagnostics放入record.errors。
2. `DesktopPluginManager.applyCatalog`对已经published的旧版把 `errors: []`；恢复启用时 `PluginRegistry.markEnabled`也清空运行错误。这可以表示当前运行正常，但不能抹掉持久历史的详情展示。
3. 非tombstone的 `renderPluginRecord`仅渲染record.errors，不读取entry.diagnostics；只有tombstone分支直接显示native诊断。

已通知Root和manager owner。manager owner确认并负责最小产品修复：可信详情合并本地运行错误与native持久诊断，保留native重复事件次数，避免镜像副本双计，HTML escape；列表和公开脱敏投影保持原合同。正在建立相应RED/GREEN证明。

本代理未弱化精确两条原始诊断的harness要求，也未通过换宽selector把无关全局诊断算作成功。management02属于错误的public raw-message期望；management03在修正后的合同上暴露真实可信详情缺失，两次失败不能混为同一个harness问题。

后续应由Root在修复后的冻结二进制重跑：公开两条generic +privacy → 可信两条raw +catalog不变 → 停用独立扩展 → 原生安全壳拒绝候选并恢复原fixture。最终完整结论仍待这条链通过。本结果仅Linux原生；没有跨平台、完整sandbox或任意进程崩溃恢复证明。

---

# 追加最终复核：production07 / management04（PASS）

本节于2026-10-19追加。上面的production06/management03 **FAIL**及其未到达安全壳步骤的解释完整保留，仍是该次历史结果；本节只报告新的 `../native-ui/runs/p6-m02-management-04/`，不覆盖03文件或把03改记通过。

**本次完整管理链通过，独立复核与截图一致。** `completion.json`为passed=true；production07 `proof.json`为exitCode0、postBuildInputDrift=[]、acceptance=frozen production inputs。相对于06的冻结输入，仅manager源码及其catalog测试发生变化，符合可信详情诊断修补范围。

- production07 ELF SHA256：`b909794f6d83b5e27a92e852f4c2b81d0b5630a336ca182b85f0bea310e26f94`。
- 同一独立management1.0.0包SHA256：`800c6bc03eaa63e06dbd324caeb64eef719920be4defbb3e21d7ca8ba96844b0`。
- 源文档最终SHA256：`1704d1855305b320d9d8f316d69a90a9c734ac8a242faf6e39ab575f87687bd6`，本次只读重算与completion一致。
- 实际运行事件从09:53:59未批准状态，到09:54:32独立安全壳恢复完成。原生运行由Root执行，本代理只读复核，没有改产品/harness或重跑UI。

## 逐项结果

| 场景 | 04实际证据与结论 |
| --- | --- |
| 安装与精确批准 | `management-unapproved`中management rev1、enabled=false、active=null、pending1.0.0，未自行授权。后续显式审批/验证后rev4 enabled=true，实际列表/详情可用。harness匹配可信控件当前fingerprint及revision后才执行批准。 |
| 简洁列表和只读设置 | `minimal-cards.json`与截图显示首字logo、标题、描述，没有状态/版本/权限动作混进普通条目。详情包含兼容要求、默认showHints:true及说明，无输入/select/textarea设置写控件。源码设置值没有通过公开contract泄漏。 |
| 候选权限/origin变化与拒绝 | fixture rev5 active1.0.0仍启用，同时pending1.0.2待审；公开详情准确显示新增document:read、network:access及 `https://p6-management-never-contact.invalid`。真实导航宿主后拒绝，未给候选授予新能力。该域名仅作声明，没有网络请求证明。 |
| 可读activation失败和旧版恢复 | 1.0.3故意失败后fixture rev11、active1.0.0、enabled=true、pending=null、startAttempt=null。`readable-activation-error.json`和截图底部显示 `命令执行失败：Plugin activation failed: P6_MANAGEMENT_EXPECTED_FAILURE`。 |
| 公开诊断与隐私 | `management-diagnostic-projection.json`精确两条catalog-diagnostic及完整通用导航guidance；原始native消息及六类原生路径不在公开modal。像素上长英文行使用省略号，完整guidance由DOM断言，不夸称整句在图中全部可见。 |
| 可信详情保留完整历史 | 两条 `Candidate aborted; old installation retained` 在 `.plugin-detail .plugin-errors`准确出现两次，截图红色诊断框清楚显示两行。entry仍rev11；真实导航前后整个catalog相等，诊断读取没有审批/生命周期副作用。此前03的0/2缺陷在新二进制上通过同一要求。 |
| 管理扩展停用后的安全壳恢复 | 最后management rev5、enabled=false，menu中“插件说明”入口已移除；fixture第三次候选通过独立宿主被拒绝，再禁用/重新启用，最终rev16、active1.0.0、enabled=true、pending=null。真实P6 ping回报 `P6_BASE_ALIVE:07b0ef5e16b29f58b14a0ab7e1cc5433`。截图显示宿主管理按钮仍可用、P6 ping聚焦，三条abort历史完整保留。 |

早期记录仍保留旧的 `resolve existing candidate/startup first` notice，本复核不隐藏它，也不将该notice解释为后续导航到了错误插件。最终activation错误有独立可读记录；安全壳恢复后notice已变为本次真实P6_BASE_ALIVE token。

## 实际查看的04截图

本代理通过 `view_image` 实际查看 `launch-1/` 下六张原图：

1. `management-minimal-list.png`：紧凑的独立扩展列表；首字logo与title/description较紧密，部分描述末尾省略。仅支持内容分离和可点击条目的结论，不冒称与宿主大卡片等同的视觉排版。
2. `management-readonly-details.png`：兼容、权限/网络、schema/defaults和宿主导航，原生路径未出现在modal中。
3. `management-candidate-differences.png`：待审1.0.2、fingerprint、明确新增权限和origin；内容纵向可滚动，末尾按钮不全在当前画面，不是“全部同屏”的证明。
4. `management-failure-diagnostics.png`：两条脱敏诊断及可读底部activation错误。
5. `management-trusted-full-diagnostics.png`：修复后可信详情中两条完整native诊断；此处原生路径是可信宿主详情数据，不是公开API泄漏。
6. `management-disabled-host-recovery.png`：独立扩展入口消失但宿主安全壳/fixture命令仍在，第三次拒绝后保留三条历史；P6 ping焦点可见。

04 completion静态limitations中的“Disable and safety-shell recovery tested”这次有真实末事件、catalog状态、命令notice和截图支撑。**03中的同一静态文字仍然是假阳性描述，不能因04成功而抹掉03未执行到该步骤的事实。**

## 最终边界与冻结

本次可以关闭的是上述Linux原生管理链和可信诊断展示回归。它不等于任意进程崩溃/断电恢复、完整恶意代码沙箱、物理打印、全部输入历史矩阵或Windows/macOS验收。native catalog读操作仍是可信宿主观察，不能当作插件获得原生IPC权限的证明；实际用户操作依靠出货控件、GTK picker和原生键盘。

03失败与04成功分开保留，未再修改产品或harness。**本代理最后一次交付复核已完成并冻结。**
