# 第四阶段：Linux 原生持久化与窗口保护

## 恢复与环境

本阶段从专用分支 `dot/milkup-v2-quality` 的完整 HEAD `ff5a4ccb5f7ab7a90169fe911291f8caf0b3ed9f` 开始。云环境初始实际检出 `v2 f713d91d311ff22e7b19a01b3b94938b714ba375`，工作树干净。显式 fetch 专用分支并核对 SHA 后建立本地同名工作分支，保留原 `v2` 和 `work`，未 reset、覆盖用户修改、合并远端 v2 或强推。

在本环境实际加载 `/workspace/.cloud/milkup-v2/env.sh` 后：Node 24.19.0、项目 pnpm 11.7.0、Rust/Cargo 1.99.0、GTK 3.24.49、WebKitGTK 2.52.6。原生库位于用户环境 sysroot，通过原环境的 proot/D-Bus/Xvfb 启动方案运行。未重新安装或发布云环境，未发布产品。为格式检查增加了用户级 rustfmt 组件。

工作树和挂载 `.agents` 未发现 AGENTS.md / SKILL.md。已阅读质量基线、第二／三阶段报告、云环境文档，以及 coding-plan、regression-policy 和架构相关约束；继续使用原编辑内核。未切换模型、未委派子代理；工具不提供独立核验模型／reasoning 配置的接口。

## 复现、修复与测试边界

| 问题                         | 复现与最小修复                                                                                                                                                      | 证据                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 普通保存覆盖未通知的外部修改 | 原生 IPC 打开 `original`，真实磁盘改为 `external change`，旧保存仍返回成功并写成 `local overwrite`。前端现传入打开时的快照与原路径；Rust 在暂存前、替换前检查版本。 | `race-before.json`；Rust 回归；原生窗口停用本文件 watcher 后真实改盘、Ctrl+S 拒绝覆盖，另存副本成功 |
| 写入失败损坏原文件风险       | 普通保存由直接 `fs::write` 改为同目录 `create_new` 临时文件、写入、sync、检查、原子替换；只确认成功替换的内容。                                                     | 部分写入后故障注入保留原字节；真实缺目录、只读、目录拒绝替换及清理失败回归                          |
| 大文件暂存期间的外部修改     | 大文件原来仅在生成临时文件前检查；现在替换前再次比较磁盘快照。另存副本也检查目标在暂存期间是否改变。                                                                | 移除新检查的受控回退测试失败（exit 101）；真实磁盘暂存／外部改写的 Rust 回归；原生大文件 IPC        |
| 大文件权限及另存为路径别名   | 新增回归先复现：替换后 `0640` 变成默认权限；`/dir/./file` 绕过同路径冲突检查。统一 canonical 路径比较，替换时保留目标权限并拒绝只读目标。                           | 两份 red 日志；Rust 回归；原生 IPC 核对权限位、拒绝只读、别名冲突                                   |
| 旧 Rust 清理失败             | 原始结果为 31 通过／1 失败。按文件名前缀截断后，再找带前导点的标记会漏配。改为解析完整的应用临时文件格式，并精确匹配所属文档。                                      | 原始失败日志；保留并通过旧断言；新增相似文件名、短文件名、未知归属保护                              |
| 清理误删活跃缓冲             | 修复前目录清理会删除当前进程的 `.add.work`。只有匹配格式且能够确认 PID 已不存在时才清理；活跃、无权限探测或未知归属一律保留；不跟随符号链接。                       | red 回归；当前进程工作文件保留；原生同时打开同路径两个会话后首会话仍可落盘                          |
| 清理失败不可见               | 保存失败时若无法清理临时文件，错误包含保留路径与清理失败原因；不会谎报文件已清理。启动时清理遇到无删除权限则保留，不中断用户打开文件。                              | Linux 目录权限故障回归，验证原文件完整、临时文件保留及错误说明                                      |

