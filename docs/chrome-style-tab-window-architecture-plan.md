# Chrome 式 Tab 与多窗口架构实施计划

> 状态：候选方案，暂不实施。
> 编写日期：2026-07-16。
> 目标：评估并分阶段实现“单窗口多 Tab、Tab 可拖出为独立窗口、已打开文件全局去重、窗口与 WebView 预热复用”的 Chrome 式桌面架构。
> 决策原则：先完成最小原型和量化验证，再决定是否迁移正式产品。未经阶段评审，不允许直接重构现有桌面入口。

## 1. 背景

当前 Milkup 桌面端使用一个 Tauri `WebviewWindow` 承载完整前端。该结构适合单窗口、单文档或前端虚拟 Tab，但存在以下限制：

- Windows 冷启动期间，原生窗口已经出现而 WebView2 尚未完成首个 HTML 绘制，用户会先看到纯色背景。
- 创建新的独立窗口仍需要创建新的 WebView，不能直接共享现有 DOM、JavaScript Heap 和编辑器实例。
- 如果未来只在一个 WebView 中实现多个虚拟 Tab，Tab 拖出到独立系统窗口时需要迁移文档、选区、撤销历史和插件状态。
- 文件关联、第二次启动、已打开文件定位和多窗口路由需要一个独立于任意具体窗口的全局协调层。

目标方案借鉴 Chrome 的基本思路：应用进程负责全局窗口和文档路由，每个 Tab 拥有独立渲染上下文，Tab 在窗口之间移动时尽量移动原 WebView，而不是重新加载文档。

## 2. 产品目标

最终用户体验目标：

- 一个窗口可以打开多个文件，每个文件对应一个 Tab。
- 从文件关联、最近文件或系统资源管理器打开文件时，优先进入第一个可用 Milkup 窗口。
- 如果文件已经打开，直接显示其所属窗口并激活对应 Tab，不重复打开。
- Tab 可以在同一窗口内排序。
- Tab 可以拖出为独立系统窗口。
- Tab 可以从一个窗口拖入另一个窗口。
- 拖出和跨窗口移动时保留未保存内容、选区、滚动位置、撤销历史和编辑模式。
- 第一次冷启动允许“短暂无窗口 -> Logo -> 加载 -> 文档”。
- 应用进程仍然存活时，打开新 Tab 或新窗口不出现完整冷启动过程。
- 最后一个可见窗口关闭后，可按产品设置保留预热运行时；显式“退出 Milkup”必须彻底结束进程。

## 3. 非目标

本计划不承诺：

- 在第一阶段同时完成 Windows、macOS 和 Linux 的正式交付。
- 让多个窗口同时显示同一个 WebView。
- 让一个 WebView 同时绑定多个原生窗口。
- 在没有原型证据前，把现有所有编辑器状态迁入 Rust。
- 通过后台常驻规避未保存确认、文件冲突或插件权限规则。
- 无限量预热窗口或 WebView。
- 完全复制 Chrome 的进程隔离、安全沙箱和崩溃恢复模型。

## 4. 技术可行性基线

当前依赖解析中：

- Tauri 实际解析版本为 `2.11.5`。
- Wry 实际解析版本为 `0.55.1`。
- Wry 在 Windows、macOS 和 Linux 桌面实现中提供 WebView reparent 能力。
- Tauri 暴露 `Webview::reparent()`。
- Tauri 的裸 `Window`、`Window::add_child()` 等多 WebView 能力依赖 `unstable` feature。
- 稳定模式下，普通 `WebviewWindow` 不能直接作为可 reparent WebView 的来源或目标。

因此目标架构不能继续以“一个 `WebviewWindow` 就是一个完整窗口”为核心，而需要评估：

```text
裸原生 Window
├── Shell WebView
└── 一个或多个 Tab WebView
```

在正式实施前必须锁定并记录 Tauri/Wry 版本，避免 unstable API 在依赖升级后静默变化。

## 5. 目标架构

### 5.1 进程与全局协调器

