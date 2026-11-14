# Windows run 41703213523 最终候选独立视觉复核

候选 `b139a9891a086685d7e0e9e85472a29a629f7a45`。本轮 CI success 由主线程/native 核验；本审阅无远程操作，并独立读取到两账号原始报告均为 `passed`、各完整 10 个 UI 步骤。本轮实际截图在所捕获 fixture 范围内视觉通过。原始报告（包括 `visualReviewAccepted` 字段）未改写。

两账号各有 7 张图 PNG、10 张窗口，共 **34 张本轮实际 PNG**。全部解码并逐像素比较，其中 **14 张图完整 RGBA** 与此前已直接查看的 run41692476025 filtered-admin 同名原图一致，**18 张窗口正文/状态栏 `[0,36,1028,760)`** 与该来源一致。两个初始源码窗口各只差 50 像素，范围 `[26,63,28,88)`，均直接用 view_image 查看，确认是标题左侧光标闪烁，没有正文或布局问题。标题栏中的账号工作路径不同，没有声称整窗口像素一致。旧图仅用于明确标记的比较，没有冒充本轮截图。

C4 的 `Presents` 标签白底与 `View` 左蓝边框保持已确认的间隙，边框缺口没有复现；图与正文的相对位置保持一致。宽图原始 PNG 完整保留 16 个节点，窗口仍使用横向滚动区域维持可读字号。普通图、编辑、撤销、重做、重新启用图的文字与箭头完整；中英文和 emoji 标题、Outside 正文、错误回退及最终禁用源码均保持已审效果。未发现新增裁切、文字覆盖、边框碰撞或 frame 放置问题。普通图为 448×102、C4 为 564×118、宽图为 3528×126、窗口均为 1028×760。

两账号各 **12 条 native finished 记录全部 cleanup clean**：无 cleanupFailureKinds、cleanupUncertain 为 false、privateTreeRemoved 为 true，stdout/stderr failure 均为 null。pure-standard 实际出现一次目录删除 Win32 5，第二次尝试成功，耗时 **142ms**，并有独立 `absenceChecked: true`、`absent: true`。这是本轮观测到的恢复，不宣称消除所有未来清理失败。

**本轮没有 IPC995，不等于历史 IPC995 根因已解决。** 本视觉复核不解释或覆盖先前该问题；此前各失败运行及证据仍保留原结论。

以下每个文件均存在于本轮 `../extracted/pure-standard/` 与 `../extracted/filtered-admin/`。完整逐文件哈希、比较范围和原始审计摘要见 [JSON](windows-visual-review.json)。

| 每账号实际文件 | 尺寸 | 复核方式 |
| --- | --- | --- |
| `01-initial-disabled-source-window.png` | 1028×760 | 两账号本轮直接查看 |
| `02-enable-and-exact-bytes-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |
| `02-enabled-diagram.png` | 448×102 | 两账号完整图 RGBA 与已审图一致 |
| `03-edited-diagram.png` | 448×102 | 两账号完整图 RGBA 与已审图一致 |
| `03-real-edit-save-replacement-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |
| `04-undo-exact-original-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |
| `04-undone-diagram.png` | 448×102 | 两账号完整图 RGBA 与已审图一致 |
| `05-redo-exact-edit-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |
| `05-redone-diagram.png` | 448×102 | 两账号完整图 RGBA 与已审图一致 |
| `06-disable-and-reenable-in-place-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |
| `06-reenabled-diagram.png` | 448×102 | 两账号完整图 RGBA 与已审图一致 |
| `07-c4-diagram.png` | 564×118 | 两账号完整图 RGBA 与已审图一致 |
| `07-c4-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |
| `07-invalid-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |
| `07-wide-diagram.png` | 3528×126 | 两账号完整图 RGBA 与已审图一致 |
| `07-wide-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |
| `08-final-disable-window.png` | 1028×760 | 两账号正文/状态栏 RGBA 与已审图一致 |

只生成本目录派生报告，全部 raw 文件 SHA-256 在生成前后核对一致。未修改截图、原始报告、源码或旧 beta.8 ZIP，未操作远程 CI、下载、重试、合并或 Release。此结论不建立安装器、回滚、系统 IME、多 DPI、导出或所有 C4 布局的验收。
