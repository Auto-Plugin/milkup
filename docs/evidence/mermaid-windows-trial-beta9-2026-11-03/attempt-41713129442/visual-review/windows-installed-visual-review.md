# Windows 安装验收 41713129442 独立视觉复核

候选 `a5556beea5cdd1570361c528b2326bc0ad8ba0c4`。本轮实际截图在捕获的测试范围内视觉通过。两份本地原始产品报告均为 `passed`，各 10 步通过；原报告的 `visualReviewAccepted: false` 未改写，此处是独立派生审阅结论。

全部 **34 张本轮实际 PNG** 已完整解码并核对各自原始 artifact manifest：两账号各 7 张图、10 张窗口。**14 张图完整 RGBA** 与已验收源码运行 `41703213523` 同名原图一致；7 张图跨账号的编码字节及完整 RGBA 也全部一致。**19 张窗口正文和状态栏 `[0,36,1028,760)`** 与对应已验收原图一致。剩下的 filtered-admin 初始源码窗口只差 50 像素，范围 `[26,63,28,88)`，直接查看确认是标题左侧文本光标闪烁。标题栏的账号/工作路径不同，未声称整窗口像素一致。

本轮直接用 view_image 原尺寸查看了 **7 张实际 PNG**：pure-standard 的 C4 原图、宽图原图，两账号各自的 C4 和宽图窗口，以及有光标差异的 filtered-admin 初始源码窗口。C4 的 `Presents` 白底旁 `View` 左蓝色边框保持完整，beta.8 的细小缺口未复现；标签、箭头和图下 Outside 正文清楚。普通图、编辑、撤销、重做和重新启用图保持已验收像素。宽图原始 PNG 为 3528×126，完整保留 16 个节点和 15 条箭头；两账号窗口均维持自然字号和横向滚动区域。窗口只展示左侧视口，截图本身不证明已人工滚动到最右端。

C4 原图仍为 564×118，普通图为 448×102，所有窗口为 1028×760。没有发现新增裁切、文字覆盖、边框碰边或正文放置问题。范围仅限所捕获的浅色/DPR 1 fixtures，不推及全部 C4 布局、语法组合、DPI、系统中文输入法或导出。

逐文件哈希、比较范围、直接查看清单及差异见 `windows-installed-visual-review.json`。`compare-images.py` 可重复执行完整像素比较；`actual-comparison.json` 保留机器比较结果。全部 **94 项原始证据文件** 在比较前后重新计算 SHA-256，字节保持不变。源码、原始报告和截图均未修改，没有下载、运行 Windows 进程或保存截图到 Library。

视觉一致不替代安装包内容/哈希、真实账户、自然退出或原生清理的独立验证，也不解决历史 IPC 995 的具体句柄持有者问题。

复验示例：

```bash
python3 compare-images.py --raw /path/to/current/extracted/installed --accepted /path/to/attempt-41703213523/extracted --output /path/to/derived-comparison.json
```