Rust 主进程不属于任何一个具体窗口，负责：

- 单实例控制。
- 原生窗口注册和生命周期。
- Tab WebView 注册和归属关系。
- 文件路径规范化与全局去重。
- 文件打开路由。
- 最近聚焦窗口和首个窗口选择。
- Tab reparent 协议。
- 预热 WebView 和预热宿主窗口池。
- 应用级退出、恢复和崩溃清理。

建议的核心注册表：

```text
WindowRegistry
  window_id -> WindowState

TabRegistry
  tab_id -> TabState

OpenDocumentRegistry
  canonical_path -> tab_id

WarmPool
  warm_tab_webviews
  warm_host_windows
```

### 5.2 宿主窗口

每个可见系统窗口使用裸 Tauri `Window`，包含：

- 一个 Shell WebView。
- 零个或多个 Tab WebView。
- 同一时间只显示一个活动 Tab WebView，其余 Tab WebView隐藏。

Shell WebView 负责：

- 自定义标题栏。
- Tab 栏和 Tab 拖拽入口。
- 窗口控制按钮。
- 应用菜单和窗口级状态。
- 空窗口、恢复和错误占位界面。

Shell WebView 不直接持有文档正文和编辑器实例。

### 5.3 Tab WebView

每个 Tab WebView 负责一个文档会话：

- 编辑器 DOM 和输入代理。
- 文档文本或大文件视口。
- 选区、滚动位置和编辑模式。
- 撤销/重做历史。
- 文档搜索和文档级浮层。
- 文档级插件视图。
- Dirty、保存、冲突和文件监视状态的前端表示。

Tab WebView 使用独立、轻量的前端入口，例如 `tab.html`，不能重复加载完整 Shell UI。

### 5.4 原生层级限制

子 WebView 是独立原生渲染表面，不等同于普通 DOM 节点。设计时必须遵守：

- Shell WebView 的 DOM 浮层不能可靠覆盖 Tab WebView。
- 文档搜索、文档对话框和文档工具栏应放在 Tab WebView 内部。
- 应用级菜单和模态框需要明确选择由 Shell 承载、由原生层承载，或暂时隐藏 Tab WebView。
- Shell 与 Tab WebView 的位置和尺寸必须由 Rust 统一计算。
- 切换 Tab 时不能通过 DOM `z-index` 管理，只能调用 WebView show/hide、position 和 size。

## 6. 文件打开路由

### 6.1 路径规范化

Rust 层建立唯一的文件身份：

- 转换为绝对路径。
- Windows 下按不区分大小写的规则比较。
- 处理 `.`、`..` 和路径分隔符。
- 明确是否解析符号链接和 junction。
- 新建未保存文档使用稳定的内部 document ID，不进入路径去重表。

### 6.2 路由规则

打开文件时按以下顺序处理：

1. 路径已经存在于 `OpenDocumentRegistry`：显示所属窗口并激活对应 Tab。
2. 文件尚未打开且存在首选窗口：在该窗口创建 Tab。
3. 没有可见窗口但存在预热宿主窗口：激活预热窗口并创建 Tab。
4. 没有任何窗口：创建首个隐藏宿主窗口，等待 Shell/Logo 首帧后显示。

首选窗口策略第一版固定为“最早创建且仍可用的可见窗口”。以后如需切换为“最近聚焦窗口”，必须作为独立产品决策。

### 6.3 单实例转发

第二个 Milkup 启动进程只负责：

- 检测已有实例。
- 将命令行参数、文件路径和当前工作目录发送给主实例。
- 等待主实例确认接收后退出。

主实例负责显示目标窗口、激活 Tab 或创建新 Tab。

## 7. WebView 预热策略

### 7.1 Tab WebView 池

默认只预热一个空 Tab WebView：

```text
应用空闲
→ 创建隐藏 Tab WebView
→ 加载 tab runtime
→ 等待 editor runtime ready
→ 标记为 warm
```

打开文件时：

