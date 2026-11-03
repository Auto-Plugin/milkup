# Linux 产品正文验收的复现记录

这里保存 2026-11-03 本轮实际使用的本机运行器、非敏感环境配置、临时运行时映射设计，以及第一轮脚本误判的原始失败证据。**这不是可跨机器直接运行的安装器或完整环境镜像。** 本目录的归档操作只做了原字节复制、语法检查和校验和验证，没有重新启动应用或测试。

已通过的第二轮是父目录的 [11 步实际报告](../evidence/mermaid-private.json)，不是下方的失败轮。候选源码 `688fc89aad6c6b4b54cdec87ffa66179e5dd0def`；实际桌面二进制 SHA256 为 `01487ea1f1fcf22f6c9557b7e0c85d14bd93942d9bbc26c30ace8e6fce5af746`，采用 debug 构建及 `tauri/custom-protocol`，加载内嵌前端资源，没有使用开发服务器。最终验收脚本为仓库 `tests/native/tauri-mermaid-private.mjs`，提交 `d75b974beaa23e594c8da6e0b364d7233cd2d1b2`。二进制、原始 sysroot、用户配置和凭据没有打包到本目录。

## 文件身份

| 文件 | 记录范围 |
| --- | --- |
| `run-product-native.py` | 实际执行的 session 编排器原字节。新建临时 profile，按给定 SHA 冻结二进制，启动独立显示和驱动，运行 11 步脚本，按所属 PID/birth 清理进程组并归档证据。 |
| `run-native-mounted.sh` | 实际执行的外层 bwrap/D-Bus 入口原字节。整段 Python 编排器在同一个外层 PID/挂载命名空间运行。 |
| `dependency-env.sh` | 实际使用的显式工具链/库路径配置原字节；没有整个进程环境转储。 |
| `runtime-overlay-construction-record.sh` | Linux 代理从本轮两段实际执行过的 Python 命令整理出的记录。**该 shell 文件不是原执行入口，本次没有运行它。** 包含最初 symlink 映射和随后加载器/共享库修正。 |
| `runtime-overlay.json` | 当时保存的映射位置与目的。 |
| `environment-summary.json`、`dependency-versions.log` | 白名单环境说明和原有版本核查输出。后者还列出当时存在的浏览器/前端测试工具，不表示本次原生验收使用 Chromium。 |
| `source-records.json` | 每份复制源的路径、大小、SHA256 和来源身份。 |
| `failure/` | 第一轮失败的原始报告、运行状态、清理记录、当时的 harness 和两张截图；摘要独立保存，不改写原始记录。 |
| `syntax-checks.json`、`EVIDENCE-SHA256SUMS.txt` | 本次只读归档校验；不是又一次原生运行结果。 |

## 本机前提与路径

本轮为 Debian 13 x86_64，Node 24.19.0、pnpm 11.7.0、Rust/Cargo 1.99.0、GTK 3.24.49、WebKitGTK/JavaScriptCoreGTK 2.52.6、libsoup 3.6.5。精确应用、运行时及 bootstrap 哈希见父目录 [构建来源记录](../final-native-build-provenance.json)。

运行器依赖下列已存在的本机路径：

- 工作树 `/workspace/milkup-mermaid-rebuild` 及其安装好的依赖。
- `/workspace/.cloud/milkup-v2/sysroot` 中的 GTK/WebKit 库、WebKitWebDriver、Xvfb、xdotool、xwininfo、xprop 等；还需宿主 `bwrap`、`dbus-run-session`、Python 3、ImageMagick `import`、Node 和 Git。
- `/workspace/.cargo/bin/tauri-driver`，以及 `/workspace/.cargo`、`/workspace/.rustup` 的既有工具链。
- `/workspace/mermaid-rebuild-evidence` 中原来的脚本路径，以及 `/tmp/milkup-mermaid-runtime-overlay/usr`。

`dependency-env.sh` 中的 Cargo runner 仍指向早期诊断用 `run-native-rebuild.sh`。**最终产品正文验收没有使用这个 Cargo runner**；它显式调用 `run-native-mounted.sh`。此归档不提供该早期 proot 运行器，不能仅靠 source 该环境文件就把任意 `cargo test/run` 当作本轮的最终启动方式。

在另一台机器上，应先按现有授权准备兼容运行时与工具，再逐项审查并替换上述绝对路径，重建自己的候选二进制和来源记录。归档脚本没有下载或安装缺失依赖的逻辑。原库和宿主目录内容会影响字体、链接器、浏览器及图像输出；重新构建的二进制哈希未必与本轮相同，不能拿新结果覆盖旧记录。

## 临时映射设计

`run-native-mounted.sh` 用 `--ro-bind / /` 保留只读宿主视图，仅将当前工作区和 `/tmp` 绑定为可写。临时 `/usr` 映射的关键部分是：

