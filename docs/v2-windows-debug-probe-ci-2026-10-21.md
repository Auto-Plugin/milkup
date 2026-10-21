# Windows debug-image 原语 CI：环境门禁拒绝，原语仍未验证

2026-10-21；独立分支 `dot/milkup-v2-debug-handoff-probe`；产品基线
`302dd3901aa70b3a01d147d24578fa7add51fb1b`。
用户本轮明确允许有界 Windows CI：自建临时惰性程序、60 分钟、零产物上传，不提权、
不修改安全设置、不运行安装器、不访问真实文档、不附加第三方进程、不启用 SeDebugPrivilege、不创建账号。
原源码 README 中“尚未批准”描述的是初始 `70ba59fb` 评审状态；本报告记录随后获批运行的实际终态。

## 结论和精确候选

最终受测 SHA：`9ddcd1749b9b9500cf5609f6a31db262f208a988`。
[最终 CI](https://github.com/Auto-Plugin/milkup/actions/runs/39550159660) 终态为 **failure**，
不能记为原语测试通过。Windows x64 编译/链接、两项纯门禁测试通过，但监督进程在创建
临时根目录、Job、coordinator 或 helper 之前，被预先启用的调试特权门禁拒绝。
七个映像句柄/进程实例/退出清理场景实际执行 **0 项**，coordinator/helper 创建 **0 个**。

实际监督进程 token（来自成功的 TOKEN_QUERY 读取）：

```json
{
  "elevated": true,
  "elevation_type": 1,
  "integrity_rid": 12288,
  "administrators_present": true,
  "administrators_enabled": true,
  "administrators_deny_only": false,
  "SeDebugPrivilege_present": true,
  "SeDebugPrivilege_enabled": true,
  "ordinary_medium_context": false
}
```

`elevation_type=1` 表示没有关联的 split token，不能据此称为普通用户；这里同时观察到
`elevated=true`、管理员组 enabled、高完整性 RID 12288 和 SeDebugPrivilege enabled。
程序没有启用或关闭任何特权；发现已启用状态后立即退出。没有调整 token、创建受限 token、
切换账号、创建账号或以别的方法绕过门禁。最终错误为 `SeDebugPrivilege-already-enabled-stop`。
这证明的是 runner 不符合本原型的执行前提，**不证明调试映像 API 必须提权，也不证明其普通用户可行性**。

## 所有运行及失败

| CI | 精确 SHA | 原型 job 时长 | 实际结果及后续处理 |
| --- | --- | --- | --- |
| [39549477113](https://github.com/Auto-Plugin/milkup/actions/runs/39549477113) | `d863646e8358f4e246c0c3af5f5759e7d984c7f6` | 44s | 检出历史证据目录遇到 Windows 超长路径；原型未构建/启动。随后仅改为稀疏检出，不改系统设置。 |
| [39549597655](https://github.com/Auto-Plugin/milkup/actions/runs/39549597655) | `a0ced9c9553f0cac5e0480478f939d56b3916040` | 20s | 缺少名为 1.99.0 的已安装工具链；改用现有 stable 别名，实际仍为 Rust 1.99.0，没有安装工具链。 |
| [39549712035](https://github.com/Auto-Plugin/milkup/actions/runs/39549712035) | `b77e3549b2d9465c7a53811ef3b6fa7a2271dfc0` | 57s | Windows 编译/链接和 2 项门禁测试通过；监督进程 token 长度查询拒绝，未创建 helper。 |
| [39549924018](https://github.com/Auto-Plugin/milkup/actions/runs/39549924018) | `f733f541524a0544c74df3c50f5d1f6eb8289c01` | 58s | 补充诊断确认 TokenElevation(class=20) 的空缓冲区返回 error=24、required bytes=4；未创建 helper。 |
| [39550159660](https://github.com/Auto-Plugin/milkup/actions/runs/39550159660) | `9ddcd1749b9b9500cf5609f6a31db262f208a988` | 48s | 长度查询修复后获得真实 token：预先启用 SeDebugPrivilege，门禁安全拒绝，未创建 coordinator/helper。 |

五次都是新候选 push 的首次 attempt；每次先确认前次终态，未盲目重复触发。
原型 job 合计 **227 秒**；从首次创建 05:25:31 UTC 到最终完成 05:33:38 UTC，墙钟 **8 分 7 秒**。
重测 timeout 随剩余窗口下调；各次产品 desktop-source job 均 skipped。
每次 artifacts API 的 total_count 均为 **0**，没有 upload-artifact/cache action。
没有安装包、编译产物或证据 ZIP 上传到 GitHub artifact；原始日志保留在各 CI 链接，另已下载到本地证据目录。

## 有限修复及验证

- Workflow 只为本候选分支添加精确父 SHA/测试树/提交消息/首次 attempt 门禁，contents:read、checkout 不保留凭据。
- Windows 检出改为 `.github/workflows` 和本测试 crate；不改变系统长路径设置。
- 使用现有 stable 工具链，记录实际 Rust 1.99.0；未安装工具链/运行时。
- token 两阶段查询兼容实际返回的 ERROR_BAD_LENGTH(24) 和 ERROR_INSUFFICIENT_BUFFER；
  只接受有界 required length。第二次精确长度读取必须成功，仍只请求 TOKEN_QUERY。
  权限错误、未知长度、超长缓冲区仍拒绝，管理员与 SeDebugPrivilege 门禁未放宽。
- 最终 Windows x64 构建/链接通过、2 项门禁测试通过。Linux 2 项测试、格式检查和 Windows 目标类型检查通过。
- 最终临时 EXE 的构建日志摘要：`2a7a4ab3299032787afca0cf87df45d3c408a62cfcb94c5ddddc25cacd4e17b5`。
  这是自建测试程序的文件摘要，**不是 CREATE_PROCESS_DEBUG_INFO.hFile 观测结果或真实发行证明**。
- 23 个外部锁定包均为既有产品依赖版本/checksum；无产品依赖变化。
- Clippy 本地未安装，不能称为通过；PowerShell 脚本已由实际 Windows CI 解析和执行到 token 门禁。
- 最终受测提交的 GitHub author/committer 均为 LarryZhu-dev。本地及远端 SHA 一致。

产品 `apps/`、`vendor/`、`packages/`、`plugins/`、`release/` 对基线零差异；
健康产品分支仍为 `302dd3901aa70b3a01d147d24578fa7add51fb1b`。
未合并、未发布、未执行安装/回滚/NSIS、未访问真实用户信任记录或文档。

## 下一道不可跳过的门槛

先提供一个**已存在且获准使用的非管理员 Windows 执行环境**，实际 token 必须满足记录的
普通用户条件且 SeDebugPrivilege 未启用，再验证同一自建惰性原型的七个场景。
本轮不自行创建账号、不修改安全策略、不调整当前 runner token，也不继续在同类管理员 runner 上堆重试。
缺少该环境时保持阻塞，不把通过编译或安全拒绝当作映像/退出原语验收。

只有原语得到有效上下文实测后，才有依据决定下一阶段安装链：协调者在旧 EXE 被替换期间的
独立寿命与可信身份、可信安装完成事实、谁创建并持有新进程实例、与签名 envelope/事务的交接。
目前内部线程会随应用退出；同一安装 EXE 的另一进程并未证明允许 NSIS 覆盖旧映像。
不以此原型代替真实安装、载荷版本、运行健康或回滚验收，也不追加外围产品模块。

相关官方合同：[GetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)、
[TOKEN_ELEVATION_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_elevation_type)、
[CREATE_PROCESS_DEBUG_INFO](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ns-minwinbase-create_process_debug_info)。
API 文档说明接口合同；上面的 Win32 error=24 和 token 数值来自实际 CI，不混写为文档保证。
