# beta6 Linux 原生验证：分轮结果与定点补验

前两轮使用同一个 Linux Tauri/WebKit release 二进制，产品提交为 `b3962099939149abe930d42b8c57f0a79ba009ce`，显示版本为 `2.0.0-beta.5`，二进制 SHA-256 为 `2afcf3f7573a1987944e96b9801f346849e870120539877e219fa3577bd94ba1`。第三、四轮和卸载后定点补验使用 mode 修复提交 `b7f9cdecfc02c2f0710fc9d6b71c12419364e644`，显示版本不变，二进制 SHA-256 为 `ce34e8222bec1cf4bcf24d494291e00b670221f24dc5855945692908cdfd3a16`。

每轮的 `proof.json.txt` 保留 567 项构建输入，其中 22 项为生成输入，构建退出码为 0，`inputDrift` 和 `verifiedCommitInputDrift` 均为空。二进制未归档。最终证据组合是 26 步连续通过、第 27 步卸载成功但快捷键测试缺少编辑器焦点前提，以及定点补验完整通过；没有一次完整 28 步全绿记录。

## Attempt 1：17 步通过后缩放等待失败

[完整结果](./attempt1/context.json.txt)和[原始日志](./attempt1/native-run.log.txt)记录 17 步通过，第 18 步 `ordinary-live-geometry-1280-150` 因 `Timeout: real native application zoom` 失败。失败前后观测缩放均为 1.25，未到目标 1.5；后续步骤没有执行。

该轮 fixture 连续发送缩放重置和增量快捷键，未等待各次异步缩放稳定。第二轮只补充这些等待，并继续使用同一产品二进制。[实际测试脚本](./attempt1/tested-harness.mjs.txt)来自冻结提交的 `git show`，SHA-256 与结果中记录的 `48680c86ae64762c9f6f149b7644408632f59a84cb2d56884fa4f6736c2ba171` 一致；未用后续修改覆盖该脚本。

保留第 [02 步宿主菜单](./attempt1/02-ordinary-host-menu-without-plugins-system.png)、第 [14 步普通文件 Live 浮层](./attempt1/14-ordinary-live-enable-preserves-selection-and-editor-geometry-system.png)和第 [18 步失败系统截图](./attempt1/18-ordinary-live-geometry-1280-150-failure-system.png)，并保留对应 WebView 截图。第一轮未执行第 19 步，因此没有该轮 200% 截图。

## Attempt 2：20 步通过后窗口化 Live 浮层命令失败

[完整结果](./attempt2/context.json.txt)和[原始日志](./attempt2/native-run-zoom-settled.log.txt)记录 20 步通过，第 21 步 `windowed-live-cell-floating-command-save-and-undo` 失败。点击时找不到 `formatting.tableAddRow` 按钮；失败记录的 `toolbar.commands` 为空，文档已是窗口化 Live 模式，`Alpha` 单元格存在。

主线程后续定位为 Source → Live 切换期间旧按钮被后续空输出清除，并进行了 mode 绑定修复。本目录的原始结果能直接证明按钮在点击时缺失，但不含完整 RPC 时序，不能单凭这些记录确认上述因果链。第一批归档时修复尚未通过原生验证；第三、四轮补充了修复后的证据，本轮结果仍保持失败，不回写为通过。

[实际测试脚本](./attempt2/tested-harness.mjs.txt)复制自 `/tmp/milkup-beta6-native/native-runner-zoom-settled.mjs`，SHA-256 与运行记录中的 `a070cc4cfe55098dec641151e2b6157c629815aa664e12a04ff879445b71f60a` 一致。临时副本用于固定实际测试内容；日志栈中的执行路径仍是仓库内的脚本路径。

保留第 [02 步宿主菜单](./attempt2/02-ordinary-host-menu-without-plugins-system.png)、第 [14 步普通文件 Live 浮层](./attempt2/14-ordinary-live-enable-preserves-selection-and-editor-geometry-system.png)、第 [19 步窄窗 200%](./attempt2/19-ordinary-live-geometry-760-200-system.png)和第 [21 步失败系统截图](./attempt2/21-windowed-live-cell-floating-command-save-and-undo-failure-system.png)，并保留对应 WebView 截图。第 21 步系统截图采集时按钮已经重新出现；截图晚于失败状态读取，不能把它描述为按钮一直隐藏，也不能据此否定此前的点击失败。

## Attempt 3：26 步通过，卸载指针辅助函数失败

[完整结果](./attempt3/context.json.txt)和[原始日志](./attempt3/native-run.log.txt)记录 26 步连续通过，第 27 步在 `Native wheel could not reveal ... milkup.formatting` 断言失败。此前失败的窗口化 Live 表格加行、保存、撤销已在第 [21 步](./attempt3/21-windowed-live-cell-floating-command-save-and-undo-system.png)通过，普通与窗口化文件的缩放、浮层显隐和禁用流程均已执行。

