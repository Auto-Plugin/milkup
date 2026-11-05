# Mermaid 渲染路径核查（2026-11-05）

核查源码：`11da1c3cb3f6c48834fa02f57133932987722017`。本文记录实现与证据边界，不代表此候选已通过 Windows 或安装版验收。

## 是否为纯前端

**当前实现不是纯前端。** `apps/desktop/src/private-mermaid-service.ts` 调用 `private_mermaid_render`，Rust 在私有目录复制应用可执行文件，用 `CreateProcessW` 启动 `milkup-fixed-mermaid.exe --milkup-fixed-mermaid-child ...`。helper 创建独立 WebView2，运行固定 Mermaid.js 12.2.0 和 bootstrap，调用 `mermaid.render()` 生成 SVG，再通过原生 `CapturePreview` 返回 PNG。

此链路会启动外部 helper 以及 WebView2 浏览器子进程。当前 Windows 固定 Mermaid 路径没有用 cmd、PowerShell 或外部 ACL 命令；ACL 由 Win32 API 处理。`launcher.rs` 的 `Command::new(...).arg("--list")` 位于单元测试，不是产品渲染路径。Linux 的独立 helper 路径不在本次 Windows 结论内。

防止可见窗口的实现措施分别是：

- 发布版 `src/main.rs` 使用 `windows_subsystem = "windows"`。
- helper 的 `CreateProcessW` 指定 `CREATE_NO_WINDOW`，标准流连接协议管道。
- helper 的原生宿主窗口以 `WS_POPUP` 创建，没有 `WS_VISIBLE`，也没有调用 `ShowWindow`；内部 WebView2 controller 设置为可见以便布局和截图。

这些是源码措施，不是“永不闪窗”的证明。完整真实窗口审计仍须覆盖实际启动、渲染和关闭。没有观察到命令行窗口也不能反推没有外部进程，更不能称为纯前端。

## 已有前端原型证据

已有 [前端隔离评估](frontend-architecture.md) 和真实 Windows 探针，不能重复把它们当作新方案已交付：

- [41760093749](https://github.com/Auto-Plugin/milkup/actions/runs/41760093749) 中，标准账户的不透明 iframe 无法读取父 DOM，但存在 Tauri/IPC 全局。子框架命令调用超时，缺少原生 dispatch 证据，未证明无原生调用能力。
- 移除 iframe 约 60ms 后，同一次有界计算仍运行到 1000ms 并回报；`hardTerminationProven=false`。移除节点和忽略迟到结果不等于进程级终止。
- 探针没有验证生产 Mermaid 资源加载、完整渲染流程、任意死循环或内存硬限制；它不是产品可用的前端 renderer。

固定 Mermaid 的 DOM/SVG 渲染本身不需要命令行。要交付纯前端方案，需要替换 manager 到 native owner 的渲染接入，验证内置脚本加载、消息来源、SVG/资源边界、取消和三模式、热启用及旧配置迁移。不能直接把当前原生 PNG/Job 合同改名为前端合同，也不能把现有 iframe 的移除操作标成硬终止。

## 最近失败的精确范围

[42085841073](https://github.com/Auto-Plugin/milkup/actions/runs/42085841073)，源码 `1169ad79`，原始 artifact `13450485694`：

- 纯标准产品在 `07-wide` 等待 PNG 超时；前 01–06 项通过。请求 `461f9d85af2e481ab9668965a4a9d580` 复制耗时 50ms，launch 到父持有子端管道关闭耗时 12,538ms。helper 仍为挂起状态，尚未创建 IPC 线程或恢复主线程；无 helper startup 记录。资源释放已证明，`cleanupUncertain=false`。不能归因于 controller callback 或尾部 EOF。
- launch 的更细阶段虽已采集，但未进入 audit 输出白名单，因此该工件不能定位到某一个系统调用。`53d8bb71` 修复了白名单；新运行才能验证这些阶段。
- filtered-admin 产品 11/11 通过。两账户 GUI 八项功能、12 图与回访、idle/busy 正常关闭均通过；最终窗口合同失败。
- 纯标准 101/102 SHOW 已解析，剩余窗口第一次身份读取仍存在、第二次已消失。filtered-admin 100/101 已解析，剩余窗口在回调入口就已消失。两者无预算溢出或诊断截断，仍不能证明完整窗口生命周期，不能宣布零控制台验收通过。

窗口消失后的身份缺失不能用同 PID/TID、旧类名或相近时间替代。当前没有提交降低这些校验的改动。

## 后续验收绑定

[42102515568](https://github.com/Auto-Plugin/milkup/actions/runs/42102515568) 绑定上述 `11da1c3c` 源码；最终结论须读取该轮原始产品与 GUI 工件。本记录不预先给它通过结论。

旧配置真实安装升级仍未完成。现有准备覆盖两账户各四种旧配置、旧版手动启用并重启、候选升级与覆盖、启动及实际卸载。只有精确源码验收成功且受保护源码无差异时，才可沿现有绑定机制构建对应安装候选；不能用旧 SHA 的成功覆盖新源码，不能用新装通过替代旧配置升级通过。
