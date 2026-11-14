# Windows W0 UDP 机制诊断：重复发送已在原生路径复现

基点 `1d095d4def531e73578902ad36591e13ed1d8d58`，隔离分支 `dot/milkup-v2-windows-backends`。最终实测源码 `6af70966994927e116d58de40c46398d1ccf0e43`。这是一份**失败诊断里程碑**，没有启用 Windows DOM/PDF，没有完成产品验收。

## 结论与需要修正的判断

**当前 Windows CI 环境中，AppContainer / 0 network capability 不能独自提供要求的 UDP 拒绝边界。问题可以脱离 WebView2，在原生 helper 自建 socket 的重复发送中复现。** D03 的受限 helper 在启动自己的 Runtime 前，对 IPv4 loopback、IPv6 loopback、同机私有 IPv4 各执行一次“三次发送、间隔 250 ms”的测试；每个 socket 都有两份合成标记送达，并收到正确回显。Runtime 结束后的原生测试得到同样结果。

因此，D02 的“原生 30 个单发组合均未收到、Runtime TURN 实际送达”只能说明那一组单发观察，不能外推为原生通道隔离成功，也不能据此断定只有 WebView2 broker 绕过。D03 直接否定了 broker 是复现的必要条件；它仍未定位 Windows 内核的具体分类规则、缓存或运行环境根因。不能将结果称为通用 Windows 漏洞，也不能声称已排除所有 runner 配置影响。

产品 DOM/PDF 保持关闭。没有通过禁用 WebRTC、缩短观察窗口或把 CI 改绿来“修复”失败。Linux PDF 保持既有依赖、转向 WebKit 补丁的用户决定不受本分支影响。

## 三组真实 Windows 结果

