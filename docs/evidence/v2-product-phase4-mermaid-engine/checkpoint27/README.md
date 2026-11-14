# Checkpoint27：定向验证首次 FAIL，视觉与平台边界收敛

**当前 production08 定向原生 UI 验证首次 FAIL，Node/harness exit 1；完成 31/32 组合，保留 234 张截图，未重试。** checkpoint26 的完整原 UI 64/64 PASS 作为历史独立结果保留，不能消除本次实际预览丢失与插件停用，也没有修复或解释旧超时。产品源码仍为 `ffa662077bfe696b50c43f94691bc88e5f693c14`；此次只使用原 production08 二进制与官方插件包，原 2s/10s 预算未改。

固定归档基线为 checkpoint26 commit `b0b1f34f1e2df79bb97c925ee89f2b24ef0820c9`。本检查点仅增加文档与证据，不修改产品；原 diff/log/脚本按字节保留。Windows 内容和 failed-active capture 设计都是静态提案，不是实现、下载、打包或运行结果。

## 首次失败与未完成范围

冻结清单包含 **447 files / 81,577,458 B**，SHA256 `66eb2be2505d641f4d6b356ae18fe13fae7a7c1eb29a9e2c81cc0911b74aa8c5`。独立失败证据审计首次 exit 0 表示原始失败和哈希核验成立，**不表示产品通过**；完成态 completed-run auditor 未执行或修改。

5-case targeted catalog 保留原 Sankey、显式作者配置 Sankey 及原 contrast 样例，目标为 32 个 live 组合。共 150 条记录，最后 FAIL：31 个组合完成、63 个 Sankey matrix shots、14 个 contrast shots、13 个 corner shots、10 个 coverage、12 个 history、2 个 selection。最后成功帧是 windowed/live/dark/200%/narrow 原 Sankey bottom-right；返回 top-left 的水平轴在首次 wheel 前发现目标不再 mounted（此前垂直轴已有交互）。该组合的原图 top-left、author 图及其角落、最后 contrast 图、组合完成与终态 PASS 均未到达。

失败图显示字面 Mermaid 源码取代预览，底栏明确提示渲染超时、插件停用。DOM previews 为空，registry 为 failed/disabled；保留源码的通用 DOM notice 在视口上方，不能误写为画面内可见。文档仍 saved/clean，不代表预览持续可用。

[失败 WebView 原图](images/8cbbfe454cc95467d3f3715b583882c7b6aa515f15306767678753a16aa721f8.png) · [失败 X11 原图](images/6f3cefdae4700ced9f320a3fed61929f167b90c52218467e2e2a720a9aa209cc.png) · [原首次摘要](raw/research/production08-targeted-sankey-native-01/runtime/mermaid-ui-production08-targeted-01/control/first-result-summary.json.txt) · [独立失败证据审计](raw/research/cold-start-request-review-01/targeted-ui-failure-review-01/REPORT.md.txt)

原生日志绑定同一 App 的 `render_1037`，dispatch→deadline-observed 为 **2027.576399 ms**，deadline→cleanup-confirmed 为 376.540126 ms。没有跨进程相减，也没有从多出的 27.576399 ms 推断 CPU 饥饿、渲染或 IPC 根因。完整 driver 记录含 860 个 dispatch，1037 后缀不是已接受请求数。**失败请求的完整 wire 输入没有捕获**；当前选中的原 Sankey、前一帧和时间邻近均不足以绑定完整文档窗口、blocks、theme/layout 或内部 Mermaid 操作。

冻结清理记录 12 个已知精确 PID/birth 均 absent、10 次 reaps；不是全局完整进程树证明。77 inputs、2,913 source、12 frontend 与正式 binary/插件包保持一致。最终 ordinary/windowed 字节由独立审计按 catalog 和 160,000 Unicode 行精确重建；历史中间字节仍只是原 harness 断言。新失败保留，没有因 evidence audit 通过而改名成功。

## 部分像素与静态结论

[独立 partial pixel 报告](raw/research/targeted-sankey-pixel-review-01/REPORT.md.txt)实际查看 **34 张原 PNG（30 WebView、4 X11）**，不是全部 234 张。125%/150% 只有自动保存记录，不在本次实际像素查看范围。Root 另看的 4 张与该集合重叠，不另加唯一计数。报告保留一次读取缺失最终 top-left 图片的 ENOENT；没有拿推定帧充数。

显式作者配置 `width:1200 / height:900 / nodePadding:24 / useMaxWidth:false / labelStyle:legacy` 在已看区域改善 Sankey 标签间距；原 68 行边数据、48 个节点标签及 `showValues:false` 不改。代价是更大画布、更长横纵滚动和较差全局概览；部分文字被视口边缘裁切，暗色流带上的低对比仍在。已看的端点支持那些位置可达，不证明全部节点、所有角落或最后未完成组合。不能据此改默认 renderer、官方原样例或宣称所有重叠消失。

