# P1 门禁补验与 P2 独立工作区插件

分支 `dot/milkup-v2-product-phase2-workspace`，精确基线 `35e03e3df37ce0bab083242b75c5214b2ac615f9`。本轮 P2 指 workspace，对应旧规划的文件导航阶段；不包含安装发行。本轮未构建 Windows/Runtime、未上传 artifact、未创建 Release 或部署、未整合 main/v2/quality、未创建真实凭据，未复用历史交付批准。

## 实施顺序与 P1 门禁

先从基线构建 Linux production deb，并在全部已安装可选插件 `milkup.outline` / `milkup.updates` 同时停用的独立 profile 中完成真实 GTK 打开、source 编辑、撤销/重做、Unicode/CRLF 全字节保存、正常关闭重开及 SIGKILL 后宿主恢复副本。恢复原件完整保留，两次重启仍全部停用。只有此门禁通过后才开始 P2 产品代码。

基线 deb SHA256 `a57022e74eafcf3d9ca551ba882b38fb4632e6ed0f90388753e805df5d0c50b4`，提取 binary SHA256 `2e7292f3a1400f9d054a443c882bf5814939a86ad76826ebfe1108b6403ac497`。脚本 `tests/native/tauri-all-plugins-disabled.mjs`；原始结果保留于执行环境 `/workspace/milkup-workspace-phase2-evidence/p1-all-disabled/run`。

P2 最终生产 deb 又在独立安装路径、显示会话与 profile 中复验相同门禁，这次同时停用 Outline、Updates、Workspace 三个插件。19 条结果全部通过，恢复副本保留未保存内容，原件 SHA256 仍为 `60739bdfb01de4d611420a8396592eb1d446fcaf4c45a61d889bd6095722512e`。见 [三插件停用结果](./evidence/v2-workspace/p2-all-disabled-results.json)、[原生恢复截图](./evidence/v2-workspace/p2-all-disabled-recovery.png)。

## 架构与数据保护

- 独立 `plugins/workspace` Worker 包仅依赖公开 SDK 0.3，业务状态、文件树、分页、刷新、最近文件及文案在插件中。通用预装目录只安装敏感包，用户批准 `workspace:read` 后才能启用；禁用、撤销及卸载不会自行恢复。
- `host.workspace` 只接受宿主发出的根、目录、文件和游标句柄。选择根及打开文件只能使用真实点击或键盘命令签发的一次性短期能力；激活时捕获的只读能力没有这两项方法。脚本事件、伪造字段及重放不能授权。
- 目录按页懒加载，默认 100、最大 200 项，每次最多检查 512 个目录项；不会全目录排序或递归扫描。句柄、并发请求和枚举会话均有配额。取消、刷新、撤权和卸载清理在途工作，迟到回复不能重新发布旧数据。
- Native 使用目录句柄逐层拒绝链接/重解析点，通过验证后的文件描述符读取；不会检查路径后再用插件提供的路径重新打开。大文件复用既有 PieceTree，在私有临时目录准备工作副本。准备和接纳在同一授权代次内完成，取消与迟到注册不能留下孤立文档。
- 目录游标在目录内容变化后失效；无关同目录文件的正常原子保存不会使另一个文件的身份失效。目标文件和祖先目录替换仍会拒绝。最近文件在插件 storage 中按稳定根 key 存最多 20 个相对路径；key 不是授权，重启或重新启用必须再次选择根。
- 打开复用单文档 dirty/save/conflict 保护与既有恢复控制器。准备阶段检查取消和当前文档身份/版本/外部状态，成功提交后再等待界面绘制。取消、保存失败及准备失败保留原文；提交后的展示错误单独报告。插件不持有或删除恢复记录，也不创建平行恢复系统。
- 通用树增加单 Tab 入口、方向键/Home/End 导航与刷新焦点保持；面板折叠通过 `visible:false` 通知插件停止在途工作。原大纲实现和多标签架构均未改造。

SDK 0.3 增加 workspace 和可见性契约。Outline/Updates 新档案声明有界兼容范围 `>=0.2.0 <0.4.0`；解析器仅补明确完整版本的有界比较语法，仍使用标准 SemVer 判断。已安装旧 manifest 不被静默改写，旧 profile 若保留 `^0.2.0` 档案会显示不兼容，须正常重新安装兼容档案。

## 回归与实际验收

实现期间通过回归发现并修复：取消后迟到 prepare 句柄泄漏、accept 与清理竞争、提交后取消误报、重复选择根未释放旧原生授权，以及有界版本范围被旧语法拒绝。完整 Worker 验证还发现并修复最近文件存储键不符合公开存储限制，以及取消分页后复用已消费游标的问题。修复断言覆盖作用域、权限、分页、取消、生命周期、真实事件与保存保护；[迟到撤销发布的修前日志](./evidence/v2-workspace/publication-revoke-before.txt) 保留了实际失败结果。

