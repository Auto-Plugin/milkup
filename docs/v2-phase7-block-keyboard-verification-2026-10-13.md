# 第七阶段：常规文档列表与代码块键盘验收

日期：2026-10-13。起点为 `56f85ada91c1873889b9c2c63369ecd4be204389`，专用分支 `dot/milkup-v2-quality`；开始时工作树干净。继续使用原生云环境的 pnpm 11.7、Rust 1.99、GTK 3.24.49、WebKitGTK 2.52.6、Xvfb 和 Tauri debug 窗口。没有重置用户修改、切换开发基线、合并远端 v2、强推或发布应用。

## 有界帧尾延迟剖析

沿用第六阶段的 1,100,019 字节、100,002 行、同 SHA fixture、原生二进制、自然滚动、每模式四次往返和两次 RAF 完成口径。新增 scroll 事件、目标 DOM 更新、首个 RAF 与 20 ms timer 间隔的时间戳，只运行一次完整有界采样；性能采样期间不并行构建或全仓测试。完整数据见 [frame-profile.json](./evidence/v2-phase7-frame-profile.json)。

| 样本               | 总等待 | 应用 render 区间 | DOM 更新至首个 RAF | 最大 timer 间隔 |
| ------------------ | -----: | ---------------: | -----------------: | --------------: |
| source warm away 1 | 312 ms |            41 ms |             148 ms |           42 ms |
| source warm away 2 | 275 ms |            28 ms |             156 ms |           29 ms |
| source warm away 3 | 269 ms |            47 ms |             125 ms |           36 ms |
| live warm away 1   | 655 ms |           131 ms |             297 ms |          279 ms |
| live warm away 2   | 522 ms |            37 ms |             309 ms |          197 ms |
| live warm away 3   | 845 ms |            74 ms |             490 ms |          321 ms |

不能只选择快样本：source 第三次 return 达到 1789 ms，其中读窗口 IPC 966 ms、render 1001 ms、timer 间隔 1023 ms。空 IPC 19–153 ms；空闲两帧 source 19–458 ms、live 19–266 ms。实际 `x` 输入至 DOM 为 source 77／live 55 ms，至两帧为 266／443 ms。这些控制组也波动，支持环境、事件循环和 WebKit 帧调度成本明显的判断，但不能据此把全部尾延迟归咎于平台。

render 计时包含其等待的读取，不能与 IPC 相加；RAF 是帧等待代理，并非像素呈现时间戳。小于数毫秒的 rect 探针也不证明布局成本为零。Linux proot、4 CPU 配额、软件渲染和 debug 环境没有提供足以进一步分离 compositor、调度与每项应用工作的 trace。本次没有定位出像第六阶段重复读取那样明确的新应用热点，因此停止追逐环境数字，不改渲染架构、不放宽 200／500 ms 目标。该目标仍**未全面达到**。

## 失败复现与局部实现

改动范围为常规文档 `EditorView` 的 source/live 键盘行为。窗口化大文档 `SourceDocumentView` 的 Markdown 上下文只涵盖可见窗口，不能安全照搬代码／列表判定；本次明确不将该路径计为交互等价通过。

初始 28 项定向测试有 24 项失败、4 项通过；原始输出保存在 [block-before.txt](./evidence/v2-phase7-block-before.txt)。新增两类边界后各先得到 source/live 两项失败，再修复：[闭合代码块之后的行误判](./evidence/v2-phase7-block-boundary-before.txt)、Linux WebKit 原生 Shift+Tab。

- 列表 Enter 延续有序／任务标记；空嵌套项先退一级，空顶层项退出；在标记之前换行不复制标记。
- Tab／Shift+Tab 以两个空格为一步缩进／反缩进，支持正向和反向跨行选区；选区正好到下一行起点时不改下一行。常规无缩进段落的单光标 Tab 仍保留焦点导航。
- 列表正文起点 Backspace 先退嵌套层，再移除标记；仅有前导空白时按缩进步长退格。已有选区删除和 Unicode 字形删除路径保留。
- 代码中 `- literal` 等文本不会被自动续成 Markdown 列表；Enter 保留前导缩进和空行；闭合 fence 后可以进入普通段落；Tab、Shift+Tab 和缩进退格支持日常编辑。
- 结构编辑各自构成独立撤销步骤，映射原有选区方向；source/live 切换保留光标。

原生 Shift+Tab 先由 WebDriver 复现，再以 X11 XTest 实际按键路径复核，均返回 `key=Unidentified, code=Tab, keyCode=9`，焦点离开编辑区。产品仅在 `Unidentified` 且明确 `code=Tab` 时按 Tab 处理，不猜测任意未知键。保留 composition 与修饰键保护。[原生失败事件记录](./evidence/v2-phase7-native-tab-before.txt)与[定向失败测试](./evidence/v2-phase7-block-native-tab-before.txt)均保留。

