# beta.5 修复续接检查点

用户要求下一轮切换 Astra ultra，当前仅安全保存，不作为验收或交付。工作树 `/tmp/milkup-windows-manual-candidate`，分支 `dot/milkup-v2-beta5-feedback`；来自报告 a18c8147 / 已交付产品 0e74d9fa。此检查点暂未推送，无 beta.5 Windows CI 或新安装包。

已改：插件页按身份局部 DOM 更新、稳定 pending/active 顺序及后台通知不抢详情；Live 代码开闭围栏隐藏，保留源文/历史/映射和普通/窗口化箭头导航；Formatting 1.0.1 仅表格上下文显示、快照绑定及迟到/切文档保护、宿主空 toolbar 行隐藏；主程序批准随包 Formatting 1.0.0→1.0.1 的显式卡片升级；文档呈现按真正编辑焦点保护块内光标，失焦的折叠光标不阻止 block 预览，错误诊断不被选区过滤。

已实际复现：冻结 beta.4 Linux release `c2ec837c…b754` 在同一已打开 flowchart 文档上启用立即渲染、禁用立即还原；块内光标后到插件页启用则源码，移出光标就渲染，无重启。七个连续步骤与截图在 evidence/native-beta4-baseline。这里只确证一个问题，不代表用户所有 Mermaid 失败都由此导致。

已验证：代码呈现46测、相关Unicode/粘贴/块/解析预算87测；卡片完整16浏览器+最终4针对性、114单测；Formatting独立SDK构建51测、通用UI62测；hot-focus新增4红→4绿；全仓typecheck/build exit0。全仓test中core的100MiB虚拟搜索5000ms超时，188过/1失败后fail-fast（与typecheck/build同时运行，不能擅自归为无关）；应降并发原预算重跑，不加大超时掩盖。document-presentation套件182过/2失败：旧多行block测试未focus编辑器，与新焦点语义冲突，已补focus，尚未重跑。原失败均保留。

下一轮必须：

1. 审查当前未验完整性，再顺序跑全仓测试/格式及相关浏览器完整链路，重点IME、复制、选区、焦点、插件迟到回调。已改doc-presentation旧测试需重新验。
2. 同一新的生产构建验开文档→卡片启用位置不跳→返回立即图形→禁用立即源码，flowchart/sequence/不支持语法、块内外/边界/焦点、source/live、宽窄/缩放。不能仅沿用beta4基线截图或manager测试。
3. 表格内外toolbar、增行/撤销、切文档与关闭插件即时清除；普通代码实际Ctrl+C由desktop绑定，包内源切片不够。
4. 完成旧安装Formatting升级准入验收及Diagrams旧包迁移；现原生测试用独立profile移除Linux DOM候选后导入独立Worker，不能称Windows升级已验。
5. beta.5版本已同步；三个CI/交付脚本分支与版本已改，指南/样本只是beta4复制换版，需改成本轮手测流程。完成后提交精确候选、按既有授权构建/验证/交付Actions测试包，无Release/main合并。

本地构建资源：复用 `/tmp/milkup-beta3-native-target`，冻结证据套路参考 `/tmp/milkup-beta4-native-paintfix/freeze.py`；不要覆盖既有冻结二进制。Formatting外部包 `/tmp/milkup-beta5-formatting-external/dist/milkup.formatting-1.0.1.milkup-plugin` SHA256 `26d0684f3df4b2dc29710c52bdca9bb6c5e390035244bea8c51f715a9fe3a7e0`，已替换ignored本地随包输入；Windows仍会独立构建10插件。独立Worker1.2.0仍在 `/tmp/milkup-beta4-diagrams-worker-external-infofix/dist/`。

原生环境 `/tmp/milkup-beta5-baseline/env.sh`，Xvfb :124、tauri-driver4516/native9516仍在，独立/tmp profile；应用已关闭。默认bwrap uid_map失败记录于driver-first.log，按既有只读用户namespace执行获准，未关闭WebKit sandbox。1426为先前Vite进程，版本define可能仍beta4；最终应重启。没有进行真实Windows安装、GUI/IME/系统DPI/更新回滚验收。等待下一轮继续，不等待用户提供样本才能工作。
