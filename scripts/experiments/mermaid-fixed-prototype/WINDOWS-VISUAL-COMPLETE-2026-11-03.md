# Windows complete PNG evidence — 2026-11-03

**50 actual PNGs were independently recovered and visually inspected; product visual acceptance is not complete.** This is the fixed official Mermaid 12.2.0 prototype, not Milkup Windows GUI or an installer.

[Successful run 41620256524](https://github.com/Auto-Plugin/milkup/actions/runs/41620256524): source `53a8637a314a8bfe4cd1cbc324410790382a3315`, exact native checkpoint `3b03127cb46afcbda68180dbf28ba0cc3625401b`; 25 Windows Rust tests and PowerShell preflight passed. One canary plus the 50 established positives rendered. Runtime was preinstalled `156.0.4314.50`, with no Runtime download/installation. Prototype EXE SHA256 `5603bada73b87e581732c004e028b3eab2bb0edbe9fd256f1fc4dcf73f63d398` (8,029,184 bytes). No prototype binary is published here.

All actual host tokens were standard Users without administrator membership or SeDebugPrivilege. Helper/browser tokens were zero-capability AppContainers in the owned Job. Each native Job/profile/tree and the outer account/profile/stage were cleaned. Actual Actions artifact count: zero. Full originals total 551,169 bytes. The independent reader verified exact run/source, complete ordered transport, SHA256, PNG framing/CRC/dimensions, complete Pillow decoding, nonuniform pixels and cleanup. Its15 synthetic tests passed. The raw normalized log, API metadata, machine readback and hashes are retained [with the images](evidence/windows-visual-2026-11-03/).

The machine readback remains unchanged, including its pending human-review field. Subsequent **assistant** image inspection is separately recorded in [visual-review.json](evidence/windows-visual-2026-11-03/visual-review.json); no human-user acceptance is implied. Three assistants viewed all 50 original images against their authored sources, with nine root spot-checks.

## Actual findings

- Every sample has visible expected diagram structure; no wholly blank image or obvious whole-diagram boundary loss was observed. This is not a mathematical full-ink/no-clipping proof.
- MathML fractions/roots/superscripts and Chinese/Japanese/Korean labels are visible. HTML/Markdown labels, long diagrams and shadows also have actual pixel evidence.
- **flow-wide is 1280×30: all 16 nodes exist but labels are too small for normal reading. Wardley labels are also too small.** This is a product readability blocker, not successful visual acceptance.
- **c4-component has a relationship label overlapping its line/arrow; c4-container and c4-dynamic have lines through labels.** Root inspection confirmed these findings.
- Many simple diagrams occupy only the left portion of a fixed 1280 px canvas. Some timeline/treemap/Venn labels or outlines have weak contrast; gantt/gitGraph annotations are small. These remain visible design issues rather than hidden passes.

These 50 examples cover 37 built-in registration IDs plus 13 selected variants, not all grammar productions, configurations, external packs, themes, editor widths or DPI settings. This run used original std deletion and did not reproduce historical OS5. Full Mermaid remains unintegrated into Milkup; no new app package is available from this evidence.

## Per-image observations

| ID / original PNG | Size | Actual observation |
| --- | --- | --- |
| [c4](evidence/windows-visual-2026-11-03/c4.png) | 1280×437 | Reader、Editor、Writes 均出现；类型说明字较小。 |
| [flowchart-v2](evidence/windows-visual-2026-11-03/flowchart-v2.png) | 1280×74 | Read → Complete 两框及箭头完整、清楚。 |
| [agentflow](evidence/windows-visual-2026-11-03/agentflow.png) | 1280×149 | Writer 容器、Draft、Check 及箭头完整。 |
| [swimlane](evidence/windows-visual-2026-11-03/swimlane.png) | 1280×426 | Writer/Reviewer 泳道、Draft/Check、连线完整。 |
| [er](evidence/windows-visual-2026-11-03/er.png) | 1280×289 | PERSON、NOTE、writes 及关系端点符号完整。 |
| [gitGraph](evidence/windows-visual-2026-11-03/gitGraph.png) | 1280×178 | main/review 分支、提交点和连线完整；斜排提交标签较小。 |
| [gantt](evidence/windows-visual-2026-11-03/gantt.png) | 1280×152 | Work、Draft/Review 和日期跨度呈现；日期刻度很小且较密。 |
| [info](evidence/windows-visual-2026-11-03/info.png) | 1280×154 | 实际显示 v12.2.0；其余空白符合 info 样例。 |
| [pie](evidence/windows-visual-2026-11-03/pie.png) | 1280×454 | Draft/Done 图例及 30%/70% 扇区完整，匹配3/7。 |
| [quadrantChart](evidence/windows-visual-2026-11-03/quadrantChart.png) | 1280×504 | 四象限、Low/High轴、Point均可见。 |
| [xychart](evidence/windows-visual-2026-11-03/xychart.png) | 1280×504 | Count、One/Two、0–10刻度及3/7柱形完整；顶部刻度边距较紧。 |
| [requirement](evidence/windows-visual-2026-11-03/requirement.png) | 1280×204 | r1、ID1、Verify output、Low、Test 可读。 |
| [sequence](evidence/windows-visual-2026-11-03/sequence.png) | 1280×263 | Reader/Editor、Write、Saved及生命线完整。 |
| [classDiagram](evidence/windows-visual-2026-11-03/classDiagram.png) | 1280×164 | Note、+String title、+save()完整。 |
| [stateDiagram](evidence/windows-visual-2026-11-03/stateDiagram.png) | 1280×248 | 起点→Draft→Saved→终点完整。 |
| [journey](evidence/windows-visual-2026-11-03/journey.png) | 1280×569 | Writing、Work、Draft/Review、Reader/Writer图例及情绪标记完整。 |
| [flowchart-elk](evidence/windows-visual-2026-11-03/flowchart-elk.png) | 1280×74 | Read → Complete完整；此简单样例与普通流程图相同。 |
| [timeline](evidence/windows-visual-2026-11-03/timeline.png) | 1280×476 | Releases、2025/Draft、2026/Review及箭头完整；浅紫底白字对比偏低。 |
| [mindmap](evidence/windows-visual-2026-11-03/mindmap.png) | 1280×92 | Notes圆形根节点连接Draft、Review，文字完整。 |
| [kanban](evidence/windows-visual-2026-11-03/kanban.png) | 1280×103 | Todo、Done两列及Draft、Review卡片完整。 |
| [sankey](evidence/windows-visual-2026-11-03/sankey.png) | 1280×404 | Draft3→Review3→Done2、渐变流带和节点可见；流带贴边，未见明显截断。 |
| [packet](evidence/windows-visual-2026-11-03/packet.png) | 1280×66 | Header、Data及0/7/8/15位编号完整；编号偏小。 |
| [radar](evidence/windows-visual-2026-11-03/radar.png) | 1280×704 | speed/quality/cost、sample图例、网格和曲线完整；轴标签偏小。 |
| [block](evidence/windows-visual-2026-11-03/block.png) | 1280×54 | Draft、Review方框及箭头可见；连接间距很短。 |
| [treeView](evidence/windows-visual-2026-11-03/treeView.png) | 1280×112 | 根/、notes、draft.md、review.md及树线完整。 |
| [architecture](evidence/windows-visual-2026-11-03/architecture.png) | 1280×187 | 数据库/服务器图标、Notes/Editor及连线完整。 |
| [eventmodeling](evidence/windows-visual-2026-11-03/eventmodeling.png) | 1280×474 | UI/Automation、Command/Read Model、Events及Editor→SaveNote→NoteSaved完整。 |
| [ishikawa](evidence/windows-visual-2026-11-03/ishikawa.png) | 1280×582 | Process/Review wait、Equipment/Slow disk汇入Delayed note；图形集中左侧，留白明显。 |
| [venn](evidence/windows-visual-2026-11-03/venn.png) | 1280×454 | Draft、Review相交圆及Ready完整；黄色轮廓对比偏低。 |
| [treemap](evidence/windows-visual-2026-11-03/treemap.png) | 1280×375 | Notes10、Done7与Draft3分区完整；顶部白字较小且对比偏低。 |
| [usecase](evidence/windows-visual-2026-11-03/usecase.png) | 1280×165 | Writer人形、箭头及Save note椭圆完整。 |
| [wardley](evidence/windows-visual-2026-11-03/wardley.png) | 1280×604 | Reader/Editor、连接线、Visibility/Evolution及四阶段均出现；原始标签明显过小。 |
| [cynefin](evidence/windows-visual-2026-11-03/cynefin.png) | 1280×684 | 四象限、Confusion、Explore/Repeat和说明出现；中央线靠近说明区域。 |
| [railroad](evidence/windows-visual-2026-11-03/railroad.png) | 1280×109 | word=、a、可选b支路和端点完整；左侧标签贴边。 |
| [railroadEbnf](evidence/windows-visual-2026-11-03/railroadEbnf.png) | 1280×109 | word=、a、可选b支路及端点完整；左侧贴边。 |
| [railroadAbnf](evidence/windows-visual-2026-11-03/railroadAbnf.png) | 1280×109 | a后接可选b完整，符合该样例。 |
| [railroadPeg](evidence/windows-visual-2026-11-03/railroadPeg.png) | 1280×109 | a后接可选b完整，符合该样例。 |
| [flow-html-labels](evidence/windows-visual-2026-11-03/flow-html-labels.png) | 1280×98 | Bold、Second line、Italic、换行及粗斜体实际可见。 |
| [flow-markdown-labels](evidence/windows-visual-2026-11-03/flow-markdown-labels.png) | 1280×122 | Strong加粗、emphasis斜体、second line及Done完整，无Markdown标记残留。 |
| [flow-mathml](evidence/windows-visual-2026-11-03/flow-mathml.png) | 1280×80 | 分式a/b、加号、根号c及x²实际可见，无源码或缺字方框。 |
| [flow-cjk](evidence/windows-visual-2026-11-03/flow-cjk.png) | 1280×74 | 中文草稿、日本語の確認、한국어 완료完整可辨。 |
| [flow-wide](evidence/windows-visual-2026-11-03/flow-wide.png) | 1280×30 | Stage1–16均存在，但1280×30输出中的文字极小；可读性不合格。 |
| [flow-tall](evidence/windows-visual-2026-11-03/flow-tall.png) | 1280×2236 | Stage1–24及全部连接完整；首尾未见裁切，文字可读。 |
| [flow-shadow](evidence/windows-visual-2026-11-03/flow-shadow.png) | 1280×68 | Shadow粗边、Bounds、箭头及右下阴影可见；未见明显画布裁切。 |
| [flow-subgraphs](evidence/windows-visual-2026-11-03/flow-subgraphs.png) | 1280×390 | Workspace/Draft两层容器及Read→Write→Review完整。 |
| [sequence-groups](evidence/windows-visual-2026-11-03/sequence-groups.png) | 1280×462 | Writer/Editor、loop/alt分组、Save/Saved/Error完整。 |
| [c4-container](evidence/windows-visual-2026-11-03/c4-container.png) | 1280×437 | Reader、Editor、Container/Desktop、Notes完整；斜线穿过Writes标签。 |
| [c4-component](evidence/windows-visual-2026-11-03/c4-component.png) | 1280×366 | Parser/View、TypeScript、Reads/Shows notes可见；Presents与连线/箭头重叠，尾部辨识受影响。 |
| [c4-dynamic](evidence/windows-visual-2026-11-03/c4-dynamic.png) | 1280×437 | Reader、Editor、1. Writes可见；斜线穿过关系标签。 |
| [c4-deployment](evidence/windows-visual-2026-11-03/c4-deployment.png) | 1280×472 | Workstation、Windows框、Editor、Container/Desktop、Notes完整。 |

## Current authorization and next integration boundary

Further historical Fixed 155 execution is paused following the parent's clarified pending approval. Two completed Fixed 155 runs had already occurred; both cleaned all Windows temporary resources. Their exact results and the permission-state discrepancy are retained in [the Fixed 155 report](FIXED-RUNTIME-155-2026-11-03.md). No further old Runtime was run after that instruction. The current installed 156 image run was already complete and its remaining work was read-only evidence review. The review entry point now blocks future Fixed 155 markers pending explicit confirmation. The Linux CAB remains inert local evidence, never extracted/executed.

The minimum product decision is whether the disclosed fixed-official-code/text-input/validated-PNG service trust boundary may enter a product candidate. Prototype permission is not treated as that decision. The small-package route can reuse installed Evergreen; the 705 MB Fixed tree is not a required distribution choice. Engineering still needs same-login short-lived coordination/cancellation/cleanup (not CI's cross-SID supervisor), private PNG ownership/decode/aggregate budgets, package fingerprint/epoch binding, 1.2.0 migration/hot unload, and real editor/theme/DPI/readability verification. Filtered-administrator compatibility remains unverified and its current gate remains in place. See [17 prepared acceptance cases](PRODUCT-INTEGRATION-ACCEPTANCE.md); none is claimed executed as product integration.

Readback tooling note: direct CLI job-log download received HTTP403 from GitHub's temporary blob redirect. The authorized GitHub connector retrieved the same job successfully. No signed redirect URL is archived. This was a retrieval failure, not a product test failure; no workflow was repeated for it.