测试脚本最初错误地将标题目录当完整路径，又引用了不存在的状态 DOM；改为同时核对目录和标题，实际保存还逐字节核对原文件。另一次原生运行被本次格式化引起的 Vite HMR 重载中断（事件记录消失、文档回到空白），未计通过。以上脚本／运行问题与真实 Shift+Tab 产品缺陷分开记录，没有删除失败记录或放宽断言。

## 验收矩阵

| 项目                                    | 结果及边界                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 常规 source/live 列表、代码、选区、撤销 | 32 项定向回归通过；最初 24 项失败，另有两类各 2 项边界失败后修复                                |
| 原生列表／代码／#255                    | 8 组通过；真实按键、逐次保存核对磁盘字节；#255 图片行使用缺失资源 fixture，仅验收后续标题和光标 |
| 原生保存／冲突／窗口保护                | 12 组通过，沿用前阶段完整矩阵                                                                   |
| 原生窗口化 Unicode／历史／磁盘          | 6 组通过，原有 1.1 MiB Unicode／CRLF／跨视口场景回归                                            |
| 全仓 JS 单元／集成                      | 717 项通过，13 个有测试的 workspace，退出 0                                                     |
| 浏览器 Chromium                         | 45 项通过，退出 0                                                                               |
| Rust                                    | 46 项通过，0 failed／ignored；直接运行测试，未使用掩盖退出码的 runner                           |
| typecheck／build                        | 通过；构建前端，沿用未修改的第六阶段原生 debug 二进制运行当前 Vite 代码，无安装包发布           |
| Prettier／Rust fmt／diff check          | 全部通过                                                                                        |
| 200／500 ms 性能目标                    | 未全面达到，保留原始慢样本                                                                      |
| 系统中文 IME／Win／macOS／Word 2016     | 未验收                                                                                          |

[原生分组结果](./evidence/v2-phase7-native-blocks.json)、[保存安全矩阵](./evidence/v2-phase7-native-safety.json)。截图：[source 列表](./evidence/v2-phase7-source-nested-list.png)、[live 列表](./evidence/v2-phase7-live-nested-list.png)、[source 代码空行](./evidence/v2-phase7-source-code-blank-line.png)、[live 代码空行](./evidence/v2-phase7-live-code-blank-line.png)、[图片后标题](./evidence/v2-phase7-live-image-heading.png)。截图已逐项检查，但不代替源码字节、选区和历史断言。

脚本准备／HMR 中断的[失败输出](./evidence/v2-phase7-harness-failures.txt)与产品失败分开保存。全套日志位于 `/tmp/milkup-v2-phase7/`，最终结果与日志哈希见 [verification.json](./evidence/v2-phase7-verification.json)。完成全套 v2 验证后，提交沿用已记录的 `SKIP_SIMPLE_GIT_HOOKS=1` 单次开关，原因是本地遗留 main hooks 引用 v2 不存在的脚本；不修改 hooks 或 Git 安全配置。

## 复跑

```bash
source /workspace/.cloud/milkup-v2/env.sh
# 原生运行前启动 Vite :1420、Xvfb :99 和 tauri-driver :4446。
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:blocks
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:unicode
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:quality
# Playwright 自行启动 Vite，先停止人工启动的同端口服务。
MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:e2e --workers=2
pnpm -r --workspace-concurrency=1 test --maxWorkers=1 --no-file-parallelism
pnpm typecheck
pnpm build
pnpm lint
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
```

原生脚本使用现有测试路径入口绕过文件选择器，操作真实 Tauri 窗口和真实磁盘；Shift+Tab 在 Linux 使用 X11 按键，其余使用 WebDriver 按键。焦点准备和状态读取使用 DOM，未用合成 composition 冒充系统输入法。环境没有 ibus/fcitx，中文系统 IME **未验收**。GTK 文件选择器在 proot 下的限制沿用第四阶段，不计为产品通过。

## 剩余体验差距与下一阶段

1. 大文档窗口化编辑仍缺跨窗口 Markdown 上下文，列表／代码键盘行为尚未与常规文档对齐；还需 10／100 MiB、极长单行和真实平台性能基准。
2. 本阶段没有实现按完整语法树移动整个嵌套子树、自动整理所有后续有序编号、自动补齐／吞掉 fence 等更复杂规则；这些需独立复现和产品行为约定。
3. 下一步优先表格单元格导航、选区、撤销与 Milkup→Word 富文本复制（#252），然后搜索／大纲定位、模式切换滚动锚点和段落／图片／列表视觉间距。Windows 11／Word 2016 的粘贴效果需要真实目标环境。
4. 系统中文 IME、Windows／macOS 原生快捷键与磁盘行为未由 Linux 结果替代。200／500 ms 性能目标未全面通过。

本报告是限定场景的验收记录，不以测试数量声明整体达到 Typora，也不是产品发布批准。