```text
取出 warm Tab WebView
→ 分配 tab_id/document_id
→ 开始加载文档
→ 放入目标宿主窗口
→ 后台补充一个新的 warm Tab WebView
```

禁止先在 Shell 中创建临时完整编辑器，再无感替换为真实 Tab WebView。临时双编辑器会引入输入法、撤销历史、文件监视和插件状态同步风险。

Shell 可以显示轻量加载占位，但文档事务只能由最终 Tab WebView接管。

### 7.2 预热宿主窗口池

最多保留一个隐藏宿主窗口：

- Shell WebView 已加载完成。
- 不包含用户文档。
- 不显示在任务栏或 Alt+Tab 中，具体平台行为需要原型验证。
- Tab 拖出时优先使用该窗口。
- 预热窗口被使用后，再异步补充新的预热窗口。

如果隐藏窗口仍然出现在任务栏、任务切换或窗口管理器中，必须放弃预热宿主窗口，改为拖出时创建窗口。

### 7.3 回收规则

- 普通 Tab 关闭后默认销毁其 WebView。
- 只有确认所有文档状态、事件监听器、插件实例和原生资源都能完全重置后，才允许把关闭的 Tab WebView放回池中。
- 空宿主窗口可以进入宿主池，但必须清除窗口标题、最近文档、菜单状态和焦点状态。
- 池大小必须有硬上限，不能随打开次数增长。

## 8. Tab 拖出与跨窗口移动协议

### 8.1 拖出流程

拖出必须采用确认式交接：

1. Shell A 发起 `begin_tab_detach(tab_id)`。
2. Rust 将 Tab 标记为 `moving`，暂时禁止关闭、保存目标切换和重复拖拽。
3. 选择预热宿主窗口 B，或创建隐藏宿主窗口 B。
4. 等待 Shell B 报告布局区域和接管准备完成。
5. 隐藏 Tab WebView。
6. 调用 `Webview::reparent()` 将 Tab WebView移到窗口 B。
7. 设置新的位置、尺寸、自动缩放和焦点。
8. 显示窗口 B，并让 Tab WebView 恢复可见。
9. Shell B 确认接管成功。
10. Shell A 移除原 Tab 标签；Rust 更新所有注册表。

任一步骤失败时：

- Tab WebView 必须重新挂回窗口 A。
- 原 Tab 标签必须保持存在。
- Dirty 文档不能丢失。
- 文件监视和保存所有权不能产生两个活跃副本。

### 8.2 拖入已有窗口

拖入窗口 B 使用相同协议，但目标为已存在宿主窗口。完成 reparent 后：

- 按释放位置插入 Tab 标签。
- 更新活动 Tab。
- 如果窗口 A 已无 Tab，按产品规则关闭、隐藏或回收为空宿主窗口。

### 8.3 拖动指针与命中测试

原型必须验证：

- 指针离开源窗口后是否仍能持续接收拖动状态。
- Windows 鼠标捕获是否需要原生实现。
- 如何识别另一个 Milkup 窗口的 Tab 栏命中区域。
- 跨显示器、不同 DPI 和缩放比例下的坐标转换。
- 拖动取消、Esc、失焦和系统切换窗口时的回滚。

如果纯前端 Pointer Events 无法稳定覆盖窗口外拖动，需要 Rust/Win32 辅助拖动会话。

## 9. 状态所有权

### 9.1 基本原则

- 文档只能有一个活跃写入所有者。
- Tab reparent 改变窗口归属，不改变 document ID 和文件所有权。
- Rust 注册表是窗口、Tab 和文件路径映射的事实来源。
- 编辑器事务和撤销历史第一阶段仍保留在 Tab WebView 中。
- 文件读写、大文件存储和 watcher 继续由 Rust 服务负责。

### 9.2 必须保持的状态

reparent 前后必须保持：

- 文档文本和版本号。
- Dirty 与 saved version。
- 磁盘快照 hash。
- 外部修改/删除冲突状态。
- 光标、选区和滚动位置。
- undo/redo 历史。
- source/live 模式。
- 搜索 query、结果和活动项。
- 大文件编辑 session ID。
- 插件 contribution 和文档级 UI 状态。

