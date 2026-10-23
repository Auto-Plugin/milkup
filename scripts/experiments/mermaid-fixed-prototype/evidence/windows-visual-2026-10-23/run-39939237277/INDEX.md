# Windows partial image evidence

Run [39939237277](https://github.com/Auto-Plugin/milkup/actions/runs/39939237277) / source `5da5f27499286606ab644c8b699133b8942f3e7b`.
**CI failed; complete=false.** Five successful positive PNGs (30,169 bytes) were
strictly reconstructed from bounded logs after all outer cleanup completed.
The sixth positive failed native deletion; 44 were not reached. Zero artifacts.

Original bytes are unchanged. See [manifest.json](manifest.json),
[separate visual inspection](human-review.json) and
[failure/cleanup record](failure-summary.json). The earlier 50-case run is
separate evidence and supplied no retained Windows images.

| #   | Fixed fixture                                                         | This run                                                | Pixels       | SHA256                                                           |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------- | ------------ | ---------------------------------------------------------------- |
| 1   | [c4](../../../fixtures/01-c4.mmd)                                     | [PNG](c4.png), decoded and visually inspected           | 1280 × 437   | 8962edb75c2428ecb00b63bd4bf3b83b03d1089197d8d404f07768cfb9a27c42 |
| 2   | [flowchart-v2](../../../fixtures/02-flowchart-v2.mmd)                 | [PNG](flowchart-v2.png), decoded and visually inspected | 1280 × 74    | 23d3f4f7654d1b66c02c83eedd43be9277a96e0cf21f178d21bfddfe14a839eb |
| 3   | [agentflow](../../../fixtures/03-agentflow.mmd)                       | [PNG](agentflow.png), decoded and visually inspected    | 1280 × 149   | b29b52952ba6278552cab9bd39d7c3ca4566225deaa4c168d12fbbf360feddcf |
| 4   | [swimlane](../../../fixtures/04-swimlane.mmd)                         | [PNG](swimlane.png), decoded and visually inspected     | 1280 × 426   | 583c44ef601f4aa7bacaf1d40af29312b69f7f5af37a0f13214973b1ae994dbe |
| 5   | [er](../../../fixtures/05-er.mmd)                                     | [PNG](er.png), decoded and visually inspected           | 1280 × 289   | 96050410ca13f8b75a32b2270305651e206629651b910382613c0ced3f7e9fa1 |
| 6   | [gitGraph](../../../fixtures/06-gitGraph.mmd)                         | Rendered, then native OS5; PNG discarded                | not retained | —                                                                |
| 7   | [gantt](../../../fixtures/07-gantt.mmd)                               | Not reached                                             | —            | —                                                                |
| 8   | [info](../../../fixtures/08-info.mmd)                                 | Not reached                                             | —            | —                                                                |
| 9   | [pie](../../../fixtures/09-pie.mmd)                                   | Not reached                                             | —            | —                                                                |
| 10  | [quadrantChart](../../../fixtures/10-quadrantChart.mmd)               | Not reached                                             | —            | —                                                                |
| 11  | [xychart](../../../fixtures/11-xychart.mmd)                           | Not reached                                             | —            | —                                                                |
| 12  | [requirement](../../../fixtures/12-requirement.mmd)                   | Not reached                                             | —            | —                                                                |
| 13  | [sequence](../../../fixtures/13-sequence.mmd)                         | Not reached                                             | —            | —                                                                |
| 14  | [classDiagram](../../../fixtures/14-classDiagram.mmd)                 | Not reached                                             | —            | —                                                                |
| 15  | [stateDiagram](../../../fixtures/15-stateDiagram.mmd)                 | Not reached                                             | —            | —                                                                |
| 16  | [journey](../../../fixtures/16-journey.mmd)                           | Not reached                                             | —            | —                                                                |
| 17  | [flowchart-elk](../../../fixtures/17-flowchart-elk.mmd)               | Not reached                                             | —            | —                                                                |
| 18  | [timeline](../../../fixtures/18-timeline.mmd)                         | Not reached                                             | —            | —                                                                |
| 19  | [mindmap](../../../fixtures/19-mindmap.mmd)                           | Not reached                                             | —            | —                                                                |
| 20  | [kanban](../../../fixtures/20-kanban.mmd)                             | Not reached                                             | —            | —                                                                |
| 21  | [sankey](../../../fixtures/21-sankey.mmd)                             | Not reached                                             | —            | —                                                                |
| 22  | [packet](../../../fixtures/22-packet.mmd)                             | Not reached                                             | —            | —                                                                |
| 23  | [radar](../../../fixtures/23-radar.mmd)                               | Not reached                                             | —            | —                                                                |
| 24  | [block](../../../fixtures/24-block.mmd)                               | Not reached                                             | —            | —                                                                |
| 25  | [treeView](../../../fixtures/25-treeView.mmd)                         | Not reached                                             | —            | —                                                                |
| 26  | [architecture](../../../fixtures/26-architecture.mmd)                 | Not reached                                             | —            | —                                                                |
| 27  | [eventmodeling](../../../fixtures/27-eventmodeling.mmd)               | Not reached                                             | —            | —                                                                |
| 28  | [ishikawa](../../../fixtures/28-ishikawa.mmd)                         | Not reached                                             | —            | —                                                                |
| 29  | [venn](../../../fixtures/29-venn.mmd)                                 | Not reached                                             | —            | —                                                                |
| 30  | [treemap](../../../fixtures/30-treemap.mmd)                           | Not reached                                             | —            | —                                                                |
| 31  | [usecase](../../../fixtures/31-usecase.mmd)                           | Not reached                                             | —            | —                                                                |
| 32  | [wardley](../../../fixtures/32-wardley.mmd)                           | Not reached                                             | —            | —                                                                |
| 33  | [cynefin](../../../fixtures/33-cynefin.mmd)                           | Not reached                                             | —            | —                                                                |
| 34  | [railroad](../../../fixtures/34-railroad.mmd)                         | Not reached                                             | —            | —                                                                |
| 35  | [railroadEbnf](../../../fixtures/35-railroadEbnf.mmd)                 | Not reached                                             | —            | —                                                                |
| 36  | [railroadAbnf](../../../fixtures/36-railroadAbnf.mmd)                 | Not reached                                             | —            | —                                                                |
| 37  | [railroadPeg](../../../fixtures/37-railroadPeg.mmd)                   | Not reached                                             | —            | —                                                                |
| 38  | [flow-html-labels](../../../fixtures/38-flow-html-labels.mmd)         | Not reached                                             | —            | —                                                                |
| 39  | [flow-markdown-labels](../../../fixtures/39-flow-markdown-labels.mmd) | Not reached                                             | —            | —                                                                |
| 40  | [flow-mathml](../../../fixtures/40-flow-mathml.mmd)                   | Not reached                                             | —            | —                                                                |
| 41  | [flow-cjk](../../../fixtures/41-flow-cjk.mmd)                         | Not reached                                             | —            | —                                                                |
| 42  | [flow-wide](../../../fixtures/42-flow-wide.mmd)                       | Not reached                                             | —            | —                                                                |
| 43  | [flow-tall](../../../fixtures/43-flow-tall.mmd)                       | Not reached                                             | —            | —                                                                |
| 44  | [flow-shadow](../../../fixtures/44-flow-shadow.mmd)                   | Not reached                                             | —            | —                                                                |
| 45  | [flow-subgraphs](../../../fixtures/45-flow-subgraphs.mmd)             | Not reached                                             | —            | —                                                                |
| 46  | [sequence-groups](../../../fixtures/46-sequence-groups.mmd)           | Not reached                                             | —            | —                                                                |
| 47  | [c4-container](../../../fixtures/47-c4-container.mmd)                 | Not reached                                             | —            | —                                                                |
| 48  | [c4-component](../../../fixtures/48-c4-component.mmd)                 | Not reached                                             | —            | —                                                                |
| 49  | [c4-dynamic](../../../fixtures/49-c4-dynamic.mmd)                     | Not reached                                             | —            | —                                                                |
| 50  | [c4-deployment](../../../fixtures/50-c4-deployment.mmd)               | Not reached                                             | —            | —                                                                |
