# P3 第二步：公开命令 / 快捷键合同与独立快捷键插件

## 范围与架构

`apps/desktop/src/keymap-service.ts` 是宿主基础设施，负责实际命令目录、单组按键匹配、受限上下文、冲突检查、revision 与持久化。用户界面位于独立 Worker 插件 `plugins/shortcuts`，只依赖公开 `@milkup/plugin-sdk` 0.3.1。菜单打开器与命令执行仍由通用插件 UI / ActionRegistry 承载，没有在宿主按插件 ID 特判实现偏好 UI。

新增 `app:keymap` 能力只暴露 `host.keymap.snapshot/update/reset`，不授予任意命令执行、文件或网络访问。独立 broker、Worker / Sidecar RPC、权限撤销与 AbortSignal 边界由 `packages/plugin` 实现；未知方法、附加路径/URL/其他插件 ID、错误形状与超额载荷被拒绝。远端错误只携带白名单 code，用户错误为固定文案，不透传底层路径。

## 实际命令审计

旧实现分散在 `main.ts` 的窗口 keydown、`getDesktopShortcutAction` 与缩放 capture handler。此次收敛到宿主目录，公开参数包装命令避免按键携带任意参数。目录每次从实际注册的 ActionRegistry 与插件 contributions 取得，不另维护一份虚构命令表；有必需参数且无安全默认的命令仍显示帮助，但 `bindable:false` 并说明输入。

| 命令                                             | 默认快捷键                         |
| ------------------------------------------------ | ---------------------------------- |
| `file.new/open/reloadExternal/save/saveAs/close` | Mod+N/O/R/S/Shift+S/W              |
| `view.source/live/toggle`                        | Mod+1/2/斜杠                       |
| `document.selectAll`                             | Mod+A                              |
| `core.undo/redo`                                 | Mod+Z；Mod+Y 或 Mod+Shift+Z        |
| `search.find/replace/next/previous`              | Mod+F/H；F3/Shift+F3               |
| `appearance.zoomIn/zoomOut/zoomReset`            | Mod+= 或 Mod+Shift+=；Mod+-；Mod+0 |

`Mod` 在 Windows/Linux 表示 Ctrl，在 macOS 表示 Command；缩放命令在浏览器预览中标记不可用。无默认键的实际命令也列入目录，用户可以绑定无必需参数的命令。旧插件默认 keymap 条件通过有限 `editorFocus/documentOpen/sourceMode/liveMode` 表达式继续约束；用户重新绑定不能绕过原上下文。默认键被其他插件遮蔽时，目录只将 active 键作为默认值，同时保留全部非 invalid 绑定的上下文限制，避免用户替换键丢失原条件。

固定帮助另列 F6/Shift+F6 区域导航、Tab/Shift+Tab 焦点/缩进/表格、Escape、剪贴板、方向键与选区、Home/End/文档边界、源码 PageUp/PageDown、Enter/Shift+Enter 与表格换行、替换输入框 Enter 单次替换、Escape 中止替换、分隔条方向键调整侧栏宽度、删除、控件 Space/Enter、IME/Alt/AltGraph。它们不是伪装成可执行公共命令。输入法组合期间不触发应用快捷键。普通输入框保留原生编辑；搜索框保留已有文件/视图/搜索/外观全局快捷键，同时 A/Z/Y 保持原生局部行为。

## 保存与失败语义

- 插件字段修改只更新本地草稿；取消不调用宿主，不影响运行中的快捷键。
- `update({revision, bindings})` 对每个指定命令完整替换候选 keys；空列表取消该命令绑定。多个命令可在同一事务交换快捷键。
- 按键为单组组合，无序列。支持 Mod、Shift 与有限字母/数字/标点/功能键；拒绝重复修饰、未修饰文本、Alt/AltGraph、F6、Tab、Escape、导航与剪贴板键。
- 编辑器全选/历史的 Mod+A/Z/Y/Shift+Z 不能被其他命令夺取。
- 旧 revision、冲突、未知/不可绑定/当前不可用命令、保留键、非法载荷均在写入前拒绝。
- `localStorage.setItem` 成功后才发布新的运行映射和 revision；持久化失败保留原映射与草稿，不显示成功。
- `reset({revision})` 清除所有持久 override，包含当前停用/卸载插件的记录。普通停用/卸载保留用户映射，但不执行已撤销的插件命令；重新启用后恢复。
- 损坏持久数据会显示错误并使用基础默认快捷键。插件停用/卸载不移除宿主的基础编辑、历史、打开与保存动作。
- 请求取消或插件卸载会中止未提交工作；已经完成的持久提交不会因之后关闭界面而回滚。

