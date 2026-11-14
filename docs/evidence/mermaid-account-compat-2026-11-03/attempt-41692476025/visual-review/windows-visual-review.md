# Windows run 41692476025 独立视觉审阅

候选 `5e683405e48231595f66f998fb89d04d04f05514`。本轮实际 **20 张原始 PNG 全部用 view_image 直接查看**，未修改或生成替代截图。**整轮仍为 FAILED；pure-standard 没有接受的图 PNG，不能视觉通过。** filtered-admin 原始报告为 `passed`，包含完整 10 个 UI 步骤；pure-standard 为 `failed`，记录初始源码步骤及第 2 步等待实际 PNG 超时。两个账号原始报告和 `visualReviewAccepted` 字段未改动。

filtered-admin 的 17 张实际图片（7 张图 PNG、10 张窗口）在有限截图范围内视觉通过：普通图 `Draft 草稿` / `Review 审阅`、编辑后的 `XDraft 草稿`、撤销、重做、重新启用均完整可读；中英文和 emoji 标题、Outside 正文及窗口边框无碰撞。C4 的 `Presents` 白底与 `View` 左蓝边框保持间隙，原白色缺口没有复现。宽图原始 PNG 完整保留 16 个节点；窗口中前 4 个完整、第 5 个部分显示，并有横向滚动条，这是视口边界，原始图未被截断。invalid 和最终禁用界面均保留源码，没有冒充成功图像。

本轮 filtered-admin **7/7 图 PNG 与此前实际审阅的 run41688389731 filtered-admin 图逐像素一致**，包括 C4。对比冻结 beta.8 的实际 Windows 图，6/7 图不变；C4 保持 564×118，仅 374 像素变化，范围 `[280,38,333,57)`，对应已确认的边框修复。普通图为 448×102，宽图为 3528×126，全部窗口为 1028×760。旧运行图片只用于明确标识的比较，没有作为本轮证据。

pure-standard 仅有 3 张窗口截图：初始禁用源码、`02-enable-and-exact-bytes-failure-window.png` 和 `unhandled-failure-window.png`。后两张显示可读错误提示并保留完整普通图源码；没有图 PNG，也没有可接受的正文图像。它们只能证明失败回退画面和源码保留，不能证明渲染通过。

原始 pure-standard native finished 审计明确记录 `rendererStatus: ok`、`capturedPngBytes: 2606`，但 `pngBytes: 0`、`successful: false`、`cleanupUncertain: true`、`privateTreeRemoved: false`，stdout/stderr 读取错误为 Win32 `995`。**内部捕获但被拒绝的字节不是接受的图 PNG；原生清理不确定是真实 blocker。** filtered-admin 的通过不能覆盖该失败，也不能将整轮判为通过。

下列为本轮全部直接查看文件。逐文件 SHA-256、RGBA 哈希、与前轮比较及原始失败字段见 [JSON](windows-visual-review.json)。

| 实际文件（相对 ../extracted/） | 尺寸 |
| --- | --- |
| `filtered-admin/01-initial-disabled-source-window.png` | 1028×760 |
| `filtered-admin/02-enable-and-exact-bytes-window.png` | 1028×760 |
| `filtered-admin/02-enabled-diagram.png` | 448×102 |
| `filtered-admin/03-edited-diagram.png` | 448×102 |
| `filtered-admin/03-real-edit-save-replacement-window.png` | 1028×760 |
| `filtered-admin/04-undo-exact-original-window.png` | 1028×760 |
| `filtered-admin/04-undone-diagram.png` | 448×102 |
| `filtered-admin/05-redo-exact-edit-window.png` | 1028×760 |
| `filtered-admin/05-redone-diagram.png` | 448×102 |
| `filtered-admin/06-disable-and-reenable-in-place-window.png` | 1028×760 |
| `filtered-admin/06-reenabled-diagram.png` | 448×102 |
| `filtered-admin/07-c4-diagram.png` | 564×118 |
| `filtered-admin/07-c4-window.png` | 1028×760 |
| `filtered-admin/07-invalid-window.png` | 1028×760 |
| `filtered-admin/07-wide-diagram.png` | 3528×126 |
| `filtered-admin/07-wide-window.png` | 1028×760 |
| `filtered-admin/08-final-disable-window.png` | 1028×760 |
| `pure-standard/01-initial-disabled-source-window.png` | 1028×760 |
| `pure-standard/02-enable-and-exact-bytes-failure-window.png` | 1028×760 |
| `pure-standard/unhandled-failure-window.png` | 1028×760 |

仅生成本目录派生 JSON/Markdown，所有 raw 文件保持不变。未进行远程 CI、下载、重试、源码修改、合并或 Release。本审阅不建立安装器、回滚、系统 IME、多 DPI、导出或全布局验收。
