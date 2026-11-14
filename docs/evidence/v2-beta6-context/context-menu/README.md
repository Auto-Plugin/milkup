# Beta6 宿主右键菜单证据

2026-10-23，基线 `7189a26a`，工作目录 `/tmp/milkup-windows-manual-candidate`。本目录保留菜单实现过程的失败与成功记录，不将后续修复回写成原失败通过。最终已验证源码字节见 `verified-source-hashes.json.txt`；产品提交与原生生产构建证明由主报告记录。

## 最终结果与范围

- 相关单测最终 **127/127**：菜单外壳 24、插件投影 10、共享 UI controller 93。`logs/milkup-context-menu-hide-lifecycle-green.log.txt`。
- 新菜单浏览器完整 **8/8**：普通与窗口化编辑器各覆盖无插件基础菜单、剪贴板与历史、三级键盘菜单、剪贴板拒绝和取消；另含真实慢 Worker、3 项扩展配额及热卸载、窄窗边界。最初完整绿见 `milkup-context-menu-browser-final.log.txt`，生命周期修复后的完整绿见 `milkup-context-menu-browser-lifecycle.log.txt`。
- 最后生命周期兼容修复后，有界复验真实 Formatting 的选区 A 打开／关闭→选区 C 重开→加粗，仅 C 改变，**1/1，4.7 秒**；慢 Worker **1/1，7.5 秒**。见 `milkup-context-menu-formatting-reopen-final.log.txt` 与 `milkup-context-menu-worker-hide-final.log.txt`。
- 桌面 TypeScript 检查、相关文件 Prettier、`git diff --check` 已通过；这些工具结果记录于会话，未伪造独立原始日志。

环境为 Node v24.19.0、Debian 13 上 Chromium 154.0.8037.57、现有 Vitest 3.2.6 与 Playwright。浏览器运行本机 Vite `127.0.0.1:1437`；配置原字节保存在 `configs/`。文件服务使用浏览器测试传输，编辑器、插件 Worker、剪贴板权限与菜单操作走实际实现。此证据不代表 Windows、系统 DPI 或原生磁盘字节验证。

## 失败分类与修复对应

| 记录                                                   | 分类与结论                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatting-role-red/error-context.md.txt`             | 旧测试使用 `role=button`，新菜单语义为 `menuitem`。当时菜单实际可见，不是 Shift+F10 打不开。                                                                                                                                                                  |
| `formatting-cap-red/error-context.md.txt`              | 迁移角色后仍点击第 5 项“删除线”，与新总计最多 3 项合同冲突。精确迁移为固定顺序“一级标题／二级标题／粗体”、删除线隐藏，点击第 3 项并断言正文；保留提交先于隐藏及 Escape 恢复焦点。对应 `milkup-context-menu-formatting-green.log.txt`。                        |
| `milkup-context-menu-race-red.log.txt`                 | 实质产品竞态：双插件菜单 A 关闭后改选区 C，快插件完成使慢插件旧 A 按钮再次可用，实际提交旧 `{revision:1}`。新开窗同步退役全部旧输出，仅当前 epoch、文档、版本与选区的 ready 输出参加配额，提交时再次校验；直接绿见 `milkup-context-menu-race-green.log.txt`。 |
| `milkup-context-menu-render-count-pointer-red.log.txt` | 实现中回归：隐藏菜单仍发送无用渲染，刷新清掉按下中的有效按钮。改为每次打开一次请求，隐藏刷新不请求；同上下文按压期间延后刷新，跨上下文立即退役。                                                                                                              |
| `milkup-context-menu-deferred-mount-red.log.txt`       | 延迟隐藏菜单首次渲染后，首个可见请求误发 update，漏掉 manager 的 mount 登记。修复后首个可见请求仍为 mount。以上阶段整合绿为 `milkup-context-menu-all-unit-final.log.txt`（126 项）。                                                                          |
| `milkup-context-menu-hide-lifecycle-red.log.txt`       | 省略关闭通知会破坏 Formatting 的 visible false→true 选区重载。最终仅已启动视图关闭时发送一次捕获快照的 blur；同视图有序，重开等待该通知完成再检查 epoch／context，通知输出不进 DOM。对应最终 127 项单测绿和 A→C 浏览器绿。                                    |

原始日志名称均在 `logs/` 下加 `.txt` 后缀保存。中间的 90／92／126 项通过是对应阶段结果，最终总数为 127；最后一次改动没有重跑完整 8 项，只复验受影响的 Formatting 与慢 Worker 两条链。

## 环境与测试夹具记录

以下为会话观察记录，原始工具输出未单独落盘，不能当作产品失败或伪装成原始日志：

- 默认工具沙箱启动 Vite 遇到监听 `EPERM`，Chromium 遇到 crashpad `setsockopt` 权限错误。获批准后使用已有本机进程能力完成浏览器验证，没有安装依赖或降低浏览器安全配置。
- 曾尝试重复启动同端口得到 `Port 1437 is already in use`；沿用已有服务器继续验证，没有停止其他代理的服务。
- 新慢插件夹具最初的命令 ID `context.fixture.1` 不合法，改成 `context.fixture.action1`；顶层受控输出数组改成合法 element 包裹。两项均为测试夹具错误，未据此放宽产品断言。
- 早期 pnpm 包装器因本地路径 `ENOENT` 未成功运行；随后全部使用已有 Node CLI，未安装依赖、未修改锁文件。

保留的必要截图为旧角色／配额失败时的实际可见菜单、最终三项菜单和 A→C 操作结果。完整 8 项运行中的窄窗截图随后被 Playwright 的输出目录清理；其断言通过记录与测试源码仍在，不声称本目录保存该截图。为保持包小于 3 MiB，未复制两个大型 trace.zip。

## 字节校验

`source-map.json.txt` 记录原始路径、归档相对路径和 SHA-256；日志、JSON、配置、错误上下文均按原字节复制。README 与源码哈希清单是本次编写的说明文件。

在本目录执行：

```sh
sha256sum -c SHA256SUMS
```

`SHA256SUMS` 覆盖除自身以外的全部文件。没有提交、推送或重复运行已完成的测试。