### 9.3 插件作用域

需要重新定义插件实例作用域：

- `app`：每个应用进程一个实例。
- `window`：每个宿主窗口一个实例。
- `document`：每个 document ID 一个实例，随 Tab WebView移动。
- `view`：每个 Tab WebView 一个实例。

插件不能把 `window.label` 当作文档永久身份。

## 10. 生命周期与后台常驻

### 10.1 关闭 Tab

- 执行 Dirty/冲突保护。
- 停止文档级 watcher 或把 watcher 所有权移交给仍显示该文档的视图。
- 释放大文件会话和插件文档资源。
- 从全局路径注册表移除。
- 销毁 Tab WebView，或在严格 reset 验证通过后回收到池。

### 10.2 关闭窗口

- 逐个处理窗口内 Tab 的关闭保护。
- 如果用户取消任一文档关闭，窗口保持可见。
- 窗口清空后可以销毁，或回收为预热宿主窗口。
- 不能仅隐藏仍包含 Dirty 文档的窗口而不给用户明确状态。

### 10.3 最后一个窗口关闭

产品设置允许后台运行时：

- 保留 Rust 主进程。
- 最多保留一个预热宿主窗口和一个预热 Tab WebView。
- 清理所有用户文档、大文件映射、watcher 和文档插件实例。
- 提供托盘入口和明确的“退出 Milkup”。

产品设置不允许后台运行时：

- 正常退出应用。
- 下次启动重新走冷启动。

### 10.4 显式退出

显式退出必须：

- 对所有窗口和 Tab 执行统一关闭保护。
- 关闭所有 watcher、sidecar 和插件 Worker。
- 销毁预热池。
- 结束 WebView2 和 Rust 进程。

## 11. 前端拆分计划

目标入口：

```text
apps/desktop/
├── shell.html
├── tab.html
└── src/
    ├── shell-main.ts
    ├── tab-main.ts
    ├── window-client/
    └── tab-client/
```

拆分原则：

- Shell bundle 不加载编辑器 parser、view 和大文件编辑实现。
- Tab bundle 不重复加载应用菜单、插件管理器和全局窗口 UI。
- 共享协议放入独立 package 或桌面端纯类型模块。
- Shell 与 Tab 只能通过明确 IPC/event 协议通信。
- 不允许依赖对方 DOM。
- 当前 `main.ts` 的拆分必须按功能所有权逐步进行，不能一次性重写。

## 12. 分阶段实施

### P0 - 可行性原型

状态：未开始。不得进入正式产品代码路径。

实现一个独立实验入口：

- 启用并锁定 Tauri `unstable` feature。
- 创建两个裸原生窗口。
- 在窗口 A 创建一个 child WebView。
- child WebView 内运行最小编辑器和输入代理。
- 在 A/B 之间反复执行 `reparent()`。
- 不接入真实文件、插件和正式 Shell。

必须验证：

- WebView 不重新加载，JS Heap 中的计数器保持不变。
- 文本、撤销历史、选区、滚动位置保持不变。
- Windows 中文 IME 组合输入在 reparent 前后正常。
- 焦点可以恢复到编辑器输入代理。
- 最大化、最小化、缩放和跨显示器移动正常。
- 不出现黑屏、白屏、旧父窗口残影或输入失效。
- 连续 reparent 100 次无崩溃、句柄增长或明显内存泄漏。

退出条件：

- 任一关键状态无法可靠保留，停止“一 Tab 一 WebView”路线。
- unstable API 在目标平台表现不可控，回退到虚拟 Tab + 状态迁移方案。

### P1 - 全局协调器与单实例路由

状态：等待 P0 通过。

- 建立 Window/Tab/Document 注册表。
- 实现路径规范化和全局文件去重。
- 接入单实例启动参数转发。
- 实现显示已打开文件所属窗口和 Tab 的路由协议。
- 保持现有单窗口 UI，不启用子 WebView Tab。