旧清理 fixture 使用 PID `999` 假定进程已死；本容器该 PID 确实存在。加入所有权保护后，测试改用超出 Linux PID 上限的 `2147483647`，并单列活跃进程保护。没有放宽匹配以令旧测试通过，反而排除了 `.note.md.extra...`、不合法后缀、未知 PID 和非普通文件。

普通保存保留现有文件的 POSIX mode；既有符号链接仍指向同一目标。新普通文件临时内容用 `0600` 创建。大文件延续既有流式写入，只补充提交检查、权限和失败清理。没有新增数据库、文件锁服务或重写文档模型。

## 原生验收矩阵

本矩阵运行真实 Tauri 二进制、WebKitGTK、Rust IPC 与临时测试目录中的真实磁盘。键盘通过 WebDriver actions；确认按钮经焦点和 Enter 激活。文件路径使用仓库既有 `milkup.desktop.nativeTestPaths` 测试入口选择，因此**不能作为 OS 文件选择器验收**。没有用浏览器文件 mock 代替落盘。

| 场景                       | 结果         | 关键断言                                                                                            |
| -------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| 新建：取消／放弃／保存     | 通过         | 取消保留原文和输入焦点；放弃清空；保存字节匹配后才新建                                              |
| 打开：取消／放弃／保存     | 通过         | 未保存确认完整；等待真实 ready；成功后切换到目标内容                                                |
| 关闭标签：取消／放弃／保存 | 通过         | 原文保护、磁盘保存、回到空文档                                                                      |
| 确认框焦点                 | 通过         | 默认取消；Tab / Shift+Tab 保持在弹窗；Escape 返回正文继续输入                                       |
| 真实保存失败与重试         | 通过         | 缺父目录失败保留正文和确认框；有效路径重试成功                                                      |
| watcher 未通知的外部修改   | 通过         | Rust 拒绝旧版本覆盖，磁盘外部内容不变，正文仍 dirty                                                 |
| 冲突后另存副本             | 通过         | 原文件外部内容不变，副本为本地正文                                                                  |
| 文件打开后变只读           | 通过         | 保存失败保留原文件和编辑；恢复权限后重试成功                                                        |
| 大文件原生 IPC             | 通过         | 两个活跃会话缓冲不被清理；保存字节正确；权限保留；只读及外部修改／别名被拒绝                        |
| 真正的窗口关闭事件         | 通过         | 经 `window_control` 触发 Tauri close-request；取消保留、保存落盘并退出、放弃退出                    |
| OS Save As / Open 对话框   | **环境阻塞** | 实际 GTK Save File 已弹出，目录枚举报 `Bad address`；用 X11 Escape 取消后正文和输入恢复；不标为通过 |
| 系统中文 IME               | **未验收**   | 未找到 ibus/fcitx 运行组件；没有分发合成 composition 事件冒充系统输入法                             |

原生脚本为 [tauri-quality.mjs](../tests/native/tauri-quality.mjs)。12 组结果明细见 [native-results.json](./evidence/v2-phase4-native-results.json)。窗口退出检查同时查询 X11 根窗口树，确认该会话捕获的原生窗口 ID 消失。WebKitWebDriver 在真正退出后可能返回 `Session terminated without a reply`，只在该明确响应且 X11 独立证据成立时接受；任意网络或 WebDriver 超时仍然失败。立即放弃关闭可能使该次按键请求返回相同响应，后续仍检查窗口消失。

截图：[原生确认](./evidence/v2-phase4-native-confirm.png)、[真实磁盘失败](./evidence/v2-phase4-native-save-error.png)、[外部修改拒绝覆盖](./evidence/v2-phase4-native-disk-conflict.png)、[原生窗口关闭保护](./evidence/v2-phase4-native-window-close.png)、[GTK 选择器环境错误](./evidence/v2-phase4-native-dialog-environment-error.png)。

## 完整验证与复跑

