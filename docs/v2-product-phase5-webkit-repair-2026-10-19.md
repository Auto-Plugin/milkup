# P5：保持现有依赖的 WebKit 修复准备（2026-10-19）

本轮沿用 `dot/milkup-v2-product-phase5-export-print` 与 `7241f8b875f241d6ee50535e3bc0d4c18f51052b`。用户已明确选择“保持现有依赖，转向 WebKit 引擎补丁”。**当前没有已验证的 WebKit 文字保真或长块分页修复。** 产品代码已恢复基线，失败不改记通过。

## 路线与安装体积

此前提出的“新增系统 Chromium，或修补 WebKit”问题已得到明确回答，无需重复征询。Chromium 研究实现 `3e9e03478bce9c8828711609919f3465136db770` 已通过新增撤销提交 `3946345e3c5a9725a49709ac7fce147cc9280815` 撤回；保留历史，不强推。撤销后 `apps / packages / plugins` 与 7241 完全一致。独立插件仍为原 1.0.0；1.0.1 与新的打印确认语义仅保留研究证据。

[最终决策](./evidence/v2-product-phase5-export-print/milestone05/DECISION.md)优先于研究阶段的旧说明。没有自动 Chromium 包依赖，没有捆绑浏览器、字体或 Runtime，也没有将其转为当前可选交付方案。WebKit 补丁必须另外解决终端版本、ABI 和分发问题；不替换全局系统库，不默认附带完整自编译 WebKit，不把大依赖体积转嫁用户。

| 量                                | 实测或状态                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| 7241 沿用的 Linux ELF             | 22,320,152 字节；SHA256 `f29911982fc0d6e26d15ef572156c0c29d2fc2140ace6d2d7914b456e9635d98` |
| 已撤回研究候选 ELF                | 22,352,520 字节；SHA256 `2ac6b51b31702e14413b1eb535e061249fcaf25a3dffd6b9e4997201ba90b678` |
| ELF 增量                          | 32,368 字节                                                                                |
| 同参数 gzip ELF 增量              | 19,388 字节；不是安装包                                                                    |
| 完整压缩安装包／安装后总增量      | 未测，不能由 ELF 推断                                                                      |
| 本机 Chromium 三包 Installed-Size | 385,984 KiB = 376.9375 MiB；不含共享库和字体，不等于下载量或每台机器的安装增量             |
| Windows／macOS                    | 当前输出后端仍不支持；本轮没有验证 WebView2／WKWebView 的实现质量或分发增量                |

尺寸原始数据与哈希见[对照记录](./evidence/v2-product-phase5-export-print/milestone05/distribution-size-comparison.json)。研究构建成功不等于已验收产品，更不等于发布。

## 当前产品与研究证据分别说明

正常审批重试成功，原 WebKit 生产 PDF05 已完成独立 diagrams 1.1.1、公式和脚注启用后的真实输出。A4 七页、Letter 横向十页；17 页与此前逐页审查过的输出解码 RGB 一致，正文 100 个标记各一次。**复制／搜索仍失败**。[实际文件、原始提取与比较](./evidence/v2-product-phase5-export-print/milestone05/baseline-production-pdf05/)保留；此前审批容量失败是历史阻塞，不再表示本次 PDF05 未执行。

被撤回的 Chromium 研究证明原文簇数据可以解决原始汉字／部首、引号、组合字符、连字、emoji 和 SVG 标签丢失。六个真实 native helper 输入通过，受控外部资源监听为零；GTK FileBackend 接收的 PDF 与输入 368,049 字节完全相同。九个原分页案例的标题与首内容同页；三个首行／首项本身超页的补充案例保留全部内容。它们均是研究测试二进制，**新候选生产 GUI 未执行**，不能替代当前产品修复。扩展 Arabic 提取顺序仍失败；pypdf 忽略 ActualText 的路径仍有差异；超高表格首列可读性与代码 END 独占末页也分别记录。

研究候选完成 2,202 项 Vitest、4 项 Node、31 项独立插件测试、15 项原生单测、类型检查、全仓构建和格式检查。首次并行全仓测试有一个视图测试超时；保留失败日志，原时限单独复核和串行全仓复跑通过。这些数字归属于撤回候选，不宣称当前产品新增相应行为。撤回后以产品树精确相同核对恢复基线；没有为证据文件重复重建产品。

