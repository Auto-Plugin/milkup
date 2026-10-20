# P8 工程检查点证据

对应 [P8 报告](../../v2-product-phase8-readiness-2026-10-20.md)，源码候选为 `10af790217307b44f95c62aa6e9d7bf61f259942`，基线为 `a4d44e680478d7894450f30f3d533dc1c3131974`。

`evidence.zip` 收录原始日志、失败与修复证明、源码快照、GitHub API 结果及审阅记录。`manifest.json` 给出档案及每个成员的 SHA-256；解压后的路径如下。没有应用、插件构建产物、安装器或 Runtime。GitHub 日志 ZIP 是日志下载，不是 Actions artifact。

| 证据路径                                    | 用途                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `recovery-2026-10-20/`                      | 中断恢复前 15 个工作文件与隐藏配置的原始快照、哈希、diff                     |
| `public-plugins/`                           | CRLF、路径与冻结 SDK 输入的修复前失败和修复后断言；目录别名与篡改拒绝        |
| `updates-version/`                          | SemVer/lock 与下载取消竞态失败回归；updater 窄补丁、480 包闭包与宿主恢复证据 |
| `validation-2026-10-20/`                    | 全仓测试/类型/构建/格式、14 项浏览器结果和指定 GitHub 身份                   |
| `windows-compile/ci01/`                     | 长路径 checkout 原始失败，无测试或编译执行                                   |
| `windows-compile/ci02/`                     | 真实平台合同/类型推断/schema 失败；独立插件与 updater API 已运行             |
| `windows-compile/ci03/`                     | 生产链接已通过，但 22 项完整 lib 测试失败的原始日志                          |
| `windows-compile/ci04/`                     | 最终候选的完整 Windows 工作流、逐阶段命令退出码、测试名与生产 manifest       |
| `windows-compile/recovery05-lib-lifecycle/` | 12 项 cleanup 失败的持有者定位及测试生命周期补丁                             |
| `windows-compile/ci04-resources-recovery/`  | 8 项资源/恢复失败、只读目录 flush 根因与文件 flush/目录保护合同              |
| `windows-compile/recovery06-workspace/`     | 实际 canonical 路径及 Windows 根目录 guard/lease 语义回归                    |
| `windows-compile/recovery06-combined/`      | 完整 Linux lib 188 通过、5 个既有忽略项的精确名称与源码指纹                  |
| `review/`                                   | 各源码候选的独立审阅；记录中的 SHA 是审阅当时的版本                          |

先核对 manifest 中档案哈希，再解压核对成员哈希。历史记录保留当时的失败、待验状态和环境路径；最终结论以报告及 CI04 实际日志为准。测试总数不关闭 PDF、平台后端、GUI、IME、读屏、DPI 或安装升级门槛。
