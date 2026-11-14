# Linux 失败候选恢复：精确 d73 检查点

2026-10-23 的 Linux 原生生产界面测试 **32/32 通过**。从保留的失败 DOM 1.1.1 `prepared` 候选出发，通过正常插件导入 UI 直接导入已交付的 Worker 1.2.0，再开启、编辑、撤销、即时禁用和重新启用；没有先卸载插件，也没有由测试脚本人工改写 catalog。正常 UI 事务会更新 catalog。

这份记录只验证源码 **`d73b46a2a745ba330949a929191e687dd5c408e9`** 对应的早期 beta.7 候选，**不代表最终 beta.7 安装包或 Windows 验收**。受测 Linux 二进制 SHA256：

```text
939a6c1e770a9c389529ab854678f24780dc1b3af42ed42ea059dee0623cf8e8
```

构建从未提交工作树开始，冻结的受记录输入随后逐字节核对到 d73；原始 proof 的运行期漂移与提交比对漂移均为空。不能据此描述成从干净 checkout 构建。精简身份记录见 [candidate.json](candidate.json)，原始来源与变换见 [provenance.json](provenance.json)。

## 实际覆盖

| 步骤 | 实际流程 |
| --- | --- |
| 01–02 | 复用失败 pending DOM 1.1.1；正常 UI 导入 Worker 1.2.0。新候选保持 prepared、无批准、不自动启动；旧失败诊断仍保留。 |
| 03–09 | 普通 flowchart：已有文档开启即出图、修改并保存、撤销恢复原字节、即时禁用、重启用。 |
| 10–16 | 普通 sequence：同一编辑、保存、撤销和热启停流程。 |
| 17–23 | 窗口化 flowchart：同一流程，约 918 KiB 自建文件。 |
| 24–30 | 窗口化 sequence：同一流程，约 918 KiB 自建文件。 |
| 31–32 | 仅最后的窗口化 sequence：保存后退出旧应用进程，启动新的进程实例，确认同一 active generation 恢复且正文出图。 |

逐步时间、状态、catalog 版本、渲染数量和保存摘要见 [result.json](result.json)。四份夹具包含 CRLF、中文、emoji 和组合字符；大文件使用无损 gzip 保存，校验器核对解压后完整原字节。原始 harness 启动快照 SHA 与报告一致，启动快照与完整原始报告仅本地保留。本轮沿用名称含 beta6 的 harness、来自 beta6 的失败 profile 和交付 Worker 归档；这些是来源历史，没有改称 beta7 新生成材料。

## 可见证据

下列原始 PNG 已实际查看，图形标签、箭头与禁用后的源码可见。系统截图底部黑区属于虚拟显示器中应用窗口之外；没有裁剪或重绘。第 02 步截图是导入完成后回到正文、尚未开启的状态，导入事务由对应 catalog 快照证明。

- [导入后尚未开启](screenshots/02-ui-import-delivered-worker-without-removal-system.png)
- [普通流程图：系统截图](screenshots/04-ordinary-flowchart-enable-and-return-real-render-system.png) · [同一步 WebView 截图](screenshots/04-ordinary-flowchart-enable-and-return-real-render-webview.png)
- [禁用后立即还原源码](screenshots/07-ordinary-flowchart-disable-removes-render-immediately-system.png)
- [普通时序图](screenshots/11-ordinary-sequence-enable-and-return-real-render-system.png)
- [窗口化流程图](screenshots/18-windowed-flowchart-enable-and-return-real-render-system.png)
- [窗口化时序图](screenshots/25-windowed-sequence-enable-and-return-real-render-system.png)
- [真实进程重启后的时序图](screenshots/32-restart-restores-same-active-worker-and-visible-output-system.png)

这是失效 pending 候选的恢复证明，不是已启用 DOM 升级，也不覆盖旧 Worker 1.1.x 升级。只有最后一个文档做过一次进程重启。Worker 1.2.0 仍是受限 flowchart/sequence 实现，不是完整官方 Mermaid；本目录不计入独立官方引擎 50 例，也不合并 beta6 的 3/41/42 步结果。早期导入失败与 Linux DOM 诊断保留在[独立旧证据](../v2-beta7-linux-diagrams/README.md)。系统 DPI、真实 IME、Windows、安装器及最终发行包均未由本次测试验证。截图检查确认这些样例实际可见，不等于全部视觉品质验收。

## 隐私与校验

仅收录自建夹具、8 张选定截图、白名单提取的状态与构建结果。截图标题中的 `/tmp` 路径均属于这些自建夹具。排除了完整 profile/catalog、运行环境、锁与进程身份、二进制、插件包及大份原始快照。JSON 是明确标注的衍生摘要，保留来源 SHA；没有改动本地原始证据。文本凭据模式检查无命中，并对选定图片实际查看；这不代表通用秘密扫描器的完整保证。

```bash
python3 docs/evidence/v2-beta7-pending-recovery/verify.py
```

校验器只读检查清单、PNG 结构、夹具原字节、32 步声明、关键状态和来源映射；不会运行应用，也不能替代重新执行测试或 Windows 验证。
