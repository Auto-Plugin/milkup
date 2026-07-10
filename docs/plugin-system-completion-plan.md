# 插件系统完善计划

> 状态：下一阶段实施草案。
> 目标：把现有的沙箱化插件运行时，完善成用户可安装、可管理、可扩展 UI/行为的插件平台，同时不削弱编辑器可靠性、文件安全和大文件能力。

## 1. 基本原则

- 核心编辑能力默认由宿主掌控，只有明确设计过的扩展点才允许插件介入。
- 普通第三方插件默认运行在 Worker host。
- 所有系统能力必须 broker 化，插件不能直接调用 Tauri、原生文件系统或进程 API。
- 插件代码执行前，必须先通过 manifest 声明贡献点和权限。
- UI 扩展点必须是受控插槽，不允许插件任意改宿主 DOM。
- 文档修改必须走事务，插件失败不能破坏文本、历史、选区或保存状态。
- 从插件 API 看，全量模式和性能模式应保持功能等价。

## 2. 当前基线

已完成：

- `PluginManifest` 支持 `worker` 和 `sidecar` host。
- 已有 document、view、file、app、network 等权限词表。
- `PluginRuntime` 支持 load、enable、disable、unload、reload 生命周期。
- 插件命令可以注册到共享 `ActionRegistry`。
- 已有 Worker 风格隔离执行。
- 已有 file/network broker 能力路径。
- sidecar 基础设施已存在，但需要宿主显式允许。
- CLI/headless 路径也复用隔离和 broker 模型。

仍缺少：

- 桌面端插件管理器 UI。
- 用户安装、启用、禁用、移除、更新流程。
- 插件命令接入菜单/命令面板。
- `keymaps` 在桌面端的完整接入。
- `markdownSyntax` 和 `renderers` 接入真实编辑器渲染链路。
- 稳定 UI 插槽。
- 插件存储、设置、诊断和审计界面。
- 插件包格式和信任策略。

## 3. 面向用户的里程碑

### M1. 桌面端插件管理器

交付内容：

- 在菜单的“插件”页实现真正的插件管理器。
- 展示已安装插件的名称、版本、状态、host 类型、权限和来源路径。
- 支持启用、禁用、重载、移除插件。
- 插件加载或激活失败时显示错误，不影响编辑器启动。
- 持久化插件启用/禁用状态。
- 增加开发者本地插件安装入口。

验收标准：

- 损坏插件会显示为失败状态，不会拖垮应用启动。
- 禁用插件会注销 action、快捷键和运行时资源。
- 重载插件前会清理旧实例。

### M2. 命令和快捷键接入

交付内容：

- 将插件命令接入桌面端命令注册表。
- 在菜单或命令面板中执行插件命令。
- 将 `keymaps` 贡献接入桌面端快捷键处理。
- 设计快捷键冲突规则，保证优先级确定且状态可见。
- 命令级权限继续暴露给宿主。

验收标准：

- 插件命令可以从 UI 和快捷键触发。
- 禁用插件后不会留下可触发的快捷键。
- 权限被拒绝时有可见错误，且不影响应用运行。

### M3. 插件包和加载流程

交付内容：

- 定义插件包结构：manifest、入口模块、资源、可选 sidecar 二进制。
- 安装前校验 manifest。
- 增加插件数据目录和受限存储根目录。
- 增加 Milkup 版本和 plugin SDK 版本兼容检查。
- 支持开发阶段导入/导出本地插件包。

验收标准：

- 无效插件包在代码执行前被拒绝。
- 插件文件和数据路径按插件隔离。
- 桌面端、CLI 和测试共享同一套 manifest 校验行为。

### M4. Markdown 语法和渲染器贡献

交付内容：

- 将 `markdownSyntax` 通过受控 API 接入解析/分词链路。
- 将 `renderers` 接入编辑器真实渲染路径，并提供 fallback。
- 增加按节点/块隔离的渲染失败边界。
- 定义 renderer context、允许的 DOM 输出、事件桥和销毁生命周期。
- 保持源码模式和 live 模式行为兼容。

