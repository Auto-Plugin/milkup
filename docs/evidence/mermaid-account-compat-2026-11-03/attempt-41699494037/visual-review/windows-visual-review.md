# Windows run 41699494037 最小独立视觉复核

候选 `b2415e9ec06ac6a5defcac2833de81840a61b007`。**整轮仍为 FAILED。** filtered-admin 原始报告通过 10 步；pure-standard 前 5 步完成并有 4 张普通图 PNG，第 6 步重新启用等待实际图 PNG 超时，不能判为通过。

本轮 28 张实际 PNG 均已核对：11 张图 PNG（filtered 7、pure 4）与此前已直接查看的 run41692476025 filtered-admin 同名图完整 RGBA 一致；14 张窗口正文/状态栏区域 `[0,36,1028,760)` 与同一已审来源一致。账号工作路径使标题栏不同，没有声称完整窗口像素一致。剩余 3 张差异/失败窗口已直接用 view_image 查看，详见表格。旧图只用于明确比较，没有代替本轮原始证据。

filtered-admin 的 C4 保持已确认的 `Presents` 与 `View` 左边框间隙，宽图完整保留 16 个节点，普通/编辑/撤销/重做/重新启用图没有新变化。9 个窗口的正文与已审来源完全一致；初始源码窗口仅在 `[26,63,28,88)` 有 50 像素输入光标闪烁差异，直接查看确认无正文或布局问题。图的尺寸仍为普通 448×102、C4 564×118、宽图 3528×126；窗口均为 1028×760。

pure-standard 的前 4 张成功普通图及前 5 个窗口正文与已审图一致。**第 6 步没有接受的重新启用图 PNG。** 已直接查看 `06-disable-and-reenable-in-place-failure-window.png` 与 `unhandled-failure-window.png`：错误提示可读，普通 Mermaid 源码、标题、Outside 正文保留，正文不显示图像。这只能证明失败回退画面，不能作为第 6 步成功出图。

原始 native audit 明确 `cleanupFailureKinds: [private-tree-delete]`，`privateTreeRemoved: false`，`privateTreeCleanup.finalOsError: 5`（remove 阶段一次尝试），`cleanupUncertain: true`。stdout/stderr 均正常 EOF，failure 为 null，所有 IPC 线程 `cancelRequested: false`。捕获的 2606 字节被拒绝，`pngBytes: 0`。**本轮真实 blocker 是目录删除 Win32 5；不是上一轮 IPC 995。** filtered-admin 的通过不能覆盖 pure-standard 的失败，原始报告没有改写。

| 本轮实际文件（相对 ../extracted/） | 尺寸 | 复核方式 |
| --- | --- | --- |
| `filtered-admin/01-initial-disabled-source-window.png` | 1028×760 | 直接查看 |
| `filtered-admin/02-enable-and-exact-bytes-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `filtered-admin/02-enabled-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `filtered-admin/03-edited-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `filtered-admin/03-real-edit-save-replacement-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `filtered-admin/04-undo-exact-original-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `filtered-admin/04-undone-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `filtered-admin/05-redo-exact-edit-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `filtered-admin/05-redone-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `filtered-admin/06-disable-and-reenable-in-place-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `filtered-admin/06-reenabled-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `filtered-admin/07-c4-diagram.png` | 564×118 | 完整图 RGBA 一致 |
| `filtered-admin/07-c4-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `filtered-admin/07-invalid-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `filtered-admin/07-wide-diagram.png` | 3528×126 | 完整图 RGBA 一致 |
| `filtered-admin/07-wide-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `filtered-admin/08-final-disable-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `pure-standard/01-initial-disabled-source-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `pure-standard/02-enable-and-exact-bytes-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `pure-standard/02-enabled-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `pure-standard/03-edited-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `pure-standard/03-real-edit-save-replacement-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `pure-standard/04-undo-exact-original-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `pure-standard/04-undone-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `pure-standard/05-redo-exact-edit-window.png` | 1028×760 | 正文/状态栏 RGBA 一致 |
| `pure-standard/05-redone-diagram.png` | 448×102 | 完整图 RGBA 一致 |
| `pure-standard/06-disable-and-reenable-in-place-failure-window.png` | 1028×760 | 直接查看 |
| `pure-standard/unhandled-failure-window.png` | 1028×760 | 直接查看 |

逐文件 SHA-256、RGBA 哈希、比较范围和原始 blocker 字段见 [JSON](windows-visual-review.json)。报告只写入本目录；raw 文件、截图、源码和旧 ZIP 未改动，未进行远程 CI、下载、重试、main 合并或 Release。不建立安装器、回滚、系统 IME、多 DPI、导出或全布局验收。
