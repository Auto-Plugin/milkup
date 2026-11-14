# beta6 Mermaid 固定渲染服务：供批准的具体方案

这是前一份[可行性调查](v2-beta6-mermaid-feasibility-2026-10-23.md)的决策补充，仍是只读设计，**没有实现、运行原型或改变已关闭的 Windows DOM/PDF 门禁**。固定包、37 个注册项、哈希和 W0 失败证据继续有效。

## 推荐决策

建议选择一个明确受限的新产品能力：**独立 Worker 图表插件调用宿主固定的 Mermaid 12.2.0 渲染服务；服务在独立、无 Tauri bridge 的 WebView2 helper 中运行完整官方引擎；原生 `CapturePreview` 只返回有界 PNG。** 不把 Mermaid 放入主编辑器 WebView，不开放通用 Windows DOM 插件，不从安装插件的包中加载渲染 JS。

选择这条路线的实际收益是：复用 Windows 已有 WebView2，不安装第二套浏览器，不要求 UAC、WFP、防火墙规则或后台服务；全部官方图型的普通静态 SVG/HTML labels/MathML 交给真实浏览器绘制，不再受自制布局或现有 `bounded-svg-v1` 图元子集约束。付出的代价是：固定官方引擎成为宿主受信依赖、引擎升级随应用发布；输出为位图而非可无损放大的向量；**AppContainer 已被实测否定的全网络拒绝保证不成立**，需要明确接受下文限定的剩余风险。普通用户部署、截图边界与全图型正确性还须真实验证。

如果“renderer 一旦被恶意文档利用仍必须由 OS 拒绝任何联网”是不可改变的要求，**不应批准本方案**；它不能满足这个条件。此时继续保留功能阻塞，不能用 CSP 或受信代码称谓替代该保证。

## 精确代码与数据路径

```text
已安装/启用的独立 Worker 插件（仍受现有 Worker 隔离）
  → 计算型 SDK capability：renderMermaid12(当前渲染请求的宿主 token)
  → 宿主检查插件实例、已注册 renderer、文档版本与请求预算
  → 宿主从自己的快照取围栏文本；发送固定 JSON 数据帧
  → 独立 milkup.exe helper 模式：AppContainer / Job / 私有 UDF
  → 固定 bootstrap + 固定 mermaid@12.2.0 完整 bundle
  → 官方 render → helper DOM 布局/字体/MathML → WebView2 CapturePreview(PNG)
  → 有长度上限的原生流 → 宿主核验 PNG、像素、总字节、请求身份
  → 宿主所有的 raster lease → 静态 <img>；导出解析同一个 lease
```

**受信代码的确切来源与位置：**拟新增应用内部 `mermaid_service` / Windows helper 模块，在 [main.rs](../apps/desktop/src-tauri/src/main.rs) 调用 `milkup_desktop_lib::run()` 之前分派；直接使用 WebView2 COM，不构造 Tauri App/WebviewWindow。固定 JS 在构建期从已审批的 `mermaid@12.2.0` 全部输入生成单一离线 bundle，连同受审 bootstrap 嵌入应用资源/可执行文件。helper 只读自身固定资源；协议中没有 `module`、JS、HTML 页面、文件路径、URL、任意配置或“执行脚本”字段。运行时不得读取 `plugins/<id>/dist/plugin.js` 来替代该 bundle。前述哈希白名单约束的是已冻结输入；新增 bootstrap 仍需审查与版本化。

Worker 插件保留独立包、启用/禁用/卸载、围栏贡献声明与公开 SDK。拟新增的 `renderMermaid12` 是**只计算当前已授权围栏的 host capability**，不授予文件、网络、shell 或其他文档权限；token 由宿主建立，并与正在处理的 request/实例/版本绑定，插件不得通过修改 documentId 或 source 字段扩大输入范围。只有声明该服务并注册相应 renderer 的插件可以请求；不按 `milkup.diagrams` 字符串给任意代码特殊权限。新 capability、manifest 声明和 SDK 兼容是实际开发工作，现行 SDK 尚无此方法。

