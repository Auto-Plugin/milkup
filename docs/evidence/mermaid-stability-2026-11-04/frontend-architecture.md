# 固定 Mermaid 引擎的前端渲染与隔离评估

核查日期：2026-11-04。范围：独立工作树 `dot/mermaid-stability-20261104`，产品基线 `a5556beea5cdd1570361c528b2326bc0ad8ba0c4`（已交付 beta.9），核查时 HEAD `500f64379c06a6c05e98e3336e3119e68e6a1599`。同时阅读正在集成的原生修复；本文是架构及源码评估，不是新方案的 Windows 运行验收。

**判断：固定、可信的 Mermaid 完全可以在前端生成并显示 SVG，无须调用命令行。** 当前产品已经由 WebView2 中的浏览器 JavaScript 调用 `mermaid.render()` 生成 SVG，再由宿主捕获 PNG；命令行来自外层 ACL 管理，不是 Mermaid 的要求。直接将 SVG 留在隔离 iframe 或独立 WebView 中，功能和安装体积上都可行。但是“没有主页面 DOM 权限”“没有 Tauri 命令能力”“能够硬终止并限制内存”是三个不同保证，不能把 iframe 的 `sandbox` 一项当作全部证明。[Mermaid 使用说明](https://mermaid.ai/open-source/config/usage.html)

## 已核对的本地事实

| 项目             | 本地源码/事实                                                                                                                                               | 含义                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 固定引擎         | `mermaid-engine/assets/mermaid-12.2.0.min.js`，5,494,801 字节，SHA-256 `a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f`，本次重新计算一致 | 可以复用同一份离线资源；迁移不需要再捆绑一份浏览器或 Mermaid   |
| SVG 已由前端生成 | `assets/bootstrap.js:337–352`，固定配置后调用 `mermaid.render()`                                                                                            | PNG 是当前宿主输出契约，并非引擎只能输出 PNG                   |
| 当前边界         | `src/engine.rs:269–392`：禁止 host objects，固定本地两类资源响应、独立 CSP、主框架一次性导航和子框架导航拒绝                                                | 不能把这些 native 浏览器事件门禁仅用 `connect-src 'none'` 替换 |
| 输出处理         | `assets/bootstrap.js:355–370` 去掉链接目标，拒绝可执行元素；只有 PNG 离开 helper                                                                            | 直接输出 SVG 要重新验证其交互、链接、外部资源及 DOM 归属       |
| 资源硬边界       | `src/launcher.rs` 的 `Job::new`/`stop_observed`：512 MiB Job 总内存、16 个进程、关闭 Job 杀进程、显式终止后查询 active=0                                    | 是进程级保证；它不来自 Mermaid 配置或浏览器计时器              |
| 依赖版本         | `apps/desktop/src-tauri/Cargo.lock`：Tauri 2.11.5、Wry 0.55.1                                                                                               | 本文没有用新版本接口行为代替当前锁定实现                       |

表内 `mermaid-engine` 路径均相对于 `apps/desktop/src-tauri/`。行号是核查时工作树位置，函数名用于后续变更后的定位。

## 方案 A：主页面内的固定可信 iframe

只允许宿主内置的固定 Mermaid 与固定 bootstrap 进入 iframe；第三方插件继续使用既有隔离运行时，不能向该框架提供脚本、HTML、URL、Mermaid 配置对象或事件回调。插件启用只控制宿主功能是否可用，仍须通过当前已审查包的精确内容身份与激活代际校验。

建议实现方式：

1. 宿主创建 `sandbox="allow-scripts"` 的不透明源 iframe，不授予 `allow-same-origin`、弹窗、表单、下载或顶层导航权限。SVG 留在该文档内；绝不把结果 `innerHTML` 写回具有 Tauri 权限的编辑器页面。Worker 不能直接替换这个 DOM 环境：当前代码需要 SVG 几何、字体布局以及 HTML 标签测量。
2. 引擎仅从已封存的本地字节加载。框架 CSP 默认拒绝；脚本只允许固定资源/精确哈希，样式仅允许渲染所必需的内联样式；`connect-src/img-src/font-src/media-src/frame-src/worker-src/object-src 'none'`，`base-uri/form-action 'none'`。不开放 CDN、动态 layout/icon loader、远程图片、网络字体或任意 blob 脚本来源。主页面现有 CSP 只有 `script-src` 声明，不足以当作新框架的完整策略。
3. 建立一次性的 `MessageChannel`。初次握手严格验证 `event.source === iframe.contentWindow`、预期不透明源、随机实例 nonce 和固定消息结构。`origin === 'null'` 本身没有身份鉴别能力；其他不透明源也会得到此值。由于不透明源不能使用普通精确 `targetOrigin`，初始化的通配发送只传一次性握手/端口，不传文档；确认配对后，文档只经该专属端口传输，并在导航或代际变更时关闭端口。单看 WindowProxy 身份也不能识别导航后的新文档。规范要求检查消息来源与数据格式，并提醒通配目标的机密数据风险。[HTML 消息规范](https://html.spec.whatwg.org/multipage/web-messaging.html#security-2)
4. 输入保留现有 50,000 字符、256 行、500 边及允许主题等界限；输出/布局保留 8,192 轴长和 16,777,216 像素等界限。队列串行、有界，最多一个正在执行的渲染；撤销使用 owner/epoch/requestId，迟到结果不能显示。超时后关闭端口、移除框架，不无限重试。**这些是准入、结果和合作式取消上限，不是执行期间的内存硬上限。**
5. 导航必须补独立验证和原生层阻止：sandbox 限制其他上下文/顶层导航，但规范仍允许上下文导航自己。框架内 `connect-src 'none'` 不等于禁止 `location` 改变；父页面 `frame-src` 可以增加约束，也不能未经实测就宣称覆盖了所有本地协议、重定向和数据 URL 情况。[HTML 导航规则](https://html.spec.whatwg.org/multipage/browsing-the-web.html#allowed-to-navigate)、[CSP 规范](https://www.w3.org/TR/CSP3/)

此设计在普通浏览器的功能实现上合理；在当前 Windows Tauri 主页面中，还不能宣称“无 native bridge”已经成立。

### 当前 iframe 的桥与导航核查

锁定依赖的本地代码位于 `/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`：

- `wry-0.55.1/src/lib.rs:990` 明确 Windows 的初始化脚本也注入子框架，不受 `for_main_frame_only` 控制；`src/webview2/mod.rs:492–495` 的实际调用与之相符。
- `wry-0.55.1/src/webview2/mod.rs:877–915` 即使没有自定义 IPC handler，也会注入 `window.ipc` 包装，并注册仅在 handler 存在时转发的消息回调。因此“存在 JavaScript 对象”和“具备可调用的 native 权限”不能画等号。
- 该实现只注册顶层 `ICoreWebView2.WebMessageReceived`，本次全文查找未发现 `FrameCreated`/子框架消息接收注册。官方文档把顶层和子框架的消息事件分开说明。[WebView2 JavaScript 消息 API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/javascript/webview)
- `tauri-2.11.5/src/ipc/protocol.rs:488–496` 要求 `Origin` 能解析为 URL；`webview/mod.rs:1819–1851` 对非本地来源还有能力检查。这些是反对“子框架看到了 Tauri 全局变量就已越权”的源码证据，但不是本产品真实运行的完整否定测试。
- `wry-0.55.1/src/webview2/mod.rs:673–693` 的通用 navigation handler 只绑定主框架事件。必须接入子框架专用门禁；不能直接把该 handler 当作 iframe 全覆盖导航拦截。微软也单独提供 frame 导航事件。[WebView2 框架文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/frames)、[导航事件](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/navigation-events)

微软的初始化脚本文档说明执行范围涉及顶层和子框架；实际 sandbox/CSP 的影响需要按当前 Runtime 验证。[AddScriptToExecuteOnDocumentCreated](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2?view=webview2-1.0.4258.31#addscripttoexecuteondocumentcreated)

## 方案 B：独立、无命令桥的 WebView

这是更容易明确控制 Windows native 能力的直接 SVG 方案，但须新建真正的专用浏览器控制器，不能仅创建另一个默认 Tauri WebView：

- 使用原始 WebView2 控制器；不注册 Tauri 初始化脚本、Tauri/custom IPC 协议、host objects 或页面发起的命令处理器。设置 `AreHostObjectsAllowed=false`、`IsWebMessageEnabled=false`，保留渲染需要的 JavaScript，关闭弹窗/下载/权限/外部协议/拖放。宿主只通过固定、宿主发起的脚本调用送入 JSON 数据并读取有界几何结果；文档文本不能插入可执行代码模板。该回调是宿主发起的浏览器操作，页面没有任意 native 命令入口。[WebView2 安全指导](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)
- 所有资源请求先拒绝，再只放行固定本地引擎和固定入口；独立 CSP；主导航只允许初始固定入口；子框架导航全部拒绝，或者仅在设计确需子框架时逐帧安装拒绝策略。SVG 就显示在此 WebView 内，清晰度不依赖 PNG 缩放。
- 为编辑区实现原生子控件的位置、裁剪、滚动、焦点、键盘、辅助功能和 DPI 同步；关闭或复用控制器必须验证所有待办取消。这是实质产品接线工作，不是换一次 `render()` 返回值。
- 专用 user-data folder 可以分离 WebView2 进程集合，但一个 WebView/iframe 并不保证对应一个独立 renderer 进程。若控制器仍在主应用进程里，关闭控制器不能据此宣称与现有 Job 硬终止等价。[WebView2 进程模型](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)

若必须保留现有硬边界，优先考察“一个激活期内复用一个受限 helper/Job 与固定 WebView”，失败或到期即销毁，并有界缓存同一输入；它保留宿主独立终止能力，减少每次渲染创建 profile/WebView 的成本。若进一步改为可见子 WebView 或传出 SVG，还必须单独验证窗口归属/裁剪或 SVG 容器边界，不能把它当作已有实现。无论采用哪种方案，不把任意第三方插件代码装入该可信引擎，亦不扩大通用插件的 SVG/DOM 权限。

## 安全与资源保证比较

| 保证                     | 固定不透明 iframe                       | 独立 raw WebView                             | 现有 AppContainer + Job helper                   |
| ------------------------ | --------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| 与主页面 DOM 分离        | sandbox 可提供；必须保持不透明源        | 不共享 DOM                                   | 不共享 DOM                                       |
| 任意 native 命令不可用   | 当前 Tauri 注入/IPC 路径需实测          | 不注册命令桥且禁用 web messaging，可明确设计 | 固定协议，无 Tauri 插件命令桥                    |
| 网络与导航拒绝           | CSP + 父策略 + Windows frame 门禁需闭合 | 原生请求/导航事件可逐项拒绝                  | 已有独立原生门禁，还受 AppContainer 能力约束     |
| 同步死循环硬终止         | 移除 iframe/JS timer 不能保证独立硬终止 | 单个控制器也不自动保证                       | 宿主可终止整个 owned Job；还须确认所有进程已退出 |
| 512 MiB 执行期硬内存上限 | 无等价逐帧上限                          | 无等价逐控件上限                             | 当前 Job 配置提供总内存限制                      |
| SVG 清晰度/缩放          | 直接矢量显示可行                        | 直接矢量显示可行                             | 当前为有界 PNG，宿主应按真实视口缩放             |

此处“无等价保证”不是已测出 iframe 逃逸或内存问题，而是源码和 API 没有给出与现有边界相同的保证。

## 最小 Windows 验证方案与尚未完成项

应在原有产品 GUI 验收之外增加独立探针报告，不修改正式插件权限、不以 Linux Chromium 代替 Windows WebView2：

1. 在新建测试账号的已安装产品中创建一个固定诊断 iframe，记录 Runtime、应用/hash、iframe 属性、实际 `origin`、Tauri/IPC 全局是否存在、读取父 DOM 是否被拒绝。报告只记录布尔值/固定错误分类，不泄露桥密钥或文档内容。
2. 用已有无副作用的 `bridge_status` 作为正/负对照：主页面能返回预期固定结构；iframe 以其自身真实环境尝试相同调用，记录拒绝/超时/成功及 native 审计。未知命令报错不能证明隔离。不得让父页面代转 iframe 命令。若桥不存在，则记录事实；若全局存在但无响应，不把一次超时当作完整不可达证明。
3. 在包含原生 frame 门禁的候选中，测试同框架导航、链接、顶层导航、弹窗、资源请求和外部协议。只用拥有的回环接收端或固定自有 URL，不发送真实文档；验证拦截发生在请求离开之前。另测兄弟 iframe 伪造消息、旧 nonce/epoch、重复/过大结果和导航后旧端口。
4. 取消探针只做一次预先有界的约 1 秒同步忙循环和 50 ms 取消请求，记录主界面心跳/延迟及迟到结果是否被拒绝。它可显示调度延迟，不能证明任意死循环可硬杀；不进行无限循环或大内存耗尽测试。现有 helper 的硬终止/Job 限额另按原生控制测试证明。
5. 普通、宽图、C4、多个图表在真实编辑区记录 `clientWidth`、padding、滚动条占位、DPR、OS DPI、SVG viewBox/边界；窗口大小变化及跨实际 DPI 环境测试稳定尺寸、文字可读性、75 秒静置、重复打开、渲染中关闭。CSS zoom 不充当 Windows DPI 实测。

Windows 的有限诊断已在运行 41760093749 的标准用户产品中执行，结果见下节；完整新架构尚未实现或验收。现有源码确认的滚动条宽度反馈、每次原生渲染的额外资源管理成本，以及把渲染失败和资源未释放混为一谈的退出路径，应先完成修复和真实 GUI 验收。它们也可能影响新容器接入，单纯替换为 SVG 不会自动修好生命周期。随后可用独立分支验证直接 SVG 方案；通过桥、导航、取消和资源边界测试后再决定产品迁移，避免用尚未验证的架构替代已交付故障。

## 已完成的诊断脚本检查

`tests/windows/mermaid-frontend-boundary-probe.mjs` 是单独启用的测试诊断，使用 WebDriver 在自有不透明 iframe 内注入固定脚本，不修改产品 CSP 或插件权限。此路径绕过脚本加载，所以**不证明生产引擎资源已能加载**。原生命令只使用已核对无副作用的 `bridge_status`；主页面正对照和子框架尝试分开记录。

Linux Chromium 的脚本检查使用模拟父桥，只证明诊断可执行及自有对象可清理，不能代替 Windows/Tauri 结果。该次观察中，iframe 在计算开始约 49 ms 后被移除，但预先有界的计算仍完成了 1000 ms，并通过专属诊断端口发送迟到记录；父页面心跳最大间隔约 20 ms。移除框架与终止其计算确实是不同观察。诊断端口只记录固定计时数据，始终声明没有接受迟到渲染结果，也没有证明任意循环的硬终止或内存限制。

握手验证确切父窗口、来源及随机 nonce，只向确切自有窗口转移一次性诊断端口；通配目标不承载文档数据。普通 `postMessage` 来源仍独立验证。清理必须关闭端口、移除框架并恢复 WebDriver 主框架，失败会阻止继续产品验收。证据位于同目录的 `frontend-probe-local/`。

## Windows 产品中的有限探针结果

运行 [41760093749](https://github.com/Auto-Plugin/milkup/actions/runs/41760093749)，候选 `f1a76dbc6224c827ca9e703ade3f462eb656f018`，实际 Evergreen WebView2 `156.0.4314.50`。标准用户的 [原始 GUI 报告](source-41760093749/raw/gui-pure-standard/gui-regression.json) 保留诊断结果；原始 ZIP 和 142 项报告文件已独立核对哈希。整个运行的 GUI 验收失败，以下仅是单独完成的探针事实。

- 主页面 `bridge_status` 正对照返回 `ok`。子框架存在 Tauri/IPC 全局，尝试调用后超时；未取得 native dispatch 审计，因此**超时不能证明命令没有执行，也不能宣称无桥**。读取父 DOM 被拒绝，确切窗口来源与不透明源握手通过。
- 子框架自行导航到 `about:blank` 成功。现有 sandbox/CSP 不足以宣称禁止全部自身导航；拟议方案仍需独立原生导航门禁。
- 子框架计算开始约 60 ms 后被移除；同一次预先有界计算仍运行到 1000 ms，并经已配对的诊断端口报告完成。父页面心跳最大间隔 21 ms；迟到数据仅作诊断，未成为渲染结果。这个实际案例足以否定“移除 iframe 就等价于已有 Job 硬终止”的假设。
- 诊断框架、计时器、端口和 WebDriver 主框架恢复已确认。未测试生产引擎资源加载、外部网络请求、硬内存上限或任意死循环。管理员 GUI 在启用插件前的窗口测量处失败，探针未运行，不计通过。

因此，直接 SVG 的可行性判断保持不变；当前 opaque iframe 尚不能被批准为现有安全边界的等价替换。独立无命令桥的 raw WebView 仍需原型及完整测试，而可信固定引擎继续在现有受限 helper 内运行的故障修复可以独立推进。

## Frontend evidence contract added 2026-11-05

The candidate now has a separate `mermaid-windows-frontend-compat.yml` workflow.
It runs the same full two-account product and GUI scenarios, including twelve
scrolling diagrams and normal idle/busy closes, with an explicit externally
selected `frontend` contract. Native-renderer audit lines cause failure. No
helper ownership, AppContainer or Job proof is fabricated for this architecture.
The original audit filenames are retained as compatibility filenames; records
identify `frontend-mermaid-12.2.0` and are bound to PID + native creation FILETIME.

Before the frame receives document source, the actual production owner requires:

1. Its top-level read-only native probe to dispatch successfully.
2. The actual child `chrome.webview.postMessage` attempt to be observed and
   rejected on that exact native frame, without a new probe dispatch.
3. A subsequent child `about:blank` navigation attempt to receive a native
   cancellation record for the same frame. The frame must then render using its
   existing authenticated MessagePort; a lost document cannot produce a pass.

The native frame identity comes from FrameCreated and the original nonce name,
not a caller-provided PID or a JavaScript timeout. The vendored Wry root IPC
handler subscribes only to root WebMessageReceived; frame messages are never
forwarded by the guard. See Microsoft's [frame event documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2frame2?view=webview2-1.0.4258.31).
This describes implementation and required evidence, **not an already passed
Windows bridge test**.

Opt-in bounded native diagnostics receive metadata only (phase, request/owner
IDs, source/PNG hashes, geometry and closed error codes), never Mermaid source.
Request admission, actual renderer entry, completion, native FrameDestroyed and
zero pending requests are checked before final acceptance. The native writer
has a bounded queue and a bounded flush barrier. Missing records fail closed.
Retirement is idempotent. `hardTerminationProven` is explicitly false: frame
removal revokes publication authority, not arbitrary JavaScript CPU execution.
This design has no per-frame OS memory quota and no claim that a malicious
synchronous renderer hang can be killed independently of the application.

Local checks for this evidence increment:

- Actual bundled frontend assets in Chromium: 19 tests passed, including twelve
  syntax types, correct-nonce forged window messages, malicious configuration,
  queued cancellation/deadline, bounded admission and repeated retirement.
- Node account/product/GUI/evidence fixtures: 312 passed before the additional
  explicit frontend downgrade negative test; that added test also passed.
- PowerShell wrapper contracts: 110 installation fixtures and 57 account fixtures
  passed locally; these do not execute Windows installers or native APIs.
- Two actual Rust metadata-contract tests passed on Linux; the actual guard and
  tests passed Windows-target type checking. Full desktop Windows linking cannot
  run in this Linux environment because MSVC `lib.exe` is absent.
- Desktop TypeScript passed after the evidence integration.

Real Windows frontend product/GUI and installed prior-profile migration remain
required. Old helper run 42104273456 completed successfully but is a different
architecture and cannot satisfy these frontend gates.

### Installer preparation (not executed)

The installer builder and both installer workflows now require the exact successful
`mermaid-windows-frontend-compat.yml` receipt. Old helper-run defaults were removed.
The packaging record, installer manifest, wrapper environment and report retain
an explicit frontend mode. The finalizer selects the frontend evidence contract
from the independently prepared package expectation, never from optional report
fields. Pinned beta.9 preparation remains an explicitly separate legacy phase.

A new asset check binds the reachable production module references to the exact
official engine and fixed frame source bytes. Local production build inspection:
engine 5,494,801 bytes, SHA-256
`a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f`;
frame 19,948 bytes, SHA-256
`e4e1d998cf6b024f2be3c39d5c13ed0d4486c4475814d5c7b2a9f7e5f952cf14`.
These are build-asset checks, not a claim that an installer has run.
Source/packaging contract tests: 169 passed; wrapper fixtures: 111 passed.

Old helper baseline 42104273456 original final artifact 13453098480 was separately
read: both product and GUI passed; each account resolved 102/102 SHOW records,
no observer overflow or unresolved window; idle/busy UI closes exited normally
with inner cleanup. This remains old-architecture evidence only.
