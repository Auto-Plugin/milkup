# P6 首次输出原生时序复核

只读解析 terminal runs 的原始日志与 observations/completion；未启动 UI、构建或渲染。完整阶段时间、来源 hash、警告和 cleanup 记录见 [JSON](first-output-timing.json)。

| Run | 终态 | 请求 / target / version | dispatch → owner accepted (ms) |
| --- | --- | --- | --- |
| p6-cold-a4-01 | automated-checks-passed | render_1 / export / 0 | 602.034282 |
| p6-cold-html-02 | automated-checks-passed | render_1 / export / 0 | 594.18865 |
| p6-cold-html-02 | automated-checks-passed | render_2 / export / 1 | 166.767593 |
| p6-cold-letter-01 | automated-checks-passed | render_1 / export / 0 | 681.243949 |
| p6-cold-print-01 | failed | render_1 / export / 0 | 621.696752 |
| p6-cold-print-02 | automated-checks-passed | render_1 / export / 0 | 627.804452 |

耗时从 native owner 实际 dispatch 开始，绝不是 enqueue 到完成；日志无 enqueue，所以 queue wait 未测。native DOM 请求数不能推算 footnotes worker 的 pending 次数。observations.elapsedMs 含用户界面/目标选择，不能当作纯渲染性能。

每个输出保留 document version 与 source SHA；HTML02 first 是 v0，r2 是真实编辑后 v1。同一已激活实例的第二次输出不能称第二次冷启动。输出警告保留原文，包含有界 Markdown 窗口及无法离线内嵌图片；这些不是 diagrams timeout。

本批已纳入请求的 timeout phase 数：0。cleanup 使用 kill-start→cleanup-complete，并单列实际 owner confirmation；没有 confirmation 不补造。process-lifecycle 最终快照仅证明所跟踪 PID/birth 状态，不外推全部系统进程。native log 中 inspector 端口占用、GTK 警告也保留，不能声称零警告。

此前 p6-cold-html-01 的 footnote marker 计数断言失败继续保留，不改记通过。completion 的 automated checks 通过不等于 PDF copy/search fidelity、物理打印、所有 P6 生命周期故障或历史 2 秒超时已修复。

最终纳入 5 个 terminal runs：4 个 automated-checks-passed、1 个 failed；共 6 个 native render 请求。另保留 HTML01 前序失败，不混入通过。全部启动记录的 expected binary SHA 与 production proof 一致：`58652f2cea9361b6ee562a65f7405259f2320f9ac170bf9598a798e58905789e`。这是 proof 所列基线 HEAD 加 changedInputs 的构建，非仅凭 HEAD 声称干净构建。

print02 的 v0 源 SHA 为 `8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7`，真实 Print-to-File PDF 已产生；harness exit 0。该轮最终跟踪的 helper current 均为 null，日志 guardian cleanup-complete 已保留。print01 的 Z 状态仍独立保留：非 running 不等于 fully reaped。

PDF 全页视觉与图表保真结论由 content 独立 review 提供（同目录 `*.pdf-review.json`）；本时序报告不替代内容审阅，亦不把 Print-to-File 称为物理打印。

p6-cold-print-01 为失败终态：Error: Command failed: xdotool search --onlyvisible --pid 170266；native accepted 不等于输出完成，未计为通过。

p6-cold-print-01 以下 guardian 只有 kill-start、无 cleanup-complete：[170252]。最终 tracked process 的 running=false 不等于确认已 reap；JSON 保留 current/state 与 birth。
