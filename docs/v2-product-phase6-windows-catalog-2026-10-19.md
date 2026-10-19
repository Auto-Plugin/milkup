# P6 milestone03：Windows catalog 安全后端与验证边界

本轮从 `4e0d305bab563e3fc58aa97bb18115b6bf8f69d6` 继续，分支仍为 `dot/milkup-v2-product-phase6-plugin-lifecycle`。父助手接受前一轮 Linux 限定检查点后，将 Windows catalog 实现缺口列为下一优先级。方案 A 是父助手依据用户委托作出的技术选择，非用户明确选择 A；活动合同与前报告的误归因已补正，原始证据保持不变。

本报告不宣布整个 P6、Windows 桌面交付或跨平台验收完成。源码实现、目标编译、真实 Windows 文件系统测试与桌面 UI 验收分别记录。

## 实现与隔离边界

`plugin_catalog.rs` 的事务状态机、revision CAS、不可变 generation、精确审批、checksum/backup、迁移、tombstone 与 sidecar 拒绝保持共享。磁盘层新增 `plugin_catalog_windows.rs`，其他非 Unix/Windows 平台继续明确拒绝。共享测试抽至 `plugin_catalog_tests.rs`，同时用于 desktop Rust unit suite 与无 Tauri 的 `tests/native/catalog-core`，没有复制一份替代事务实现。

Windows 首版只接受本地盘符 NTFS；UNC、网络盘、设备路径、盘符相对路径及其他文件系统明确 unsupported。一次 Win32 调用取得盘符根句柄，此后逐层使用 `NtCreateFile` 的 `RootDirectory` 加单组件名称；打开 reparse 对象但不跟随，核验返回句柄后拒绝 reparse/device。所有祖先句柄持有至操作结束并拒绝 delete sharing。组件校验拒绝 ADS、分隔符、控制字符、尾部点/空格及保留设备名。常规文件 link count 必须为1，拒绝硬链接别名。行为依据 [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)、[句柄属性](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information)及 [CreateFileW 共享规则](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)，仍需以下实际 Windows 证据确认。

候选文件使用独占创建、write-through 与检查错误的文件 flush。catalog 先完整写入临时文件并 flush，使用 `NtSetInformationFile(FileRenameInformation)` 对持有的临时文件句柄作同目录替换；目标是验证后的单组件名称，`RootDirectory=NULL` 选择该文件已有父目录，继续对同一文件句柄 flush。不先删除旧目录项、不逐字节覆盖旧 catalog。共享冲突保持旧文件；替换后 flush 报错明确提示“可能已提交，重读再试”。复用现有 fs2 非阻塞独占锁；目录枚举、容量检查和递归删除基于持有句柄。参考 [FILE_RENAME_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)与 [LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)。未增加产品 crate 或 DLL 分发依赖。

**Windows 目录持久性限制不能省略。** `Dir.sync` 在该后端仅校验被固定的目录句柄，不代表 POSIX directory fsync。所有实际文件 flush 失败均传播；没有静默忽略。普通用户模式没有在本实现中取得已文档保证的目录元数据持久屏障，不请求管理员级 volume flush。因此进程重启恢复通过也不证明任意断电下的 namespace 持久性；有效 catalog 仍须验证完整 generation 封存字节，缺失/损坏状态拒绝执行。[FlushFileBuffers 的文件与卷限制](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)是该边界的依据。继承用户 profile DACL，不宣称隔离已攻陷的同用户 native 进程。

可信详情和候选详情新增执行支持说明：sidecar 当前不能启用；DOM 仅允许严格只读文档 renderer；Worker 仍须通过当前系统的隔离启动。版本兼容或批准能力不等于后端存在或已验证。未放开 sidecar、未改变权限审批或启动门禁。

## 工具链与 CI

本机 Linux 的 Rust 为1.99.0，原本只有Linux target；本轮仅增加 `x86_64-pc-windows-msvc` Rust standard library，用于真正编译 Windows 条件分支和 tests。没有 MSVC linker、Windows SDK运行环境、PowerShell、Wine或MinGW。交叉 `cargo check` 不能链接或执行 Windows。

无 Tauri 测试 crate 直接编译真实 catalog 文件。唯一 `tauri::Url` 引用由与 desktop lock 同版本 `url::Url` 重导出，未替代 URL 解析或文件系统。所有依赖版本均已存在于 desktop lock；单独 lock 固定其闭包。Windows `run-windows.ps1` 需要真实 Windows、x64 MSVC Rust/linker 和本地 NTFS，命令输出平台、源码/lock SHA及真实测试退出码。

