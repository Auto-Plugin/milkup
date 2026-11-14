# 独立插件系统与标准大纲验收（2026-10-14）

> 此文保留 b86edd3 初版区域大纲的设计和验收记录；当前 SDK 0.1.1 与全文分页大纲 1.1.0 的实现、性能和限制见[后续验收报告](v2-full-outline-validation-2026-10-14.md)。

本轮在 `566babb93fde847251a9f3f458d77c6603bf8ba4` 上建立 `dot/milkup-v2-plugin-system`。SDK、独立插件包、通用宿主修补和 Linux 生产安装流程已完成验证。没有合并其他分支、发布 npm/Release 或上传 Windows 安装包；原有上传请求仍为 `enabled:false`、`uploadConsumed:true`。

这不是整个产品达到 Typora 品质的声明。大文件大纲冷扫描仍有显著延迟，Windows/macOS、真实 IME、Word 2016、辅助技术仍待目标环境验证。编辑器视觉七项由另一线程处理，本分支没有修复这些项目。

## 独立性与实现

公开 `@milkup/plugin-sdk@0.1.0` 提供模块、命令、UI 生命周期快照、只读扫描与受控 UI 类型，以及无宿主依赖的 `definePlugin`。SDK 可本地打包为 tgz，不发布注册表。大纲只有 `document:read` 权限，只导入 SDK，通过文档/版本/视口快照、扫描和导航命令工作。

将大纲复制到仓库外后，使用 SDK tgz 安装依赖、类型检查、构建成功。构建输入只有插件入口和公开 SDK，产物无运行时导入；故意引入宿主私有输入时构建拒绝。插件有自己的 manifest、tsconfig、构建脚本和 `.milkup-plugin` 归档。移走整个 `plugins/outline` 目录后，生产宿主仍成功构建，随后原样恢复目录。

生产应用通过 GTK 文件选择器安装归档，没有写注册表或注入插件源码来替代安装。正常启用、禁用、重新启用、卸载、重启恢复均通过；只改 manifest 身份为 `example.independent-outline` 的同一模块也能安装运行并卸载。没有新增按 `milkup.outline` 身份分支的宿主逻辑。

宿主修改限于公开快照的行数/模式字段、受控树属性、通用树样式、扫描上下文/预算/取消，以及 Worker 初始化失败清理。原生保存、恢复和历史协议未修改。Worker 初始化超时、postMessage 异常、启动前销毁、重复初始化和异步导入晚到均有测试；扫描取消后晚到批次、变化版本、关闭中的读错误不会发布过期结果。

## 功能与真实生产证据

[生产原始记录](evidence/v2-plugin-system/production-results.json) 与 [可重跑驱动](../tests/native/tauri-plugin-system.mjs) 覆盖：

- ATX H1–H6 层级、围栏伪标题排除、标题点击及当前项高亮。
- 单节点及全部折叠/展开，活动子节点被折叠时高亮可见祖先。
- source/live、编辑更新、撤销/重做、保存后精确 UTF-8 字节比较。
- 切换文件、空文档、26,018,029 字节 / 40,001 行的大文件。
- 禁用后 UI/命令撤销、卸载后编辑保存、重启保持启用或已卸载状态。
- 更换 manifest 身份后仍通过同一公开机制运行。

所有操作使用生产二进制 `tauri://localhost`、WebKitGTK、Xvfb 和 XTest；WebDriver 用于读取状态和截图。辅助诊断观察 Worker 消息/错误，不替代安装。大文件测试最多观察到 160 个呈现行，未超过 500 行上限；8192 行分页、16384 行缓存及 262144 UTF-16 / 128 行单次读取预算另有单元测试。

已查看原始窗口截图：[层级](evidence/v2-plugin-system/02-enabled-hierarchy.png)、[折叠](evidence/v2-plugin-system/03-collapsed.png)、[空文档](evidence/v2-plugin-system/05-empty.png)、[大文件尾部](evidence/v2-plugin-system/06-large-tail.png)、[卸载后保存](evidence/v2-plugin-system/08-uninstalled-editor-saved.png)。截图发现范围说明误用了 22px 加载图标样式；已改为公开的 `plugin-list-summary`，并修正窄侧栏工具按钮换行。重新查看确认说明不再覆盖标题。