| 代表场景                                        | 原官方样例                                                                          | 显式作者配置                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ordinary / light / 100% / wide                  | [原图](images/fdbfa42600a4acbd1685749b2d0dbfcdba3eb35f3d9f34a7d93f4fec792a6751.png) | [配置图](images/8631e70c977f61e33fe5c6cdd91feb82e7ab8aa449d12cb597b7663af232f019.png) |
| ordinary / light / 200% / narrow / bottom-right | [原图](images/bf762ccf1bb97467da625916e4ac6743b9460b7cb3100ce9639ac604efd7a301.png) | [配置图](images/f33ebc49745e587285e79103e8e6c9a8cbab35a371a07994476c21a3c337541c.png) |

[contrast 静态证据](raw/research/contrast-layout-static-review-01/REPORT.md.txt) 表明 sequence016 明确指定紫色 box，flowchart107 明确指定浅紫底/白色 Stop；历史官方 SVG/computed-style 已含这些颜色，不能称转换器自动改色。新 coverage 原图继续呈现低对比：[sequence016](images/5eab3f55eb0c90a09ee8c2160f380058fd642f4a9bfa226084bfc18fcf06a772.png)、[flowchart107](images/149784fc64aa4b744153959c6bfd1351aab625c8d9638979b79a74f32d26a517.png)。未测数值对比率；历史 Chromium 样式不能替代当前各 WebKit 主题值。

[Journey 静态解释](raw/research/journey-canvas-static-01/REPORT.md.txt) 将最终固定样例精确连接到已完成 paired 实验（checkpoint16 固定引用）及六个一致的当前源文件。官方 responsive width 保留显式 565px 高画布，width-limited 映射仅占约157.846px，留下合法下部空白；原图与 canonical 的 bottom-right 均为空白。没有产品 crop fix，也不应特判 Journey 或以截图裁掉合法画布。paired 是研究 renderer tap/native helper；最终本轮 SVG bytes 未保存，不能声称 same-run byte-identical 重建、dark paired 实验或旧1106-pixel差异被解释。

[Windows 独立 DOM 计划](raw/research/windows-independent-dom-plan-01/PLAN.md.txt) 仅说明当前 Linux 支持缺口及未来 W0 能力门槛：网络隔离强语义与 file-picker 控制仍阻断，不能假定公共 API 已满足，也不能从 Linux UI 推出 Windows/DPI/IME 验收。没有 Windows 实现、Runtime 下载、构建、打包或运行。

[failed-active wire 最小设计](raw/research/cold-start-request-review-01/targeted-ui-failure-review-01/FAILED-ACTIVE-CAPTURE-DESIGN.md.txt) 仅为下一步提案，未实现或执行。[调度只读分析](raw/research/targeted-wheel-render-scheduling-static-01/REPORT.md.txt) 区分 harness 主动 gutter alignment（外层位移 32px）与内层到边后的其他位移；后者缺少 outer scroll/key 记录，不能仅凭位移证明产品缺陷。窗口边界改变可能触发新聚合请求，但没有证据证明相同完整输入重复派发或 cancel 错误。active cancel 不提前释放原生所有权，原 2s deadline 覆盖剩余传输、执行与校验，不是纯 Mermaid CPU 时间。未实现 cache/scroll/cancel 修复，也未新建诊断运行。

## 归档范围与复核

本检查点共 **121 个来源别名**，本地 **94 个对象 / 3,876,889 B**，复用固定历史检查点 **23 个对象 / 14,759,693 B**。本次运行只复制 8 张原 PNG（FAIL 双图及 6 张 partial pixel 代表图）；Journey 的 4 个历史原图来源通过固定 crossrefs 复用，不重复复制。

完整 447-file manifest、结果、首失败、driver/harness 原日志、四份几何/滚动 JSONL、targeted harness 与 diff/catalog/candidate、准备/GO/cleanup/exit、静态报告和独立审计原文均保留。排除复制的主体仍在外部原位：154 个 profile / 40,471,952 B、226 张未选运行 PNG / 21,955,475 B、2 个 work / 7,845,955 B，以及新 windowed.md / 7,845,955 B。该大文档保留完整哈希与独立精确重建审计，ordinary.md 5,955 B 原文入档。安装包、binary/SO、源快照及缓存主体不复制，旧外部证据不删除。

[索引](index.json) 保存完整来源、哈希、大小、选择/排除与固定 crossrefs。在本目录运行 `python3 verify-index.py` 校验原字节对象和历史引用；最终来源/边界/格式复核命令是 `bash /workspace/milkup-mermaid-engine-evidence/checkpoint27-draft/verify-final02.sh`。复核程序只检查归档与冻结记录，不启动产品或执行完成态 auditor。归档完整性 PASS 与本次产品 FAIL 始终分开。
