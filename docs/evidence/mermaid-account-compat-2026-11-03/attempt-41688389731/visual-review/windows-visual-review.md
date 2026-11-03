# Windows run 41688389731 独立视觉审阅

本轮候选为 `c377f56212353ed26eda82a4fc24a1bcfb4b2e27`。审阅使用本轮实际 Windows 产品截图，目录为 `../extracted/pure-standard/` 与 `../extracted/filtered-admin/`。**所审截图视觉检查通过，但整轮运行仍为 FAILED。** 原始报告中 pure-standard 为 `passed`，filtered-admin 为 `failed`；两者均记录 10 个 UI 步骤。filtered-admin 最后关闭 invalid 窗口时报告 `target frame detached` 和 fallback assertion，不能由截图结论改写为全绿。原始报告及其 `visualReviewAccepted: false` 字段均保持不变。

C4 的具体旧问题已在两个账号的实际新 Windows PNG 中消除：旧 beta.8 中 `Presents` 标签白底侵入 `View` 左蓝边框，形成白色缺口；新图中左轮廓连续，标签右侧留有白色间隙，箭头和节点文字仍完整可读。旧、新 C4 都是 **564×118**，变化只有 **374 个像素**，范围为左闭右开 `[280,38,333,57)`。像素 `(331,45)` 从旧图白色 `(255,255,255,255)` 变为新图蓝色 `(120,168,216,255)`；相邻 `(330,45)` 仍为白色。完整窗口中图仍位于标题与 `Outside C4 diagram` 之间，没有正文/窗口边框错位。

宽图的两个实际原始 PNG 都为 **3528×126**，16 个节点和连接箭头均完整。**1028×760** 窗口中前 4 个节点完整，第 5 个节点只部分显示，下面有横向滚动条；这是当前横向视口边界，原始 PNG 没有截断。节点文字保持可读字号，标题、图外正文和状态栏无碰撞。

普通图原始 PNG 都为 **448×102**。`Draft 草稿`、`Review 审阅` 与编辑后的 `XDraft 草稿` 均完整，箭头与边框清楚；窗口中的中英文、emoji 标题和 Outside 正文可见。初始禁用状态保留源码。invalid 窗口显示可读的中文错误提示并保留源码与图外正文；最终禁用截图也保留源码。未发现新的裁切、文字覆盖或 frame 放置问题。

两账号全部 **7/7 图 PNG 逐像素一致**。对比冻结旧 beta.8 的实际 Windows `attempt-41668620695/installed/`，其中 **6/7 图逐像素一致**，仅 C4 有上述预期差异。Linux helper 的 native-before/native-final 只作为此前独立辅助证据，没有冒充本轮 Windows 图像。两个账号 **9/10 个窗口**的正文与状态栏区域 `[0,36,1028,760)` 分别逐像素一致；初始禁用源码窗口只差 50 个像素，范围 `[26,63,28,88)`，对应标题左侧输入光标的闪烁，没有文字或布局变化。标题栏中的账号工作路径不同是正常来源差异。

以下每个文件在两个账号目录下均用 `view_image` 直接查看，共 **22 张本轮原始 PNG**。未保存裁剪、放大或重绘替代图。其余 12 张 undo/redo/reenable 图与窗口，均验证与同账号已直接查看对应文件的完整 RGBA 一致；逐文件 SHA-256、尺寸、等价关系与比较结果见 [JSON](windows-visual-review.json)。

| 每账号实际文件名 | 尺寸 |
| --- | --- |
| `01-initial-disabled-source-window.png` | 1028×760 |
| `02-enable-and-exact-bytes-window.png` | 1028×760 |
| `02-enabled-diagram.png` | 448×102 |
| `03-real-edit-save-replacement-window.png` | 1028×760 |
| `03-edited-diagram.png` | 448×102 |
| `07-wide-window.png` | 1028×760 |
| `07-wide-diagram.png` | 3528×126 |
| `07-c4-window.png` | 1028×760 |
| `07-c4-diagram.png` | 564×118 |
| `07-invalid-window.png` | 1028×760 |
| `08-final-disable-window.png` | 1028×760 |

旧 Windows C4 比较源为仓库 `docs/evidence/mermaid-windows-trial-2026-11-03/attempt-41668620695/installed/07-c4-diagram.png` 与 `07-c4-window.png`。本报告只确认这些实际截图的有限视觉范围，不涵盖安装器、回滚、系统 IME、多 DPI、导出或全部 C4 布局。只写入本目录的派生 JSON/Markdown；原始截图、产品源码、旧 beta.8 ZIP 和原始报告未修改，未操作 CI、下载、重试、main 合并或 Release。