### P2 - Shell 与 Tab 前端拆分

状态：等待 P1 完成。

- 从现有 `main.ts` 抽离 Shell UI。
- 建立轻量 `tab.html` 编辑器入口。
- 定义 Shell/Tab IPC 协议。
- 迁移文档级搜索、加载、冲突和保存状态。
- 保持单宿主窗口，只运行一个 Tab WebView。

### P3 - 单窗口多 Tab WebView

状态：等待 P2 完成。

- 一个宿主窗口管理多个 child WebView。
- 实现 Tab 创建、切换、关闭和排序。
- 非活动 Tab WebView隐藏，不销毁。
- 接入全局文件去重。
- 验证多 Tab 文件监视、保存和插件隔离。

### P4 - 预热池

状态：等待 P3 稳定。

- 增加一个预热 Tab WebView。
- 测量新 Tab 首帧、内存和资源释放。
- 增加一个候选预热宿主窗口。
- 验证任务栏、Alt+Tab 和窗口管理器行为。
- 不满足平台体验时关闭宿主窗口预热，仅保留 Tab WebView预热。

### P5 - Tab 拖出与跨窗口移动

状态：等待 P4 完成。

- 实现确认式 reparent 协议。
- 实现拖出、新窗口定位和拖入命中。
- 实现失败回滚。
- 实现空窗口回收。
- 覆盖跨显示器和 DPI 场景。

### P6 - 后台常驻与快速再次打开

状态：等待 P5 稳定。

- 增加“关闭窗口后继续在后台运行”设置。
- 增加托盘菜单和显式退出。
- 最后窗口关闭时清理文档并保留有限预热资源。
- 第二次启动复用常驻进程和预热窗口。

### P7 - 稳定性与发布

状态：等待 P6 完成。

- 崩溃恢复和异常注册表清理。
- 多窗口自动化测试。
- Windows 原生手工验证。
- 内存、句柄、GPU 和启动性能基准。
- 锁定 Tauri/Wry 版本。
- 记录 macOS/Linux 延后项或完成对应验证。

## 13. 验收指标

以下指标是进入正式实现前的建议门槛，最终数值可在 P0/P4 后调整：

### 正确性

- 同一路径全局只存在一个可编辑 Tab。
- reparent 前后文本、Dirty、选区和 undo/redo 完全一致。
- 移动失败不会丢失 Tab 或产生重复文件写入所有者。
- Dirty/冲突文档关闭保护与当前版本等价。
- 大文件 session 不因移动窗口而重新打开或复制工作临时文件。

### 交互性能

- 使用预热 Tab WebView 时，分配 Tab 到开始文件加载不出现 Logo 或白屏。
- 使用预热宿主窗口时，释放拖拽到新窗口可用首帧目标为 100 ms 内。
- 无预热宿主窗口时必须显示稳定占位，不出现黑白闪烁。
- 切换已创建 Tab 不重新加载页面。

### 资源

- 记录 1、5、10、20 个空闲 Tab 的私有内存、GPU 内存、WebView2 进程数和句柄数。
- 记录每增加一个 Tab 的增量成本。
- 关闭全部文档后，内存应回落到明确基线。
- 预热池必须有固定上限，空闲时不持续增长。

### 稳定性

- 100 次跨窗口 reparent 无崩溃。
- 100 次创建/关闭 Tab 无持续句柄泄漏。
- 中文 IME、复制粘贴、拖放和快捷键在移动后正常。
- 外部文件修改、删除和冲突提示在移动后正常。

## 14. 测试计划

### 单元测试

- 路径规范化和文件去重。
- 首选窗口选择。
- Window/Tab 注册表状态机。
- reparent 协议成功、失败和回滚。
- 关闭保护和应用退出决策。
- 预热池分配、回收和上限。

### 浏览器/前端测试

