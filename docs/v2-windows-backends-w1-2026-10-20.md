# Windows W1：受控 HTML 导出与可信 helper 生命周期

从已接受 P8 `3747004b15e1dcf9c92b794b1f818c0853b98d11` 继续，工作分支 `dot/milkup-v2-windows-backends`。应用保持 **2.0.0-beta.1**，Git 身份为 LarryZhu-dev <larryzhu@foxmail.com>。本报告记录 Windows 后端的限定里程碑，不表示 DOM/PDF、GUI 或安装包完成。

## 技术路径与实现

[完整路径与 W0 决策](v2-windows-backends-plan-2026-10-20.md)保留既有隔离合同。W1 实现 HTML 发布和原生目标选择：输出插件及公开 SDK 未改，宿主继续接收通用输出格式和受控租约。Windows DOM、PDF/打印仍明确拒绝，未借用主 WebView，未执行插件模块。

- **目标授权**：选择器在独立可信进程中运行，只接收有界默认文件名，不接收文档 HTML。实际 COM 对话框禁止探测写文件、快捷方式解析和更改当前目录；系统错误和用户取消分别处理。路径仍需由宿主复核，插件传入路径不构成授权。
- **进程生命周期**：Job Object 不继承 owner 句柄、不允许 breakaway；helper 的 stdin 握手在成功纳入 Job 后才释放。取消及 10 分钟租约截止会终止 Job，并以 ActiveProcesses 为零确认清理。宿主异常退出关闭 owner 句柄；这只是进程归属，不是网络/文件沙箱。
- **文件发布**：限本地 NTFS，拒绝 UNC、设备/管道、ADS、模糊名称和重解析点祖先。相对被保护目录句柄创建 stage，严格 flush 文件，并在取消锁内重查目标内容、源身份和权限后按句柄重命名。新目标使用不覆盖语义；失败只删除拥有的 stage，提交后的输出不随 abort 删除。
- **原文保护**：保留源文件、原源身份和其他打开文档的保护。另补 Windows 缺失文件的大小写别名：以父目录身份加原生 ordinal 名称比较判断，覆盖 RUNNER~1/canonical 父目录别名；不同目录同名仍允许。
- **权限与依赖**：旧目标的 DACL 在首个内容字节写入前复制到新 stage；不修改旧目标、源文件或系统目录 ACL。仍有 480 个依赖包，版本和既有依赖边不变，只直接引用已在锁文件中的 Windows 0.61.3 与 windows-sys 0.61.2。

已有目标沿用现存“立即复查后提交”的外部写者边界，不宣称与任意并发写者的文件系统 CAS。Windows 文件 flush 不等于 POSIX 目录元数据 fsync，不宣称任意断电持久性。DACL 证据不等于所有 Windows 文件元数据保留。

## 实际验证记录