生产候选的真实原生验收另暴露两项问题：[保存后再点文件被旧句柄拒绝](./evidence/v2-workspace/saved-entry-before.png)，以及 [最近文件误用空状态留白而挤压文件树](./evidence/v2-workspace/recent-layout-before.png)。前者的 Native 拒绝是正确的授权行为；修复后插件在每次新的用户打开请求中重新解析已授权根下的已显示路径，再提交宿主打开，旧句柄、链接和范围限制保持严格。后者移除最近列表继承的空状态样式，使用通用可滚动次级列表。相同 316px 面板下文件树从 44px 增至 105px，最近列表从 140px 减至 79px；3/20 条最近记录、明暗主题、宽窄窗口的 8 项布局回归均通过。完整候选失败数据见 [原生修前记录](./evidence/v2-workspace/native-candidate-before.json)，布局见 [修后尺寸数据](./evidence/v2-workspace/navigation-layout-metrics.json)。

全仓 `pnpm test` 通过 1,208 项，Chromium 全量浏览器回归 114 项全部通过；Rust 通过 101 项、保留原有 1 项 ignored。独立仓库外 workspace 包通过 24 项测试、类型检查和打包；公开 SDK 的类型契约与包测试同时通过。全仓类型检查、构建及格式检查通过。

浏览器回归发现旧的窗口化更新保护测试仅等待 DOM 可见，可能在加载锁释放前发送模式快捷键。诊断记录中名义 source 用例实际仍为 live；已补 ready、editable、mode、焦点与输入前缀断言，保持完整保存内容严格相等。source/live 各重复 6 次均通过。最初一次保存字节差异未再重现，不能把时序证据称作该次差异的唯一原因，未据此修改产品保存逻辑。见 [测试时序对照](./evidence/v2-workspace/windowed-test-timing.json)。

最终 Linux production deb SHA256 为 `b4480627a2c1c2f94244c5d3b0b53228e4204fb84f269b70a8475f6abac3de95`，提取 binary 为 `143bbda2bd4ccfd97d9638d03314c820ecf1e9ee74fc313be68d4db974092bf8`。SDK、独立外部包与预装包的精确哈希见 [产物清单](./evidence/v2-workspace/artifacts.json)，没有上传这些二进制或发布产品。

全新 profile 的原生工作区主链 exit 0，保留 [44 条结果](./evidence/v2-workspace/native-final-results.json) 和 [运行日志](./evidence/v2-workspace/native-final-log.txt)。包括正常 GTK 外部安装、PNG 图标、显式权限审批、真实目录授权及取消、重复选择、230 项目录分页、刷新、鼠标及键盘打开、普通与 2,952,022 字节窗口化文档的 source/live 选区与历史、Unicode/CRLF 全字节保存、dirty 取消及保存后切换、外部冲突保留 draft/原件、重启后重新授权与最近文件、停用/撤权/卸载重装。后者均没有恢复旧目录句柄。

侧栏导航矩阵为 light/dark × 100/125/150/200% 原生 zoom × 1100×760/760×520，共 16 组；CSS zoom 始终为 1，devicePixelRatio 分别为 1/1.25/1.5/2，焦点行保持在可见边界内。数据流用例与这 16 组侧栏矩阵分别执行，不把它们称作完整笛卡尔积。截图：[修后文件树](./evidence/v2-workspace/recent-layout-after.png)、[窄窗浅色 200%](./evidence/v2-workspace/native-light-760-200.png)、[窄窗深色 200%](./evidence/v2-workspace/native-dark-760-200.png)、[宽窗深色 100%](./evidence/v2-workspace/native-dark-1100-100.png)。

另以真实 Tab/Shift+Tab 离开及返回树，再逐步方向键导航，补验窄窗 light/dark × 100/200% 的键盘焦点。4 组均 `document.hasFocus=true`、`:focus-visible=true`、`outline: solid 2px`，未为此更改产品样式。见 [焦点数据](./evidence/v2-workspace/native-focus-results.json)、[浅色 200% 焦点](./evidence/v2-workspace/native-focus-light-760-200.png)、[深色 200% 焦点](./evidence/v2-workspace/native-focus-dark-760-200.png)。脚本支持 `--focus-only` 重现。

GTK/proot 环境仍可能在 Home 位置显示 `Bad address`。验收通过真实界面关闭该提示再输入目录，没有新增路径授权测试 IPC 或关闭 WebKit sandbox。GTK 返回后的输入焦点曾使一轮脚本未激活按钮，该失败输出单独保留；最终全流程改用真实鼠标选择目录，树操作仍用系统键盘。控件定位使用公开 DOM 聚焦，正文编辑、授权与命令使用原生按键/鼠标，不注入私有状态。

Linux 和 Chromium 结果不代表 Windows 实机、Windows IME、读屏或发行安装验证。Windows 本轮只做代码审查，未构建或运行。

## 后续边界

首版仅支持用户选定单个目录中的 Markdown 导航；不做任意文件写入/改名/删除、全盘索引、递归监听、网络同步或多标签页。建议父线程先审阅 P2 代码与真实交互证据，再协调下一个独立产品插件；安装发行仍遵守单独授权，不因本轮完成而自动启动。
