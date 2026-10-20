# Windows W0 隔离里程碑：WebRTC UDP 拒绝门槛失败

基点为已接受的 `e37e9b43e0f8481074872a7514c62246e1cd0d0f`，分支为 `dot/milkup-v2-windows-backends`。**本轮发现可复现的受限 WebView2 网络请求送达，因此不接入产品 DOM/PDF。** W1 HTML 后端和既有应用代码未变；应用仍为 `2.0.0-beta.1`。Linux PDF 保持现有依赖、沿 WebKit 引擎补丁方向处理的用户决定继续有效，本轮没有改 Linux 输出代码或添加 Chromium 依赖。

## 已确认的阻塞

[第二轮 M02](https://github.com/Auto-Plugin/milkup/actions/runs/39367851284) 使用精确源码 `3d14a5672698fdd658d821c887a30bfb8567133b`。临时身份没有 capability，也不在回环豁免列表中；BFE、mpssvc、Dnscache 处于运行状态，Domain/Private/Public 防火墙配置文件均启用。本轮没有改这些配置。

受控页面仅创建 relay-only 的 WebRTC data channel，TURN 地址为本机自建 IPv4/IPv6 端点。服务器返回测试用 401 realm/nonce；随后收到带测试用户名的 Allocate 请求，未建立 TURN relay 或完成 RTC 连接：

| 案例                  |         IPv4 已收到的带用户名请求 |         IPv6 已收到的带用户名请求 | 发送端口的进程关联                                               |
| --------------------- | --------------------------------: | --------------------------------: | ---------------------------------------------------------------- |
| ordinary 正对照       |              4，用户名 `ordinary` |              4，用户名 `ordinary` | PID 6004，普通 WebView2 utility 进程                             |
| restricted            |            4，用户名 `restricted` |            4，用户名 `restricted` | PID 2652，AppContainer/0 capabilities，属于本次 Job              |
| restricted-owner-exit | 4，用户名 `restricted-owner-exit` | 4，用户名 `restricted-owner-exit` | PID 3772，AppContainer/0 capabilities，属于内外层受控 Job 的后代 |

端点记录实际数据包、测试用户名和接收时间；只读 `GetExtendedUdpTable` 按接收包的源端口查询所有匹配 PID，记录查询时的令牌。上述受限请求的快照各只匹配一个 PID，其保留的进程句柄、创建时间、`IsProcessInJob`、可执行文件路径和 WebView2 `GetProcessInfos` 的 utility 角色相互对应。两例的 SID 与本次临时 AppContainer SID 一致，完整性 RID 为 4096，capabilityCount 为 0。普通案例已经结束并回收，其与受限案例的测试用户名不同；因此无需靠短时“未收包”或单纯时间先后来解释结果。

这足以否定**当前方案对全部网络路径的拒绝声明**，不等于证明公网 UDP 可达，也不证明 Windows/WebView2 内部根因。没有抓取系统流量、修改过滤规则或尝试扩大权限来消除失败。M02 的四个执行/清理案例均完成，但网络 canary 门槛返回 false，进程退出 1，Actions 整轮明确失败。`fullIsolationGatePassed` 与 `productIntegrated` 均为 false。

## 分层证据与边界

| 项目                               | 机制 / 实测                                                                                                                                                                | 当前结论                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 身份与权限                         | 创建唯一临时 AppContainer；空 capability；仅测试 private 子树 SID ACE 和低完整性标签；创建时关联 Job，无继承句柄；记录实际 SID、capability SID 数组、完整性 RID            | 受限 helper 与已采样 Runtime 进程符合预期。不是全部短生进程/系统 broker 的令牌证明                     |
| IPv4/IPv6 原生 TCP/UDP             | 同端点普通 helper 能送达；受限 TCP 2 秒超时，UDP send 返回成功但测试标记未送达                                                                                             | 有限的两种原生调用路径观测；不能替代 WebRTC，不能泛化到全部端点或 socket 选项                          |
| WebView2 HTTP/XHR/beacon/WebSocket | 普通页面在两族地址各收到 fetch、XHR、beacon 和 WebSocket Upgrade 请求；受限案例没有对应请求送达。fetch/XHR 返回失败，beacon 返回 true                                      | 请求返回值与实际收包分开记录。WebSocket 正对照只证明 Upgrade 请求送达，测试服务器不完成 WebSocket 会话 |
| WebRTC UDP                         | 两个受限案例均收到上述带测试用户名的 TURN 请求，匹配到受限 utility 进程                                                                                                    | **拒绝门槛失败**。不以 CSP、JS monkeypatch 或不出现候选地址掩盖它                                      |
| 显式服务器 DNS                     | `DnsQueryEx` 仅指定本机 `127.0.0.1:53`，测试名 `.invalid`；不递归、不转发、不改系统解析器。M02 普通调用状态 0、实际收到查询、返回记录；三个受限调用状态 87，无对应查询送达 | 普通正对照成立；受限 87 保留原值，不能改写为网络拒绝 10013。**未验证 WebView2 系统 DNS 路径**          |
| 原生文件打开                       | 普通进程可读、可写打开自建外部 canary；受限进程均拒绝 5；私有测试文件可读                                                                                                  | 只针对自建 canary，不代表任意 Windows 可读资源都被禁止                                                 |
| WebView2 file://                   | 普通页面可读取私有和外部测试 HTML 的精确 marker；受限页面能读取私有文件，外部导航失败且无 marker                                                                           | 实际引擎文件导航对照成立；未以 CORS 失败代替 OS 文件拒绝，也未扩大任意文件/URL 支持范围                |
| 原生文件选择器                     | 显示自建测试窗口，以 CDP `userGesture=true` 发起 input-file click；普通案例观察到 Job 内可见 `#32770` 对话框并只关闭该 Job 的窗口；受限案例未观察到该对话框，均未选择文件  | 有有限正/负对照；**不覆盖 broker 窗口、所有文件选择 API 或普通用户 GUI 验收**                          |
| 直接 breakaway                     | 每例以 `CREATE_BREAKAWAY_FROM_JOB` 请求创建受控、保持挂起的自身程序；均拒绝 5。意外成功路径会在恢复执行前终止并等待                                                        | 只验证直接 CreateProcess 路径，不声称阻止所有 broker/服务创建路径                                      |
| 取消 / 硬截止                      | 正常案例由宿主终止整个 Job；另例实际引擎执行永不 resolve 的 Promise，宿主在观测到该阶段后 2 秒截止                                                                         | 后代归零，所有保留进程句柄均变为 signaled；不等于 CPU 密集/内存耗尽/全部 Runtime 故障覆盖              |
| 宿主异常退出                       | 内层 owner 持有不可继承的 Job 句柄，直接 `ExitProcess(73)`，不运行 Rust Drop；外层宿主尚未 TerminateJob 前已观察到 ActiveProcesses=0                                       | 该受控异常退出和 KILL_ON_JOB_CLOSE 案例通过；不是任意系统 broker 生命周期保证                          |
| 清理与数据                         | 每例 Job ActiveProcesses=0；最终 profile 删除且其目录不存在，private 树/ACL 删除，cleanupErrors=[]；外部 canary 字节不变                                                   | 两轮均成立，无权限/目录残留报告                                                                        |

M02 普通、受限、异常 owner、硬截止四例观测时长分别为 16705、23621、23577、6684 ms。Job 累计进程分别为 11、12、14、8；保留句柄的不同 PID 分别为 10、11、13、8。前三例各有一个已计入 Job 但没有令牌采样的短生进程。completion port 收到 NEW_PROCESS 数量分别为 11、12、14、8，但通知 API 并非全部事件的可靠审计源，且退出通知未在所有案例的有限 drain 中齐全，因此不声称进程覆盖完整。

WebView2 `GetProcessInfos` 明确不包含 crashpad。Job 计数、通知、成员采样、保留句柄、引擎进程列表分别保存，未合并成虚假的“所有后代已验证”。本轮 CI 原始宿主具有管理员角色，但没有提权；ordinary 指未放进 AppContainer 的配对 helper，不是普通 Windows 用户兼容性证明。

## 原始失败与修正记录

| 运行                                                                  | 精确源码                                   | 实际结果                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [M01](https://github.com/Auto-Plugin/milkup/actions/runs/39367303098) | `458e8f0865a6fbc650a990512abe526232d6e562` | 执行/清理脚本成功，产品/完整隔离标志始终 false；已观察到受限阶段新 TURN/STUN 包，但尚无用户名/端口 PID 关联。DNS 两侧均 87，不能当作正对照；隐藏测试窗口下两侧均未观察到 picker，不能当作拒绝证明。普通/受限 Job 总进程 11/12，采样 10/11 |
| M02                                                                   | `3d14a5672698fdd658d821c887a30bfb8567133b` | 按 Microsoft DNSAsyncQuery 示例保留 DNS_ADDR 元数据默认值；普通 DNS 对照成立。显示测试窗口后普通原生选择器成立。补 TURN 用户名及 UDP owner-table、Job 通知、异常 owner 与硬截止；**网络 canary 实际失败，CI 红灯保留**                    |

M02 的 stderr 失败行插入 stdout JSON 中间，首次本地日志提取失败；原始下载 ZIP 和日志不改。提取时仅去掉时间戳前缀及 group 第 2403 行的精确独立 stderr 文本，另存 `parse-provenance.json`，保留该行的内容与位置。没有删除失败或重写原始结果。

## 验证、交付与下一步

- 当前相关 CI 合同测试 **57/57** 通过；Windows 目标 `cargo check --offline --locked`、Rust fmt、变更格式/空白检查通过。两轮 Windows 都实际编译并运行独立探针。W1 已验 174 项 Rust/15 个完整阶段保持原历史，本轮未把它们当作重新运行的产品验证。
- 应用、packages、plugins、vendor、应用 Cargo.lock、pnpm 锁文件与基点相同；新增 Win32 feature 仍来自原有版本，没有新包版本或运行时。无 core public API、共享 CSS 或大纲变更。
- 两个提交作者均为 `LarryZhu-dev <larryzhu@foxmail.com>`，GitHub 身份 ID 40397402；两轮 Actions artifact 数均为 0。没有安装包、Runtime 下载、Windows 构建产物上传、合并、部署或 Release。
- [证据索引](evidence/win-w0-isolation-20261020/index.json)、[原始日志/JSON/源码快照包](evidence/win-w0-isolation-20261020/evidence.zip)和[独立校验器](evidence/win-w0-isolation-20261020/verify.py)可复核此结果。此前 W1/W0 证据包原样保留。

**建议保留 Windows DOM/PDF 关闭状态，先定位这个受限 utility 进程的 UDP 路径，再讨论可满足安全合同的方案。** 当前 canary 已经证伪候选边界；仅关 WebRTC JS API、改变网页 CSP 或依赖 Runtime 参数不应当被标记为 OS 全通道网络隔离完成。尚缺 WebView2 系统 DNS、非回环受控端点、broker 完整性、更多文件选择 API、普通用户 GUI 等证据，不应继续叠加产品功能来遮蔽这些缺口。

本轮没有申请或执行新的安全权限。若后续定位需要系统网络追踪、WFP/防火墙配置、服务或 Runtime 权限变化，须先给出具体操作、范围、清理方案和必要性并另行授权；不能沿用本次“临时身份和私有目录”的许可。

机制参考：微软 [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)、[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[loopback exemptions 查询](https://learn.microsoft.com/en-us/windows/win32/api/networkisolation/nf-networkisolation-networkisolationgetappcontainerconfig)、[DnsQueryEx](https://learn.microsoft.com/en-us/windows/win32/api/windns/nf-windns-dnsqueryex)、[Microsoft DNSAsyncQuery 示例](https://github.com/microsoft/Windows-classic-samples/blob/main/Samples/DNSAsyncQuery/cpp/DnsQueryEx.cpp)、[WebView2 process infos](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment8?view=webview2-1.0.3537.50)。这些机制说明与本轮有限实测分开使用。