| 实验 | 精确源码 / Actions                                                                                                         | 原生对照和实际结果                                                                                                                                                          | 判定                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| D01  | `4ed8d76439243d0fef4677d12b40460caaab4886` / [39369212541](https://github.com/Auto-Plugin/milkup/actions/runs/39369212541) | 接收器向已经关闭的 UDP peer 回显后遇到 10054，三个接收线程退出；后续普通正对照与 TURN 缺失                                                                                  | **实验无效**。原始 CI success 和 `networkCanaryGatePassed=true` 原样保留，不能当作通过 |
| D02  | `323c27d83c5ac17e87a3bf9709f77863eb8b786b` / [39369762462](https://github.com/Auto-Plugin/milkup/actions/runs/39369762462) | 普通 30/30 单发组合收到，24/24 保持 socket 的组合正确回显；受限 0/30 收到；受限 Runtime 在三地址各 4 个具名 TURN Allocate 请求送达                                          | 有效对照，**网络失败**                                                                 |
| D03  | `6af70966994927e116d58de40c46398d1ccf0e43` / [39370364907](https://github.com/Auto-Plugin/milkup/actions/runs/39370364907) | 普通 42/42 组合收到、36/36 保持 socket 的组合正确回显；受限 36 个单发组合均未收到，但 6 个重复发送组合各收到 2/3 包并正确回显；受限 Runtime 仍各地址 4 个具名 TURN 请求送达 | 有效对照，**网络失败，共 24 个受限 canary 收据**                                       |

D02/D03 的观察判定均为 `observationControlsPassed=true`、`observerErrors=[]`、`missingPositiveControls=[]`、`networkCanaryGatePassed=false`。D03 的 24 个失败收据由 12 个原生重复发送包和 12 个 Runtime TURN 请求组成；不是 24 个不同网络通道。

原生组合按 Runtime 前/后 × 三个地址执行。前五项是显式地址 bind 后立即关闭、显式 bind 保持、通配 bind 保持、通配 bind 后 connect/send、同步 WSASendTo。D03 再增加 overlapped WSASendTo 和同一 socket 重复 send_to。保持时间为 750 ms；重复发送在 0/250/500 ms 后再保持 750 ms。没有缩短既有观察；每个诊断 case 的外层硬截止为 120 秒。D03 普通/受限 case 分别约 49.8/74.2 秒正常完成，未触及硬截止。

重复发送的三个数据包使用同一标记，接收日志未为每次发送编号。因此只能证明收到其中两包，不能把它们精确标为“第二、第三包”，也不能证明第一包在内核的去向。这个限制不影响已发生送达的失败判定。

## 接收器修正与失败保护

D01 是诊断工具自身的错误：把对已关闭 peer 的回显所引发的 10054 当作接收器致命错误，却继续将无收据解释为隔离成功。D02 起不向 `explicit-close` 回显，遇到 10054 记录为 peer ICMP reset 并继续接收；其他接收器错误继续显式报告。

新的判定先检查实际受限送达；只要送达就失败。没有送达时，还要求每个地址的普通 TURN、HTTP 路径、原生组合收据及适用回显全部有效。观察器死亡或缺失正对照返回未决，CI 失败，不能变成通过。三个 Windows Rust 回归测试分别覆盖接收器死亡、缺失正对照/矩阵、实际送达不得被缺失对照掩盖；D02/D03 均实际执行通过。完整隔离门槛始终为 false，即使狭窄 canary 判定将来通过，也不会自动启用产品。

## 身份、环境与机制的区分

D03 为 Windows `10.0.26100`，已有 WebView2 `154.0.4258.62`。原始 CI host 具有 administrator role；未提权，也不能以此代替普通用户安装后 GUI 验证。仅使用临时身份、测试私有目录及受控合成数据。地址为 `127.0.0.1`、`::1`、同机 `172.24.0.1`；最后一个不是远端主机或公网覆盖，未测试远端 IPv6。

- **原生实际发送者**：受限 helper PID 1280，AppContainer=true、capabilities=[]、capabilityCount=0、appContainerNumber=9、低完整性级别 4096。Runtime 前/后身份一致。其代码自行创建 socket，发送路径没有 broker、句柄转移或 impersonation API。Runtime 前已有重复发送收据，因而该复现不依赖这个 helper 启动 Runtime。普通 case 的 Runtime 在此前已经执行并清理，所以不能进一步声称“整台机器从未运行过 Runtime”的冷机结论。
- **Runtime 实际发送者**：受限 TURN 的端口在收据时关联到 utility PID 9392，位于 owner Job，主令牌与 helper 的精确 AppContainer SID、0 capability、appContainerNumber 相同。IPv4/IPv6 绑定分别为 `0.0.0.0` / `::`。D02 同类关联为 utility PID 7796。端口归属是收到时快照，不等于 socket 创建调用栈。
- **线程令牌**：D03 具名受限 TURN 收据中，成功枚举的发送者线程均返回无 thread token（1008）；helper 前/后亦如此。这排除了这些快照时刻的可见 impersonation，不能排除更早的短暂身份切换或 Runtime 内部 broker。`lessPrivilegedAppContainer` 查询返回 87，保留为未知，不能写成 LPAC=false。`hasRestrictions=0` 也不是“没有 AppContainer 限制”的同义词。
- **loopback exemption**：实验前、普通 case 后、受限 case 后均为空，自己的 SID 不在例外表内。没有写入例外。
- **有效策略**：D03 在整个探针前后读取 `Get-NetFirewallProfile -PolicyStore ActiveStore`，两份结果相同且无查询错误；Domain/Private/Public 均 Enabled=1。有效规则计数均为入站 Allow 100、出站 Allow 82、出站 Block 1。已存在一条匹配该 Runtime 程序的入站 Allow 规则，前后相同；不能仅凭它归因，更不能把它当作原生 helper 重复发送的解释。QWAVE 前后均 Stopped/Manual；未启动、停止或配置服务。

此前 M01/M02/D01/D02 的 `Get-NetFirewallProfile` 未指定 store，实际读取 **PersistentStore**。Microsoft 文档明确区分默认持久配置与 ActiveStore 的有效策略。本报告补充并收窄旧报告的环境证据：不能把旧的“profiles enabled”当成完整有效策略审计。[Microsoft Get-NetFirewallProfile](https://learn.microsoft.com/en-us/powershell/module/netsecurity/get-netfirewallprofile?view=windowsserver2025-ps)。

ActiveStore 前后快照仍不是逐包 WFP 分类日志，也不证明运行期间所有动态过滤器完全不变。剩余机制缺口是：哪些具体过滤层/规则允许重复包、是否存在临时分类或流状态变化、该 runner 环境与普通用户机器有何差异。现有证据不支持选择其中一个作为定论。

上游 Chromium 存在 [brokered UDP client](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/services/network/brokered_udp_client_socket.cc)；其 [broker helper](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/services/network/broker_helper_win.cc) 对部分地址选择 broker。然而 [P2P UDP 默认 factory](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/services/network/p2p/socket_udp.cc) 又使用 UDPServerSocket/nonblocking 路径。它们只说明候选机制，**不能证明本次 WebView2 二进制的精确实现或实际调用路径**。本次关键排除依据是原生实测，而不是把上游源码猜测套到 Runtime。

## 清理、验证和保留的限制

三组均完成私有树/本次 ACL 清理、测试身份删除、profile folder 不存在、外部合成文件未变化、`cleanupErrors=[]`。D03 两个 Job 的 activeProcesses 最终为 0，所有保留的进程句柄均 signaled。普通/受限 Job 累计进程数为 11/12，采样到 10/11；瞬时后代仍有采样缺口，不能称每一个后代令牌都有证明。完整 owner 异常退出、deadline 和选择器矩阵没有在 D03 重跑，继续引用[前一失败里程碑](v2-windows-w0-isolation-2026-10-20.md)的原始证据和限制。

本地 58/58 CI 合同测试、独立探针的 Windows MSVC `cargo check --offline --locked --all-targets` 和 rustfmt 通过；Windows D03 实际编译及三个语义测试通过，探针因真实网络送达正确失败。未重跑未变更的整个产品功能套件，也没有把独立探针检查称为产品 GUI 验收。没有修改 apps/packages/plugins/vendor、应用版本、产品锁文件或 Runtime 安装；没有上传 Actions artifact、安装器或可执行产物。之前的 M01/M02 冻结 ZIP 与校验器保持不变并重新校验通过。

## 不增加 Runtime 体积的后续建议

在现有授权范围内，**可立即保持的产品状态是 W1 HTML 可用、Windows DOM/PDF 关闭**。当前没有已验证、可直接接入产品的 UDP 修复。继续重复同样的单发实验、禁用一个 Web API 或设置 Chromium 开关都不足以满足完整合同。

若父线程选择继续同一 Windows 引擎，建议把下一步改为一个有退出标准的 OS 策略原型：围绕本次独立 AppContainer 身份，验证显式 WFP deny 是否真正覆盖重复 UDP、TCP、IPv4/IPv6、loopback、Runtime 和 broker/DNS 代理路径。Windows 已有 WFP，候选实现不需要捆绑第二个 Runtime。Microsoft 提供 AppContainer SID 条件 `FWPM_CONDITION_ALE_PACKAGE_ID`，但条件只适用于部分过滤层，不能直接推定它能覆盖所有代理流量。[WFP 条件](https://learn.microsoft.com/en-us/windows/win32/fwp/filtering-condition-identifiers-)、[WFP 访问控制](https://learn.microsoft.com/en-us/windows/win32/fwp/access-control)。

这只是待验证方案，**本轮未实施，也未获授权修改 WFP/防火墙或提权**。如要实施，应先提交精确权限范围：仅临时 runner、本次新建 SID、明确 provider/sublayer/filter 标识和生命周期；不写广泛的 `msedgewebview2.exe` 拒绝规则以免影响编辑器/其他应用；策略必须在任何受限进程启动前生效，并且控制端异常退出时不得留下活着但失去网络约束的子进程。需要什么权限以及动态对象/清理的可行性必须先核验；不能提前承诺无需服务、无需管理员或一定可部署。

对这一路径的验收至少包括本报告重复发送反例、原始 TURN 反例、身份归属和有效过滤记录、普通正对照、取消/异常退出/清理，以及现有未关闭的 DNS/选择器/全部后代边界。若父线程不接受新增 OS 策略权限，则保留关闭状态；产品路线由父线程决定，不在本分支擅自变更。

原始日志、精确源码、无效 D01 和真实失败 D02/D03、解析来源及逐文件校验见[证据目录](evidence/win-w0-udp-20261020/README.md)。所有数字来自实际收据，未将 Linux 结果当作 Windows 证明。