宿主到 helper 的数据只含固定协议版本、request ID、宿主原样围栏正文、宿主宽度/主题/目标和受控栅格比例。所有数据用 JSON serializer 与 `PostWebMessageAsJson` 传入，不拼接成脚本。主页面通过 `chrome.webview.postMessage` 返回有界 ready/error/尺寸状态；native 的回调只接收这些消息，没有通用命令代理。**这是窄 WebMessage 通道，并非“完全没有 native 通信”**；没有 Tauri invoke、host objects 或文件/网络 broker。PNG 由 native `CapturePreview` 产生，不接受 JS 自报的 PNG/base64 作为截图。

配置保留 `securityLevel:'strict'`、`startOnLoad:false`、受控 theme/font、deterministic ID、500 edges/50,000 字符等；`secure` 列表禁止文档改写这些安全配置，不调用 `bindFunctions`。以官方常规 HTML label 路径支持 Markdown 标签和 MathML，由浏览器绘制；不能沿用旧转换器为避开 `foreignObject` 而关掉所有 HTML label 的取巧方法。任意脚本、外部 URL/字体/图标包和链接交互仍不授予。它们与普通静态 grammar 的全量覆盖分开记录。

## helper 可用能力与封闭边界

以下均为拟实现并验证的准入条件，API 存在不等于当前产品已具备保障。

| 面向            | 具体选择                                                                                                                                                                                                                                                                                    | 能证明什么 / 仍不能证明什么                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 进程与期限      | 当前 exe 的独立 helper；创建时进入专用 Job，保留 KILL_ON_JOB_CLOSE、禁止 breakaway；原生父进程在准备 10 秒、渲染含截图 2 秒截止终止 Job；不靠 JS setTimeout                                                                                                                                 | 主编辑器不执行布局；必须验证同步忙循环、取消、崩溃及后代归零。Job 不构成文件/网络 sandbox                                                                            |
| AppContainer    | 保留独立零 capability 身份作为额外防御；分离只读执行/固定资源子树与可写UDF/temp；AppContainer对代码及其父目录无写入、删除子项或重命名权限，只给UDF/temp低完整性写入；不改应用数据、文档、Runtime 或系统目录 ACL                                                                             | 复用已测的部分文件限制；不能宣称全部文件不可读，尤其已有允许 AppContainer 访问的系统资源；不能宣称 UDP 不可达                                                        |
| 主宿主桥        | 不初始化 Tauri；不调用 AddHostObjectToScript；`AreHostObjectsAllowed=false`。`IsWebMessageEnabled=true` 仅用于固定数据通道                                                                                                                                                                  | 隔离应用 invoke/命令对象；仍需来源、schema、长度、实例和请求 ID 校验，不能把来源正确等同于消息可信                                                                   |
| 页面 origin     | 注册仅本环境可用的 `milkup-render://job-<opaque>/index.html`；`HasAuthorityComponent=true`、`TreatAsSecure=false`，不开放跨源访问，独立于主应用 origin；从内存提供两个固定资源：index 与 bundle；不用 file://、HTTP server 或文件夹虚拟映射                                                 | 无任意目录路径解析；同源约束隔离主页面数据。origin 不是恶意 renderer 的 OS 网络边界                                                                                  |
| Runtime/profile | 只用已安装可用 WebView2；每实例新 UDF，`ExclusiveUserDataFolderAccess=true`；不与编辑器共用 UDF/浏览器进程；SSO=false、扩展=false，避免携带账号状态                                                                                                                                         | 避免借用主应用 cookies/profile 和错杀共用进程；必须核对实际 UDF/进程，因为环境或策略可影响创建。缺必需 API/环境创建失败就不可用，不安装或静默放宽                    |
| 请求路径        | 在首次导航前安装 `ICoreWebView2_22::AddWebResourceRequestedFilterWithRequestSourceKinds('*', ALL, ALL)`；回调仅接受精确内存资源的 GET，其余被捕获请求返回本地403；没有外部转发                                                                                                              | 可检验 HTTP(S)、CSS资源等已覆盖请求不送达；不能证明 WebRTC UDP、原生 sockets、DNS/系统broker、Runtime自身流量全部经过该事件                                          |
| CSP             | 响应带 `default-src 'none'; script-src <精确bundle>; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`；并带no-store/nosniff；无 eval/外部脚本 | 允许官方生成内联样式；阻止外部资源与嵌套执行的已覆盖浏览器路径。不是网络总开关，也不覆盖浏览器/引擎漏洞后的 native 行为                                              |
| 导航与外部程序  | `NavigationStarting` 仅首次固定 index 放行，其他均 Cancel；`FrameNavigationStarting` 全拒绝；`NewWindowRequested` 标为 Handled；`LaunchingExternalUriScheme` Cancel；SourceChanged 偏离预期即终止                                                                                           | 防止已覆盖导航/弹窗/OS URL handler 路径；不拿它代替资源过滤或 OS 阻断                                                                                                |
| 文件与权限      | 不提供文件路径/句柄，不开放 picker/下载功能；`PermissionRequested` 默认 DENY（含 FILE_READ_WRITE、camera/mic/clipboard等）；`DownloadStarting` Cancel；`AllowExternalDrop=false`；helper不接收用户输入                                                                                      | 浏览器文件请求、拖入、下载与权限通路可逐项测；permission事件不是覆盖所有 input-file/broker API 的文件系统拒绝证明；保留原AppContainer文件反例/正对照并补普通用户验证 |
| 其它界面能力    | 默认脚本对话框、上下文菜单、DevTools、密码保存、autofill关闭；只运行固定渲染                                                                                                                                                                                                                | 不依赖 Chromium flags、JS删API或全局策略来宣称安全；也不向此 helper 提供交互浏览器能力                                                                               |

