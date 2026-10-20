# Windows 后端首个里程碑与隔离决策

基线 `3747004b15e1dcf9c92b794b1f818c0853b98d11`，隔离分支 `dot/milkup-v2-windows-backends`。应用保持 `2.0.0-beta.1`。本轮仅源码、测试、公开标准 Windows CI 编译/OS 测试；无安装器、Runtime 下载、产物上传、合并或发布。

## 已有设计的约束

[P4 checkpoint27](v2-product-phase4-mermaid-engine-2026-10-16.md#windows-独立-dom-后端的最小实施门槛) 明确把 Windows W0 列为实施前门槛：网络的 WebRTC/UDP/DNS 路径和文件选择器不能只靠资源过滤或 JavaScript monkeypatch 宣称禁止。[P8 清单](v2-product-phase8-readiness-checklist.md) 将 Windows DOM、受控 PDF/打印列为未实现，Linux 结果不能替代。

WebView2 包含 browser、renderer 和其他 helper；共享 user-data folder 可以共享进程组，关闭一个控件不能独自证明所有所属后代已消失。[Microsoft 进程模型](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)。Microsoft 还要求把网页视为不可信、限制 host objects、脚本和导航，并推荐普通用户完整性级别；这些设置没有提供本项目要求的所有网络与文件通道的 OS 拒绝证明。[WebView2 安全指南](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)。

因此：不能将另一个普通权限 WebView2 窗口、独立 user-data folder 或 Job Object 直接称为安全 DOM 后端。当前 DOM 和 PDF/打印继续 fail closed，没有在主编辑器 WebView 中执行插件，也没有加载插件提供的 URL。

## 本轮可独立完成的 W1

1. Windows **HTML 导出**：复用现有插件、输出租约、序列化内容和源文档/已打开文档身份保护。原生选择器仅返回候选路径；宿主再次检查后才产生可消费一次的目标授权。
2. 选择器使用独立可信进程，不接收 HTML 或插件模块。stdin 握手之前不初始化 COM 或派生工作；宿主成功纳入非继承 Job Object 后才发送有界文件名。取消/租约超时强制结束该 Job，确认 ActiveProcesses 为零后才返回。宿主异常退出依靠 KILL_ON_JOB_CLOSE；不允许 breakaway，不按进程名杀进程。
3. 原生 COM FileSaveDialog 显式启用 FOS_NOTESTFILECREATE、FOS_NODEREFERENCELINKS、FOS_FORCEFILESYSTEM、FOS_NOCHANGEDIR、覆盖确认和路径存在要求。没有用会隐藏系统错误的高层 Option 返回值替代错误判断。普通系统文件选择器的浏览行为不是网络沙箱。
4. 发布暂仅支持本地 NTFS：拒绝 UNC/设备/管道路径、ADS、保留名及模糊尾部字符，拒绝重解析点祖先。保持祖先句柄不可删除共享；新 stage 以目录句柄相对创建、独占打开并持有 DELETE 权限。文件 flush 后在原取消锁内再次检查源身份、目标字节和状态，以 NtSetInformationFile 在 stage 句柄的既有父目录内重命名（单组件名称、空 RootDirectory，不重新解析路径）。新目标不能覆盖后来出现的文件；已有目标保持既有“立即复查后提交”的外部写者边界，不承诺与任意并发写者的文件系统 CAS。
5. 在写入任何内容前，仅给本次新建 stage 复制原目标 DACL，不修改源文档、原目标或系统目录 ACL。失败按拥有的 stage 句柄清理，报告清理错误；提交后的输出不因取消删除。Windows 文件 flush 不等于 POSIX 目录 fsync，也不承诺任意断电持久性。

直接引用既有锁文件中的 Windows 0.61.3 / windows-sys 0.61.2 API；不新增包版本、WebView2 Runtime 或 Chromium。Job Object 只提供进程归属和资源限制，不提供文件/网络隔离。

W1 需要真实 Windows 验证：修复前缺失后端失败、Unicode 新建/替换、原文/别名/其他打开文档保护、外部修改、只读/共享失败、取消/过期、stage 清理与 ACL、独立选择器帧边界、子孙回收和宿主异常退出。原生 COM 配置可不显示 GUI 独立测试。实际用户点击、窗口焦点、缩放、读屏与最终安装应用仍需 Windows GUI 会话，不由单元测试关闭。

## W0 DOM/PDF 技术选择与限定授权

| 方案                                   | 能证明什么 / 代价                                                                                                                                                                               | 建议                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **无网络能力的 AppContainer 能力原型** | 独立 Win32 helper + 独立 Job + 私有 UDF；先证明已有 Runtime 能否在受限令牌下启动，以及全部后代的归属、网络/文件拒绝。AppContainer 涉及应用身份/配置和访问权限，兼容性目前未验证，不能预承诺可行 | **推荐先做 W0 原型**，通过后再接 DOM 协议与静态 PDF；不先启用产品功能 |
| 普通用户 WebView2 + CSP/资源过滤 + Job | 可限制网页层请求和生命周期，但当前没有全通道 OS 网络/文件隔离证明                                                                                                                               | 不符合现有合同，不推荐作为完成方案                                    |
| 暂缓 Windows DOM/PDF，只交付 W1 HTML   | 不改变安全合同；图表与 PDF/打印继续明确不可用                                                                                                                                                   | 若不授权 W0 所需身份/私有目录权限操作，这是可保留的安全状态           |

AppContainer 是按最小权限隔离资源的机制，其 ACL/网络能力是独立于 WebView2 内容设置的 OS 边界。[Microsoft AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)。**这里是候选技术路径，尚无 WebView2 在该边界下运行的实测，不是已证明的解决方案。**

父线程已转发用户明确批准的 W0 范围：允许在 Windows CI 临时 runner 上创建并删除一个测试用、无网络 capability 的 AppContainer 身份，只给本次私有临时目录配置必要访问；只用已存在的 Runtime；禁止修改已有 Runtime/系统/用户文档的 ACL、启用 loopback exception、修改防火墙、提权或安装服务。若已有 Runtime 不可访问或不兼容，记录失败并停止，不扩大权限。授权仅覆盖上述临时原型。独立 CI 程序先验证令牌、无 capability、私有目录之外的读写拒绝及有正对照的 loopback TCP/UDP 拒绝，再启动已有 Runtime。记录后代令牌与 Job 清空、测试身份删除、私有目录/ACL 清理结果。预检不等于 DNS/WebRTC/文件选择器完整证明；产品入口保持关闭。

PDF 的输出目标、取消及发布可以复用 W1，但 WebView2 静态渲染仍需独立网络/文件限制与进程硬截止证明；物理打印还需要真实系统打印与取消证据。Linux WebKit PDF 精确 Unicode、长块分页及 Print04 失败仍开放，不在本轮改依赖或重写结论。
