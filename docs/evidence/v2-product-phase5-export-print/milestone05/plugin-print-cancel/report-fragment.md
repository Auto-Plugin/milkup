# Milestone 05：独立插件与打印取消语义

本段仅汇总插件构建、控制器与界面回归证据。新原生 Chromium 后端的真实输出、进程清理和打印提交结果，应另引用对应生产二进制与原生运行证据；不由这些单元测试代验。本文整理期间未启动原生 UI，未修改仓库源码。

## 可追溯产物

`milkup.export-print` **1.0.1** 最终独立包：

- [milkup.export-print-1.0.1.milkup-plugin](./external-1.0.1-final/dist/milkup.export-print-1.0.1.milkup-plugin)，17,877 字节。
- SHA256：`1c6623c3ad0846353547e9e7227d577ecda0cea516aca80d3df8d794130e7c76`。
- 唯一 Milkup 依赖仍为公开 `@milkup/plugin-sdk` **0.3.5**，未增加公开方法、字段或错误码。SDK tarball：`/workspace/milkup-p5-sdk/final/milkup-plugin-sdk-0.3.5.tgz`，SHA256 `14010a1084ec1c8fc023470052a4daf56882dd7ebd60904b3d744e59baa7033a`。
- 两份 SHA 已在本段整理时重新计算核对。独立构建输入只有插件文件与公开 SDK 分发文件，生成 Worker 没有运行时 import；见 [build-meta.json](./external-1.0.1-final/dist/build-meta.json)。未导入宿主私有模块。
- [离线安装](./external-1.0.1-final/install.log)复用 53 个包、下载 0 个包；[独立构建](./external-1.0.1-final/build.log)包含通过的 TypeScript 检查。

旧 1.0.0 包 SHA256 `08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9` 保留在 milestone01；中途 `external-1.0.1` 的候选包不是上述最终交付。完整元数据见 [verification-summary.json](./verification-summary.json)；其中 `committed:false` 是生成该文件时的历史状态，不代表后续仓库状态。

## 打印取消的最终行为

调用 `host.output.print` 后，取消仅发送一次取消请求，界面显示“正在确认打印结果”，保留当前操作和资源，禁止重新开始及重复取消，直到该 Promise 返回终态。关闭面板或禁用也会发送取消请求，不提前释放尚未确认的打印资源。

宿主随后确认 `printed` 时显示成功，即使用户此前已取消；明确返回 `cancelled`，或明确的 `aborted`／`cancelled` 错误时才显示取消。打印结果无法确认（包括 `unavailable` 或未知错误）时保留错误，提示先检查系统打印队列、确认没有该任务再重试，避免重复提交。无取消请求时的同类未知结果也使用此提示。原生“已进入提交阶段后最多等待 30 秒确认”属于宿主实现约定，插件不另设超时；本段单元测试不能证明真实打印队列或 30 秒上限。

HTML／PDF 的已有取消行为保持不变；已确认写入的文件不会因迟到取消被删除。命令仍在首次 `await` 前调用 capture，命令本身不等待整个输出流程。

## RED → GREEN 证据

| 记录 | 结果 | 证明范围 |
| --- | --- | --- |
| [first-red.log](./first-red.log) | 9 失败、17 通过 | 修前过早取消、提前释放、迟到错误丢失，以及缺少确认中界面／检查队列提示 |
| [first-green.log](./first-green.log) | 26 通过 | 首轮打印取消与界面修复 |
| [dependency-red.log](./dependency-red.log) | 2 失败、29 通过 | 缺少 Linux PDF／打印系统 Chromium 依赖说明 |
| [最终仓库外 test.log](./external-1.0.1-final/test.log) | **31 通过** | 控制器 23、插件界面 7、manifest 1；含普通 HTML／PDF 取消和写入成功竞态回归 |

这些是受控测试替身驱动的协议与界面断言，不是实际物理打印，也不能将历史 WebKit Print to File 的视觉结果转计为新 Chromium 后端成功。

## 支持边界与待验项

当前原生后端仅支持 Linux。PDF 和打印需要系统已安装的 Chromium；程序不下载浏览器，缺少依赖明确报错，HTML 导出不需要 Chromium。Windows／macOS 的输出后端仍不支持。插件 README 已记录这些边界。**未实际验收物理打印机输出**；真实纸张、系统打印队列最终状态与提交后取消仍须有独立原生证据。

新 `pdf-render-cancel` 原生阶段的脚本已经准备，并通过语法、格式与不启动应用的 preflight；见 [准备记录](./pdf-render-cancel-preparation.json)及 [plan.json](./pdf-render-cancel-preflight01/plan.json)。它要求观察本次 helper 的真实 Chromium `--remote-debugging-pipe` 后代仍在执行，才点击真实取消控件，并检查目标未发布、子进程／窗口清理、编辑→撤销→保存原文 SHA 和可重新输出。若发布先完成，明确记录成功提交与“未取得取消覆盖”，不能伪报取消通过。准备记录中的 Python allowlist 待改事项已由父任务随后补齐；准备记录保留原始时间状态。这里不宣称该阶段已实际运行。

## 主报告更新建议（只读检查）

仓库顶层目前没有 README 文件。现有 `docs/v2-product-phase5-export-print-2026-10-19.md` 第 13 行仍描述 Linux PDF 使用 WebKit，第 58 行仍以旧后端复制／搜索失败作为当前边界。建议父任务新增 milestone05 或更新当前说明：写明系统 Chromium 依赖、无下载、缺依赖显式错误，以及 HTML 不依赖 Chromium；将旧 WebKit 失败与旧二进制继续保留为历史结果，新后端保真状态只按新实际文件证据判定。不要仅因插件 31 项测试通过就撤销历史失败或宣布新后端验收完成。

## 后续决策：候选已撤销（2026-10-19，优先于上文）

用户明确选择保持现有依赖并转向 WebKit 引擎补丁，否决 Chromium／Chrome 路径。研究提交 `3e9e03478bce9c8828711609919f3465136db770` 已由普通 revert 提交 `3946345e3c5a9725a49709ac7fce147cc9280815` 撤销，未改写历史；当前已提交产品树恢复为 `7241f8b875f241d6ee50535e3bc0d4c18f51052b`。

因此，上文插件 1.0.1、31 项通过、系统 Chromium 依赖及打印取消确认语义均只属于已撤销的研究候选，**未留在当前产品**；不能作为当前插件能力或最终验收通过的说明。原始包、SHA、RED／GREEN 日志保持历史意义，不覆写。新候选的生产原生 GUI 验收未执行；六个受控 helper 渲染与 GTK FileBackend 结果也仅为研究证据，未实际物理打印。下一步等待 WebKit 引擎补丁及对应验证，不因路线回退而撤销旧 WebKit 已知保真失败。

仓库内权威决策为 `docs/evidence/v2-product-phase5-export-print/milestone05/DECISION.md`；该决策优先于本片段上文及此前发行建议。