这些原语存在于当前缓存的 `webview2-com-sys 0.38.2` bindings；桌面与 W0 锁中版本/checksum一致。直接调用 COM 需要给桌面增加显式依赖边和所需 Win32 features，不需要换依赖版本或安装新 Runtime。通用 DOM backend 仍维持 unavailable，服务必须有独立入口和独立启用条件。

官方依据：[WebView2 安全及消息原则](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)、[自定义 scheme](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2customschemeregistration?view=webview2-1.0.3537.50)、[覆盖多种 request source 的过滤接口](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_22?view=webview2-1.0.3537.50)、[Settings](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings?view=webview2-1.0.3537.50)、[外部 URI scheme 取消](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_18?view=webview2-1.0.3537.50)、[process model/UDF](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)。

## 完整静态输出：推荐 PNG，必须新建受控合同

**CapturePreview 是本方案的推荐输出。** 它将官方 SVG、HTML label、MathML、CSS 效果在 helper 内绘制后的像素交给宿主，避开现有 SVG converter 的图元/属性支持缺口；不需要再自制 Mermaid 布局或逐图型重写 renderer。它也去除了输出端的脚本、链接、HTML/CSS 和动画执行能力；但不会撤销渲染之前发生的行为，不能修复网络边界。

当前 [DocumentPresentationNode](../packages/core/src/document-presentation.ts) **没有 raster/PNG 节点**，只有 `svg-image`、`vector`、math等。SDK resources 的 PNG MIME 是用户导入文件事务，不是 renderer 输出能力，不能借它静默增加文件写入权限。需要新增 `raster-image` 类型与宿主拥有的 opaque asset lease，拟包含 engine revision、CSS width/height、pixel width/height、byte length、lease ID 和 accessible text；PNG内容由宿主保存并与插件实例/文档版本/当前请求绑定，插件不提供 URL、路径或任意 bytes。

必要工作跨越 SDK/manifest与RPC、native PNG帧和lease registry、core类型/预算、view-dom图片生命周期、HTML/输出serializer与资源解析、撤销/版本变化/禁用/卸载清理。导出时由可信serializer解析lease并创建受控内嵌PNG或资产；lease ID本身不能被直接写进最终HTML。Windows PDF仍不因图片能力自动开放。这个改动规模不是换一个manifest或新增一个converter分支。

