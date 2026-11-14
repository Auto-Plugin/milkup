# 第六阶段：原生大文档行窗口读取性能

## 范围与结果

从专用分支 `dot/milkup-v2-quality` 的 `d0173f5f049f3fdf2d7f2493f606941760398266` 继续。生产代码仅局部修改 Rust 行窗口读取；没有改 UI 等待指示、缓存策略、Unicode 编辑、历史或保存协议，没有改写 piece tree。

主要瓶颈已修复：逐行重复查找／读取 piece 前缀，改为解析窗口首尾偏移、一次读取所需连续窗口，再顺序计算各行 byte／UTF-16 偏移。窗口请求范围没有扩大到全文。原生远跳从数秒降至主要数百毫秒，但**暖跳 200 ms、冷跳 500 ms 的可感知目标没有全面达到**，不能宣布性能或整体 Typora 对标完成。

## 同数据集与测量边界

- 沿用第五阶段：`A👩🏽‍💻B\r\n` + 100,000 次 `body line\r\n`；1,100,019 bytes、100,002 行，SHA-256 `2393fa4d6c188334ed88612fa3f9cd28d56a0bca1c59b1d2ca37a26be9486960`。
- 每种模式重新打开原生注册／视图，滚动到 100,000 px（4738–4819 行、82 行 DOM），返回 1–58 行；四次往返，记录第一次和三次暖缓存访问。没有强行清 OS 页缓存；fixture 写入后页缓存通常已暖，因此“冷”仅指新注册／新视图的首次目标窗口，不是冷磁盘启动。
- Linux、Rust 1.99.0 debug binary、GTK 3.24.49、WebKitGTK 2.52.6、Xvfb、软件渲染和现有 proot/D-Bus 启动器；cgroup 配额 4 CPU、16 GiB。不是独占物理机，也不是 Windows/macOS 或 release 安装包。
- 第五阶段脚本设置 scrollTop 后还手工分发 scroll，会导致重复请求。第六阶段所有有效前后性能对照统一只设置 scrollTop，使用实际滚动事件；不能把减少测试重复事件算作产品优化。
- Rust 单独测 `read_large_line_window`（[修复前](./evidence/v2-phase6-rust-before.txt)、[同条件修复后](./evidence/v2-phase6-rust-after-isolated.txt)）；原生脚本另测空 IPC、直接读取 IPC、实际 source 读取入口和 `renderVisibleWindow`。render 时间包含其等待的读取；IPC 和 render 是包含／可能重叠的区间，不能简单相加。读取入口还含 JS 结果映射，另有直接 invoke 对照。
- scroll→目标行 DOM→两次 animation frame 为可见延迟近似，包含事件派发、IPC、布局／绘制及调度。最后的同步 `getBoundingClientRect` 探针通常 0–1 ms，**不代表总布局／绘制耗时为零**。未用隐藏等待状态或缩短观测窗口改善数字。
- 空闲两帧／16 ms timer 对照，以及捕获阶段 keydown→MutationObserver→两帧，使用同一原生窗口。键盘由 WebDriver 实际派发；不合成系统 IME。

测量脚本：[tauri-window-performance.mjs](../tests/native/tauri-window-performance.mjs)。原始完整数据：[修复前](./evidence/v2-phase6-profile-before.json)、[修复后第一轮](./evidence/v2-phase6-profile-after-first.json)、[修复后第二轮及输入对照](./evidence/v2-phase6-profile-after-final.json)。

## 实际分层样本

| 测量                 | 修复前                                         | 修复后                                            | 解释                                                        |
| -------------------- | ---------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| Rust 远处 82 行读取  | 384.20／451.92／316.62／278.28 ms              | 同过滤条件 1.51／1.49／1.59／1.42 ms              | 重复前缀扫描与文件访问是确认的瓶颈                          |
| 空 IPC               | 22–83 ms                                       | 17–95 ms（第一轮）；后续控制另存                  | 原生桥与环境存在明显波动                                    |
| 直接 82 行 IPC       | 706–1110 ms，另有 3633 ms 样本                 | 第一轮 24–247 ms；第二轮 35–186 ms                | 不含视图渲染，但包含桥／队列／序列化                        |
| source 第一次远跳    | 4590 ms                                        | 537／801 ms                                       | 两轮均未达到 500 ms 目标                                    |
| source 暖远跳        | 2039／3542／1442 ms                            | 第一轮 372／378／536 ms；第二轮 418／423／461 ms  | 明显改善，仍未达 200 ms                                     |
| live 第一次远跳      | 3497 ms                                        | 471／654 ms                                       | 一轮达到 500 ms，一轮未达到                                 |
| live 暖远跳          | 515／544／295 ms                               | 第一轮 342／314／1142 ms；第二轮 396／385／353 ms | 命中缓存，无读取 IPC；尾延迟仍存在，没有丢弃 1142 ms 离群值 |
| live 暖 render 函数  | 18–42 ms                                       | 第二轮 35–77 ms，第一轮有 265 ms 离群值           | 前端与环境时间仍有变动，不能宣称这一层已改善                |
| 实际 `x` 键→DOM 更新 | 本阶段修复前未形成有效同口径计时，不作数字对比 | source 44 ms，live 36 ms                          | 观察器始于捕获阶段，且断言完整正文、退格恢复                |
| 实际 `x` 键→两帧     | 同上                                           | source 373 ms，live 164 ms                        | 输入处理及时不等于屏幕呈现始终及时                          |