| 运行                                                                                        | 精确源码与结果                                                                                                                                                                          | 边界                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [W01 修复前](https://github.com/Auto-Plugin/milkup/actions/runs/39359055547)                | `089b947ec1a5bfa776a213a6387631e9d0c04033`；14/15 阶段通过；Windows lib **156 通过、3 失败、1 个既有忽略项**                                                                            | 两项 HTML 发布报 unavailable；一项 ADS/模糊名错误接受。编译/生产链接成功，artifact 0                                                  |
| [W02 实现候选](https://github.com/Auto-Plugin/milkup/actions/runs/39360165677)              | `c0eb8d0fe37e5cfe2e23918d6098261fb83b4a8e`；Windows lib **166 通过、5 失败、3 忽略**；发布路径报 Win32 87                                                                               | 不是最终含大小写/句柄相对创建补强的源码                                                                                               |
| [W03 修复及补强](https://github.com/Auto-Plugin/milkup/actions/runs/39362396405/attempts/1) | `5a32efdb0de21adb783c8d806cf48c49450a19a8`；Windows lib **174 通过、0 失败、3 忽略**；22 项新回归全部通过                                                                               | 整轮失败：未修改的独立 outline 测试在完成后未及时显示 Last；39/40 通过，后续生产构建未执行。原始失败保留                              |
| W05 同源码复跑                                                                              | [同一 run 的 attempt 2](https://github.com/Auto-Plugin/milkup/actions/runs/39362396405/attempts/2)，**15/15 阶段通过**；Windows lib **174 通过、0 失败、3 忽略**，22 项新增回归再次通过 | 11 个独立插件、工作区测试/类型/构建、完整 check、生产链接及 manifest 验证通过。没有改大纲实现或测试超时；一次复跑通过不消除原时序失败 |
| Linux 完整 native                                                                           | 188 通过、0 失败、5 个既有忽略项                                                                                                                                                        | Windows 专用代码不由这个结果验证；输出保护另跑 7/7                                                                                    |

Windows 测试使用真实 NTFS、COM 配置及 Job API。子进程 fixture 是测试二进制中的私有入口，由相应父测试显式启动；其独立 ignored 标记不能计为通过。选择器协议测试使用受控 fixture，不能代替用户实际点击对话框或最终安装应用。

## 尚未关闭

- **Windows DOM/PDF/打印**：后端仍未启用。用户已明确批准限定 W0 原型。首次 Windows 实验在受限进程启动前返回错误 203；Job 归零、测试 profile 和私有目录清理均已确认。补齐私有 profile 环境后，受限进程与单个文件 canary 拒绝成立，W08 又完成静态 Runtime 兼容性预检；网络隔离验收及产品接入均未完成，详细结果见下。没有修改防火墙、启用 loopback、修改 Runtime/系统 ACL 或提权。
- **GUI**：窗口焦点、用户实际选择/取消、已安装应用、真实 IME、读屏和系统 DPI 未验。没有 Windows 截图，也没有把 Linux 或模拟传输当作 Windows GUI 成功。
- **跨平台及产品**：macOS 输出后端仍未实现；Linux WebKit PDF 的精确 Unicode、长块分页和历史 Print04 问题不变。P7 性能尾延迟等原门槛继续开放。
- **发行**：没有生成或发布安装器，没有下载 Runtime、上传 Actions artifact、创建密钥、购买服务、合并或部署。

## W0 兼容性实验（与产品入口分开）

[W04 原始实验](https://github.com/Auto-Plugin/milkup/actions/runs/39362983077) 使用 `ea0f638bfff583589dbc493de61bce1e8599336e`，已安装 Runtime 154.0.4258.62；没有下载或更改 Runtime。只读探针显示该临时 runner 的当前进程本来具有管理员角色，本次没有提权；不能据此宣称普通用户实机兼容。原型单独编译，29 个依赖包的版本/校验和都来自既有应用锁文件；产品的 480 包闭包不变。

本次权限仅限随机唯一的测试 AppContainer 身份，以及本次新建 `private` 子树中的 SID ACE/低完整性标签；没有改外部 canary、系统、用户文档或已有 Runtime 的 ACL。启动时要求空 capability、清空继承环境中的 WebView2 overrides、进程创建即归属不可 breakaway 的 Job，未继承任何句柄。TCP/UDP 有普通宿主可达的正对照；外部文件 canary 不作权限修改。记录每次失败，不通过扩大权限或普通 WebView2 回退消除失败。

W04 实际结果：创建受限进程前报 Win32 203。没有 child/DOM 成功证据；既有 Runtime 能否在该边界内运行仍未证实。cleanupErrors 为空，Job ActiveProcesses=0，profile 删除并确认其目录不存在，私有子树和对应 ACL 已删除，外部文件字节保持不变。[W06](https://github.com/Auto-Plugin/milkup/actions/runs/39363251595)（`98035a917f1e2aa9bf06e3f441340a464db30688`）只补充指向私有目录的 APPDATA/LOCALAPPDATA/USERPROFILE 和精确启动错误上下文。受限进程实际启动，启动前及子进程令牌均为 AppContainer、capabilityCount=0；外部 canary 的读/写打开均返回拒绝访问 5，原文未变。网络预检没有得到预期 10013，首次诊断仅保存 raw_os_error，空值无法区分“成功”与“封装错误没有原生码”；宿主 TCP/UDP 均没有接收到 canary。因此不能把这次空值解释为网络放行，也不能当作可靠拒绝证据。WebView2 尚未启动。Job 归零、profile/私有目录删除、零 cleanupErrors 再次成立。

[W07](https://github.com/Auto-Plugin/milkup/actions/runs/39365162883)（`385c3433109bb18070a4c65af02201a7e254d59b`）补充原生诊断，确认 WinSock 初始化返回 0，TCP 是 TimedOut、UDP send 返回成功，但宿主未收到 TCP 连接或 UDP 包。两个 Job 成员分别为原型和系统 conhost，均观察到 AppContainer/0 capabilities。文件拒绝、Job 归零及身份/目录清理再次成立。原型对“必须返回 10013”的假设不成立；UDP send 成功不等于收到数据。此次仍未启动 WebView2。

W08 保持隔离配置，改为宿主检查已通过正对照的 TCP/UDP listener，连续观察子进程报告后的额外 1 秒，不忽略 listener 错误，并记录迟到流量。仅在 TCP 明确拒绝或超时、UDP 已尝试发送或明确拒绝且两端均未收到 canary 时，释放可信静态 Runtime 实验；不是产品授权通道，不声称验证了 DNS/WebRTC。[W08](https://github.com/Auto-Plugin/milkup/actions/runs/39365466103)（`263e52df2ec681391a5f4f16b5f2f6dce24bb33e`）实际通过静态兼容性原型：已有 Runtime 154.0.4258.62 创建 environment/controller，NavigateToString 后 ExecuteScript 精确返回 `中文 😀`。8 个被采样到的 Job 成员（原型、conhost、6 个 WebView2 进程）均报告 AppContainer=true、capabilityCount=0。最终 Job ActiveProcesses=0，profile 删除且其记录目录不存在，私有目录/ACL 删除，cleanupErrors=[]，外部 canary 未变。**这是静态兼容性原型通过，不是 W0 完整隔离验收通过；产品未接入。**

即使原型能完成静态 DOM，也只证明兼容性预检；完整 DNS/WebRTC、文件选择器及所有 renderer/broker 后代边界仍需独立证据。不会把一次 loopback 拒绝或 Job 成员列表当作完整产品沙箱证明。

W1 产品源码为 `5a32efdb0de21adb783c8d806cf48c49450a19a8`。后续 W0 仅修改独立 CI 原型、门禁与文档，产品源码哈希保持相同。W05 生产二进制（仅在 runner 内链接/检查，不上传）SHA-256 为 `AEC104CA6A2984BF0F39D0AD0FF18AF7FE56862781FA0729E532A877219CC792`，含 Common Controls v6 和 asInvoker manifest，检查前后哈希一致。

## 机制、观测与尚缺证据

- **平台机制**：使用 Microsoft AppContainer、空 capability、低完整性私有目录，以及创建即纳入、禁止 breakaway 的 Job。Microsoft 文档说明 AppContainer 按权限隔离资源，同时明确只读文件访问比写入限制更少；它不等于“任意文件完全不可读”。见 [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)。本轮没有把平台说明当作所有具体通道的运行证据，也未核验 runner 的全部既有 WFP/防火墙/loopback 例外策略。
- **令牌观测**：启动前、helper 内部及 Job 采样中的 8 个 PID 都观察到 AppContainer/0 capabilities。这证明这些被观察进程的相应令牌属性，不证明每个短命进程、COM/系统 broker 或 Job 之外进程都已被发现。
- **网络 canary**：由原生 helper 发起，对宿主 127.0.0.1 上各一个 TCP/UDP 临时端口；普通宿主先证明同端口可达。helper TCP 在 2 秒后超时，UDP send 返回成功；宿主在报告后的额外 1 秒及其后的采样中未接受连接/收到数据。仅是有正对照的有限 IPv4 loopback 连通性观测，**不等于所有网络通道已被 OS 拒绝**，也不是从 WebView2 JavaScript/network service 发起的验证。
- **文件 canary**：只覆盖私有子目录之外一个普通兄弟文件的 read/write-open 拒绝（5）及字节不变。没有验收任意文件、用户目录、文件选择器、URI/重解析别名或 WebView2 文件通道。
- **渲染及退出**：仅可信固定 HTML/Unicode DOM 返回值，无插件模块、PDF、打印、截图或用户 GUI。Job 清空和测试身份/目录删除均有实际结果；这不等于所有未观察到的外部 broker 都已证明不存在。

## 推荐的下一阶段（交父线程决策）

建议继续同一 AppContainer 路线，先做 **W0 全通道验证**，通过后再实现通用 Windows DOM host；不要用普通权限 WebView2 或主编辑器 WebView 代替门槛。

1. **只读环境基线**：记录当前身份/完整性、capability SID、Job 限制、现有 BFE/防火墙服务及 loopback 例外状态；不改策略。对普通用户 Windows 会话独立验证，CI 已有管理员角色不能替代它。
2. **网络矩阵**：分别从 helper 与真实 WebView2 页面/network service 发起 IPv4/IPv6 loopback、可用非 loopback 接口上的 TCP/UDP、HTTP(S)、WebSocket、导航/重定向/子资源、DNS/解析以及 WebRTC/STUN/ICE/UDP 测试。每个用例都需正常进程正对照、唯一 canary 与接收端记录、覆盖异步/迟到流量的截止，而非只依赖 API 错误或短暂无包。DNS 外部解析及公网端点若没有现成可控观察端，应明确保持未验；需要新增监听基础设施、包捕获/ETW 权限、防火墙或系统 DNS 配置时先报告，不在本轮授权下执行。
3. **文件与选择器矩阵**：使用自建非敏感 canary，分别从 helper 和 WebView2 验证私有 UDF/固定输入允许、外部文件 read/write 拒绝、file URI/导航/fetch、下载、文件选择器、URI/编码/大小写/硬链接/junction/UNC 等入口；外部 canary ACL 保持原状。测试任何需要新权限的路径先报告，不读取真实用户文档作为测试材料。
4. **完整生命周期**：覆盖实际 browser/renderer/GPU/network/crash helper 的角色、令牌与归属，检查短命后代及 COM/broker 外部启动可能性；验证取消、超时、异常退出、旧请求、双任务私有 UDF、禁止 breakaway、终止后无迟到消息/写入。采样列表不能独自关闭这项。
5. **通过后才接产品**：宿主只实现通用 DOM 协议、尺寸/资源预算、取消/撤销与硬截止；插件继续独立，先通过固定可信 fixture 再运行 diagrams。PDF 在隔离合同成立后接静态转换与 W1 的目标授权/发布，另验 Unicode 精确提取、分页与完整内容。真实系统打印、Windows GUI/IME/DPI/读屏及安装应用仍需单独验收，不由 CI 原型代替。

当前建议不是扩大安全权限的申请；这些新增权限或交付动作仍需父线程在具体方案明确后决定。本轮停止在已验证的 W1 源码/OS 检查点与 W0 静态兼容性原型。

## 证据与提交

[证据说明与校验器](evidence/win-w1-20261020/README.md)、[逐文件索引](evidence/win-w1-20261020/index.json)、[完整日志与源码 ZIP](evidence/win-w1-20261020/evidence.zip)。原始 W01/W02/W03/W04/W06/W07 失败、W05/W08 成功及每次 artifactCount=0 全部保留。运行 `python3 docs/evidence/win-w1-20261020/verify.py` 校验完整性。全仓 Prettier、两个 Rust manifest 的格式检查、版本、31 个更新器文件哈希及 CI 门禁检查通过。Linux 完整 lib 188/0/5 忽略对应 W1 补强阶段；后续产品变化仅在 Windows cfg 分支。

产品代码检查点 `5a32efdb0de21adb783c8d806cf48c49450a19a8`；最后的独立 W0 原型代码 `263e52df2ec681391a5f4f16b5f2f6dce24bb33e`。GitHub 已核验各代码提交的 author/committer 均为 LarryZhu-dev（40397402）及指定邮箱。报告/证据随后以普通提交保存，不改写以上历史。