## 已执行验证

- 宿主 keymap 服务：28 项通过，覆盖精确修饰、平台、IME/AltGraph、搜索输入框、固定保留键、非法组合、原子交换、冲突/过期/参数命令、写入失败、损坏存储、重启/reset、插件上下文与启停。
- broker/RPC：13 项通过，覆盖完整操作往返、缺失/撤销权限、伪造方法与载荷、错误脱敏、timeout/AbortSignal、卸载取消。
- 仓库外独立插件：公开 SDK 0.3.1 tarball 安装、TypeScript 检查、构建、自包含依赖审计与 8 项控制器/生命周期测试通过。
- 首轮真实浏览器捕获了激活时序缺陷：插件在 activate 读取目录时，宿主尚未注册该插件命令，首次保存因此错误地判为 stale。修复为首次打开视图后读取，重新打开时也刷新目录。保留失败日志，不将其计为通过证据。

- 真实 Chromium 浏览器累计 6 项均有通过证据。原 5 项覆盖：命令/固定帮助、草稿取消、冲突/保留键；重启保持自定义按键、实际编辑/自定义保存、恢复默认、搜索框原生全选与全局保存；持久化失败保留旧键与草稿；source/live 两模式停用、移除后的编辑/历史/保存。完整批次 `browser/final.log` 的其余 4 项通过，保存/重启用例在修正测试导航假设后由 `browser/transaction-final.log` 单项通过。
- 中间浏览器失败还包括测试错误假定所有入口都保持菜单开启、忽略插件详情返回层级；测试最终使用通用插件菜单入口，并按菜单真实可见状态关闭。没有为通过测试改变产品导航。
- 真实截图显示长目录下顶部错误反馈不可见，因此把事务结果移到字段后、操作按钮前；保留修改前截图。已新增错误提示位于视口内的断言，主代理在端口释放后独立补跑通过（`browser/visible-feedback-final-confirmed.log`）。此前一次端口占用导致的未启动记录仍保留，不算通过。
- 聚焦复核另发现被遮蔽默认绑定的上下文丢失问题。新增第 6 项真实浏览器测试安装两个独立 Worker，以同一默认键和 `editorFocus && sourceMode` 造成遮蔽，经公开插件重绑定第二个命令为 F2 并重启；目录验证其默认键为空，随后分别从菜单焦点、实时编辑器、源码编辑器按 F2。修复后仅源码执行一次合法 SDK `insertText` 事务并成功保存。通过路由临时恢复旧目录过滤逻辑的对照得到三次插入，明确失败；未回改产品文件。证据为 `browser/shadowed-context-before.log`（预期失败）与 `browser/shadowed-context-final.log`（通过）。
- 该新增测试最初误用 SDK transaction 数组、并在重启后未等待 Worker 恢复，导致正向无文本；这些是测试夹具问题，未计为 guard 通过或产品缺陷。最终测试使用公开 SDK `insertText`、等待真实目录恢复，并明确断言输入代理焦点与允许上下文下的实际写入。

原生生产验证结果由本轮综合报告补充；本文件不把浏览器内存文件适配器保存等同于原生磁盘落盘，不声称 Windows 通过。

## 证据与产物

证据根目录：`/workspace/milkup-preferences-phase3-evidence/keymap/`。

- `service-tests.log`、`service-review-tests.log`、`rpc-tests.log`
- `external/install.log`、`build.log`、`test.log`、`verification.json`
- `external/dist/milkup.shortcuts-1.0.0.milkup-plugin`、`plugin.js`、`build-meta.json`
- `browser/before-activation-fix.log`、`final.log`、`transaction-final.log`、`before-result-position.png`
- `browser/shadowed-context-before.log`、`shadowed-context-final.log`、`shadowed-before-results/`
- `artifact-sha256.txt`：最终安装包 SHA-256 为 `850863c7d597361eea68845bcd80dc99ec99efd1ec53f0533b96b5bb1a6cc7e8`

`release/bundled-plugins.json` 已增加 shortcuts 的 `app:keymap` 敏感能力项，走既有通用安装、审批、启停与移除路径。本专项代理未提交、推送、发布或执行 Windows 构建；最终提交与推送由主代理按用户授权统一处理。