| 命名空间内路径 | 本轮来源 |
| --- | --- |
| `/usr` | `/tmp/milkup-mermaid-runtime-overlay/usr`，只读绑定 |
| `/usr/host` | 原宿主 `/usr`，只读绑定，供普通工具链接定位 |
| `/usr/share` | 原宿主 `/usr/share`，只读绑定 |
| `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1` | 既有 sysroot 的 WebKit helper 目录，只读绑定 |
| `/usr/bin/xdg-dbus-proxy` | 既有 sysroot 的 D-Bus proxy，只读绑定 |
| 临时 `/usr/lib/x86_64-linux-gnu` 中的根层文件 | 按构造记录复制既有 sysroot 文件；不再仅依赖 `/usr/host` symlink |
| 临时 `/usr/lib64/ld-linux-x86-64.so.2` | 既有 sysroot 的真实加载器文件副本 |

最初仅有 symlink 的映射在 WebKit 自己的内层沙盒中无法解析 D-Bus proxy 的 ELF 加载器/共享库；构造记录保留了后来添加真实文件副本和 `/usr/share` 挂载的过程。没有改写系统 `/usr`，也没有向系统安装旧版运行时。

Xvfb、tauri-driver、WebKitWebDriver、Node harness 和被测应用必须处在同一个外层测试 PID 命名空间。否则 X11 的 `_NET_WM_PID` 可能是命名空间内 PID，而外部 harness 的 `/proc` 是另一套 PID，导致归属检查失真。WebKit 仍创建自己的内层沙盒。这里没有设置 `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS`，也没有改变系统 userns、安全策略或 UAC。

该外层 wrapper **没有**创建网络命名空间，不能据此宣称 OS 全网络阻断。它是这台测试机的路径适配，不是插件权限协议或产品信任边界的替代实现。

## 当时实际运行的入口

以下是成功轮的历史调用，不是要求现在重跑。原运行是在工具审查允许的 `require_escalated` 执行上下文中进行；普通工具包装层让 `/proc/self/uid_map` 只读，无法让 WebKit 创建自身沙盒。此记录不要求关闭 WebKit 沙盒或更改系统策略来绕过该限制。

```bash
source /workspace/mermaid-rebuild-evidence/dependency-env.sh
export DISPLAY=:144
/workspace/mermaid-rebuild-evidence/run-native-mounted.sh \
  python3 /workspace/mermaid-rebuild-evidence/run-product-native.py \
  --binary /workspace/milkup-mermaid-rebuild/apps/desktop/src-tauri/target/debug/milkup-desktop \
  --sha256 01487ea1f1fcf22f6c9557b7e0c85d14bd93942d9bbc26c30ace8e6fce5af746 \
  --archive /workspace/mermaid-rebuild-evidence/product-native-02
```

编排器固定使用独立 `:144`、driver 4450、native driver 4451；已存在的显示锁会拒绝启动。每次创建新的 `/tmp/milkup-mermaid-product-*` 配置目录，归档目标必须不存在。未来执行前须确保显示/端口没有被别的工作占用；不得重用原轮 profile 或停止别的进程。所有输入由实际 XTest/GTK 完成，WebDriver `execute()` 只观察 DOM。

四份自创文档和 11 步通过并不等于正文内 50 图或所有主题/DPI 验收。`XDraft 草稿`、宽图、C4 和错误回退有父目录保留的实际截图；测试窗口为 1280×800，Xvfb 屏幕为 1440×1000，DPR 1。首次失败没有提供这些通过结论。

## 第一轮失败

[原始失败报告](failure/mermaid-private.json)与 [摘要](failure/summary.json)明确记录 exit 1。错误是 harness 在首次启用前要求 `active` generation，但新 profile 中正确状态为 `pending.phase = prepared`、`active = null`、`verified = false`。`milkup.diagrams` 条目和两项审查哈希实际存在且匹配；不是“插件包不存在”。

修正只发生在测试脚本：初态检查确切 pending 包及未渲染源码；通过原生 UI 启用后再检查确切 active 包、`verified = true` 和真实图片。产品未为通过此断言而放宽审批。失败轮应用停止、driver 显示 `No sessions`，外层 driver/display 均退出 0；这些清理记录不把失败轮变为通过。原始 harness、JSON、日志和截图均保持原字节。

## 本目录的离线核查

```bash
sha256sum -c EVIDENCE-SHA256SUMS.txt
bash -n dependency-env.sh run-native-mounted.sh runtime-overlay-construction-record.sh
node --check failure/harness-startup-source.mjs
```

Python 文件及构造记录中的两个 Python heredoc 另用 `ast.parse` 做过语法检查，详情见 `syntax-checks.json`。这些命令不会运行图表或应用。