## WebKit 补丁的当前门槛

WebKitGTK 2.52.6 的字形绘制链缺少原文簇信息，不能靠反向字形映射区分共用同一字形的原字符。修补需覆盖 TextRun、字形和 UTF-16／UTF-8 偏移、RTL、字体回退、DisplayList 与打印链；只改 Skia 的分配 API 不能证明正确。长块分页还需保留 oversized 内容的可拆分性，不能通过裁切或把整块设为不可分页掩盖问题。

[构建、ABI 与终端部署评估](./evidence/v2-product-phase5-export-print/milestone05/webkit-patch/build-feasibility.md)已核对发行版库 SHA、build ID、已剥离符号和缺少构建条件。持久磁盘约 341 MiB；9 GB 可用 `/tmp` 是与 16 GiB 内存限额共享的 tmpfs，不能当作独立构建磁盘。没有已验证的小模块或私有二进制差分部署路线。修复进入上游／发行版正常维护是符合现有依赖方向的条件性路线，尚无接纳时间承诺。没有执行全局库替换、运行时注入、沙箱关闭或大型引擎下载；实际引擎构建和回归未通过前，所有补丁都只算研究。

[WebKit 审查材料](./evidence/v2-product-phase5-export-print/milestone05/webkit-patch/README.md)包含一个 RTL 字形／原文偏移配对的前置 diff，正向应用、反向检查和恢复原字节通过；九个源码推导反例模型通过。它没有编译或运行，既不添加 ActualText，也不是完整 PDF 修复。字体回退、非单调簇、显示列表和 IPC 接线仍有明确设计缺口。[分页源码评估](./evidence/v2-product-phase5-export-print/milestone05/content/webkit-engine-assessment/assessment.md)同样只定位候选路径；没有擅自删除 oversized 保护或修改转换器。

## 本轮保留依赖的生产补验

HTML10 使用原生产二进制与独立 1.0.0 插件，实际启用 diagrams 1.1.1。含图／省略图输出、MathML、SVG 三个中文节点和箭头、脚注双向跳转、图片原始字节及像素均通过；两份屏幕与历史 HTML04／09 逐像素一致。普通 HTML 的 source/live × 浅深色 × 四档原生缩放 × 宽窄窗口 32 格通过。见[独立内容审计](./evidence/v2-product-phase5-export-print/milestone05/html10-screen/review-summary.json)。

Large04 导出 2,101,585 字节、1,381,002 UTF-16 单元、180,060 行文档成功，含文件选择及验证的计时为 14,279 ms，未采样 RSS。矩阵只完成浅色 16 格，随后主题切换菜单等待超时；`completion.passed=true` 仅是导出流程，`layoutStatus=failed` 必须单列，不能声称 32 格通过。原截图和日志保留。验收驱动增加窗口和原生缩放实际到位的等待后，Large05 新 run 完成全部 32 格，导出计时 10,632 ms，产品不变。一次复跑通过不足以单独证明首次超时的唯一根因。

Cancel08、Disable04、Overwrite07 的原生选择器取消／插件禁用／源目标拒绝／现有文件拒绝和确认覆盖均完成，helper 与窗口清理及编辑→撤销→保存后初始源 SHA 保持一致。它们不证明正在渲染中的 PDF 取消或物理队列取消。

Print-file04 成功生成 7 页文件，100 个正文标记齐全，但实际图表回退为 Mermaid 源码，出现增强渲染未完成警告。因此富内容打印验收 **FAIL**；第 2–7 页与 PDF05 的 A4 输出不同，文字复制／搜索仍失败。实际日志记录 diagrams `render_1` 在约 2,000.31 ms 达到 deadline，控制器约 2,165.95 ms 返回；末态提示渲染超时并停用，registry 为 failed/enabled:false。本 run 没有明确 `render_1037`，不猜测更深原因。选择器观察还有 BadWindow 警告，原日志保留，不把进程退出 0 当作全面通过。详见[打印逐页审计](./evidence/v2-product-phase5-export-print/milestone05/print04-review/README.md)。

本轮没有 Library 上传、Windows Runtime 下载／构建／上传、Release、部署或合并。另一任务的 Runtime 条款及上传预算批准未用于本任务。