建议首个原型不放宽原有预算：**单次render的所有PNG字节加JSON元数据合计仍不超过256 KiB；PNG通过有界二进制帧传送，不能因为不在JSON内而逃避总计费。** 每轴不超过8192物理像素，单次请求合计不超过16,777,216像素；RGBA解码面不超过64 MiB，解码器还需独立的临时分配上限。超限明确失败，不能截断、静默降分辨率或自动追加更宽预算。这一栅格预算会使某些复杂/高DPI图超限，属于需测量的实用性风险；若达不到验收样例要求，必须带真实数据重新决定预算，不能把它说成全量可用。

native 的 `IStream` 在每次 Write 前检查累计长度并拒绝超限，宿主不先接收无限内存截图再截断。**这只约束宿主接收缓冲区，不能证明 WebView2 在 Write 之前的截图/编码内存有界。** helper 全进程树必须保留当前产品 Job 的 **512 MiB / 16 进程**上限，不采用 W0 探针的 1 GiB / 24 进程配额；须验证此限制在完整 WebView2 子进程树上生效，以及截图内存峰值、分配失败、限额终止和清理行为。所需工作集若超过现有上限，先报告不可用并提交实测证据，不能静默加预算。宿主核验PNG signature/IHDR、实际尺寸、像素与帧身份，再用现有 `image` crate 的有界PNG解码能力验证（必要时重编码移除非必要metadata）；不能只信helper报的尺寸。[resources.rs](../apps/desktop/src-tauri/src/resources.rs)已有PNG/JPEG/WebP解码依赖和limits模式，但当前导入限额是16 MiB/40MP，**不能直接用该更大配额替换上述renderer配额**。这不需要新的图片解码Runtime；PNG解析器仍是受信依赖，预算测试不能冒称不存在解析漏洞。