早期驱动失败已保留在容器：一次匹配到菜单中隐藏的同名命令按钮、一次 GTK 焦点时序、一次读取磁盘早于保存完成。驱动分别改为面板限定选择器、等待 GTK 输入焦点、等待精确落盘字节。最终完整流程通过。重启后的侧栏默认收起，恢复状态由 DOM/管理器证明；另有实际展开的补充截图：[改名插件](evidence/v2-plugin-system/10-renamed-visible.png)、[重启恢复](evidence/v2-plugin-system/11-restored-visible.png)。补拍曾因旧 X11 窗口 ID 失效而卡在 ImageMagick；随后改用有超时的根窗口捕获并通过，未修改产品逻辑。

## 大文件分布与限制

这些数值测量从真实快捷键发出到目标区域大纲完成呈现，包含输入驱动、IPC 与观察轮询；不是纯编辑器光标延迟，也不是与旧容器的提速比较。

| 场景             | 样本 |     p50 | p95 / 最大值 |
| ---------------- | ---: | ------: | -----------: |
| 首次尾部大纲完成 |    1 | 8284 ms |      8284 ms |
| 重复回到头部     |    5 | 2369 ms |      2581 ms |
| 重复回到尾部     |    5 | 1493 ms |      1773 ms |

初次打开（含 GTK 文件选择）到区域大纲约 3506 ms。尾部观测时原生进程 RSS 144020 KiB，WebKit 内容进程 RSS 442484 KiB；这是单次 RSS 快照，不是峰值。`ps` 的 CPU 值为进程累计平均，不能解释为一次导航的 CPU 成本。

为正确排除从文档中部开始扫描时仍在代码围栏内的标题，首次扫描需要建立前缀围栏状态。实现分片读取、缓存最多 256 个同版本检查点，内存有界，但冷扫描时间仍随前缀长度增长。界面明确显示加载行范围，不能称为完整大文件树或宣称 200ms。超过单行预算时显式失败，保留正文，不无界复制、降低恢复频率或关闭恢复。后续若要求进一步降低冷扫描延迟，需要独立的上下文索引设计与测量。

## 回归与保留项

| 检查                     | 结果                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 全仓单元测试             | 853 通过                                                                                                           |
| 独立大纲测试             | 14 通过                                                                                                            |
| 全仓类型检查 / 构建      | 通过                                                                                                               |
| Chromium 浏览器全回归    | 65/65 通过                                                                                                         |
| Rust 原生测试            | 75 通过，1 个显式性能基线忽略                                                                                      |
| 生产崩溃恢复             | 未命名、已有文件、较大文件、UTF-16 四项通过                                                                        |
| 修改文件格式 / diff 检查 | 通过                                                                                                               |
| 全仓 Prettier            | 基线已有 `docs/evidence/windows-v2-package-prep/static-validation.json` 格式问题；已从 HEAD 导出复现，未改写旧证据 |

原生测试覆盖保存/关闭并发的流式快照、原子保存失败、部分写入/发布中断、旧快照保留、历史、编码与 CRLF 字节完整性。生产崩溃恢复通过 SIGKILL 后重启、恢复副本逐字节比较及原文件保护；[原始记录](evidence/v2-plugin-system/crash-recovery-results.json)。本轮没有重试 IBus，没有改安全配置，没有删除旧证据或恢复副本。磁盘仍有约 19 GiB 可用。

前一轮浏览器执行曾有一个 Unicode 用例失败；单独复验通过，之后两次完整 65/65 通过，未修改该编辑器实现。全部原始日志和独立构建清单见 [证据目录](evidence/v2-plugin-system)。

## 使用与重跑

独立构建与安装说明见 [SDK README](../packages/plugin-sdk/README.md) 和 [插件 README](../plugins/outline/README.md)。本地归档最终 SHA-256 为 `b98cb9d7398c32b533e691c944b522e2ff00fc04d9b453ee2481c667fed2bf0f`，大小 25389 字节；模块 SHA-256 为 `c7f394b8e6b60ae7aa07a345a792c82fb5cdc42755a4a7c6eb539923fd212b27`。

生产驱动要求独占测试显示、全新隔离配置目录、已启动的 tauri-driver、生产 `TAURI_APP_PATH`，并指定 `MILKUP_PLUGIN_ARCHIVE`、`MILKUP_NATIVE_EVIDENCE_DIR`、`TAURI_DRIVER_URL`、`DISPLAY`。它创建自己的测试文档；不要指向用户文档目录。环境细节沿用 [云环境说明](cloud-environment-v2.md)。