仓库 API 确认 `Auto-Plugin/milkup` 为 public，已有标准 `windows-2025` 成功记录。self-hosted runner 列表只读查询403，不请求额外凭据。旧交付 workflows 含打包/上传流程，未借用。新增独立 source-check workflow 限定本P6分支、public仓库与显式 `[windows-catalog-check]` 提交标记，`contents: read`、标准runner、20分钟上限、无缓存/上传/Release；只安装编译器并运行固定依赖的源码测试。GitHub 官方明确公开仓库标准runner免费，日志不计artifact存储；本轮没有新增付费任务。[计费与日志依据](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

第一轮真实 CI 在历史证据长路径检出失败，未运行测试。第二轮改为仅检出源码/测试/工作流目录，保留历史 Git 对象供精确基线读取；没有删除或重命名历史证据，也没有以不完整替代源码测试。第二轮真实基线 RED 成立，当前后端却为9通过、27失败：原子替换返回 sharing violation。独立复核定位到非空 `RootDirectory` 使 I/O manager 为目标目录再请求写权限，与已固定的目录共享模式冲突。修正采用官方同目录名称形式并补足 FFI buffer 长度，未放宽目录或文件共享约束。旧基线脚本读取固定4e0d305b源文件并核验 SHA `b04225d2b48cba126f154ba65e8bdb5485b2b103589de87c0be8f907459e8fb4`，只有指定测试实际因 unsupported 失败、exit101和精确失败计数成立才接受 RED；编译失败不能冒充 RED。

## 实际结果

源码修正固定为 `d6a740fdb15075aa479874864d37078c0fca6859`。三轮真实 CI 与原件都在 [milestone03 证据](evidence/v2-product-phase6-plugin-lifecycle/milestone03/README.md)，完整索引可执行校验。

| 验证                                                                               | 实际结果                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [CI01](https://github.com/Auto-Plugin/milkup/actions/runs/39235628255)，`d572d777` | 历史证据长路径 checkout 失败，未运行测试                                    |
| [CI02](https://github.com/Auto-Plugin/milkup/actions/runs/39235766579)，`eef31bc4` | 基线 runtime RED 核验通过；当前后端9通过、27失败，atomic sharing violation  |
| [CI03](https://github.com/Auto-Plugin/milkup/actions/runs/39236553133)，`d6a740fd` | 基线 runtime RED 核验通过；当前36单元 + 3独立进程测试通过，0失败、0 ignored |
| Linux 独立 catalog crate                                                           | 30共享单元 + 3独立进程测试通过                                              |
| Windows MSVC 目标编译                                                              | `--tests` 与 `--lib --bins` 通过，无警告；这两项本身不算运行时验证          |
| 管理器说明                                                                         | 修前 RED 保留，修后58测试通过，desktop TypeScript通过                       |

CI03 实际系统为 `Microsoft Windows NT 10.0.26100.0`，Rust1.99.0 / x64 MSVC；覆盖真实 NTFS 原子替换、junction/硬链接拒绝、祖先固定、锁、revision CAS、损坏恢复、升级失败、GC、迁移和 fresh-process trial/startup恢复。7项Windows专用测试全部执行，没有跳过项。三个run的artifact数量均为0。

CI检出使用CRLF，本机及Git blob使用LF；逐项计算3份Rust源码与Cargo.lock的LF→CRLF哈希，均精确匹配CI输出，见 `final-source-proof.json`。不是拿不同平台字节哈希直接声称相同。独立审查保留CI02阻塞判断，并追加候选diff与CI03实际复核。格式检查通过。

完整 Linux desktop 首轮为180通过、1失败、5 ignored：未修改的 DOM blocked-pipe watchdog 在并行运行中收结果超时。相同源码串行重跑为181通过、0失败、5 ignored，该项通过。两轮原件均保留；未改硬截止、断言或把首轮改记成功。该观察不能单独证明时限抖动根因已经解决。

## 剩余边界与下一决策

Windows catalog 的受测原生文件系统行为不能替代桌面 Tauri/WebView2、插件 Worker/UI、Windows保存/恢复、安装器或完整Unicode/缩放矩阵验收。后续应先在同一固定源码下补 Windows 桌面集成闭环，再决定 P6 平台关闭范围。任意断电、非NTFS/远程文件系统不在本轮承诺；不以放开路径回退解决兼容性。失败写入可能留下未发布临时文件，重复失败的累积清理仍是继承的剩余边界，未在本轮冒称修复。

macOS未验，sidecar catalog activation继续安全拒绝。P5 PDF Unicode精确复制/搜索、长块分页及历史Print04超时继续开放，产品保持现有WebKit依赖。本轮没有构建安装包、下载WebView2、上传构建产物/Library、Release、新增凭据或合并main/v2/quality。