失败发生在测试辅助函数尝试滚动显示卸载按钮时，尚未完成卸载。主线程定位为浮动“更多”菜单滚动区域中心落在窗口外，真实滚轮未能作用于预期区域；[失败系统截图](./attempt3/27-uninstall-formatting-clears-floating-and-retains-host-menu-failure-system.png)保留当时浮动菜单超出窗口底部的状态。原始状态没有记录卸载按钮坐标和滚轮轨迹，因此上述因果属于后续诊断；日志直接证明辅助函数未找到可点击位置，不构成产品卸载失败证明。[实际测试脚本](./attempt3/tested-harness.mjs.txt)与原结果记录的 SHA-256 `4349b5517c05ee793ed0b8dfdc30f3e876f1633123b87406ba56accc9e80ec55` 一致。

## Attempt 4：26 步通过，卸载成功后快捷键缺少焦点前提

该轮改用真实 Tab 与 Return 完成卸载。[完整结果](./attempt4/context.json.txt)和[原始日志](./attempt4/native-run-keyboard-uninstall.log.txt)仍记录 26 步连续通过，第 27 步随后等待 `trusted keyboard context menu` 超时。失败快照已没有 Formatting 插件卡片，浮层 `commands` 为空；宿主菜单 DOM 的 7 项仍在，但未显示。失败采样中的 `focus.editor` 为 false，`focus.class` 为 `titlebar-menu-button`，原 JSON 同时保留其 HTML。脚本关闭应用菜单后没有重新把真实焦点移回编辑器，因此这次 Shift+F10 断言不能用来判定产品编辑器菜单失效。焦点快照属于失败采样，不冒充按键瞬间的另一次采样。

[实际测试脚本](./attempt4/tested-harness.mjs.txt)不是事先保留的备份：主线程从随后版本撤销新增的四行焦点代码，再用该轮启动时已记录的 SHA-256 校验恢复内容。恢复文件与原记录的 `2e241774afd5e6beb4c6688739926692102e1a03e48041b513069b60a8a0fabf` 完全一致，原结果未修改。保留第 [19 步普通文件窄窗 200%](./attempt4/19-ordinary-live-geometry-760-200-system.png)、第 [24 步窗口化窄窗 150%](./attempt4/24-windowed-live-geometry-760-150-system.png)、第 [25 步窗口化 200%](./attempt4/25-windowed-live-geometry-1280-200-system.png)和第 [27 步失败系统截图](./attempt4/27-uninstall-formatting-clears-floating-and-retains-host-menu-failure-system.png)。

## 卸载后定点补验：通过

[补验结果](./uninstall-followup/result.json.txt)、[原始日志](./uninstall-followup/uninstall-followup.log.txt)和[实际脚本](./uninstall-followup/tested-harness.mjs.txt)保留重启同一二进制后的独立补验。Formatting 重启后仍处于卸载状态；通过真实指针把焦点放回编辑器并断言成功后，Shift+F10 打开宿主菜单。菜单的六项基础动作加“插入”入口均有 SVG，插件菜单项和浮层命令均为 0，见[系统截图](./uninstall-followup/uninstalled-host-menu-system.png)及[WebView 截图](./uninstall-followup/uninstalled-host-menu.png)。普通与窗口化 CRLF/Unicode 文件的完整字节和二进制摘要在补验前后保持一致，`passed` 为 true。

仓库完整脚本随后增加真实编辑器指针与焦点断言，只进行了语法和格式检查，没有重新跑完整 28 步。此定点补验没有重复此前 26 步，也不会把第四轮原始失败结果改写为通过。

## 剪贴板与完成范围

四轮各有普通文件和窗口化文件复制、剪切合计 4 次 `native-success`，通过独立系统剪贴板读取核验。每轮另有 2 次粘贴记录为 `explicit-platform-failure`，界面明确提示“读取系统剪贴板失败，请检查剪贴板权限，或使用系统粘贴快捷键。”准确结论是 WebKit 环境中的系统剪贴板读取失败、提示明确、文档不变；日志未记录底层异常名，不能据此确定是某项 OS 权限拒绝。这些步骤的 PASS 不表示系统粘贴成功。第二轮保留普通文件与窗口化文件的 `clipboard-refused-system.png` 原图。

四轮完整脚本都在完成全部计划步骤之前退出。已完成步骤的精确保存摘要与观测仍在结果中；第四轮后的定点补验另行完成了完整文件与二进制摘要校验。原生应用缩放不是 Windows 系统 DPI 验证；本目录不包含 Windows 安装包、IME、Mermaid 升级或完整 28 步通过声明。

## 原始资料与完整性

JSON、日志和脚本仅追加 `.txt` 后缀，内容未格式化。PNG 保持原始字节；原报告的 `visuallyReviewed` 字段未被改写。每轮保留生产来源记录、构建 proof 和准确测试脚本；[helpers](./helpers/)保存结果明确记录 SHA-256 的三个共享 helper 的冻结版本。

[visual-review.json.txt](./visual-review.json.txt)按原始字节保存主线程直接查看四张真实系统截图后的记录，包含图像摘要与视觉观察。它独立于自动化断言，未回写任何原始结果字段。

[source-map.json.txt](./source-map.json.txt)逐项记录来源、大小和摘要，[SHA256SUMS](./SHA256SUMS)覆盖本目录全部归档文件。在本目录运行 `sha256sum -c SHA256SUMS` 可校验归档。前两份结果原文合计 3,221,869 字节，第三、四份合计 4,846,960 字节；按主线程确认完整保留原字节，仅选取关键截图。未收录二进制、profile 缓存或大文档 fixture，原始 `/tmp` 目录未删除。