- Shell 与 Tab 协议。
- Tab 标签创建、激活、排序和关闭。
- 文档级状态不依赖 Shell DOM。
- Tab runtime reset 行为。

### Tauri 原生测试

- child WebView 创建、隐藏、显示和 resize。
- reparent 后页面不 reload。
- 跨窗口焦点和快捷键。
- Windows 中文 IME。
- 多显示器和不同 DPI。
- 任务栏、Alt+Tab、最小化和最大化。
- 第二实例文件路径转发。

### 性能测试

- 第一次冷启动到 Shell/Logo 首帧。
- warm Tab 分配到文档首帧。
- cold Tab 创建到文档首帧。
- warm/cold 宿主窗口拖出延迟。
- 每 Tab 内存增量。
- 最后窗口关闭后的后台内存。

## 15. 主要风险与回退路线

### 风险 A：unstable API

风险：Tauri 多 WebView 和 reparent API 发生不兼容变化。

缓解：

- 锁定 Tauri/Wry 精确版本。
- 把平台能力封装在单一 adapter。
- 不让编辑器和产品逻辑直接依赖 Tauri WebView 类型。

回退：一个窗口一个 WebView，Tab 使用前端虚拟视图，拖出时迁移状态。

### 风险 B：内存过高

风险：每 Tab 独立 WebView 导致大量 JS Heap 和 WebView2 内存。

缓解：

- 拆分轻量 Tab bundle。
- 插件按 scope 加载。
- 限制预热池。
- 测量非活动 Tab 的节流和释放能力。

回退：普通 Tab 使用同一 WebView，仅独立窗口使用独立 WebView。

### 风险 C：原生层级和浮层

风险：Shell 菜单、对话框无法覆盖 child WebView。

缓解：

- 文档级浮层放入 Tab WebView。
- 应用级模态框打开时隐藏或缩小 Tab WebView。
- 必要时使用原生窗口承载全局模态框。

回退：减少 Shell 跨 WebView 浮层，保持固定分区布局。

### 风险 D：拖拽和输入

风险：跨窗口拖动、焦点、IME 或剪贴板在 reparent 后异常。

缓解：

- P0 优先验证，不在正式重构后补救。
- Windows 下准备原生鼠标捕获和焦点恢复 adapter。

回退：拖出时序列化文档状态并在新 WebView重建，不移动原 WebView。

### 风险 E：架构复杂度

风险：窗口、Tab、文档、插件和 watcher 生命周期互相耦合。

缓解：

- Rust 注册表使用显式状态机。
- 每次移动采用 prepare/commit/rollback 协议。
- 不允许 Shell 或 Tab 自行修改全局归属关系。

## 16. 决策门

只有满足以下条件，才建议正式采用该架构：

- P0 在 Windows 上完整通过。
- reparent 不触发页面 reload，编辑器和 IME 状态可保留。
- 每 Tab 内存增量在产品可接受范围内。
- Shell/Tab 原生层级限制不会破坏现有菜单、搜索和对话框体验。
- Tauri unstable API 可以通过版本锁定和 adapter 隔离管理。
- 团队接受多入口、多 WebView 和全局协调器带来的长期维护成本。

如果任一条件不成立，优先采用回退架构：

```text
单窗口内：一个 WebView + 多个虚拟 Tab
独立窗口：一个窗口一个 WebView
拖出过程：通过全局文档模型迁移状态
启动优化：单实例常驻 + 预热独立窗口
```

## 17. 当前结论

“一 Tab 一 child WebView，并在拖出时 reparent 到新的裸原生窗口”在当前 Tauri/Wry 技术栈中具备原型可行性，也最接近 Chrome 的运行模型。它可能同时改善 Tab 拖出状态保持、新窗口感知延迟和常驻进程复用能力。

该方案的主要代价是每 Tab 内存、unstable API、原生子 WebView层级限制，以及明显高于普通前端 Tab 的生命周期复杂度。因此当前只保留为候选架构；下一步若决定继续，只执行 P0 可行性原型，不直接迁移现有桌面产品。