`CapturePreview` 抓取的是WebView显示区域，**不是自动“完整整图截图”**。拟在不向用户显示的独立原生窗口中给controller真实布局尺寸，等待初次ContentLoading、字体ready、官方render完成和合成绘制，再按已测图尺寸capture；native重新核对输出像素。全流程仍包含在原生2秒执行期限内。必须以原型证明隐藏窗口不会白图、旧图或闪现，并验证DPI/缩放、宽/长图、负坐标、阴影和overflow边界；单看viewBox或scrollWidth不能证明所有可见ink都在viewport里。截图边界不足不得裁掉图元后宣称成功，超预算必须保留源码。不能为了拿截图改用主WebView或偷偷显示窗口。官方[CapturePreview合同](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2?view=webview2-1.0.3537.50#capturepreview)只保证截图API语义，以上隐藏/全边界效果尚未实测。

图形文字不能像向量那样任意放大而保持锐利，也不可直接选择；保留完整源码、accessibleText与点击返回围栏编辑。screen的DPI和export的栅格比例须宿主控制并计入实际像素预算，不能由插件任意指定。跨平台像素不必逐字相同，但同平台应与固定官方原图对照；全37注册项及普通语法分支均需真实静态呈现验收，不能只测flow/sequence。

## 普通用户、包体与具体批准范围

| 项目               | 本方案的明确要求                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理员/UAC         | 设计不请求。需要真实标准用户验证；既有W0在管理员角色CI运行、未提权，不能据此保证普通用户已经通过                                                                                                                                                                                                                                                                                |
| 系统安全设置       | 不写WFP/防火墙/loopback exemption/注册表安全策略，不改Runtime ACL，不安装服务，不关闭浏览器sandbox                                                                                                                                                                                                                                                                              |
| 本次临时身份/目录  | 创建并删除独立AppContainer profile；仅自建私有执行/UDF树授权。若此操作也不被允许，则本案不能实施，不退回普通全权限helper                                                                                                                                                                                                                                                        |
| 应用执行文件可达性 | 先核验安装后的exe可被该身份读取执行；若不可达，可在同次自建private树放逐字验证的自有helper执行副本并精确授予RX；代码目录及其父目录对AppContainer均不可写/删除/重命名，不沿用W0整棵private递归F授权。启动前拒绝重解析点/路径替换，校验文件并以不共享写入/删除的打开句柄保持到实际执行绑定确认；不改安装目录ACL。该副本增加临时磁盘占用；若仍失败则不可用，不通过扩大系统权限解决 |
| 运行时             | 只复用既有WebView2；检查必需COM接口；缺失时报告不可用，不自动安装/升级Runtime                                                                                                                                                                                                                                                                                                   |
| 安装包体积         | 完整冻结引擎约5.3MB未压缩JS作为量级；PNG方案不需要旧SVG converter全部代码，但新增bootstrap/native桥/类型支持。正式installer增量必须真实构建对照，不能把entry压缩大小当installer差值；避免host与Windows插件各打包一份完整引擎                                                                                                                                                    |
| 插件独立性         | 独立安装/启停/卸载保留；固定renderer不再随插件任意升级，需宿主固定服务版本兼容检查。普通第三方插件JS从不进入helper                                                                                                                                                                                                                                                              |
| 输出/API变化       | 批准新增仅计算型固定服务capability与host-owned raster输出合同；不批准插件网络/文件/shell权限或任意DOM执行                                                                                                                                                                                                                                                                       |

**真正需要批准的差异是具体的：允许宿主固定的官方 renderer 在上述独立helper里处理恶意文档数据，同时接受“若官方JS/DOM/浏览器存在可利用漏洞，现有AppContainer不能保证阻止WebRTC/原生网络外发”的剩余风险。** 不授权任何正常文档功能联网；主动/外部资源仍拒绝，但不能把拒绝机制包装成OS层全网络保证。文件方面可保持无broker、无任意路径、AppContainer与canary验证，不承诺Windows所有可读资源都不可见。攻击插件本身仍受原Worker边界；它可提供恶意数据/滥用请求，因此绑定、预算与队列仍必须独立验证。

用户/父线程可批准的是“按此规格进行有限原型与验收”，不等于批准现在打包发布。当前W0失败和通用DOM/PDF门禁不改。若用户坚持零网络能力后的全路径OS拒绝，选择不实施本案；不再以未定的新信任模型提问。

## 进入打包前的可判定退出条件

1. **标准用户机制**：现有Runtime下启动成功，helper没有Tauri/host objects，精确私有UDF/身份/Job绑定，512 MiB / 16 进程限额覆盖所有后代并通过实际截图内存峰值与超限终止测试，原生2秒忙循环截止与取消/owner异常退出后后代归零；权限/API不满足时启动拒绝，无普通helper降级。
2. **仅数据合同**：更换/篡改/恶意第三方插件包只能运行其Worker；不能选择helper代码、页面、URL、文件、CDP或任意执行方法；跨实例/跨版本/迟到消息、伪造lease和资源耗尽均拒绝。
3. **内容路径**：原生HTTP/CSS/fetch/XHR/beacon/WebSocket等有限正反对照、导航/file/下载/外部scheme/权限/拖入拒绝及OS文件canary；UDP/TURN反例保留为明确“不提供的OS保证”，不能改绿或藏掉。测试既要记录被阻止的事件，也要由接收端检查实际送达。
4. **官方静态矩阵**：固定版本37注册项和重要语法分支，含HTML labels/MathML/阴影/overflow、中文、主题、DPI、宽长图；官方原图与PNG实看比对，尺寸、无裁剪、无旧帧、预算和截图截止均通过。外部图片、外部字体/图标、交互/动画能力单列限制，普通grammar失败不能被此列表吞掉。
5. **产品闭环**：安装启用→即时呈现→编辑/选择/源码返回→撤销/版本变化→禁用/卸载清理；PNG解码/lease释放/导出可读；真实Windows安装包验证与包体对照完成。

上述任何必需项未通过，完整官方Mermaid就仍未完成，**不能把“full未完成”移到beta6限制栏后照常宣称完成**。先取得明确方案选择，再开发原型、验收和打包。

本轮追加的只读API/源码核验见 `/tmp/milkup-beta6-mermaid-feasibility/service-primitives-audit.json`；11份本地输入的哈希及固定bindings中11个方法位置已记录。两份报告格式与本地链接核验通过；没有执行上述原型。