验收标准：

- 某个 renderer 崩溃只影响对应节点/块。
- 插件禁用后基础 Markdown 渲染仍正常。
- renderer 不能修改自己插槽外的编辑器 DOM。

### M5. UI 扩展插槽

交付内容：

- 增加明确的贡献点：
  - 菜单页
  - 侧边栏面板
  - 底部面板
  - 文档工具栏 action
  - 状态栏项目
  - modal/action view
- 定义 mount、update、focus、blur、dispose 生命周期。
- 定义宿主和插件 UI 之间的状态消息协议。
- 禁止插件访问分配插槽外的 DOM。

验收标准：

- 插件 UI 可以反复打开/关闭，不泄漏事件处理器。
- 插件面板在切换文档时按声明的 scope 保留或销毁。
- 除非宿主分配 modal 插槽，插件 UI 不能覆盖或拦截应用头部。

### M6. 自定义文档类型和导入器

交付内容：

- 增加 importer 贡献点，支持 ChatGPT 导出等文件类型。
- 增加 document type provider，可把结构化文档映射为 Milkup 文档或自定义只读视图。
- 增加非 Markdown 文件的预览/导入流程。
- 明确保存和导出语义。

验收标准：

- ChatGPT 导出插件可以打开 JSON/HTML 导出，并展示为对话文档或导入为 Markdown。
- 宿主能明确区分当前内容是可编辑 Markdown、生成后的 Markdown，还是自定义视图。
- importer 不能静默覆盖源文件。

### M7. 系统能力扩展

交付内容：

- 为 file、network、app-control、sidecar 权限增加用户审批 UI。
- 增加插件 file/network 操作审计日志。
- 增加 network origin allowlist。
- 增加按插件隔离的 storage API。
- 只有审批 UI 完成后，才产品化 sidecar 插件包分发和生命周期管理。

验收标准：

- Worker 插件仍然不能直接调用 Tauri 或原生 API。
- 每个系统能力在安装/启用时都清晰可见。
- sidecar 插件必须显式启用，并和普通 Worker 插件明显区分。

### M8. 性能策略扩展点

交付内容：

- 当前全量/性能模式策略继续由宿主默认掌控。
- 在插件 UI 和 document provider 稳定后，再设计受控 provider：
  - `documentSourceProvider`
  - `documentOpenPolicyProvider`
  - `viewportContentProvider`
  - `savePipelineProvider`
- 为大文档行为增加专门 capability。
- 增加回退到内置策略的硬保护。

验收标准：

- 插件不能在没有明确授权的情况下替换大文件编辑策略。
- provider 失败时，宿主可以恢复到内置性能策略。
- IME、选区、光标、撤销、保存、关闭保护继续由宿主验证。

## 4. 推荐实施顺序

1. 在桌面端“插件”菜单页做插件管理器外壳。
2. 增加持久化插件 registry 和本地安装/重载。
3. 接入命令和快捷键。
4. 接入 Markdown 语法和 renderer。
5. 增加 UI 扩展插槽。
6. 增加 importer 和自定义 document type provider。
7. 增加权限审批、审计、storage 和 sidecar 产品化。
8. 最后设计受控的性能/document-source provider。

## 5. 测试策略

- manifest 校验、registry 持久化、权限检查、贡献点解析使用单元测试覆盖。
- load/enable/disable/reload 清理使用 runtime 测试覆盖。
- 插件管理器状态和命令触发使用桌面端测试覆盖。
- renderer 失败边界和 DOM 插槽隔离使用渲染测试覆盖。
- file broker、sidecar 生命周期、插件包加载使用 native smoke 覆盖。
- 插件安装/移除 UX 和系统文件权限行为保留人工验证。

## 6. 下一阶段不做

- 任意 DOM 注入。
- 第三方替换核心编辑器视图。
- 第三方替换性能模式内部实现。
- marketplace、签名和自动更新。
- 未 broker 化的原生能力。
