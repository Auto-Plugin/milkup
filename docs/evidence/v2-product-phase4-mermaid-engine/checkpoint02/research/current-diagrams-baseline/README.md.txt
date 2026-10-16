# 现有 diagrams 官方样例修前基线

执行命令：`node /workspace/milkup-mermaid-engine-evidence/research/run-current-diagrams-baseline.mjs`。退出码 0 表示基线采集与字节断言完成，不表示样例渲染成功。

**30 官方样例：ready 0，error 30，throw 0，no-fragment 0；30/30 error 的完整围栏源码 UTF-8 字节一致。** 三个现已支持控制样例（flowchart/sequence/pie）均 ready，未计入官方样例分母。

样例来源 samples.json 的 `unmodifiedOfficialBlock === true`；共37项中的7项自定义探针排除。未改写官方图源码，包括其frontmatter、样式和高级语法；只添加单一完整mermaid围栏，必要时补闭合围栏前换行。每项JSON保留真实request、from/to/contentRanges、输入SHA、返回内容类型/错误/源码fallback SHA。

| family | 样例数 | ready | error | error 源码字节一致 |
| --- | ---: | ---: | ---: | ---: |
| block | 1 | 0 | 1 | 1 |
| classDiagram | 1 | 0 | 1 | 1 |
| entityRelationshipDiagram | 1 | 0 | 1 | 1 |
| flowchart | 8 | 0 | 8 | 8 |
| gantt | 1 | 0 | 1 | 1 |
| gitgraph | 1 | 0 | 1 | 1 |
| mindmap | 2 | 0 | 2 | 2 |
| pie | 1 | 0 | 1 | 1 |
| quadrantChart | 1 | 0 | 1 | 1 |
| requirementDiagram | 1 | 0 | 1 | 1 |
| sankey | 1 | 0 | 1 | 1 |
| sequenceDiagram | 7 | 0 | 7 | 7 |
| stateDiagram | 1 | 0 | 1 | 1 |
| timeline | 1 | 0 | 1 | 1 |
| userJourney | 1 | 0 | 1 | 1 |
| xyChart | 1 | 0 | 1 | 1 |

这是这30个未修改官方示例的结果，不能推断某图种所有语法都失败。现有子集控制样例成功，部分官方例包含frontmatter/组合高级特性而被整图回退。未移除这些特性以提高ready数。

没有运行UI/native/Worker，也未检查真实DOM像素、完整语义、编辑历史或隔离deadline。ready只代表当前renderer返回状态；源码字节断言只覆盖返回的code节点，不代替实际view/save验收。

当前built入口：`/workspace/milkup/plugins/diagrams/dist/plugin.js`，SHA256 `d288b33fb1af77d6043a5869022b8094676864c2310a9241467b68c1dcee8b3d`。未重新build/修改产物；输入与entry执行后SHA再次相同。

新DOM host相关待实现红测见 `../dom-manifest-red-test-design.md`。