| 检查                                  | 当前结果                                          |
| ------------------------------------- | ------------------------------------------------- |
| Rust `cargo test --locked`            | **44 通过，0 失败**；无 skip                      |
| 单元／集成全仓                        | **652 通过**，13 个有测试的 workspace，未删除断言 |
| 完整 Chromium 浏览器套件              | **37 通过，退出 0**                               |
| TypeScript typecheck                  | 通过                                              |
| JS/TS/Vite build                      | 通过；不是安装包构建                              |
| Tauri debug 原生编译及启动            | 通过                                              |
| Prettier lint / Rust fmt / diff check | 通过                                              |
| 原生质量矩阵                          | **12 组通过，退出 0**                             |

本容器在原生进程与默认多 worker 测试并行时，既有 100 MiB 虚拟搜索触发 5 秒测试超时。停止并行原生负载并隔离测试 worker 后，全仓在**不改超时、不改断言**的情况下通过。此结果不是大文档性能验收或性能提升声明。

原环境 `CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER` 包装器还出现“Rust 测试失败但命令退出 0”。本阶段取消该 runner 仅用于不需要 GUI 的 Rust 测试；保留系统库环境，直接运行测试二进制，red 测试实际返回 101，完整通过返回 0。没有依赖包装器退出码冒充通过。

```bash
source /workspace/.cloud/milkup-v2/env.sh
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
pnpm -r --workspace-concurrency=1 test --maxWorkers=1 --no-file-parallelism
pnpm typecheck
pnpm build
pnpm lint
# 浏览器回归需要先停止手动启动的 1420 dev server，保留其严格端口检查。
MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:e2e --workers=2
```

Linux 原生关闭验收需要可读取当前 DISPLAY 的 `xwininfo`。原生矩阵需要先在独立终端启动桌面 Vite 和原环境的 tauri-driver / WebKitWebDriver。可指定 `TAURI_DRIVER_URL`、`TAURI_APP_PATH`、`MILKUP_NATIVE_EVIDENCE_DIR`，脚本默认仅连接本机 driver，不负责发布或安装应用。例如：

```bash
TAURI_DRIVER_URL=http://127.0.0.1:4444 \
MILKUP_NATIVE_EVIDENCE_DIR=/tmp/milkup-native-quality \
node tests/native/tauri-quality.mjs
```

全部原始 red / green 日志和历次失败诊断保留于 `/tmp/milkup-v2-phase4/`。仓库保存关键 Rust 日志和原生结果、截图，避免仅依赖临时容器证据。

## 明确未关闭的风险与下一阶段

- 检查磁盘到 rename 之间仍存在不合作的外部进程竞态；没有 OS 级 compare-and-swap，不能承诺绝对不覆盖。原子替换保证文件内容替换边界，不等于断电后目录项持久化保证。
- Linux mode 已验收；Windows 文件占用、MoveFileEx 覆盖语义、macOS，以及 ACL、扩展属性、所有者、硬链接关联未完成本阶段验收。不能由 Linux 的通过外推。
- 部分写入失败使用受控故障注入；缺目录、只读、目录权限／删除失败和外部改写是实际文件系统操作。没有声称真实磁盘写满已验证。
- GTK 文件选择器的 proot 兼容错误已留证并停止反复尝试；未修改产品安全配置来绕过。真实中文候选窗、中文标点、系统 IME 失焦仍需可用桌面输入法环境。
- 下一阶段继续窗口化 Unicode 字形／CRLF／可见窗口边缘与撤销，随后列表 Tab/Shift+Tab、表格和代码块，再到搜索大纲与视觉一致性。原生试用中 Ctrl+End 未按预期移至正文末尾，单列为后续键盘导航复现项，未计入已通过的快捷键。
- 175 KiB / 1 / 10 / 100 MiB 的固定 fixture、P50/P95、内存、输入与滚动性能仍未重新验收。测试数量不代表整体已达到 Typora 质量。