空闲控制在 visible/focused 窗口也出现两帧 20–224 ms、16 ms timer 延后到 97 ms；第二轮空闲两帧 source 27–57 ms、live 29–182 ms。可证明存在环境调度波动，**不足以把全部剩余尾延迟归给环境**。还需固定机器上的 WebKit 布局／绘制分析及跨平台验证。样本量小，不报告可信 P95 或普适性能倍数。

首次 source 冷跳还观察到后台预读的多个原生窗口读取，其串行慢请求会延后可见帧。批量读取同时缩短这些请求；未关闭预读或削弱功能。

## 正确性与测试问题区分

- Rust 新增交叉检查：跨 64 KiB piece 边界的 CRLF、emoji／组合重音／旗帜、连续 CR、空行和末尾空行；逐一检查所有子窗口的 byte／UTF-16 偏移，编辑后重复检查。
- 第五阶段实际 Tauri source/live 的 [6 组矩阵](./evidence/v2-phase6-native-correctness.json)通过：完整字形、选区、CRLF 删除、立即撤销重做、窗口切换光标、保存后逐字节一致。
- 第四阶段实际磁盘／窗口保护 [12 组矩阵](./evidence/v2-phase6-native-safety.json)及保存冲突 Rust 回归通过；没有放松保存冲突判断。
- 一次原生回归出现 `stale element reference`：虚拟行重绘后，旧脚本跨请求保存的 WebDriver 元素句柄失效。改为帧稳定后原子取得矩形，再执行真实指针动作，保留原位置和字节断言。这是测试同步修复，不是删掉产品断言。
- 首版对 Tauri 内部 invoke 的包装没有捕获实际调用，空数组不计为零；有效数据改为实际 `LargeDocumentSource.readLineWindow` 入口插桩，并使用直接 invoke 校验。首版按键监听晚于编辑处理，0 ms 结果废弃；最终用捕获阶段和 MutationObserver。
- 保留修复前二进制用于额外对照；一次因备用文件 basename 改变导致 X11 匹配失败，另一次冷跳请求超过 20 秒自动化上限。均保留失败日志，未无限重试或加宽性能目标；不把超时当成功样本。[额外基线超时证据](./evidence/v2-phase6-baseline-timeout.txt)。

系统中文 IME、GTK proot 文件选择器、Windows／Word 2016、macOS、真实磁盘冷缓存、10／100 MiB 与极长单行性能仍未验收。旧性能报告及旧环境 600 项测试不计入本阶段。

## 完整验证与复跑

| 最终检查                                             | 结果                                 |
| ---------------------------------------------------- | ------------------------------------ |
| 全仓单元／集成                                       | 685 通过，13 workspace，退出 0       |
| 全套 Chromium                                        | 41 通过，退出 0                      |
| Rust                                                 | 46 通过，0 失败／忽略，退出 0        |
| 原生编辑／磁盘与安全矩阵                             | 6 + 12 组通过，退出 0                |
| typecheck / build / Prettier / Rust fmt / diff check | 全部通过                             |
| 可感知延迟 200／500 ms                               | **未全面达到**；不纳入正确性通过结论 |

[verification.json](./evidence/v2-phase6-verification.json)记录结果、日志及原生前后 binary／产品源码哈希。原始运行日志位于 `/tmp/milkup-v2-phase6/`。截图：[source](./evidence/v2-phase6-native-source.png)、[live](./evidence/v2-phase6-native-live.png)。截图只核对实际窗口、文本和模式，不代替延迟或字节断言。

没有重设测试超时、删除失败断言、强推、合并 v2 或发布应用。延续此前已说明的 main 遗留 hooks 问题，完成 v2 全套验证后使用 hooks 自带的单次跳过开关提交；不修改 hooks 或 Git 安全配置。

```bash
source /workspace/.cloud/milkup-v2/env.sh
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml profiles_distant_line_windows -- --nocapture
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
# 先启动同一 Vite、Xvfb 与 WebKit driver；性能采样不与构建／全仓测试并行。
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm bench:native:window
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:unicode
TAURI_DRIVER_URL=http://127.0.0.1:4446 pnpm test:native:quality
pnpm -r --workspace-concurrency=1 test --maxWorkers=1 --no-file-parallelism
MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:e2e --workers=2
pnpm typecheck
pnpm build
pnpm lint
```

Playwright 会自行启动 Vite；运行前须停止人工启动的同端口服务。基线对照可通过 `TAURI_APP_PATH` 指向保留相同 basename 的旧二进制；不要覆盖新二进制或重置工作树。`MILKUP_PROFILE_CONTROLS_ONLY=1` 可只采集空 IPC、空闲帧、timer 和实际输入。

## 剩余体验差距与建议

1. 保留 200／500 ms 目标，继续定位非读取部分的尾延迟，尤其 native WebKit 的帧呈现；以固定环境的 trace 为依据，不凭此次结果重写渲染器。同步补 10／100 MiB 和极长单行基准。
2. 列表续行／空项退出／缩进、代码块空行及边界退格、长选区和原生 Home/End 仍是下一批编辑交互重点；先复现后局部修复。
3. 表格单元格导航／复制、搜索／大纲定位、模式切换滚动锚点，以及段落／图片／列表间距和焦点可见性仍需产品场景验收。
4. #255 已有普通浏览器定向回归；#252 按 Milkup→Word 富文本表格复制核查，Windows 11／Word 2016 不由 Linux 结果替代。系统中文 IME仍需具备真实输入法的平台。

这是大文档读取瓶颈的有界修复，不是整体达到 Typora 的声明，也不是发布批准。
